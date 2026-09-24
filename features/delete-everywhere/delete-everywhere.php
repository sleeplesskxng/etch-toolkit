<?php
/**
 * Delete Everywhere: removes a class style from every element across the
 * site (pages, posts, templates, components), then deletes the style.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'rest_api_init',
	function () {
		$route = '/styles/(?P<id>[A-Za-z0-9_-]+)';

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			"{$route}/usage",
			array(
				'methods'             => 'GET',
				'callback'            => fn( WP_REST_Request $request ) => etch_toolkit_rest_try( fn() => etch_toolkit_delete_everywhere( $request['id'], false ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			"{$route}/delete-everywhere",
			array(
				'methods'             => 'POST',
				'callback'            => fn( WP_REST_Request $request ) => etch_toolkit_rest_try( fn() => etch_toolkit_delete_everywhere( $request['id'], true ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);
	}
);

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_feature( 'delete-everywhere' );
		}
	}
);

/**
 * Find (and optionally remove) every use of a class style.
 *
 * @param string $style_id Etch style ID.
 * @param bool   $apply    False for a dry run that only reports usage.
 * @return WP_REST_Response|WP_Error
 */
function etch_toolkit_delete_everywhere( string $style_id, bool $apply ) {
	$styles = (array) get_option( 'etch_styles', array() );
	$style  = $styles[ $style_id ] ?? null;

	if ( ! is_array( $style ) || ! is_string( $style['selector'] ?? null ) ) {
		return new WP_Error( 'etch_toolkit_style_not_found', 'Style not found.', array( 'status' => 404 ) );
	}
	// ".md\:flex" => "md:flex", unescaping special character support.
	$class = etch_toolkit_css_classes( $style['selector'] )[0] ?? '';
	if ( 'class' !== ( $style['type'] ?? '' ) || ! empty( $style['readonly'] ) || '' === $class ) {
		return new WP_Error( 'etch_toolkit_not_deletable', 'Only editable class styles can be deleted everywhere.', array( 'status' => 400 ) );
	}

	$changed   = array();
	$contents  = array();
	$originals = array();

	foreach ( etch_toolkit_contents() as $post_id => $content ) {
		if ( ! str_contains( $content, $style_id ) && ! str_contains( etch_toolkit_plain_content( $content ), $class ) ) {
			continue;
		}

		$removed  = 0;
		$stripped = etch_toolkit_strip_style( $content, $style_id, $class, $removed );
		if ( ! $removed ) {
			continue;
		}

		$contents[ $post_id ]  = $stripped;
		$originals[ $post_id ] = $content;
		$changed[ $post_id ]   = $removed;
	}

	if ( $apply ) {
		// All or nothing, so a failed save keeps the style and every use of it.
		$saved = etch_toolkit_update_contents( $contents, $originals );
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}
		unset( $styles[ $style_id ] );
		update_option( 'etch_styles', $styles );
	}

	return rest_ensure_response(
		array(
			'selector' => $style['selector'],
			'elements' => array_sum( $changed ),
			'posts'    => etch_toolkit_post_summaries( $changed ),
		)
	);
}

/**
 * Remove a style ID and its class name from every block in the content.
 *
 * @param string $content  Post content.
 * @param string $style_id Etch style ID.
 * @param string $class    Class name, unescaped, without the leading dot.
 * @param int    $changed  Set to the number of blocks changed.
 * @return string Updated content.
 */
function etch_toolkit_strip_style( string $content, string $style_id, string $class, int &$changed ): string {
	return etch_toolkit_edit_block_attrs(
		$content,
		function ( $attrs ) use ( $style_id, $class ) {
			$touched = false;

			if ( isset( $attrs->styles ) && is_array( $attrs->styles ) && in_array( $style_id, $attrs->styles, true ) ) {
				$attrs->styles = array_values( array_filter( $attrs->styles, fn( $id ) => $id !== $style_id ) );
				$touched       = true;
			}

			return etch_toolkit_edit_block_classes( $attrs, fn( $name ) => $name === $class ? '' : $name ) || $touched;
		},
		$changed
	);
}
