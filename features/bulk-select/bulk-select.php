<?php
/**
 * Bulk select: checkboxes, Cmd/Ctrl-click and Shift-click selection in the
 * Style Manager, with a floating bar (a copy of the Asset Manager's) for bulk
 * Delete and Rename.
 *
 * Rename takes an old => new map for the class names in the selected styles
 * (the builder fills it from find/replace, a prefix or a suffix, plus any
 * names edited by hand). Each class name that changes is renamed everywhere
 * it's referenced: every style's selector and CSS, Etch's global stylesheets,
 * and the class attribute of every element across the site.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_feature( 'bulk-select' );
		}
	}
);


add_action(
	'rest_api_init',
	function () {
		$args = array(
			'ids'  => array(
				'type'     => 'array',
				'required' => true,
				'items'    => array(
					'type'    => 'string',
					'pattern' => '^[A-Za-z0-9_-]+$',
				),
			),
			'map'  => array(
				'type'                 => 'object',
				'required'             => true,
				'additionalProperties' => array( 'type' => 'string' ),
			),
			'bem'  => array(
				'type'    => 'boolean',
				'default' => false,
			),
			'keep' => array(
				'type'    => 'array',
				'default' => array(),
				'items'   => array( 'type' => 'string' ),
			),
		);

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			'/styles/rename/preview',
			array(
				'methods'             => 'POST',
				'args'                => $args,
				'callback'            => fn( WP_REST_Request $r ) => etch_toolkit_rest_try( fn() => rest_ensure_response( etch_toolkit_rename_public( etch_toolkit_rename_plan( $r['ids'], $r['map'], $r['bem'], $r['keep'] ) ) ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			'/styles/rename',
			array(
				'methods'             => 'POST',
				'args'                => $args,
				'callback'            => fn( WP_REST_Request $r ) => etch_toolkit_rest_try( fn() => etch_toolkit_rename_apply( $r['ids'], $r['map'], $r['bem'], $r['keep'] ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);
	}
);

/**
 * Rename class names in a selector or CSS, matched unescaped. The pattern
 * takes the longest name at each dot, so `.card` never matches inside
 * `.card__title` or `.card\:hover`, and skips comments, strings and url()s.
 *
 * @param array<string, string> $map Old class name => new class name, unescaped. New
 *                                   names are plain identifiers, so they need no escaping.
 * @throws RuntimeException When the CSS can't be read.
 */
function etch_toolkit_rename_classes_in( string $text, array $map ): string {
	if ( ! $map || ! str_contains( $text, '.' ) ) {
		return $text;
	}
	$renamed = preg_replace_callback(
		ETCH_TOOLKIT_CLASS_PATTERN,
		function ( $m ) use ( $map ) {
			// A comment, string or url(), left as it is.
			if ( ! isset( $m[1] ) || '' === $m[1] ) {
				return $m[0];
			}
			$name = etch_toolkit_css_unescape( $m[1] );
			return isset( $map[ $name ] ) ? '.' . $map[ $name ] : $m[0];
		},
		$text
	);
	if ( null === $renamed ) {
		throw new RuntimeException( 'Some CSS could not be read: ' . preg_last_error_msg() );
	}
	return $renamed;
}

/**
 * Work out everything a rename would change, without changing anything.
 *
 * @param string[]              $ids       Selected style IDs.
 * @param array<string, string> $requested Old class name => new class name, unescaped.
 *                                         Names not in the selected selectors are ignored.
 * @param bool                  $bem       Also rename BEM children and modifiers of renamed classes.
 * @param string[]              $keep      Class names to leave alone, even as BEM children.
 * @return array{
 *     classMap: array<string, string>,
 *     nested: array<int, array{from: string, to: string}>,
 *     bem: array<int, array{from: string, to: string, styled: bool}>,
 *     also: string[],
 *     styles: array<int, array{id: string, from: string, to: string, selected: bool, cssChanged: bool}>,
 *     stylesheets: string[],
 *     posts: array<int, array{id: int, title: string, type: string, elements: int}>,
 *     elements: int,
 *     errors: string[],
 *     rowErrors: array<string, string>,
 *     warnings: string[],
 *     newStyles: array<string, array<string, mixed>>,
 *     newStylesheets: array<string, array<string, mixed>>,
 *     newContent: array<int, string>,
 *     oldContent: array<int, string>
 * }
 */
