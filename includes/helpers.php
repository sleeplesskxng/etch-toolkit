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
 * IDs of every post with blocks in its content: pages, posts, custom post
 * types, templates and components (wp_block), in any status but auto-drafts.
 * Types kept out of search count too, like templates and non-public custom
 * post types.
 *
 * @param bool $trash Include trashed posts, so restoring one doesn't bring back an old class name.
 * @return int[]
 */
function etch_toolkit_content_post_ids( bool $trash = false ): array {
	global $wpdb;
	$types    = array_values( array_diff( get_post_types(), array( 'attachment', 'revision', 'nav_menu_item', 'custom_css', 'customize_changeset', 'oembed_cache', 'user_request', 'wp_global_styles', 'wp_font_family', 'wp_font_face' ) ) );
	$statuses = array_values( array_diff( get_post_stati(), $trash ? array( 'auto-draft', 'inherit' ) : array( 'auto-draft', 'inherit', 'trash' ) ) );
	$in_types = implode( ',', array_fill( 0, count( $types ), '%s' ) );
	$in_stati = implode( ',', array_fill( 0, count( $statuses ), '%s' ) );

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
	$ids = $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type IN ($in_types) AND post_status IN ($in_stati) AND post_content LIKE %s ORDER BY ID", array_merge( $types, $statuses, array( '%' . $wpdb->esc_like( '<!-- wp:' ) . '%' ) ) ) );
	return array_map( 'intval', $ids );
}

/**
 * The raw content of every post etch_toolkit_content_post_ids() returns, read
 * a batch at a time: a few queries for a big site instead of one per post,
 * without holding every post in memory.
 *
 * @param bool $trash Include trashed posts.
 * @return Generator<int, string> Post ID => content.
 */
function etch_toolkit_contents( bool $trash = false ): Generator {
	global $wpdb;
	foreach ( array_chunk( etch_toolkit_content_post_ids( $trash ), 100 ) as $ids ) {
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT ID, post_content FROM {$wpdb->posts} WHERE ID IN ($placeholders)", $ids ) );
		foreach ( $rows as $row ) {
			yield (int) $row->ID => (string) $row->post_content;
		}
	}
}

/**
 * Run a callback on every block comment's attributes in some post content,
 * rewriting only the blocks it changes.
 *
 * Edits each block's JSON in place instead of parse_blocks() + serialize_blocks(),
 * because that round trip turns empty JSON objects into arrays and rewrites
 * blocks that weren't touched.
 *
 * The callback also gets the first tag of the block's saved HTML, if any, where
 * Gutenberg writes className too. It can change that tag in place.
 *
 * @param string   $content Post content.
 * @param callable $edit    fn( object $attrs, string $name, string &$tag ): bool. Mutates $attrs, returns true if it changed anything.
 * @param int      $changed Set to the number of blocks changed.
 * @return string Updated content.
 * @throws RuntimeException When the content is too large or malformed to read.
 */
