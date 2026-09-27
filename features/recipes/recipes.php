<?php
/**
 * Recipes: a Recipes tab in the Style Manager that lists Etch's CSS recipes
 * (the "?" completions in its CSS editors) and lets you add your own.
 *
 * Etch's recipes are built into its builder script, so the tab reads them
 * from there. Yours are stored here and added to Etch's list in the builder.
 */

defined( 'ABSPATH' ) || exit;

// Mirrors NAME in recipes.js. Etch reads a recipe name up to the first space or semicolon.
const ETCH_TOOLKIT_RECIPES_NAME    = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/D';
const ETCH_TOOLKIT_RECIPES_MAX     = 500;
const ETCH_TOOLKIT_RECIPES_MAX_CSS = 20000;

etch_toolkit_routes(
	array(
		'/recipes' => array(
			array( 'GET', fn() => array( 'recipes' => etch_toolkit_recipes() ) ),
			array(
				'PUT',
				function ( WP_REST_Request $request ) {
					$result = etch_toolkit_recipes_save( $request->get_param( 'recipes' ) );
					return is_wp_error( $result ) ? $result : array( 'recipes' => $result );
				},
				array(
					'recipes' => array(
						'type'     => 'array',
						'required' => true,
					),
				),
			),
		),
	)
);

// Import and export, in the toolkit's settings, in the builder and in WordPress.
etch_toolkit_settings_section( 'recipes' );

etch_toolkit_builder_feature( 'recipes', fn() => array( 'recipes' => etch_toolkit_recipes() ) );

/**
 * Your recipes, in the order they were added.
 *
 * @return array<int, array{name: string, css: string}>
 */
function etch_toolkit_recipes(): array {
	$recipes = get_option( ETCH_TOOLKIT_RECIPES_OPTION, array() );
	return is_array( $recipes ) ? array_values( $recipes ) : array();
}

/**
 * Replace your recipes with a new list.
 *
 * @param mixed $recipes List of { name, css }.
 * @return array<int, array{name: string, css: string}>|WP_Error The list as saved.
 */
function etch_toolkit_recipes_save( $recipes ) {
	if ( ! is_array( $recipes ) || count( $recipes ) > ETCH_TOOLKIT_RECIPES_MAX ) {
		return new WP_Error( 'etch_toolkit_recipes_invalid', 'That list of recipes can’t be saved.', array( 'status' => 400 ) );
	}

	$saved = array();
	foreach ( $recipes as $recipe ) {
		$name = is_array( $recipe ) && is_string( $recipe['name'] ?? null ) ? trim( $recipe['name'] ) : '';
		$css  = is_array( $recipe ) && is_string( $recipe['css'] ?? null ) ? trim( str_replace( "\0", '', $recipe['css'] ) ) : '';

		if ( ! preg_match( ETCH_TOOLKIT_RECIPES_NAME, $name ) ) {
			return new WP_Error( 'etch_toolkit_recipes_invalid', sprintf( '"%s" can’t be a recipe name. Use lowercase letters, numbers and hyphens.', $name ), array( 'status' => 400 ) );
		}
		if ( isset( $saved[ $name ] ) ) {
			return new WP_Error( 'etch_toolkit_recipes_invalid', sprintf( 'There are two recipes named "%s".', $name ), array( 'status' => 400 ) );
		}
		if ( '' === $css || strlen( $css ) > ETCH_TOOLKIT_RECIPES_MAX_CSS ) {
			return new WP_Error( 'etch_toolkit_recipes_invalid', sprintf( 'The CSS for "%s" is empty or too long.', $name ), array( 'status' => 400 ) );
		}

		$saved[ $name ] = array(
			'name' => $name,
			'css'  => $css,
		);
	}

	$saved = array_values( $saved );
	update_option( ETCH_TOOLKIT_RECIPES_OPTION, $saved, false );
	return $saved;
}
