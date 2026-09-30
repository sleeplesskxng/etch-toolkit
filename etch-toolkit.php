<?php
/**
 * Plugin Name:       Etch Toolkit
 * Plugin URI:        https://nickarce.com/etch-toolkit/
 * Description:       Quality of life additions for the Etch builder.
 * Version:           0.6.1
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Requires Plugins:  etch
 * Author:            Nicholas Arce
 * Text Domain:       etch-toolkit
 */

defined( 'ABSPATH' ) || exit;

define( 'ETCH_TOOLKIT_VERSION', '0.6.1' );
define( 'ETCH_TOOLKIT_DIR', plugin_dir_path( __FILE__ ) );
define( 'ETCH_TOOLKIT_URL', plugin_dir_url( __FILE__ ) );

require ETCH_TOOLKIT_DIR . 'includes/options.php';
require ETCH_TOOLKIT_DIR . 'includes/helpers.php';
require ETCH_TOOLKIT_DIR . 'features/settings/settings.php';
require ETCH_TOOLKIT_DIR . 'features/style-usage/style-usage.php';
require ETCH_TOOLKIT_DIR . 'features/bulk-select/bulk-select.php';
require ETCH_TOOLKIT_DIR . 'features/fonts/fonts.php';
require ETCH_TOOLKIT_DIR . 'features/recipes/recipes.php';
require ETCH_TOOLKIT_DIR . 'features/copy-classes/copy-classes.php';
require ETCH_TOOLKIT_DIR . 'features/layer-sorting/layer-sorting.php';
require ETCH_TOOLKIT_DIR . 'features/color-mix/color-mix.php';
require ETCH_TOOLKIT_DIR . 'features/box-shadow/box-shadow.php';
require ETCH_TOOLKIT_DIR . 'features/to-rem/to-rem.php';
require ETCH_TOOLKIT_DIR . 'features/component-manager/component-manager.php';

// Updates come from GitHub releases. Skipped in a git checkout so it never overwrites a dev copy.
if ( ! is_dir( ETCH_TOOLKIT_DIR . '.git' ) ) {
	require ETCH_TOOLKIT_DIR . 'lib/plugin-update-checker/plugin-update-checker.php';
	$etch_toolkit_updates = YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker(
		'https://github.com/sleeplesskxng/etch-toolkit/',
		__FILE__,
		'etch-toolkit'
	);
	$etch_toolkit_updates->setBranch( 'main' );
	// The update details link to the full changelog on the plugin's page.
	$etch_toolkit_updates->addResultFilter(
		function ( $info ) {
			if ( $info ) {
				$info->homepage              = 'https://nickarce.com/etch-toolkit/';
				$info->sections['changelog'] = ( $info->sections['changelog'] ?? '' ) . '<p><a href="https://nickarce.com/etch-toolkit/#changelog" target="_blank" rel="noopener">See every release on nickarce.com</a></p>';
			}
			return $info;
		}
	);
}
