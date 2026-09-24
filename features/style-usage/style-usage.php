<?php
/**
 * Style usage: counts how many blocks use each Etch style
 * and shows the count in the Style Manager.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			'/style-usage',
			array(
				'methods'             => 'GET',
				'callback'            => fn() => etch_toolkit_rest_try( fn() => rest_ensure_response( array( 'counts' => (object) etch_toolkit_style_usage_counts() ) ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);
	}
);

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_feature( 'style-usage' );
		}
	}
);

/**
 * Count the blocks that use each Etch style selector across all saved content.
 *
 * A block uses a selector when it references the style by ID, or when its
 * `id` or class names match a `#id` or `.class` selector directly. Other
 * selectors, like `.card:hover` or `.card:hover .card__title`, count the
 * blocks that carry the classes of the element they style (`.card`,
 * `.card__title`). Each block counts once per selector.
 *
 * Component instances reference styles in their class properties, by ID, and
 * a component's class properties can default to styles. Each counts as a use.
 *
 * A dynamic class name counts as every class it could be: btn--{props.variant}
 * as .btn--primary, and {item.on ? 'is-on' : ''} as .is-on.
 *
 * @return array<string, int> Selector => number of blocks using it. Selectors
 *                            with nothing to count, like `.card > p`, are left
 *                            out unless a block references them by ID.
 */
function etch_toolkit_style_usage_counts(): array {
	$selectors = array(); // Style ID => selector.
	$simple    = array(); // "class:card" or "id:main", unescaped => selectors.
	$targets   = array(); // Other selectors => class lists, from etch_toolkit_style_usage_targets().
	$counts    = array();
	foreach ( (array) get_option( 'etch_styles', array() ) as $id => $style ) {
		if ( ! is_string( $style['selector'] ?? null ) ) {
			continue;
		}
		$selector         = trim( $style['selector'] );
		$selectors[ $id ] = $selector;
		if ( preg_match( '/^([.#])(' . ETCH_TOOLKIT_CSS_IDENT . ')$/u', $selector, $m ) ) {
			$simple[ ( '.' === $m[1] ? 'class:' : 'id:' ) . etch_toolkit_css_unescape( $m[2] ) ][ $selector ] = true;
			$counts[ $selector ] = 0;
		} elseif ( $found = etch_toolkit_style_usage_targets( $selector ) ) {
			$targets[ $selector ] = $found;
			$counts[ $selector ]  = 0;
		}
	}

	$dynamic = array(); // Dynamic class name => the class names it could be, worked out once each.
	foreach ( etch_toolkit_contents() as $content ) {
		if ( ! preg_match( '/"(?:styles|attributes|className)"/', $content ) ) {
			continue;
		}
		$unused = 0;
		etch_toolkit_edit_block_attrs(
			$content,
			function ( $attrs, $name ) use ( $selectors, $simple, $targets, &$counts, &$dynamic ) {
				etch_toolkit_count_block_styles( $attrs, $name, $selectors, $simple, $targets, $counts, $dynamic );
				return false;
			},
			$unused
		);
	}

	$components = get_posts(
		array(
			'post_type'     => 'wp_block',
			'post_status'   => array( 'publish', 'draft', 'pending', 'private', 'future' ),
			'numberposts'   => -1,
			'fields'        => 'ids',
			'no_found_rows' => true,
		)
	);
	update_meta_cache( 'post', $components );
	foreach ( $components as $post_id ) {
		$defaults = etch_toolkit_component_defaults( get_post_meta( $post_id, 'etch_component_properties', true ) );
		foreach ( array_unique( etch_toolkit_style_ids_in( $defaults, $selectors ) ) as $style_id ) {
			$counts[ $selectors[ $style_id ] ] = ( $counts[ $selectors[ $style_id ] ] ?? 0 ) + 1;
		}
	}

	return $counts;
}

/**
 * The classes of the element a selector styles, per comma-separated part:
 * `.card:hover .card__title::before` => [ [ 'card__title' ] ]. Parts that
 * style an element without a class, like `.card > p`, are skipped.
 *
 * @return array<int, string[]> Class names, unescaped.
 */
function etch_toolkit_style_usage_targets( string $selector ): array {
	// Rewrite escapes as six hex digits, so an escaped "(" or ":" can't read as syntax.
	$selector = (string) preg_replace_callback(
		'/\\\\(?:([0-9a-fA-F]{1,6})\s?|(.))/su',
		fn( $m ) => isset( $m[2] ) ? ( 1 === strlen( $m[2] ) ? sprintf( '\\%06X', ord( $m[2] ) ) : $m[0] ) : sprintf( '\\%06X', hexdec( $m[1] ) ),
		$selector
	);

	// Drop (…) and […] so their commas, spaces and classes don't count.
	do {
		$selector = preg_replace( '/\([^()]*\)|\[[^\[\]]*\]/', '', $selector, -1, $n );
	} while ( $n );

	$targets = array();
	foreach ( explode( ',', $selector ) as $part ) {
		$parts   = preg_split( '/\s*[>+~]\s*|\s+/', trim( $part ), -1, PREG_SPLIT_NO_EMPTY );
		$subject = preg_replace( '/::?[\w-]+/', '', (string) end( $parts ) );
		$classes = etch_toolkit_css_classes( (string) $subject );
		if ( $classes ) {
			$targets[] = $classes;
		}
	}
	return $targets;
}

