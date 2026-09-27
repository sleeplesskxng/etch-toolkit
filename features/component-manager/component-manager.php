<?php
/**
 * Component manager: update a component from JSON, reviewing each change.
 *
 * Drop a JSON file or paste JSON, from Etch's copy (Cmd+C on a component) or
 * a component's JSON. The builder matches it to a component by key, shows its
 * layers the way the Structure panel does with what changed in each, and its
 * props. Off until turned on in the toolkit's settings (General).
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_feature( 'component-manager' );
		}
	}
);
