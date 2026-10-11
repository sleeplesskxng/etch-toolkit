<?php
/**
 * Prop keys: in Etch's component editor, a prop's new key follows it into
 * the component's layers, in the builder. Instances on other pages that set
 * a value for the old key can have it renamed too, here, after Etch's Save.
 */

defined( 'ABSPATH' ) || exit;

etch_toolkit_routes(
	array(
		'/prop-keys/instances' => array(
			'GET',
			fn( WP_REST_Request $request ) => array( 'posts' => etch_toolkit_prop_key_instances( (int) $request['component'], array( array( 'from' => (string) $request['from'], 'to' => (string) $request['to'] ) ), false ) ),
			array(
				'component' => array(
					'type'     => 'integer',
					'required' => true,
				),
				'from'      => array(
					'type'     => 'string',
					'required' => true,
				),
				'to'        => array(
					'type'     => 'string',
					'required' => true,
				),
			),
		),
		'/prop-keys/rename'    => array(
			'POST',
			fn( WP_REST_Request $request ) => etch_toolkit_prop_keys_rename( (int) $request['component'], (array) $request['renames'] ),
			array(
				'component' => array(
					'type'     => 'integer',
					'required' => true,
				),
				'renames'   => array(
					'type'     => 'array',
					'required' => true,
				),
			),
		),
	)
);

etch_toolkit_builder_feature( 'prop-keys' );

/**
 * A prop's path as the props panel writes it, in steps: meta.label is
 * meta, label. A repeater's items are [], so items[0].label is items, [], label.
 *
 * @return string[]
 */
function etch_toolkit_prop_path( string $path ): array {
	return explode( '.', (string) preg_replace( '/\[\d+\]/', '.[]', $path ) );
}

/**
 * Whether a component's props have one at this path. A condition prop's
 * props sit beside it, as Etch reads them.
 *
 * @param array    $props Prop definitions.
 * @param string[] $path  From etch_toolkit_prop_path().
 */
function etch_toolkit_prop_exists( array $props, array $path ): bool {
	$step = array_shift( $path );
	if ( '[]' === $step ) {
		return etch_toolkit_prop_exists( $props, $path );
	}
	foreach ( $props as $prop ) {
		if ( ! is_array( $prop ) ) {
			continue;
		}
		$children = is_array( $prop['properties'] ?? null ) ? $prop['properties'] : array();
		if ( ( $prop['key'] ?? null ) === $step ) {
			return ! $path || etch_toolkit_prop_exists( $children, $path );
		}
		if ( 'condition' === ( $prop['type']['specialized'] ?? null ) && etch_toolkit_prop_exists( $children, array_merge( array( $step ), $path ) ) ) {
			return true;
		}
	}
	return false;
}

/**
 * Rename a key in an instance's values, where the path leads. Groups and
 * repeaters can hold their values as JSON text, which is rewritten as JSON.
 * Left alone where the new key already has a value, or the value is
 * something else, like dynamic data.
 *
 * @param mixed    $value   An instance's attributes, or a value in them.
 * @param string[] $parents The steps to the object holding the key.
 * @return int Keys renamed.
 */
function etch_toolkit_prop_rename_value( &$value, array $parents, string $from, string $to ): int {
	if ( is_string( $value ) ) {
		$decoded = json_decode( $value );
		if ( ! is_object( $decoded ) && ! is_array( $decoded ) ) {
			return 0;
		}
		$count = etch_toolkit_prop_rename_value( $decoded, $parents, $from, $to );
		if ( $count ) {
			$value = wp_json_encode( $decoded );
		}
		return $count;
	}

	if ( $parents ) {
		$step = array_shift( $parents );
		if ( '[]' === $step ) {
			if ( ! is_array( $value ) ) {
				return 0;
			}
			$count = 0;
			foreach ( $value as &$item ) {
				$count += etch_toolkit_prop_rename_value( $item, $parents, $from, $to );
			}
			return $count;
		}
		if ( ! is_object( $value ) || ! property_exists( $value, $step ) ) {
			return 0;
		}
		return etch_toolkit_prop_rename_value( $value->{ $step }, $parents, $from, $to );
	}

	if ( ! is_object( $value ) || ! property_exists( $value, $from ) || property_exists( $value, $to ) ) {
		return 0;
	}
	// In the same place, so the block's JSON only changes where it has to.
	$renamed = new stdClass();
	foreach ( get_object_vars( $value ) as $key => $item ) {
		$renamed->{ $key === $from ? $to : $key } = $item;
	}
	$value = $renamed;
	return 1;
}