function etch_toolkit_rename_plan( array $ids, array $requested, bool $bem = false, array $keep = array() ): array {
	$styles       = (array) get_option( 'etch_styles', array() );
	$stylesheets  = (array) get_option( 'etch_global_stylesheets', array() );
	$ids          = array_flip( $ids );
	$keep         = array_flip( $keep );
	$has_selector = fn( $style ) => is_array( $style ) && is_string( $style['selector'] ?? null );
	$errors       = array();
	$row_errors   = array(); // Keyed by the class name that causes them, so the builder can flag that row.
	$warnings     = array();

	// Class names read-only styles use. Those styles can't change, so neither can the names.
	$locked = array();
	foreach ( $styles as $style ) {
		if ( $has_selector( $style ) && ! empty( $style['readonly'] ) ) {
			$locked += array_fill_keys( etch_toolkit_css_classes( $style['selector'] ), true );
		}
	}

	// 1. Class names to rename: the requested ones that appear in the selected selectors.
	$map = array();
	foreach ( array_intersect_key( $styles, $ids ) as $style ) {
		if ( ! $has_selector( $style ) || 'element' === ( $style['type'] ?? '' ) || ! empty( $style['readonly'] ) ) {
			continue;
		}
		foreach ( etch_toolkit_css_classes( $style['selector'] ) as $name ) {
			if ( isset( $requested[ $name ] ) && (string) $requested[ $name ] !== $name ) {
				$map[ $name ] = (string) $requested[ $name ];
			}
		}
	}

	// Nested rules like &__title in a renamed class's own CSS. Etch writes them out with
	// the style's selector, so once .card is .box, &__title styles box__title, and every
	// card__title has to become box__title with it, whatever the BEM option says.
	$nested = array();
	foreach ( $styles as $style ) {
		if ( ! $has_selector( $style ) || ! empty( $style['readonly'] ) || ! is_string( $style['css'] ?? null )
			|| ! preg_match( '/^\.(' . ETCH_TOOLKIT_CSS_IDENT . ')$/uD', trim( $style['selector'] ), $m ) ) {
			continue;
		}
		$parent = etch_toolkit_css_unescape( $m[1] );
		if ( ! isset( $map[ $parent ] ) ) {
			continue;
		}
		// Etch's own pattern for these, in CssProcessor::parse_scss_like_syntax().
		preg_match_all( '/&(__|--|_|-)([a-zA-Z0-9_-]+)/', $style['css'], $found, PREG_SET_ORDER );
		foreach ( $found as $rule ) {
			$nested[ $parent . $rule[1] . $rule[2] ] = $map[ $parent ] . $rule[1] . $rule[2];
		}
	}
	foreach ( $nested as $child => $new ) {
		if ( isset( $keep[ $child ] ) || ( isset( $map[ $child ] ) && $map[ $child ] !== $new ) ) {
			$errors[]             = sprintf( '.%1$s is styled by a nested rule in the class it belongs to, so it has to become .%2$s.', $child, $new );
			$row_errors[ $child ] = sprintf( 'A nested rule makes this .%s.', $new );
		}
		$map[ $child ] = $new;
	}

	// Load content once, trashed posts too, so restoring one doesn't bring an old name
	// back. Posts using a new name already are read too, to say when names merge.
	$contents = array();
	if ( $map ) {
		$names = array_unique( array_merge( array_map( 'strval', array_keys( $map ) ), array_values( $map ) ) );
		foreach ( etch_toolkit_contents( true ) as $post_id => $content ) {
			$plain = etch_toolkit_plain_content( $content );
			foreach ( $names as $name ) {
				if ( str_contains( $plain, $name ) ) {
					$contents[ $post_id ] = $content;
					break;
				}
			}
		}
	}
	$universe = etch_toolkit_rename_class_universe( $styles, $stylesheets, $contents );

	// BEM children and modifiers: renaming "card" can also rename "card__cta" and "card--wide"
	// wherever they're used, even when they have no style of their own. A name follows its
	// longest renamed parent, and a name kept as it is keeps its own children too. They're
	// always listed in `bem` so the preview can show them, and only renamed when $bem is on.
	// `also` reports those without a style, since styled ones show up in `styles`.
	$styled = array();
	foreach ( $styles as $style ) {
		if ( $has_selector( $style ) && 'class' === ( $style['type'] ?? '' ) ) {
			$styled += array_fill_keys( etch_toolkit_css_classes( $style['selector'] ), true );
		}
	}
	$parents = $map + array_fill_keys( array_keys( $keep ), null );
	uksort( $parents, fn( $a, $b ) => strlen( (string) $b ) <=> strlen( (string) $a ) );
	$also      = array();
	$bem_found = array();
	$bem_map   = array();
	foreach ( $universe as $name ) {
		$name = (string) $name;
		if ( isset( $parents[ $name ] ) || isset( $locked[ $name ] ) ) {
			continue;
		}
		foreach ( $parents as $old => $new ) {
			$old = (string) $old;
			if ( ! str_starts_with( $name, $old . '__' ) && ! str_starts_with( $name, $old . '--' ) ) {
				continue;
			}
			if ( null !== $new ) {
				$bem_map[ $name ] = $new . substr( $name, strlen( $old ) );
				$bem_found[]      = array(
					'from'   => $name,
					'to'     => $bem_map[ $name ],
					'styled' => isset( $styled[ $name ] ),
				);
				if ( $bem && ! isset( $styled[ $name ] ) ) {
					$also[] = $name;
				}
			}
			break;
		}
	}
	if ( $bem ) {
		$map += $bem_map;
	}

	$targets = array();
	foreach ( $map as $old => $new ) {
		$old = (string) $old;
		if ( isset( $locked[ $old ] ) ) {
			$errors[]           = sprintf( ".%s is also used by a read-only style, which can't be renamed.", $old );
			$row_errors[ $old ] = $row_errors[ $old ] ?? 'A read-only style uses it.';
		} elseif ( ! preg_match( '/^[a-zA-Z][a-zA-Z0-9_-]*$/D', $new ) ) {
			// Etch only reads a selector as a class when the name starts with a letter. D, or $
			// would also match before a trailing newline.
			$errors[]           = sprintf( '".%s" would become ".%s", which isn\'t a valid class name.', $old, $new );
			$row_errors[ $old ] = $row_errors[ $old ] ?? 'Not a valid class name.';
		} elseif ( isset( $targets[ $new ] ) ) {
			$errors[]           = sprintf( '".%s" and ".%s" would both become ".%s".', $targets[ $new ], $old, $new );
			$row_errors[ $old ] = $row_errors[ $old ] ?? sprintf( 'Same name as .%s.', $targets[ $new ] );
		}
		$targets[ $new ] = $old;
	}

	// 2. Styles: every selector and CSS body that references a renamed class.
	$changes    = array();
	$new_styles = $styles;
	foreach ( $styles as $id => $style ) {
		if ( ! $has_selector( $style ) || ! empty( $style['readonly'] ) ) {
			continue;
		}
		$css          = is_string( $style['css'] ?? null ) ? $style['css'] : '';
		$new_selector = etch_toolkit_rename_classes_in( $style['selector'], $map );
		$new_css      = etch_toolkit_rename_classes_in( $css, $map );
		if ( $new_selector === $style['selector'] && $new_css === $css ) {
			continue;
		}
		$new_styles[ $id ]['selector'] = $new_selector;
		$new_styles[ $id ]['css']      = $new_css;
		$changes[ $id ]                = array(
			'id'         => (string) $id,
			'from'       => $style['selector'],
			'to'         => $new_selector,
			'selected'   => isset( $ids[ $id ] ),
			'cssChanged' => $new_css !== $css,
		);
	}

	// Two styles in one collection can't end up with the same selector. Only renamed
	// ones are checked, so a duplicate that's already there doesn't block every rename.
	$groups = array();
	foreach ( $new_styles as $id => $style ) {
		if ( $has_selector( $style ) ) {
			$groups[ ( $style['collection'] ?? 'default' ) . '|' . $style['selector'] ][] = $id;
		}
	}
	foreach ( $groups as $group ) {
		if ( count( $group ) < 2 || ! array_intersect_key( $changes, array_flip( $group ) ) ) {
			continue;
		}
		$selector = $new_styles[ $group[0] ]['selector'];
		$errors[] = sprintf( '"%s" would exist twice. Rename or delete the existing one first.', $selector );
		foreach ( etch_toolkit_css_classes( $selector ) as $class ) {
			$old = $targets[ $class ] ?? null;
			if ( null !== $old ) {
				$row_errors[ $old ] = $row_errors[ $old ] ?? sprintf( '%s already exists.', $selector );
				break;
			}
		}
	}

	// A new name that's in use already, as a class on elements or a style in another
	// collection, merges with what's there. Allowed, but worth knowing.
	$in_use = array_flip( $universe );
	foreach ( $map as $old => $new ) {
		if ( isset( $in_use[ $new ] ) && ! isset( $map[ $new ] ) && ! isset( $row_errors[ (string) $old ] ) ) {
			$warnings[] = sprintf( "There's already a .%1\$s on this site, so .%2\$s merges with it.", $new, $old );
		}
	}

	// 3. Global stylesheets.
	$changed_sheets  = array();
	$new_stylesheets = $stylesheets;
	foreach ( $stylesheets as $key => $sheet ) {
		$css     = is_string( $sheet['css'] ?? null ) ? $sheet['css'] : '';
		$new_css = etch_toolkit_rename_classes_in( $css, $map );
		if ( $new_css !== $css ) {
			$new_stylesheets[ $key ]['css'] = $new_css;
			$changed_sheets[]               = (string) ( $sheet['name'] ?? $key );
		}
	}

	// 4. Element class names across all content, and dynamic ones like btn--{props.variant},
	// which aren't renamed but could still make an old name.
	$changed     = array();
	$new_content = array();
	$dynamic     = array();
	foreach ( $contents as $post_id => $content ) {
		$count   = 0;
		$content = etch_toolkit_edit_block_attrs(
			$content,
			function ( $attrs, $name, &$tag ) use ( $map, &$dynamic ) {
				foreach ( etch_toolkit_block_classes( $attrs, true ) as $token ) {
					foreach ( $map as $old => $new ) {
						if ( etch_toolkit_dynamic_class_matches( $token, (string) $old ) ) {
							$dynamic[ $token ][ (string) $old ] = true;
						}
					}
				}
				return etch_toolkit_edit_block_classes( $attrs, fn( $class ) => (string) ( $map[ $class ] ?? $class ), $tag );
			},
			$count
		);

		if ( $count ) {
			$new_content[ $post_id ] = $content;
			$changed[ $post_id ]     = $count;
		}
	}
	foreach ( array_slice( $dynamic, 0, 5, true ) as $token => $olds ) {
		$warnings[] = sprintf( "The dynamic class %s can still make .%s. Dynamic classes aren't renamed, so update it by hand.", $token, implode( ', .', array_keys( $olds ) ) );
	}
	if ( count( $dynamic ) > 5 ) {
		$warnings[] = sprintf( 'And %d more dynamic classes like it.', count( $dynamic ) - 5 );
	}

	return array(
		'classMap'       => (object) $map,
		'nested'         => array_map( fn( $from, $to ) => compact( 'from', 'to' ), array_map( 'strval', array_keys( $nested ) ), array_values( $nested ) ),
		'bem'            => $bem_found,
		'also'           => $also,
		'styles'         => array_values( $changes ),
		'stylesheets'    => $changed_sheets,
		'posts'          => etch_toolkit_post_summaries( $changed ),
		'elements'       => array_sum( $changed ),
		'errors'         => array_values( array_unique( $errors ) ),
		'rowErrors'      => (object) $row_errors,
		'warnings'       => $warnings,
		// Used by apply, stripped from the preview response.
		'newStyles'      => $new_styles,
		'newStylesheets' => $new_stylesheets,
		'newContent'     => $new_content,
		'oldContent'     => array_intersect_key( $contents, $new_content ),
	);
}

