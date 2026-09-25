<?php
/**
 * Delete Everywhere: removes a class style from every element across the
 * site (pages, posts, templates, components).
 *
 * The builder deletes the style itself, the way Etch's own delete does, so
 * it's undone with Cmd+Z and saved with Etch's Save. Once Etch has saved, the
 * builder has this take the class off everything else. What that changed is
 * kept for a week, so an undo saved after it can put the class back.
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
				'callback'            => fn( WP_REST_Request $request ) => etch_toolkit_rest_try( fn() => etch_toolkit_delete_everywhere_usage( $request['id'] ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			"{$route}/strip",
			array(
				'methods'             => 'POST',
				'args'                => array(
					'class' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
				'callback'            => fn( WP_REST_Request $request ) => etch_toolkit_rest_try( fn() => etch_toolkit_delete_everywhere_strip( $request['id'], $request['class'] ) ),
				'permission_callback' => 'etch_toolkit_can_manage',
			)
		);

		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			"{$route}/unstrip",
			array(
				'methods'             => 'POST',
				'callback'            => fn( WP_REST_Request $request ) => etch_toolkit_rest_try( fn() => etch_toolkit_delete_everywhere_unstrip( $request['id'] ) ),
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
 * Every use of a class style, for the builder's confirm dialog.
 *
 * @param string $style_id Etch style ID.
 * @return WP_REST_Response|WP_Error
 */
function etch_toolkit_delete_everywhere_usage( string $style_id ) {
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

	$scan = etch_toolkit_delete_everywhere_scan( $styles, $style_id, $class );
	return rest_ensure_response(
		array(
			'selector' => $style['selector'],
			'class'    => $class,
			'elements' => array_sum( $scan['changed'] ),
			'posts'    => etch_toolkit_post_summaries( $scan['changed'] ),
			// Elements keep the class, since another style has it.
			'shared'   => $scan['shared'],
			// Components whose class properties default to the style.
			'defaults' => count( $scan['defaults'] ),
			// Elements with a dynamic class name that could make the class, left as they are.
			'dynamic'  => $scan['dynamic'],
		)
	);
}

/**
 * Take a deleted style's ID and class off every element, and out of component
 * class property defaults, all or nothing. Only once the style is gone from
 * the saved styles: an undo saved first brings it back, and then nothing
 * changes. Run again, it takes off what a copy of a page kept by the builder
 * put back.
 *
 * @param string $style_id Etch style ID.
 * @param string $class    Its class name, unescaped.
 * @return WP_REST_Response|WP_Error
 */
function etch_toolkit_delete_everywhere_strip( string $style_id, string $class ) {
	$styles = (array) get_option( 'etch_styles', array() );
	if ( isset( $styles[ $style_id ] ) ) {
		return rest_ensure_response( array( 'elements' => 0 ) );
	}
	// As it appears in class attributes: no spaces, quotes or braces.
	if ( ! preg_match( '/^[^\s"\'{}<>]+$/u', $class ) ) {
		return new WP_Error( 'etch_toolkit_not_deletable', sprintf( '"%s" isn\'t a class name.', $class ), array( 'status' => 400 ) );
	}

	$scan = etch_toolkit_delete_everywhere_scan( $styles, $style_id, $class );
	$saved = etch_toolkit_update_contents( $scan['contents'], $scan['originals'] );
	if ( is_wp_error( $saved ) ) {
		return $saved;
	}

	// What each post and default was before this first took anything off, and what it
	// is now, so an undo only puts back what nobody has changed since.
	$key     = etch_toolkit_delete_everywhere_key( $style_id );
	$journal = get_transient( $key ) ?: array(
		'posts'    => array(),
		'defaults' => array(),
	);
	foreach ( $scan['originals'] as $post_id => $content ) {
		$journal['posts'][ $post_id ]['before'] ??= $content;
		$journal['posts'][ $post_id ]['after']    = md5( (string) get_post_field( 'post_content', $post_id, 'raw' ) );
	}
	foreach ( $scan['defaults'] as $component_id => $properties ) {
		$journal['defaults'][ $component_id ]['before'] ??= get_post_meta( $component_id, 'etch_component_properties', true );
		// A default left pointing at a deleted style does no harm, so these are best effort.
		update_post_meta( $component_id, 'etch_component_properties', wp_slash( $properties ) );
		$journal['defaults'][ $component_id ]['after'] = md5( wp_json_encode( get_post_meta( $component_id, 'etch_component_properties', true ) ) );
	}
	set_transient( $key, $journal, WEEK_IN_SECONDS );

	return rest_ensure_response( array( 'elements' => array_sum( $scan['changed'] ) ) );
}

