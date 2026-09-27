<?php
/**
 * Deleting the plugin removes its data, when Settings → General says to.
 *
 * Fonts stay: the "Etch Toolkit Fonts" stylesheet, which Etch prints, and the
 * font files, so the site's fonts keep working. So does anything the toolkit
 * changed in Etch's own data, like renamed classes, which is Etch's now.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Remove this site's toolkit data, if its settings say to.
 */
function etch_toolkit_uninstall_site(): void {
	global $wpdb;

	$settings = (array) get_option( 'etch_toolkit_settings', array() );
	if ( empty( $settings['deleteData'] ) ) {
		return;
	}

	foreach ( array( 'etch_toolkit_recipes', 'etch_toolkit_fonts', 'etch_toolkit_fonts_settings', 'etch_toolkit_fonts_acss_synced', 'etch_toolkit_settings' ) as $option ) {
		delete_option( $option );
	}
	delete_transient( 'etch_toolkit_google_fonts_index' );

	// Delete Everywhere's undo records, one per deleted style.
	$like = $wpdb->esc_like( '_transient_etch_toolkit_deleted_' ) . '%';
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery
	foreach ( $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $like ) ) as $name ) {
		delete_transient( substr( $name, strlen( '_transient_' ) ) );
	}
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
