<?php
/**
 * Style usage: counts how many blocks reference each Etch style
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
 * Count block references per Etch style ID across all saved content.
 *
 * @return array<string, int> Style ID => number of blocks using it.
 */
function etch_toolkit_style_usage_counts(): array {
	$counts = array();

	foreach ( etch_toolkit_content_post_ids() as $id ) {
		$content = get_post_field( 'post_content', $id, 'raw' );
		if ( ! $content || ! str_contains( $content, '"styles"' ) ) {
			continue;
		}
		etch_toolkit_count_block_styles( parse_blocks( $content ), $counts );
	}

	return $counts;
}

/**
 * @param array<int, array<string, mixed>> $blocks Parsed blocks.
 * @param array<string, int>               $counts Running totals, by reference.
 */
function etch_toolkit_count_block_styles( array $blocks, array &$counts ): void {
	foreach ( $blocks as $block ) {
		foreach ( (array) ( $block['attrs']['styles'] ?? array() ) as $style_id ) {
			if ( is_string( $style_id ) ) {
				$counts[ $style_id ] = ( $counts[ $style_id ] ?? 0 ) + 1;
			}
		}
		if ( ! empty( $block['innerBlocks'] ) ) {
			etch_toolkit_count_block_styles( $block['innerBlocks'], $counts );
		}
	}
}
