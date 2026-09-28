<?php
/**
 * Deleting the plugin removes its data, when Settings → General says to.
 *
 * Fonts stay: the "Etch Toolkit Fonts" stylesheet, which Etch prints, and the
 * font files, so the site's fonts keep working. So does anything the toolkit
 * changed in Etch's own data, like renamed classes, which is Etch's now.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

require __DIR__ . '/includes/options.php';

/**
 * Remove this site's toolkit data, if its settings say to.
 */
function etch_toolkit_uninstall_site(): void {
	$settings = (array) get_option( ETCH_TOOLKIT_SETTINGS_OPTION, array() );
	if ( empty( $settings['deleteData'] ) ) {
		return;
	}

	foreach ( array( ETCH_TOOLKIT_RECIPES_OPTION, ETCH_TOOLKIT_FONTS_OPTION, ETCH_TOOLKIT_FONTS_SETTINGS, ETCH_TOOLKIT_FONTS_ACSS_SYNCED, ETCH_TOOLKIT_SETTINGS_OPTION ) as $option ) {
		delete_option( $option );
	}
	delete_transient( ETCH_TOOLKIT_GOOGLE_INDEX );
}

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids', 'number' => 0 ) ) as $site_id ) {
		switch_to_blog( $site_id );
		etch_toolkit_uninstall_site();
		restore_current_blog();
	}
} else {
	etch_toolkit_uninstall_site();
}
