<?php
/**
 * Copy classes: copy a layer's classes, or one class from the CSS editor,
 * and paste them onto another layer. All in the builder.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_feature( 'copy-classes' );
		}
	}
);
