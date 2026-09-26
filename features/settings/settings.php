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

const ETCH_TOOLKIT_SETTINGS_OPTION = 'etch_toolkit_settings';
const ETCH_TOOLKIT_SETTINGS_PAGE   = 'etch-toolkit';

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			ETCH_TOOLKIT_REST_NAMESPACE,
			'/settings',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => fn() => rest_ensure_response( etch_toolkit_settings() ),
					'permission_callback' => 'etch_toolkit_can_manage',
				),
				array(
					'methods'             => 'POST',
					'callback'            => function ( WP_REST_Request $request ) {
						etch_toolkit_save_settings( (array) $request->get_json_params() );
						return rest_ensure_response( etch_toolkit_settings() );
					},
					'permission_callback' => 'etch_toolkit_can_manage',
				),
			)
		);
	}
);

/**
 * @return array{deleteData: bool}
 */
function etch_toolkit_settings(): array {
	$settings = (array) get_option( ETCH_TOOLKIT_SETTINGS_OPTION, array() );
	return array(
		'deleteData' => ! empty( $settings['deleteData'] ),
	);
}

function etch_toolkit_save_settings( array $input ): void {
	$settings = etch_toolkit_settings();
	if ( array_key_exists( 'deleteData', $input ) ) {
		$settings['deleteData'] = (bool) $input['deleteData'];
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
	wp_add_inline_script(
		'etch-toolkit-settings',
		'window.etchToolkitSettings = ' . wp_json_encode(
			array(
				'context'  => $context,
				'settings' => etch_toolkit_settings(),
			)
		) . ';',
		'before'
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
