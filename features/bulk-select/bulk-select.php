<?php
/**
 * Bulk select: checkboxes, Cmd/Ctrl-click and Shift-click selection in the
 * Style Manager, with a floating bar (a copy of the Asset Manager's) for bulk
 * Delete and Rename.
 *
 * Rename is find/replace inside the class names of the selected styles. Each
 * class name that changes is renamed everywhere it's referenced: every style's
 * selector and CSS, Etch's global stylesheets, and the class attribute of
 * every element across the site.
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
			'ids'     => array(
				'type'     => 'array',
				'required' => true,
				'items'    => array(
					'type'    => 'string',
					'pattern' => '^[A-Za-z0-9_-]+$',
				),
			),
			'find'    => array(
				'type'     => 'string',
				'required' => true,
				'pattern'  => '^[A-Za-z0-9_-]+$',
			),
			'replace' => array(
				'type'     => 'string',
				'required' => true,
				'pattern'  => '^[A-Za-z0-9_-]*$',
			),
			'bem'     => array(
				'type'    => 'boolean',
				'default' => false,
			),
		);

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			'/styles/rename/preview',
			array(
				'methods'             => 'POST',
				'args'                => $args,
				'callback'            => fn( WP_REST_Request $r ) => rest_ensure_response( etch_toolkit_rename_public( etch_toolkit_rename_plan( $r['ids'], $r['find'], $r['replace'], $r['bem'] ) ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			'/styles/rename',
			array(
				'methods'             => 'POST',
				'args'                => $args,
				'callback'            => fn( WP_REST_Request $r ) => etch_toolkit_rename_apply( $r['ids'], $r['find'], $r['replace'], $r['bem'] ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);
	}
);

const ETCH_TOOLKIT_CLASS_PATTERN = '/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/';

/**
 * Replace class names in a selector or CSS text using an old => new map.
 * The pattern takes the longest class name at each dot, so `.card` never
 * matches inside `.card__title`.
 *
 * @param array<string, string> $map Old class name => new class name.
 */
function etch_toolkit_rename_classes_in( string $text, array $map ): string {
	if ( ! $map ) {
		return $text;
	}
	return preg_replace_callback(
		ETCH_TOOLKIT_CLASS_PATTERN,
		fn( $m ) => isset( $map[ $m[1] ] ) ? '.' . $map[ $m[1] ] : $m[0],
		$text
	);
}

/**
 * Work out everything a rename would change, without changing anything.
 *
 * @param string[] $ids     Selected style IDs.
 * @param string   $find    Text to find inside class names.
 * @param string   $replace Replacement text.
 * @param bool     $bem     Also rename BEM children and modifiers of renamed classes.
 * @return array{
 *     classMap: array<string, string>,
 *     bem: array<int, array{from: string, to: string, styled: bool}>,
 *     also: string[],
 *     styles: array<int, array{id: string, from: string, to: string, selected: bool, cssChanged: bool}>,
 *     stylesheets: string[],
 *     posts: array<int, array{id: int, title: string, type: string, elements: int}>,
 *     elements: int,
 *     errors: string[],
 *     newStyles: array<string, array<string, mixed>>,
 *     newStylesheets: array<string, array<string, mixed>>,
 *     newContent: array<int, string>
 * }
 */
