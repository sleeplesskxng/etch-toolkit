<?php
/**
 * Box shadow: in Etch's CSS editors, a button after each box-shadow opens a
 * small panel to build a layered shadow by dragging a light around a card.
 * With Automatic.css active, the panel also picks from its box shadow
 * variables, and can save a shadow over one.
 */

defined( 'ABSPATH' ) || exit;

// How many box shadow variables Automatic.css has. Each is a name and a value.
const ETCH_TOOLKIT_BOX_SHADOW_SLOTS = 5;
const ETCH_TOOLKIT_BOX_SHADOW_MAX   = 2000;

/**
 * Automatic.css's box shadow variables, as { slot, name, value }, empty ones
 * too, since a shadow can be saved into them. The variable is
 * --box-shadow-{name}. Null when Automatic.css isn't active, or has its box
 * shadow variables off, so there's nothing to pick from.
 *
 * @return array<int, array{slot: int, name: string, value: string}>|null
 */
function etch_toolkit_box_shadow_presets(): ?array {
	if ( ! class_exists( '\Automatic_CSS\API' ) || 'on' !== \Automatic_CSS\API::get_setting( 'option-box-shadow-variables' ) ) {
		return null;
	}

	$presets = array();
	for ( $slot = 1; $slot <= ETCH_TOOLKIT_BOX_SHADOW_SLOTS; $slot++ ) {
		$name      = trim( (string) \Automatic_CSS\API::get_setting( "box-shadow-{$slot}-name" ) );
		$presets[] = array(
			'slot'  => $slot,
			'name'  => '' === $name ? (string) $slot : $name,
			'value' => trim( (string) \Automatic_CSS\API::get_setting( "box-shadow-{$slot}-value" ) ),
		);
	}
	return $presets;
}

/**
 * Save a shadow over one of the variables, and have Automatic.css rebuild its CSS.
 *
 * @return array<int, array{slot: int, name: string, value: string}>|WP_Error The variables, as they are now.
 */
function etch_toolkit_box_shadow_save( int $slot, string $value ) {
	if ( null === etch_toolkit_box_shadow_presets() ) {
		return new WP_Error( 'etch_toolkit_no_acss', 'Automatic.css box shadow variables are off.', array( 'status' => 400 ) );
	}

	// One line, and nothing that could end the declaration or its rule.
	$value = trim( preg_replace( '/\s+/', ' ', $value ) );
	if ( $slot < 1 || $slot > ETCH_TOOLKIT_BOX_SHADOW_SLOTS ) {
		return new WP_Error( 'etch_toolkit_bad_slot', 'There is no such box shadow variable.', array( 'status' => 400 ) );
	}
	if ( '' === $value || strlen( $value ) > ETCH_TOOLKIT_BOX_SHADOW_MAX || preg_match( '/[;{}<>]/', $value ) ) {
		return new WP_Error( 'etch_toolkit_bad_shadow', 'That isn\'t a shadow Automatic.css can hold.', array( 'status' => 400 ) );
	}

	\Automatic_CSS\API::update_settings( array( "box-shadow-{$slot}-value" => $value ) );
	return etch_toolkit_box_shadow_presets();
}

etch_toolkit_routes(
	array(
		'/box-shadows/(?P<slot>\d+)' => array(
			'PUT',
			function ( WP_REST_Request $request ) {
				$result = etch_toolkit_box_shadow_save( (int) $request['slot'], (string) $request->get_param( 'value' ) );
				return is_wp_error( $result ) ? $result : array( 'presets' => $result );
			},
			array(
				'value' => array(
					'type'     => 'string',
					'required' => true,
				),
			),
		),
	)
);

etch_toolkit_builder_feature( 'box-shadow', fn() => array( 'presets' => etch_toolkit_box_shadow_presets() ) );
