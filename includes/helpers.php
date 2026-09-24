<?php
/**
 * Shared helpers for Etch Toolkit features.
 */

defined( 'ABSPATH' ) || exit;

const ETCH_TOOLKIT_REST_NAMESPACE = 'etch-toolkit/v1';

/**
 * True when the current request is the Etch builder.
 */
function etch_toolkit_is_builder(): bool {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only context check, mirrors Etch.
	return ! is_admin() && isset( $_GET['etch'] ) && 'magic' === $_GET['etch'] && current_user_can( 'manage_options' );
}

function etch_toolkit_can_manage(): bool {
	return current_user_can( 'manage_options' );
}

/**
 * Run a REST callback, turning anything it throws into an error response
 * the builder can show, instead of a critical error page.
 *
 * @return mixed|WP_Error
 */
function etch_toolkit_rest_try( callable $callback ) {
	try {
		return $callback();
	} catch ( Throwable $e ) {
		return new WP_Error( 'etch_toolkit_error', $e->getMessage(), array( 'status' => 500 ) );
	}
}

/**
 * Register the core script and styles every feature builds on:
 * `window.etchToolkit` (REST URLs, nonce, api(), save(), el(), confirmDialog()).
 */
function etch_toolkit_register_core(): void {
	if ( wp_script_is( 'etch-toolkit', 'registered' ) ) {
		return;
	}

	$url  = ETCH_TOOLKIT_URL . 'assets/etch-toolkit';
	$path = ETCH_TOOLKIT_DIR . 'assets/etch-toolkit';

	wp_register_style( 'etch-toolkit', "{$url}.css", array(), (string) filemtime( "{$path}.css" ) );
	wp_register_script( 'etch-toolkit', "{$url}.js", array(), (string) filemtime( "{$path}.js" ), true );
	wp_add_inline_script(
		'etch-toolkit',
		'window.etchToolkit = ' . wp_json_encode(
			array(
				'restRoot' => esc_url_raw( rest_url() ),
				'restUrl'  => esc_url_raw( rest_url( ETCH_TOOLKIT_REST_NAMESPACE . '/' ) ),
				'ajaxUrl'  => esc_url_raw( admin_url( 'admin-ajax.php' ) ),
				'nonce'    => wp_create_nonce( 'wp_rest' ),
			)
		) . ';',
		'before'
	);
}

/**
 * Enqueue a feature's JS and CSS in the builder, after the core.
 *
 * @param string $feature Folder name under features/, also the file basename.
 */
function etch_toolkit_enqueue_feature( string $feature ): void {
	etch_toolkit_register_core();

	$handle = "etch-toolkit-{$feature}";
	$url    = ETCH_TOOLKIT_URL . "features/{$feature}/{$feature}";
	$path   = ETCH_TOOLKIT_DIR . "features/{$feature}/{$feature}";

	if ( file_exists( "{$path}.css" ) ) {
		wp_enqueue_style( $handle, "{$url}.css", array( 'etch-toolkit' ), (string) filemtime( "{$path}.css" ) );
	} else {
		wp_enqueue_style( 'etch-toolkit' );
	}
	wp_enqueue_script( $handle, "{$url}.js", array( 'etch-toolkit' ), (string) filemtime( "{$path}.js" ), true );
}

/**
 * IDs of every post whose content can hold Etch blocks: pages, posts,
 * custom post types, templates and components (wp_block).
 *
 * @param bool $trash Include trashed posts, so restoring one doesn't bring back an old class name.
 * @return int[]
 */
function etch_toolkit_content_post_ids( bool $trash = false ): array {
	$statuses = array( 'publish', 'draft', 'pending', 'private', 'future' );
	if ( $trash ) {
		$statuses[] = 'trash';
	}

	$ids = get_posts(
		array(
			'post_type'              => 'any',
			'post_status'            => $statuses,
			'numberposts'            => -1,
			'fields'                 => 'ids',
			'no_found_rows'          => true,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
		)
	);

	// 'any' skips post types excluded from search, which includes templates and components.
	$ids = array_merge(
		$ids,
		get_posts(
			array(
				'post_type'     => array( 'wp_template', 'wp_template_part', 'wp_block' ),
				'post_status'   => $statuses,
				'numberposts'   => -1,
				'fields'        => 'ids',
				'no_found_rows' => true,
			)
		)
	);

	return array_values( array_unique( array_map( 'intval', $ids ) ) );
}

/**
 * Run a callback on every block comment's attributes in some post content,
 * rewriting only the blocks it changes.
 *
 * Edits each block's JSON in place instead of parse_blocks() + serialize_blocks(),
 * because that round trip turns empty JSON objects into arrays and rewrites
 * blocks that weren't touched.
 *
 * @param string   $content Post content.
 * @param callable $edit    fn( object $attrs, string $name ): bool. Mutates $attrs, returns true if it changed anything.
 * @param int      $changed Set to the number of blocks changed.
 * @return string Updated content.
 * @throws RuntimeException When the content is too large or malformed to read.
 */
