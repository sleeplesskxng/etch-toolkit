<?php
/**
 * Enhanced layer sorting: smooth dragging in the Structure panel, even on
 * big pages. On unless turned off in the toolkit's settings (General).
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_feature( 'layer-sorting' );
		}
	}
);