/**
 * Put a deleted style's class back where Delete Everywhere took it off, once
 * an undo has brought the style back into the saved styles. Posts and
 * defaults changed since are left as they are.
 *
 * @param string $style_id Etch style ID.
 * @return WP_REST_Response|WP_Error
 */
function etch_toolkit_delete_everywhere_unstrip( string $style_id ) {
	$key     = etch_toolkit_delete_everywhere_key( $style_id );
	$journal = get_transient( $key );
	if ( ! $journal || ! isset( ( (array) get_option( 'etch_styles', array() ) )[ $style_id ] ) ) {
		return rest_ensure_response( array( 'posts' => 0 ) );
	}

	$contents  = array();
	$originals = array();
	foreach ( $journal['posts'] as $post_id => $entry ) {
		$current = get_post_field( 'post_content', $post_id, 'raw' );
		if ( is_string( $current ) && md5( $current ) === $entry['after'] ) {
			$contents[ $post_id ]  = $entry['before'];
			$originals[ $post_id ] = $current;
		}
	}
	$saved = etch_toolkit_update_contents( $contents, $originals );
	if ( is_wp_error( $saved ) ) {
		return $saved;
	}
	foreach ( $journal['defaults'] as $component_id => $entry ) {
		if ( md5( wp_json_encode( get_post_meta( $component_id, 'etch_component_properties', true ) ) ) === $entry['after'] ) {
			update_post_meta( $component_id, 'etch_component_properties', wp_slash( $entry['before'] ) );
		}
	}
	delete_transient( $key );

	return rest_ensure_response( array( 'posts' => count( $contents ) ) );
}

function etch_toolkit_delete_everywhere_key( string $style_id ): string {
	return 'etch_toolkit_deleted_' . $style_id;
}

/**
 * The elements and component defaults with a class style, and what taking it
 * off would make of them. With another style for the same class, like .card
 * in another collection, elements keep the class and get that style instead.
 *
 * @param array<string, array<string, mixed>> $styles   etch_styles.
 * @param string                              $style_id Etch style ID.
 * @param string                              $class    Its class name, unescaped.
 * @return array{other: string, shared: bool, contents: array<int, string>, originals: array<int, string>, changed: array<int, int>, dynamic: int, defaults: array<int, array>}
 */
