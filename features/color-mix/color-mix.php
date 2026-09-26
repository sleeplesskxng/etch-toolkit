<?php
/**
 * Color mix: in Etch's CSS editors, hovering a line with a color shows a
 * swatch for it, which opens a small panel to wrap it in color-mix().
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_feature( 'color-mix' );
		}
	}
);