function etch_toolkit_rename_plan( array $ids, string $find, string $replace, bool $bem = false ): array {
	$styles      = get_option( 'etch_styles', array() );
	$stylesheets = get_option( 'etch_global_stylesheets', array() );
	$ids         = array_flip( $ids );

	// 1. Class names to rename: those in the selected selectors that contain $find.
	$map = array();
	foreach ( array_intersect_key( $styles, $ids ) as $style ) {
		if ( 'element' === ( $style['type'] ?? '' ) || ! empty( $style['readonly'] ) ) {
			continue;
		}
		preg_match_all( ETCH_TOOLKIT_CLASS_PATTERN, $style['selector'], $found );
		foreach ( $found[1] as $name ) {
			if ( str_contains( $name, $find ) ) {
				$map[ $name ] = str_replace( $find, $replace, $name );
			}
		}
	}
	$map = array_filter( $map, fn( $new, $old ) => $new !== $old, ARRAY_FILTER_USE_BOTH );

	// Load content once. Normalize WordPress's - escaping of "--" so the quick contains-check works.
	$contents = array();
	if ( $map ) {
		foreach ( etch_toolkit_content_post_ids() as $post_id ) {
			$content = (string) get_post_field( 'post_content', $post_id, 'raw' );
			$plain   = str_replace( '-', '-', $content );
			foreach ( array_keys( $map ) as $old ) {
				if ( str_contains( $plain, $old ) ) {
					$contents[ $post_id ] = $content;
					break;
				}
			}
		}
	}

	// BEM children and modifiers: renaming "card" can also rename "card__cta" and "card--wide"
	// wherever they're used, even when they have no style of their own. They're always
	// listed in `bem` so the preview can show them, and only renamed when $bem is on.
	// `also` reports those without a style, since styled ones show up in `styles`.
	$styled = array();
	foreach ( $styles as $style ) {
		if ( 'class' === ( $style['type'] ?? '' ) ) {
			$styled[ ltrim( $style['selector'], '.' ) ] = true;
		}
	}
	$also      = array();
	$bem_found = array();
	$bem_map   = array();
	foreach ( etch_toolkit_rename_class_universe( $styles, $stylesheets, $contents ) as $name ) {
		if ( isset( $map[ $name ] ) ) {
			continue;
		}
		foreach ( $map as $old => $new ) {
			if ( str_starts_with( $name, $old . '__' ) || str_starts_with( $name, $old . '--' ) ) {
				$bem_map[ $name ] = $new . substr( $name, strlen( $old ) );
				$bem_found[]      = array(
					'from'   => $name,
					'to'     => $bem_map[ $name ],
					'styled' => isset( $styled[ $name ] ),
				);
				if ( $bem && ! isset( $styled[ $name ] ) ) {
					$also[] = $name;
				}
				break;
			}
		}
	}
	if ( $bem ) {
		$map += $bem_map;
	}

	$errors = array();
	foreach ( $map as $old => $new ) {
		if ( ! preg_match( '/^-?[_a-zA-Z][_a-zA-Z0-9-]*$/', $new ) ) {
			$errors[] = sprintf( '".%s" would become ".%s", which isn\'t a valid class name.', $old, $new );
		}
	}

	// 2. Styles: every selector and CSS body that references a renamed class.
	$changes    = array();
	$new_styles = $styles;
	foreach ( $styles as $id => $style ) {
		if ( ! empty( $style['readonly'] ) ) {
			continue;
		}
		$selector = etch_toolkit_rename_classes_in( $style['selector'], $map );
		$css      = etch_toolkit_rename_classes_in( $style['css'] ?? '', $map );
		if ( $selector === $style['selector'] && $css === ( $style['css'] ?? '' ) ) {
			continue;
		}
		$new_styles[ $id ]['selector'] = $selector;
		$new_styles[ $id ]['css']      = $css;
		$changes[]                     = array(
			'id'         => (string) $id,
			'from'       => $style['selector'],
			'to'         => $selector,
			'selected'   => isset( $ids[ $id ] ),
			'cssChanged' => $css !== ( $style['css'] ?? '' ),
		);
	}

	// Two styles in one collection can't end up with the same selector.
	$seen = array();
	foreach ( $new_styles as $style ) {
		$key = ( $style['collection'] ?? 'default' ) . '|' . $style['selector'];
		if ( isset( $seen[ $key ] ) ) {
			$errors[] = sprintf( '"%s" would exist twice. Rename or delete the existing one first.', $style['selector'] );
		}
		$seen[ $key ] = true;
	}

	// 3. Global stylesheets.
	$changed_sheets  = array();
	$new_stylesheets = $stylesheets;
	foreach ( (array) $stylesheets as $key => $sheet ) {
		$css = etch_toolkit_rename_classes_in( $sheet['css'] ?? '', $map );
		if ( $css !== ( $sheet['css'] ?? '' ) ) {
			$new_stylesheets[ $key ]['css'] = $css;
			$changed_sheets[]               = $sheet['name'] ?? (string) $key;
		}
	}

	// 4. Element class attributes across all content.
	$posts       = array();
	$elements    = 0;
	$new_content = array();
	foreach ( $contents as $post_id => $content ) {
		$count   = 0;
		$content = etch_toolkit_edit_block_attrs(
			$content,
			function ( $attrs ) use ( $map ) {
				if ( ! isset( $attrs->attributes->class ) || ! is_string( $attrs->attributes->class ) ) {
					return false;
				}
				$tokens  = preg_split( '/\s+/', trim( $attrs->attributes->class ), -1, PREG_SPLIT_NO_EMPTY );
				$renamed = array_map( fn( $t ) => $map[ $t ] ?? $t, $tokens );
				if ( $renamed === $tokens ) {
					return false;
				}
				$attrs->attributes->class = implode( ' ', $renamed );
				return true;
			},
			$count
		);

		if ( $count ) {
			$new_content[ $post_id ] = $content;
			$posts[]                 = etch_toolkit_post_summary( $post_id, $count );
			$elements               += $count;
		}
	}

	return array(
		'classMap'       => (object) $map,
		'bem'            => $bem_found,
		'also'           => $also,
		'styles'         => $changes,
		'stylesheets'    => $changed_sheets,
		'posts'          => $posts,
		'elements'       => $elements,
		'errors'         => array_values( array_unique( $errors ) ),
		// Used by apply, stripped from the preview response.
		'newStyles'      => $new_styles,
		'newStylesheets' => $new_stylesheets,
		'newContent'     => $new_content,
	);
}