function etch_toolkit_edit_block_attrs( string $content, callable $edit, int &$changed ): string {
	$changed = 0;

	// Block opener tokenizer, same pattern as WP_Block_Parser, then the tag that opens
	// the block's HTML, for blocks that aren't void.
	$pattern = '/<!--\s+wp:(?P<name>(?:[a-z][a-z0-9_-]*\/)?[a-z][a-z0-9_-]*)\s+(?P<attrs>{(?:(?:[^}]+|}+(?=})|(?!}\s+\/?-->).)*+)?}\s+)(?P<void>\/)?-->'
		. '(?(void)|(?P<tag>\s*<[a-zA-Z][\w:-]*(?:\s+[^\s>"\'=\/]+(?:\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s"\'>]+))?)*\s*\/?>)?)/s';

	$result = preg_replace_callback(
		$pattern,
		function ( $match ) use ( $edit, &$changed ) {
			$attrs = json_decode( $match['attrs'] );
			$tag   = $match['tag'] ?? '';
			if ( ! is_object( $attrs ) || ! $edit( $attrs, $match['name'], $tag ) ) {
				return $match[0];
			}

			++$changed;
			// No attributes left is written the way Gutenberg writes it: none at all.
			$json = serialize_block_attributes( $attrs );
			return '<!-- wp:' . $match['name'] . ( '{}' === $json ? '' : ' ' . $json ) . ' ' . ( empty( $match['void'] ) ? '' : '/' ) . '-->' . $tag;
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

// A class selector's name, in group 1. Comments, strings and url()s match too, with
// no group 1, so a class-like ".png" or ".pdf" inside them is left alone.
const ETCH_TOOLKIT_CLASS_PATTERN = '/\/\*.*?\*\/|"(?:[^"\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\n]|\\\\.)*\'|\b(?i:url)\(\s*(?:"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|[^)]*)\s*\)|\.(' . ETCH_TOOLKIT_CSS_IDENT . ')/su';

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
		// A character past U+FFFF, like an emoji, is written as a surrogate pair.
		'/\\\\u(d[89ab][0-9a-f]{2})\\\\u(d[c-f][0-9a-f]{2})|\\\\u([0-9a-f]{4})/i',
		function ( $m ) {
			$code = isset( $m[3] ) ? hexdec( $m[3] ) : 0x10000 + ( ( hexdec( $m[1] ) - 0xD800 ) << 10 ) + hexdec( $m[2] ) - 0xDC00;
			return etch_toolkit_chr( (int) $code ) ?: $m[0];
		},
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
	return array_map( 'etch_toolkit_css_unescape', array_values( array_filter( $found[1] ?? array(), 'strlen' ) ) );
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
 * which Etch merges into it. Dynamic parts like {props.extra} are left out, or
 * with $dynamic, they're all you get.
 *
 * @param object $attrs   Block attributes, from etch_toolkit_edit_block_attrs().
 * @param bool   $dynamic The dynamic parts instead, like btn--{props.variant}.
 * @return string[]
 */
function etch_toolkit_block_classes( object $attrs, bool $dynamic = false ): array {
	$classes = array();
	foreach ( array( $attrs->attributes->class ?? null, $attrs->className ?? null ) as $value ) {
		if ( is_string( $value ) ) {
			foreach ( etch_toolkit_class_tokens( $value ) as $token ) {
				if ( str_contains( $token, '{' ) === $dynamic ) {
					$classes[] = $token;
				}
			}
		}
	}
	return $classes;
}

/**
 * Could a dynamic class name produce this class name? With fixed text around
 * its expressions, anything that fits: btn--{props.variant} could be any
 * btn--…. An expression on its own could be the names it spells out in
 * quotes: {item.on ? 'is-on' : ''} could be is-on.
 */
function etch_toolkit_dynamic_class_matches( string $token, string $class ): bool {
	return (bool) etch_toolkit_dynamic_class_filter( $token, array( $class ) );
}

/**
 * The class names a dynamic class name could produce, of those given. Works
 * out the token once, for checking many names.
 *
 * @param string   $token   Dynamic class name, like btn--{props.variant}.
 * @param string[] $classes Class names.
 * @return string[]
 */
function etch_toolkit_dynamic_class_filter( string $token, array $classes ): array {
	$fixed = preg_split( '/\{[^{}]*\}/', $token ) ?: array();
	if ( '' !== implode( '', $fixed ) ) {
		return array_values( preg_grep( '/^' . implode( '.*', array_map( fn( $part ) => preg_quote( $part, '/' ), $fixed ) ) . '$/sD', $classes ) ?: array() );
	}
	preg_match_all( '/([\'"])(.*?)\1/s', $token, $quoted );
	$names = preg_split( '/\s+/', implode( ' ', $quoted[2] ), -1, PREG_SPLIT_NO_EMPTY ) ?: array();
	return array_values( array_filter( $classes, fn( $class ) => in_array( $class, $names, true ) ) );
}

/**
 * Rename or remove class names on a block, in Etch's class attribute and
 * Gutenberg's className. Dynamic parts like {props.extra} are left alone.
 *
 * Gutenberg also writes className into the tag that opens the block's saved
 * HTML, so the same names change there, or the block editor would call the
 * block invalid and the page would still show the old names.
 *
 * @param object   $attrs Block attributes, from etch_toolkit_edit_block_attrs().
 * @param callable $edit  fn( string $class ): string. The new name, or '' to remove it.
 * @param string   $tag   The tag that opens the block's HTML, from etch_toolkit_edit_block_attrs().
 * @return bool True if anything changed.
 */
function etch_toolkit_edit_block_classes( object $attrs, callable $edit, string &$tag = '' ): bool {
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
		$before = etch_toolkit_class_tokens( $attrs->className );
		$value  = $rewrite( $attrs->className );
		if ( null !== $value ) {
			if ( '' === $value ) {
				unset( $attrs->className );
			} else {
				$attrs->className = $value;
			}
			$changed = true;

			$html = new WP_HTML_Tag_Processor( $tag );
			if ( '' !== $tag && $html->next_tag() && is_string( $html->get_attribute( 'class' ) ) ) {
				$names = preg_split( '/\s+/', trim( $html->get_attribute( 'class' ) ), -1, PREG_SPLIT_NO_EMPTY ) ?: array();
				$next  = array();
				foreach ( $names as $name ) {
					// Only the names className put there. Classes like wp-block-group stay.
					$new = in_array( $name, $before, true ) ? $edit( $name ) : $name;
					if ( '' !== $new ) {
						$next[] = $new;
					}
				}
				if ( $next !== $names ) {
					$next ? $html->set_attribute( 'class', implode( ' ', $next ) ) : $html->remove_attribute( 'class' );
					// Removing the attribute leaves a space behind: <p >.
					$tag = (string) preg_replace( '/\s+(\/?>)$/', '$1', $html->get_updated_html() );
				}
			}
		}
	}
	return $changed;
}

/**
 * Save new post content, keeping a revision where the post type supports it.
 * The status stays as it is: wp_update_post() would publish a scheduled post
 * whose time has passed. Anything a save hook throws comes back as an error.
 *
 * @return true|WP_Error
 */
function etch_toolkit_update_content( int $post_id, string $content ) {
	$status = get_post_status( $post_id );
	$keep   = function ( $data, $postarr ) use ( $post_id, $status ) {
		if ( $status && (int) ( $postarr['ID'] ?? 0 ) === $post_id ) {
			$data['post_status'] = $status;
		}
		return $data;
	};

	add_filter( 'wp_insert_post_data', $keep, 10, 2 );
	try {
		$result = wp_update_post(
			wp_slash(
				array(
					'ID'           => $post_id,
					'post_content' => $content,
				)
			),
			true
		);
	} catch ( Throwable $e ) {
		$result = new WP_Error( 'etch_toolkit_save_failed', $e->getMessage() );
	} finally {
		remove_filter( 'wp_insert_post_data', $keep, 10 );
	}
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
	// Every save makes a revision and runs save hooks, which adds up on a big site.
	wp_raise_memory_limit( 'admin' );
	if ( function_exists( 'set_time_limit' ) ) {
		set_time_limit( 300 );
	}

	$saved = array();
	foreach ( $contents as $post_id => $content ) {
		$result = etch_toolkit_update_content( $post_id, $content );
		if ( ! is_wp_error( $result ) ) {
			$saved[] = $post_id;
			continue;
		}

		$stuck = array();
		foreach ( $saved as $id ) {
			if ( is_wp_error( etch_toolkit_update_content( $id, $originals[ $id ] ) ) ) {
				$stuck[] = etch_toolkit_post_title( $id );
			}
		}
		$message = sprintf( 'Could not save "%s". %s', etch_toolkit_post_title( $post_id ), $result->get_error_message() );
		$message .= $stuck
			? sprintf( " These were saved and couldn't be put back, so check them: %s.", implode( ', ', $stuck ) )
			: ' Nothing was changed.';
		return new WP_Error( $result->get_error_code(), $message, array( 'status' => 500 ) );
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
 * Summaries of the posts a change touches, loading them in one query.
 *
 * @param array<int, int> $elements Post ID => elements changed.
 * @return array<int, array{id: int, title: string, type: string, elements: int}>
 */
function etch_toolkit_post_summaries( array $elements ): array {
	_prime_post_caches( array_keys( $elements ), false, false );
	$summaries = array();
	foreach ( $elements as $post_id => $count ) {
		$summaries[] = etch_toolkit_post_summary( $post_id, $count );
	}
	return $summaries;
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