/**
 * The posts with instances of a component that set a value for a renamed
 * key, and with $write, their content with it renamed.
 *
 * @param array<int, array{from: string, to: string}> $renames Paths, as the props panel writes them.
 * @return array|WP_Error Post summaries, where elements is the instances.
 */
function etch_toolkit_prop_key_instances( int $component, array $renames, bool $write ) {
	$steps = array();
	foreach ( $renames as $rename ) {
		$from = etch_toolkit_prop_path( $rename['from'] );
		$to   = etch_toolkit_prop_path( $rename['to'] );
		// A key changes in one place: what holds it stays the same.
		if ( count( $from ) === count( $to ) && array_slice( $from, 0, -1 ) === array_slice( $to, 0, -1 ) && end( $from ) !== end( $to ) ) {
			$steps[] = array( array_slice( $from, 0, -1 ), end( $from ), end( $to ) );
		}
	}

	$counts    = array();
	$contents  = array();
	$originals = array();
	foreach ( etch_toolkit_contents() as $post_id => $content ) {
		if ( ! $steps || ! str_contains( $content, '"ref":' . $component ) ) {
			continue;
		}
		$instances = 0;
		$updated   = etch_toolkit_edit_block_attrs(
			$content,
			function ( $attrs, $name ) use ( $component, $steps ) {
				if ( 'etch/component' !== $name || (int) ( $attrs->ref ?? 0 ) !== $component || ! isset( $attrs->attributes ) ) {
					return false;
				}
				$count = 0;
				foreach ( $steps as [ $parents, $from, $to ] ) {
					$count += etch_toolkit_prop_rename_value( $attrs->attributes, $parents, $from, $to );
				}
				return $count > 0;
			},
			$instances
		);
		if ( $instances ) {
			$counts[ $post_id ]    = $instances;
			$contents[ $post_id ]  = $updated;
			$originals[ $post_id ] = $content;
		}
	}

	if ( $write ) {
		$result = etch_toolkit_update_contents( $contents, $originals );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
	}

	$posts = etch_toolkit_post_summaries( $counts );
	foreach ( $posts as &$post ) {
		$post['postType'] = (string) get_post_type( $post['id'] );
	}
	return $posts;
}

/**
 * Rename keys in a component's instances, once Etch has saved the component.
 * Only the renames it agrees with: the new key is there and the old one
 * isn't. One undone before saving, or left unsaved, changes nothing.
 *
 * @param array $renames List of { from, to }.
 * @return array|WP_Error { posts: post summaries }.
 */
function etch_toolkit_prop_keys_rename( int $component, array $renames ) {
	$props = get_post_meta( $component, 'etch_component_properties', true );
	if ( 'wp_block' !== get_post_type( $component ) || ! is_array( $props ) ) {
		return new WP_Error( 'etch_toolkit_not_found', 'That component doesn\'t exist anymore.', array( 'status' => 404 ) );
	}

	$saved = array_values(
		array_filter(
			$renames,
			fn( $rename ) => is_array( $rename ) && is_string( $rename['from'] ?? null ) && is_string( $rename['to'] ?? null )
				&& etch_toolkit_prop_exists( $props, etch_toolkit_prop_path( $rename['to'] ) )
				&& ! etch_toolkit_prop_exists( $props, etch_toolkit_prop_path( $rename['from'] ) )
		)
	);

	$posts = etch_toolkit_prop_key_instances( $component, $saved, true );
	return is_wp_error( $posts ) ? $posts : array( 'posts' => $posts );
}
