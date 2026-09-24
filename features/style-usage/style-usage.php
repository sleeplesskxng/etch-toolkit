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
				'callback'            => fn() => rest_ensure_response( array( 'counts' => (object) etch_toolkit_style_usage_counts() ) ),
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
 * `id` or `class` attribute matches a `#id` or `.class` selector directly.
 * Other selectors, like `.card:hover` or `.card:hover .card__title`, count
 * the blocks that carry the classes of the element they style (`.card`,
 * `.card__title`). Each block counts once per selector.
 *
 * @return array<string, int> Selector => number of blocks using it. Selectors
 *                            with nothing to count, like `.card > p`, are left
 *                            out unless a block references them by ID.
 */
function etch_toolkit_style_usage_counts(): array {
	$selectors = array();
	$targets   = array();
	$counts    = array();
	foreach ( (array) get_option( 'etch_styles', array() ) as $id => $style ) {
		if ( ! is_string( $style['selector'] ?? null ) ) {
			continue;
		}
		$selector         = trim( $style['selector'] );
		$selectors[ $id ] = $selector;
		if ( preg_match( '/^[.#]-?[_a-zA-Z][\w-]*$/', $selector ) ) {
			$counts[ $selector ] = 0;
		} elseif ( $found = etch_toolkit_style_usage_targets( $selector ) ) {
			$targets[ $selector ] = $found;
			$counts[ $selector ]  = 0;
		}
	}

	foreach ( etch_toolkit_content_post_ids() as $id ) {
		$content = get_post_field( 'post_content', $id, 'raw' );
		if ( ! $content || ( ! str_contains( $content, '"styles"' ) && ! str_contains( $content, '"attributes"' ) ) ) {
			continue;
		}
		etch_toolkit_count_block_styles( parse_blocks( $content ), $selectors, $targets, $counts );
	}

	return $counts;
}

/**
 * The classes of the element a selector styles, per comma-separated part:
 * `.card:hover .card__title::before` => [ [ 'card__title' ] ]. Parts that
 * style an element without a class, like `.card > p`, are skipped.
 *
 * @return array<int, string[]>
 */
function etch_toolkit_style_usage_targets( string $selector ): array {
	// Drop (…) and […] so their commas, spaces and classes don't count.
	do {
		$selector = preg_replace( '/\([^()]*\)|\[[^\[\]]*\]/', '', $selector, -1, $n );
	} while ( $n );

	$targets = array();
	foreach ( explode( ',', $selector ) as $part ) {
		$parts   = preg_split( '/\s*[>+~]\s*|\s+/', trim( $part ), -1, PREG_SPLIT_NO_EMPTY );
		$subject = preg_replace( '/::?[\w-]+/', '', (string) end( $parts ) );
		preg_match_all( '/\.(-?[_a-zA-Z][\w-]*)/', $subject, $found );
		if ( $found[1] ) {
			$targets[] = $found[1];
		}
	}
	return $targets;
}

/**
 * @param array<int, array<string, mixed>> $blocks    Parsed blocks.
 * @param array<string, string>            $selectors Style ID => selector.
 * @param array<string, array>             $targets   Selector => class lists, from etch_toolkit_style_usage_targets().
 * @param array<string, int>               $counts    Running totals, by reference.
 */
function etch_toolkit_count_block_styles( array $blocks, array $selectors, array $targets, array &$counts ): void {
	foreach ( $blocks as $block ) {
		$used = array();

		foreach ( (array) ( $block['attrs']['styles'] ?? array() ) as $style_id ) {
			if ( is_string( $style_id ) && isset( $selectors[ $style_id ] ) ) {
				$used[ $selectors[ $style_id ] ] = true;
			}
		}

		$attributes = (array) ( $block['attrs']['attributes'] ?? array() );
		if ( is_string( $attributes['id'] ?? null ) && '' !== trim( $attributes['id'] ) ) {
			$used[ '#' . trim( $attributes['id'] ) ] = true;
		}
		$classes = array();
		if ( is_string( $attributes['class'] ?? null ) ) {
			foreach ( preg_split( '/\s+/', $attributes['class'], -1, PREG_SPLIT_NO_EMPTY ) as $class ) {
				// Skip dynamic parts like {props.extraClass}.
				if ( ! str_contains( $class, '{' ) ) {
					$used[ '.' . $class ] = true;
					$classes[ $class ]    = true;
				}
			}
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

		if ( ! empty( $block['innerBlocks'] ) ) {
			etch_toolkit_count_block_styles( $block['innerBlocks'], $selectors, $targets, $counts );
		}
	}
}
