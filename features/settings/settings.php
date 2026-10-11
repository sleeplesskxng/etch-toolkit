<?php
/**
 * Settings: one screen for the toolkit's settings, in the builder (a button
 * in the Settings Bar's bottom section) and in WordPress (Etch → Toolkit).
 * Both show the same screen, from settings.js.
 *
 * Features add their own sections: they hook etch_toolkit_settings_enqueue
 * and enqueue a script that calls etchToolkit.settings.section().
 */

defined( 'ABSPATH' ) || exit;

const ETCH_TOOLKIT_SETTINGS_PAGE = 'etch-toolkit';

etch_toolkit_routes(
	array(
		'/settings' => array(
			array( 'GET', fn() => etch_toolkit_settings() ),
			array(
				'POST',
				function ( WP_REST_Request $request ) {
					etch_toolkit_save_settings( (array) $request->get_json_params() );
					return etch_toolkit_settings();
				},
			),
		),
	)
);

/*
 * Each feature's switch in the settings (General), and whether it's on until
 * it's changed. A feature that's off still loads in the builder, doing
 * nothing, so turning it on or off applies at once.
 */
const ETCH_TOOLKIT_FEATURES = array(
	'styleUsage'       => true,
	'bulkSelect'       => true,
	'recipes'          => true,
	'colorMix'         => true,
	'boxShadow'        => true,
	'toRem'            => true,
	'layerSorting'     => true,
	'copyClasses'      => true,
	'componentManager' => false,
	// Beta, off until turned on. A new key, so it's off even where 0.7.0 saved propKeys on.
	'propKeyRenames'   => false,
	'fonts'            => true,
);

/**
 * @return array<string, bool> deleteData, then each of ETCH_TOOLKIT_FEATURES.
 */
function etch_toolkit_settings(): array {
	$settings = (array) get_option( ETCH_TOOLKIT_SETTINGS_OPTION, array() );
	$result   = array( 'deleteData' => ! empty( $settings['deleteData'] ) );
	foreach ( ETCH_TOOLKIT_FEATURES as $key => $default ) {
		$result[ $key ] = array_key_exists( $key, $settings ) ? ! empty( $settings[ $key ] ) : $default;
	}
	return $result;
}

function etch_toolkit_save_settings( array $input ): void {
	$settings = etch_toolkit_settings();
	foreach ( array_keys( $settings ) as $key ) {
		if ( array_key_exists( $key, $input ) ) {
			$settings[ $key ] = (bool) $input[ $key ];
		}
	}
	update_option( ETCH_TOOLKIT_SETTINGS_OPTION, $settings, false );
}

/**
 * The settings screen and its sections, after the core.
 *
 * @param string $context 'builder' or 'admin'.
 */
function etch_toolkit_enqueue_settings( string $context ): void {
	etch_toolkit_enqueue_feature( 'settings' );
	etch_toolkit_inline_data(
		'etch-toolkit-settings',
		'etchToolkitSettings',
		array(
			'context'  => $context,
			'settings' => etch_toolkit_settings(),
		)
	);
	do_action( 'etch_toolkit_settings_enqueue', $context );
}

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( etch_toolkit_is_builder() ) {
			etch_toolkit_enqueue_settings( 'builder' );
		}
	}
);

// Under Etch's own menu, after Etch adds it.
add_action(
	'admin_menu',
	function () {
		$hook = add_submenu_page(
			'etch',
			'Etch Toolkit',
			'Toolkit',
			'manage_options',
			ETCH_TOOLKIT_SETTINGS_PAGE,
			fn() => print( '<div class="wrap etk-settings-wrap"><h1 class="screen-reader-text">Etch Toolkit</h1><div id="etk-settings-root"></div></div>' )
		);
		add_action(
			'admin_enqueue_scripts',
			function ( $suffix ) use ( $hook ) {
				if ( $hook && $suffix === $hook ) {
					etch_toolkit_enqueue_settings( 'admin' );
					wp_enqueue_style( 'etch-toolkit-settings-admin', ETCH_TOOLKIT_URL . 'features/settings/settings-admin.css', array(), (string) filemtime( ETCH_TOOLKIT_DIR . 'features/settings/settings-admin.css' ) );
				}
			}
		);
	},
	20
);