/**
 * @return WP_REST_Response|WP_Error
 */
function etch_toolkit_rename_apply( array $ids, array $map, bool $bem = false, array $keep = array() ) {
	$plan = etch_toolkit_rename_plan( $ids, $map, $bem, $keep );

	if ( $plan['errors'] ) {
		return new WP_Error( 'etch_toolkit_rename_invalid', implode( ' ', $plan['errors'] ), array( 'status' => 400 ) );
	}
	if ( ! $plan['styles'] ) {
		return new WP_Error( 'etch_toolkit_rename_empty', 'Nothing to rename.', array( 'status' => 400 ) );
	}

	// Content first, all or nothing, so a failed save leaves the styles untouched too.
	$styles = get_option( 'etch_styles' );
	$saved  = etch_toolkit_update_contents( $plan['newContent'], $plan['oldContent'] );
	if ( is_wp_error( $saved ) ) {
		return $saved;
	}
	// Then the options. If one won't save, everything goes back the way it was.
	if ( ! update_option( 'etch_styles', $plan['newStyles'] ) || ( $plan['stylesheets'] && ! update_option( 'etch_global_stylesheets', $plan['newStylesheets'] ) ) ) {
		update_option( 'etch_styles', $styles );
		etch_toolkit_update_contents( $plan['oldContent'], $plan['newContent'] );
		return new WP_Error( 'etch_toolkit_rename_failed', "The renamed styles couldn't be saved, so nothing was changed.", array( 'status' => 500 ) );
	}

	return rest_ensure_response( etch_toolkit_rename_public( $plan ) );
}