function etch_toolkit_edit_block_attrs( string $content, callable $edit, int &$changed ): string {
	$changed = 0;

	// Block opener tokenizer, same pattern as WP_Block_Parser.
	$pattern = '/<!--\s+wp:(?P<name>(?:[a-z][a-z0-9_-]*\/)?[a-z][a-z0-9_-]*)\s+(?P<attrs>{(?:(?:[^}]+|}+(?=})|(?!}\s+\/?-->).)*+)?}\s+)(?P<void>\/)?-->/s';

	$result = preg_replace_callback(
		$pattern,
		function ( $match ) use ( $edit, &$changed ) {
			$attrs = json_decode( $match['attrs'] );
			if ( ! is_object( $attrs ) || ! $edit( $attrs, $match['name'] ) ) {
				return $match[0];
			}

			++$changed;
			return '<!-- wp:' . $match['name'] . ' ' . serialize_block_attributes( $attrs ) . ' ' . ( empty( $match['void'] ) ? '' : '/' ) . '-->';
		},
		$content
	);

	// Skipping content that can't be read would leave it out of a site-wide change.
	if ( null === $result ) {
		throw new RuntimeException( 'Some content is too large to read: ' . preg_last_error_msg() );
	}
	return $result;
}

/*
 * Class names, read the way Etch writes them.
 *
 * With special character support on, Etch puts class names into selectors with
 * CSS.escape(), so `.md\:flex` is the class `md:flex` and `.\31 col` is `1col`.
 * Class names are compared unescaped, as they appear in class attributes.
 */

// A CSS identifier, escapes included. Mirrors CLASS_IN_CSS in assets/etch-toolkit.js.
const ETCH_TOOLKIT_CSS_IDENT = '(?:-?(?:[_a-zA-Z]|[^\x00-\x7F]|\\\\(?:[0-9a-fA-F]{1,6}\s?|[^\n\r\f0-9a-fA-F]))|--)(?:[\w-]|[^\x00-\x7F]|\\\\(?:[0-9a-fA-F]{1,6}\s?|[^\n\r\f0-9a-fA-F]))*';

// A class selector's name.
const ETCH_TOOLKIT_CLASS_PATTERN = '/\.(' . ETCH_TOOLKIT_CSS_IDENT . ')/u';

/**
 * A code point as UTF-8, or '' for NUL, a surrogate or anything past Unicode.
 */
function etch_toolkit_chr( int $code ): string {
	if ( $code < 1 || $code > 0x10FFFF || ( $code >= 0xD800 && $code <= 0xDFFF ) ) {
		return '';
	}
	return function_exists( 'mb_chr' ) ? (string) mb_chr( $code, 'UTF-8' ) : html_entity_decode( "&#{$code};", ENT_QUOTES | ENT_HTML5, 'UTF-8' );
}

/**
 * Resolve CSS escapes: `md\:flex` => "md:flex", `\31 col` => "1col".
 */
function etch_toolkit_css_unescape( string $name ): string {
	if ( ! str_contains( $name, '\\' ) ) {
		return $name;
	}
	return (string) preg_replace_callback(
		'/\\\\(?:([0-9a-fA-F]{1,6})\s?|(.))/su',
		// CSS reads an escape that isn't a character as U+FFFD.
		fn( $m ) => isset( $m[2] ) ? $m[2] : ( etch_toolkit_chr( (int) hexdec( $m[1] ) ) ?: etch_toolkit_chr( 0xFFFD ) ),
		$name
	);
}

/**
 * Post content with JSON string escapes undone, for a quick check of whether a
 * class name could be in it. WordPress escapes "--" and some other characters
 * in block attributes, and Etch saves components that way.
 */
function etch_toolkit_plain_content( string $content ): string {
	$content = preg_replace_callback(
		'/\\\\u([0-9a-fA-F]{4})/',
		fn( $m ) => etch_toolkit_chr( (int) hexdec( $m[1] ) ) ?: $m[0],
		$content
	) ?? $content;
	return str_replace( array( '\\\\', '\/', '\"' ), array( '\\', '/', '"' ), $content );
}

/**
 * The class names in a selector or CSS, unescaped, in order.
 *
 * @return string[]
 */
function etch_toolkit_css_classes( string $css ): array {
	preg_match_all( ETCH_TOOLKIT_CLASS_PATTERN, $css, $found );
	return array_map( 'etch_toolkit_css_unescape', $found[1] ?? array() );
}