/**
 * @return WP_REST_Response|WP_Error
 */
function etch_toolkit_rename_apply( array $ids, string $find, string $replace, bool $bem = false ) {
	$plan = etch_toolkit_rename_plan( $ids, $find, $replace, $bem );

	if ( $plan['errors'] ) {
		return new WP_Error( 'etch_toolkit_rename_invalid', implode( ' ', $plan['errors'] ), array( 'status' => 400 ) );
	}
	if ( ! $plan['styles'] ) {
		return new WP_Error( 'etch_toolkit_rename_empty', 'Nothing to rename.', array( 'status' => 400 ) );
	}

	foreach ( $plan['newContent'] as $post_id => $content ) {
		$result = etch_toolkit_update_content( $post_id, $content );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
	}
	update_option( 'etch_styles', $plan['newStyles'] );
	if ( $plan['stylesheets'] ) {
		update_option( 'etch_global_stylesheets', $plan['newStylesheets'] );
	}

	return rest_ensure_response( etch_toolkit_rename_public( $plan ) );
}

/**
 * The plan minus the internal "new*" payloads.
 */
function etch_toolkit_rename_public( array $plan ): array {
	return array_diff_key( $plan, array_flip( array( 'newStyles', 'newStylesheets', 'newContent' ) ) );
}

/**
 * Every class name referenced anywhere: style selectors and CSS, global
 * stylesheets, and element class attributes in the given content.
 *
 * @param array<string, array<string, mixed>> $styles      etch_styles.
 * @param array<string, array<string, mixed>> $stylesheets etch_global_stylesheets.
 * @param array<int, string>                  $contents    Post ID => content.
 * @return string[]
 */
function etch_toolkit_rename_class_universe( array $styles, array $stylesheets, array $contents ): array {
	$names = array();

	$css = array_merge(
		array_map( fn( $s ) => ( $s['selector'] ?? '' ) . ' ' . ( $s['css'] ?? '' ), $styles ),
		array_map( fn( $s ) => $s['css'] ?? '', $stylesheets )
	);
	foreach ( $css as $text ) {
		preg_match_all( ETCH_TOOLKIT_CLASS_PATTERN, $text, $found );
		array_push( $names, ...$found[1] );
	}

	foreach ( $contents as $content ) {
		$unused = 0;
		etch_toolkit_edit_block_attrs(
			$content,
			function ( $attrs ) use ( &$names ) {
				if ( isset( $attrs->attributes->class ) && is_string( $attrs->attributes->class ) ) {
					array_push( $names, ...preg_split( '/\s+/', trim( $attrs->attributes->class ), -1, PREG_SPLIT_NO_EMPTY ) );
				}
				return false;
			},
			$unused
		);
	}

	return array_values( array_unique( $names ) );
}
