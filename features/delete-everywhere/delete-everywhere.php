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
				'callback'            => fn( WP_REST_Request $request ) => etch_toolkit_delete_everywhere( $request['id'], false ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			"{$route}/delete-everywhere",
			array(
				'methods'             => 'POST',
				'callback'            => fn( WP_REST_Request $request ) => etch_toolkit_delete_everywhere( $request['id'], true ),
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
	$styles = get_option( 'etch_styles', array() );
	$style  = $styles[ $style_id ] ?? null;

	if ( ! $style ) {
		return new WP_Error( 'etch_toolkit_style_not_found', 'Style not found.', array( 'status' => 404 ) );
	}
	if ( 'class' !== ( $style['type'] ?? '' ) || ! empty( $style['readonly'] ) ) {
		return new WP_Error( 'etch_toolkit_not_deletable', 'Only editable class styles can be deleted everywhere.', array( 'status' => 400 ) );
	}

	// ".foo" => "foo", unescaping CSS escapes such as "\:" from special character support.
	$class = preg_replace( '/\\\\(.)/', '$1', substr( $style['selector'], 1 ) );

	$posts    = array();
	$elements = 0;

	foreach ( etch_toolkit_content_post_ids() as $post_id ) {
		$content = get_post_field( 'post_content', $post_id, 'raw' );
		if ( ! $content || ( ! str_contains( $content, $style_id ) && ! str_contains( $content, $class ) ) ) {
			continue;
		}

		$removed = 0;
		$content = etch_toolkit_strip_style( $content, $style_id, $class, $removed );
		if ( ! $removed ) {
			continue;
		}

		if ( $apply ) {
			$result = etch_toolkit_update_content( $post_id, $content );
			if ( is_wp_error( $result ) ) {
				return $result;
			}
		}

		$posts[]   = etch_toolkit_post_summary( $post_id, $removed );
		$elements += $removed;
	}

	if ( $apply ) {
		unset( $styles[ $style_id ] );
		update_option( 'etch_styles', $styles );
	}

	return rest_ensure_response(
		array(
			'selector' => $style['selector'],
			'elements' => $elements,
			'posts'    => $posts,
		)
	);
}

/**
 * Remove a style ID and its class token from every block in the content.
 *
 * @param string $content  Post content.
 * @param string $style_id Etch style ID.
 * @param string $class    Class name without the leading dot.
 * @param int    $changed  Set to the number of blocks changed.
 * @return string Updated content.
 */
function etch_toolkit_strip_style( string $content, string $style_id, string $class, int &$changed ): string {
	return etch_toolkit_edit_block_attrs(
		$content,
		function ( $attrs ) use ( $style_id, $class ) {
			$touched = false;

			if ( isset( $attrs->styles ) && is_array( $attrs->styles ) && in_array( $style_id, $attrs->styles, true ) ) {
				$attrs->styles = array_values( array_diff( $attrs->styles, array( $style_id ) ) );
				$touched       = true;
			}

			if ( isset( $attrs->attributes->class ) && is_string( $attrs->attributes->class ) ) {
				$tokens = preg_split( '/\s+/', trim( $attrs->attributes->class ), -1, PREG_SPLIT_NO_EMPTY );
				if ( in_array( $class, $tokens, true ) ) {
					$remaining = implode( ' ', array_diff( $tokens, array( $class ) ) );
					if ( '' === $remaining ) {
						unset( $attrs->attributes->class );
					} else {
						$attrs->attributes->class = $remaining;
					}
					$touched = true;
				}
			}

			return $touched;
		},
		$changed
	);
}