/**
 * The plan minus the internal "new*" and "old*" payloads.
 */
function etch_toolkit_rename_public( array $plan ): array {
	return array_diff_key( $plan, array_flip( array( 'newStyles', 'newStylesheets', 'newContent', 'oldContent' ) ) );
}

/**
 * Every class name referenced anywhere, unescaped: style selectors and CSS,
 * global stylesheets, and element class names in the given content.
 *
 * @param array<string, array<string, mixed>> $styles      etch_styles.
 * @param array<string, array<string, mixed>> $stylesheets etch_global_stylesheets.
 * @param array<int, string>                  $contents    Post ID => content.
 * @return string[]
 */
function etch_toolkit_rename_class_universe( array $styles, array $stylesheets, array $contents ): array {
	$names = array();

	$css = array();
	foreach ( $styles as $style ) {
		$css[] = $style['selector'] ?? '';
		$css[] = $style['css'] ?? '';
	}
	foreach ( $stylesheets as $sheet ) {
		$css[] = $sheet['css'] ?? '';
	}
	foreach ( $css as $text ) {
		if ( is_string( $text ) ) {
			array_push( $names, ...etch_toolkit_css_classes( $text ) );
		}
	}

	foreach ( $contents as $content ) {
		$unused = 0;
		etch_toolkit_edit_block_attrs(
			$content,
			function ( $attrs ) use ( &$names ) {
				array_push( $names, ...etch_toolkit_block_classes( $attrs ) );
				return false;
			},
			$unused
		);
	}

	return array_values( array_unique( $names ) );
}
