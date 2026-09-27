<?php
/**
 * Where the toolkit keeps its data. No hooks here, so uninstall.php can load
 * it without the rest of the plugin.
 */

defined( 'ABSPATH' ) || exit;

const ETCH_TOOLKIT_SETTINGS_OPTION   = 'etch_toolkit_settings';
const ETCH_TOOLKIT_RECIPES_OPTION    = 'etch_toolkit_recipes';
const ETCH_TOOLKIT_FONTS_OPTION      = 'etch_toolkit_fonts';
const ETCH_TOOLKIT_FONTS_SETTINGS    = 'etch_toolkit_fonts_settings';
const ETCH_TOOLKIT_FONTS_ACSS_SYNCED = 'etch_toolkit_fonts_acss_synced';

// Transients: Google Fonts' list, cached, and Delete Everywhere's undo records, one per deleted style.
const ETCH_TOOLKIT_GOOGLE_INDEX   = 'etch_toolkit_google_fonts_index';
const ETCH_TOOLKIT_DELETED_PREFIX = 'etch_toolkit_deleted_';
