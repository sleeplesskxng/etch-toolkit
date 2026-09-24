<?php
/**
 * Plugin Name:       Etch Toolkit
 * Plugin URI:        https://github.com/sleeplesskxng/etch-toolkit
 * Description:       Quality of life additions for the Etch builder.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Requires Plugins:  etch
 * Author:            Nicholas Arce
 * Text Domain:       etch-toolkit
 */

defined( 'ABSPATH' ) || exit;

define( 'ETCH_TOOLKIT_VERSION', '0.1.0' );
define( 'ETCH_TOOLKIT_DIR', plugin_dir_path( __FILE__ ) );
define( 'ETCH_TOOLKIT_URL', plugin_dir_url( __FILE__ ) );

require ETCH_TOOLKIT_DIR . 'includes/helpers.php';
require ETCH_TOOLKIT_DIR . 'features/style-usage/style-usage.php';
require ETCH_TOOLKIT_DIR . 'features/delete-everywhere/delete-everywhere.php';
require ETCH_TOOLKIT_DIR . 'features/bulk-select/bulk-select.php';

// Updates come from GitHub releases. Skipped in a git checkout so it never overwrites a dev copy.
if ( ! is_dir( ETCH_TOOLKIT_DIR . '.git' ) ) {
	require ETCH_TOOLKIT_DIR . 'lib/plugin-update-checker/plugin-update-checker.php';
	YahnisElsts\PluginUpdateChecker\v5\PucFactory::buildUpdateChecker(
		'https://github.com/sleeplesskxng/etch-toolkit/',
		__FILE__,
		'etch-toolkit'
	)->setBranch( 'main' );
}
