<?php
/**
 * Fonts: sync the heading and body roles into Automatic.css.
 *
 * When ACSS is active, a family's "Use for headings" or "Use for body text"
 * also fills ACSS's own Heading and Text font family fields, and ACSS rebuilds
 * its CSS. Clearing a role only empties the ACSS field while it still holds
 * what we wrote, so a font set by hand in ACSS is left alone.
 */

defined( 'ABSPATH' ) || exit;

// The value last written to each ACSS field, keyed by role.
const ETCH_TOOLKIT_FONTS_ACSS_SYNCED = 'etch_toolkit_fonts_acss_synced';

add_action( 'add_option_' . ETCH_TOOLKIT_FONTS_OPTION, 'etch_toolkit_fonts_acss_sync' );
add_action( 'update_option_' . ETCH_TOOLKIT_FONTS_OPTION, 'etch_toolkit_fonts_acss_sync' );

function etch_toolkit_fonts_acss_active(): bool {
	return class_exists( '\Automatic_CSS\API' );
}

/**
 * The font stack each role should hand ACSS, empty when no family holds it.
 *
 * @return array{heading: string, text: string}
 */
function etch_toolkit_fonts_acss_wanted(): array {
	$wanted = array_fill_keys( array_keys( ETCH_TOOLKIT_FONTS_ROLES ), '' );

	foreach ( etch_toolkit_fonts_families() as $family ) {
		if ( empty( $family['enabled'] ) || empty( $family['variants'] ) ) {
			continue;
		}
		foreach ( (array) ( $family['roles'] ?? array() ) as $role ) {
			if ( isset( $wanted[ $role ] ) && '' === $wanted[ $role ] ) {
				$wanted[ $role ] = etch_toolkit_fonts_stack( $family );
			}
		}
	}

	return $wanted;
}

function etch_toolkit_fonts_acss_sync(): void {
	if ( ! etch_toolkit_fonts_acss_active() ) {
		return;
	}

	// Automatic.css errors stay here. The fonts are saved by now, so the save shouldn't fail.
	try {
		$synced  = (array) get_option( ETCH_TOOLKIT_FONTS_ACSS_SYNCED, array() );
		$changes = array();

		foreach ( etch_toolkit_fonts_acss_wanted() as $role => $value ) {
			$last = (string) ( $synced[ $role ] ?? '' );
			if ( $value === $last ) {
				continue;
			}

			$key = "{$role}-font-family";
			if ( '' !== $value ) {
				$changes[ $key ] = $value;
			} elseif ( (string) \Automatic_CSS\API::get_setting( $key ) === $last ) {
				$changes[ $key ] = '';
			}
			$synced[ $role ] = $value;
		}

		if ( $changes ) {
			\Automatic_CSS\API::update_settings( $changes );
		}
		update_option( ETCH_TOOLKIT_FONTS_ACSS_SYNCED, $synced, false );
	} catch ( \Throwable $e ) {
		// Leave the record alone so the next save tries again.
		error_log( 'Etch Toolkit: could not sync fonts to Automatic.css. ' . $e->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
	}
}
