<?php
/**
 * Component manager: every component, where it's used, updates from JSON
 * and deleting.
 *
 * Lists the site's components with the pages that use them. Edit opens one
 * in Etch as the pattern it's saved as. Update takes a JSON file or pasted JSON, from Etch's
 * copy (Cmd+C on a component) or a component's JSON, and shows its layers
 * the way the Structure panel does with what changed in each, and its props.
 * Delete asks first, and says where it's used.
 * Off until turned on in the toolkit's settings (General).
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			'/components/usage',
			array(
				'methods'             => 'GET',
				'callback'            => fn() => etch_toolkit_rest_try( fn() => rest_ensure_response( array( 'usage' => (object) etch_toolkit_component_usage() ) ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);
	}
);

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_feature( 'component-manager' );
		}
	}
);

/**
 * Where each component is used: component ID => the posts with an instance of
 * it, pages and templates first, then other components it's nested in.
 *
 * @return array<int, array<int, array{id: int, title: string, type: string, postType: string, elements: int}>>
 */
function etch_toolkit_component_usage(): array {
	$found = array(); // Component ID => post ID => instances.
	foreach ( etch_toolkit_contents() as $post_id => $content ) {
		if ( ! str_contains( $content, 'wp:etch/component' ) ) {
			continue;
		}
		// Gutenberg writes < and > in attributes as escapes, so a block comment's attributes hold no ">".
		preg_match_all( '/<!--\s+wp:etch\/component\s+\{[^>]*?"ref":(\d+)/', $content, $matches );
		foreach ( $matches[1] as $ref ) {
			$found[ (int) $ref ][ $post_id ] = ( $found[ (int) $ref ][ $post_id ] ?? 0 ) + 1;
		}
	}

	// Only components that exist. Pages can still point to deleted ones.
	$components = get_posts(
		array(
			'post_type'      => 'wp_block',
			'post_status'    => 'any',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'meta_key'       => 'etch_component_html_key', // phpcs:ignore WordPress.DB.SlowDBQuery
		)
	);
	$found = array_intersect_key( $found, array_flip( $components ) );

	$usage = array();
	foreach ( $found as $component_id => $posts ) {
		$list = etch_toolkit_post_summaries( $posts );
		foreach ( $list as &$summary ) {
			$summary['postType'] = (string) get_post_type( $summary['id'] );
		}
		unset( $summary );
		usort( $list, fn( $a, $b ) => ( 'wp_block' === $a['postType'] ) <=> ( 'wp_block' === $b['postType'] ) ?: strcasecmp( $a['title'], $b['title'] ) );
		$usage[ $component_id ] = $list;
	}
	return $usage;
}