function etch_toolkit_delete_everywhere_scan( array $styles, string $style_id, string $class ): array {
	$other  = etch_toolkit_other_class_style( $styles, $style_id, $class );
	$shared = '' !== $other;

	// A dynamic class name like btn--{props.variant} could make btn--primary without
	// containing it, so posts with the class's first word are read too.
	$word = preg_split( '/[-_]+/', $class, -1, PREG_SPLIT_NO_EMPTY )[0] ?? $class;

	$changed   = array();
	$contents  = array();
	$originals = array();
	$dynamic   = 0;

	foreach ( etch_toolkit_contents() as $post_id => $content ) {
		if ( ! str_contains( $content, $style_id ) && ( $shared || ! str_contains( etch_toolkit_plain_content( $content ), $word ) ) ) {
			continue;
		}

		$removed  = 0;
		$found    = 0;
		$stripped = etch_toolkit_strip_style( $content, $style_id, $shared ? '' : $class, $removed, $found, $other );
		$dynamic += $found;
		if ( ! $removed ) {
			continue;
		}

		$contents[ $post_id ]  = $stripped;
		$originals[ $post_id ] = $content;
		$changed[ $post_id ]   = $removed;
	}

	// Component class properties can default to the style too, by ID.
	$defaults = array();
	foreach ( get_posts( array( 'post_type' => 'wp_block', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids', 'no_found_rows' => true ) ) as $component_id ) {
		$properties = get_post_meta( $component_id, 'etch_component_properties', true );
		if ( is_array( $properties ) && etch_toolkit_replace_default_style_id( $properties, $style_id, $other ) ) {
			$defaults[ $component_id ] = $properties;
		}
	}

	return compact( 'other', 'shared', 'contents', 'originals', 'changed', 'dynamic', 'defaults' );
}

/**
 * Another class style with this class name, like .card in two collections.
 *
 * @param array<string, array<string, mixed>> $styles   etch_styles.
 * @param string                              $style_id The style being deleted.
 * @param string                              $class    Its class name, unescaped.
 * @return string Its ID, or '' if there's none.
 */
function etch_toolkit_other_class_style( array $styles, string $style_id, string $class ): string {
	foreach ( $styles as $id => $style ) {
		if ( (string) $id !== $style_id && is_array( $style ) && 'class' === ( $style['type'] ?? '' ) && is_string( $style['selector'] ?? null )
			&& ( etch_toolkit_css_classes( $style['selector'] )[0] ?? '' ) === $class ) {
			return (string) $id;
		}
	}
	return '';
}

/**
 * Remove a style ID and its class name from every block in the content,
 * including a component instance's class properties, which hold style IDs.
 *
 * Dynamic class names like btn--{props.variant} are left as they are. The
 * blocks with one that could make the class are counted instead.
 *
 * @param string $content  Post content.
 * @param string $style_id Etch style ID.
 * @param string $class    Class name, unescaped, without the leading dot. '' keeps class names as they are.
 * @param int    $changed  Set to the number of blocks changed.
 * @param int    $dynamic  Set to the number of blocks with a dynamic class name that could make $class.
 * @param string $other    Another style with the same class, to take this one's place. '' for none.
 * @return string Updated content.
 */
function etch_toolkit_strip_style( string $content, string $style_id, string $class, int &$changed, int &$dynamic = 0, string $other = '' ): string {
	$dynamic = 0;
	return etch_toolkit_edit_block_attrs(
		$content,
		function ( $attrs, $name, &$tag ) use ( $style_id, $class, $other, &$dynamic ) {
			$touched = false;

			if ( isset( $attrs->styles ) && is_array( $attrs->styles ) && in_array( $style_id, $attrs->styles, true ) ) {
				// Etch only prints a class style's CSS for elements that list it, so the other one goes in.
				$ids           = array_map( fn( $id ) => $id === $style_id ? $other : $id, $attrs->styles );
				$attrs->styles = array_values( array_unique( array_filter( $ids, fn( $id ) => '' !== $id ), SORT_REGULAR ) );
				$touched       = true;
			}
			if ( 'etch/component' === $name && isset( $attrs->attributes ) ) {
				$touched = etch_toolkit_replace_style_id( $attrs->attributes, $style_id, $other ) || $touched;
			}
			if ( '' === $class ) {
				return $touched;
			}

			foreach ( etch_toolkit_block_classes( $attrs, true ) as $token ) {
				if ( etch_toolkit_dynamic_class_matches( $token, $class ) ) {
					++$dynamic;
					break;
				}
			}
			return etch_toolkit_edit_block_classes( $attrs, fn( $token ) => $token === $class ? '' : $token, $tag ) || $touched;
		},
		$changed
	);
}

/**
 * Remove a style ID from a component's class properties, which hold style IDs:
 * a space-separated string or a list, also inside groups and repeaters. With
 * $other, that ID takes its place. A property left empty stays, so it doesn't
 * fall back to its default.
 *
 * @param mixed  $value    Attribute or property value, changed in place.
 * @param string $style_id Etch style ID.
 * @param string $other    The ID to put in its place, or '' to just remove it.
 * @return bool True if anything changed.
 */
function etch_toolkit_replace_style_id( &$value, string $style_id, string $other = '' ): bool {
	if ( is_string( $value ) ) {
		$tokens = etch_toolkit_class_tokens( $value );
		if ( ! in_array( $style_id, $tokens, true ) ) {
			return false;
		}
		$tokens = array_map( fn( $token ) => $token === $style_id ? $other : $token, $tokens );
		$value  = implode( ' ', array_unique( array_filter( $tokens, fn( $token ) => '' !== $token ) ) );
		return true;
	}

	$changed = false;
	if ( is_object( $value ) ) {
		foreach ( $value as &$item ) {
			$changed = etch_toolkit_replace_style_id( $item, $style_id, $other ) || $changed;
		}
		unset( $item );
	} elseif ( is_array( $value ) ) {
		// A list item that's only the ID, like one of a class property's ["id1", "id2"].
		$next = array();
		foreach ( $value as $key => $item ) {
			if ( $item === $style_id ) {
				$changed = true;
				if ( '' !== $other && ! in_array( $other, $value, true ) ) {
					$next[ $key ] = $other;
				}
				continue;
			}
			$changed      = etch_toolkit_replace_style_id( $item, $style_id, $other ) || $changed;
			$next[ $key ] = $item;
		}
		if ( $changed ) {
			$value = array_values( $value ) === $value ? array_values( $next ) : $next;
		}
	}
	return $changed;
}

/**
 * The same for a component's property definitions (etch_component_properties),
 * where only the defaults can hold style IDs.
 *
 * @param array<int, mixed> $properties Property definitions, changed in place.
 * @return bool True if anything changed.
 */
function etch_toolkit_replace_default_style_id( array &$properties, string $style_id, string $other = '' ): bool {
	$changed = false;
	foreach ( $properties as &$property ) {
		if ( ! is_array( $property ) ) {
			continue;
		}
		if ( array_key_exists( 'default', $property ) ) {
			$changed = etch_toolkit_replace_style_id( $property['default'], $style_id, $other ) || $changed;
		}
		if ( is_array( $property['properties'] ?? null ) ) {
			$changed = etch_toolkit_replace_default_style_id( $property['properties'], $style_id, $other ) || $changed;
		}
	}
	unset( $property );
	return $changed;
}