/**
 * A class attribute's names, split the way Etch splits them: on whitespace
 * outside {…}, so a dynamic part like {item.on ? 'is-on' : ''} is one name.
 *
 * @return string[]
 */
function etch_toolkit_class_tokens( string $classes ): array {
	return preg_split( '/\s+(?![^{]*})/', trim( $classes ), -1, PREG_SPLIT_NO_EMPTY ) ?: array();
}

/**
 * The class names on a block: Etch's class attribute and Gutenberg's className,
 * which Etch merges into it. Dynamic parts like {props.extra} are left out.
 *
 * @param object $attrs Block attributes, from etch_toolkit_edit_block_attrs().
 * @return string[]
 */
function etch_toolkit_block_classes( object $attrs ): array {
	$classes = array();
	foreach ( array( $attrs->attributes->class ?? null, $attrs->className ?? null ) as $value ) {
		if ( is_string( $value ) ) {
			foreach ( etch_toolkit_class_tokens( $value ) as $token ) {
				if ( ! str_contains( $token, '{' ) ) {
					$classes[] = $token;
				}
			}
		}
	}
	return $classes;
}

/**
 * Rename or remove class names on a block, in Etch's class attribute and
 * Gutenberg's className. Dynamic parts like {props.extra} are left alone.
 *
 * @param object   $attrs Block attributes, from etch_toolkit_edit_block_attrs().
 * @param callable $edit  fn( string $class ): string. The new name, or '' to remove it.
 * @return bool True if anything changed.
 */
function etch_toolkit_edit_block_classes( object $attrs, callable $edit ): bool {
	$rewrite = function ( string $value ) use ( $edit ): ?string {
		$tokens = etch_toolkit_class_tokens( $value );
		$next   = array();
		foreach ( $tokens as $token ) {
			$name = str_contains( $token, '{' ) ? $token : $edit( $token );
			if ( '' !== $name ) {
				$next[] = $name;
			}
		}
		return $next === $tokens ? null : implode( ' ', $next );
	};

	$changed = false;
	if ( isset( $attrs->attributes->class ) && is_object( $attrs->attributes ) && is_string( $attrs->attributes->class ) ) {
		$value = $rewrite( $attrs->attributes->class );
		if ( null !== $value ) {
			if ( '' === $value ) {
				unset( $attrs->attributes->class );
			} else {
				$attrs->attributes->class = $value;
			}
			$changed = true;
		}
	}
	if ( isset( $attrs->className ) && is_string( $attrs->className ) ) {
		$value = $rewrite( $attrs->className );
		if ( null !== $value ) {
			if ( '' === $value ) {
				unset( $attrs->className );
			} else {
				$attrs->className = $value;
			}
			$changed = true;
		}
	}
	return $changed;
}

/**
 * Save new post content, keeping a revision where the post type supports it.
 *
 * @return true|WP_Error
 */
function etch_toolkit_update_content( int $post_id, string $content ) {
	$result = wp_update_post(
		wp_slash(
			array(
				'ID'           => $post_id,
				'post_content' => $content,
			)
		),
		true
	);
	return is_wp_error( $result ) ? $result : true;
}

/**
 * Save new content for several posts, all or nothing: if one fails, the ones
 * already saved get their old content back.
 *
 * @param array<int, string> $contents  Post ID => new content.
 * @param array<int, string> $originals Post ID => content before, to put back.
 * @return true|WP_Error
 */
function etch_toolkit_update_contents( array $contents, array $originals ) {
	$saved = array();
	foreach ( $contents as $post_id => $content ) {
		$result = etch_toolkit_update_content( $post_id, $content );
		if ( is_wp_error( $result ) ) {
			foreach ( $saved as $id ) {
				etch_toolkit_update_content( $id, $originals[ $id ] );
			}
			return new WP_Error( $result->get_error_code(), sprintf( 'Could not save "%s", so nothing was changed. %s', etch_toolkit_post_title( $post_id ), $result->get_error_message() ), array( 'status' => 500 ) );
		}
		$saved[] = $post_id;
	}
	return true;
}

/**
 * A post's title as plain text. get_the_title() is HTML, with entities like &#8217;.
 */
function etch_toolkit_post_title( int $post_id ): string {
	return html_entity_decode( wp_strip_all_tags( get_the_title( $post_id ) ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
}

/**
 * @return array{id: int, title: string, type: string, elements: int}
 */
function etch_toolkit_post_summary( int $post_id, int $elements ): array {
	$type_object = get_post_type_object( get_post_type( $post_id ) );
	return array(
		'id'       => $post_id,
		'title'    => etch_toolkit_post_title( $post_id ),
		'type'     => $type_object ? $type_object->labels->singular_name : get_post_type( $post_id ),
		'elements' => $elements,
	);
}