/**
 * Count one block's uses of each selector.
 *
 * @param object               $attrs     Block attributes.
 * @param string               $name      Block name.
 * @param array<string, string> $selectors Style ID => selector.
 * @param array<string, array>  $simple    "class:card" or "id:main" => selectors.
 * @param array<string, array>  $targets   Selector => class lists, from etch_toolkit_style_usage_targets().
 * @param array<string, int>    $counts    Running totals, by reference.
 * @param array<string, array>  $dynamic   Dynamic class name => the class names it could be, filled in as they come up.
 */
function etch_toolkit_count_block_styles( object $attrs, string $name, array $selectors, array $simple, array $targets, array &$counts, array &$dynamic = array() ): void {
	$used = array();

	// Styles referenced by ID: the block's own, and a component instance's class properties.
	$ids = is_array( $attrs->styles ?? null ) ? $attrs->styles : array();
	if ( 'etch/component' === $name ) {
		array_push( $ids, ...etch_toolkit_style_ids_in( $attrs->attributes ?? null, $selectors ) );
	}
	foreach ( $ids as $style_id ) {
		if ( is_string( $style_id ) && isset( $selectors[ $style_id ] ) ) {
			$used[ $selectors[ $style_id ] ] = true;
		}
	}

	$id = $attrs->attributes->id ?? null;
	if ( is_string( $id ) && '' !== trim( $id ) ) {
		$used += $simple[ 'id:' . trim( $id ) ] ?? array();
	}
	$classes = array_flip( etch_toolkit_block_classes( $attrs ) );
	// A dynamic class name like btn--{props.variant} could be any class that fits.
	foreach ( etch_toolkit_block_classes( $attrs, true ) as $token ) {
		if ( ! isset( $dynamic[ $token ] ) ) {
			$dynamic[ $token ] = etch_toolkit_dynamic_class_uses( $token, $simple, $targets );
		}
		$classes += $dynamic[ $token ];
	}
	foreach ( array_keys( $classes ) as $class ) {
		$used += $simple[ 'class:' . $class ] ?? array();
	}

	if ( $classes ) {
		foreach ( $targets as $selector => $parts ) {
			foreach ( $parts as $part ) {
				if ( ! array_diff_key( array_flip( $part ), $classes ) ) {
					$used[ $selector ] = true;
					break;
				}
			}
		}
	}

	foreach ( array_keys( $used ) as $selector ) {
		$counts[ $selector ] = ( $counts[ $selector ] ?? 0 ) + 1;
	}
}

/**
 * The class names selectors count that a dynamic class name could be.
 *
 * @param string               $token   Dynamic class name, like btn--{props.variant}.
 * @param array<string, array> $simple  "class:card" or "id:main" => selectors.
 * @param array<string, array> $targets Selector => class lists, from etch_toolkit_style_usage_targets().
 * @return array<string, true> Class name => true.
 */
function etch_toolkit_dynamic_class_uses( string $token, array $simple, array $targets ): array {
	$names = array();
	foreach ( array_keys( $simple ) as $key ) {
		if ( str_starts_with( (string) $key, 'class:' ) ) {
			$names[ substr( (string) $key, 6 ) ] = true;
		}
	}
	foreach ( $targets as $parts ) {
		foreach ( $parts as $part ) {
			$names += array_fill_keys( $part, true );
		}
	}
	return array_filter( $names, fn( $class ) => etch_toolkit_dynamic_class_matches( $token, (string) $class ), ARRAY_FILTER_USE_KEY );
}

/**
 * Known style IDs in a value: a component's class property, which Etch stores
 * as style IDs, including inside groups and repeaters.
 *
 * @param mixed                 $value     Attribute or property value.
 * @param array<string, string> $selectors Style ID => selector.
 * @return string[]
 */
function etch_toolkit_style_ids_in( $value, array $selectors ): array {
	if ( is_string( $value ) ) {
		return array_values( array_filter( preg_split( '/\s+/', $value, -1, PREG_SPLIT_NO_EMPTY ), fn( $token ) => isset( $selectors[ $token ] ) ) );
	}
	$ids = array();
	if ( is_array( $value ) || is_object( $value ) ) {
		foreach ( $value as $item ) {
			array_push( $ids, ...etch_toolkit_style_ids_in( $item, $selectors ) );
		}
	}
	return $ids;
}

/**
 * The default values in a component's property definitions, including nested ones.
 *
 * @param mixed $properties etch_component_properties post meta.
 * @return array<int, mixed>
 */
function etch_toolkit_component_defaults( $properties ): array {
	$defaults = array();
	foreach ( is_array( $properties ) ? $properties : array() as $property ) {
		if ( is_array( $property ) ) {
			if ( array_key_exists( 'default', $property ) ) {
				$defaults[] = $property['default'];
			}
			array_push( $defaults, ...etch_toolkit_component_defaults( $property['properties'] ?? array() ) );
		}
	}
	return $defaults;
}
