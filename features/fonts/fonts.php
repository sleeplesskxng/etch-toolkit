<?php
/**
 * Fonts: a font manager in the Etch builder.
 *
 * Self-hosted families from uploads (converted to WOFF2 in the browser) or
 * Google Fonts, stored in WordPress's fonts folder (wp_get_font_dir()).
 *
 * The CSS lives in an Etch global stylesheet, "Etch Toolkit Fonts", which the
 * builder panel keeps in sync through window.etch.stylesheets. Etch prints it,
 * not this plugin, so fonts keep working if the toolkit is deactivated or
 * deleted. Only the extras stop: preload hints and blocking Google Fonts.
 *
 * Trimmed port of Etch Font Manager by Don Kanishka (GPL-2.0),
 * https://github.com/donkanishka/etch-font-manager.
 */

defined( 'ABSPATH' ) || exit;

require __DIR__ . '/fonts-google.php';

const ETCH_TOOLKIT_FONTS_OPTION     = 'etch_toolkit_fonts';
const ETCH_TOOLKIT_FONTS_SETTINGS   = 'etch_toolkit_fonts_settings';
const ETCH_TOOLKIT_FONTS_STYLESHEET = 'Etch Toolkit Fonts';
const ETCH_TOOLKIT_FONTS_MAX_FILE   = 10485760; // 10 MB.
const ETCH_TOOLKIT_FONTS_MAX_IMPORT = 52428800; // 50 MB of decoded font data.
const ETCH_TOOLKIT_FONTS_FORMATS    = array(
	'woff2' => 'woff2',
	'woff'  => 'woff',
	'ttf'   => 'truetype',
	'otf'   => 'opentype',
);
const ETCH_TOOLKIT_FONTS_DISPLAY    = array( 'auto', 'block', 'swap', 'fallback', 'optional' );
// Local fonts a size-matched fallback is drawn from. The browser takes the first it has.
const ETCH_TOOLKIT_FONTS_LOCALS     = array(
	'sans'  => array( 'Arial', 'Liberation Sans' ),
	'serif' => array( 'Times New Roman', 'Liberation Serif' ),
	'mono'  => array( 'Courier New', 'Liberation Mono' ),
);
const ETCH_TOOLKIT_FONTS_ROLES      = array(
	'heading' => 'h1, h2, h3, h4, h5, h6',
	'text'    => 'body',
);

// Weight keywords in file names, matched on the one that ends last so "Blackout-Bold" is bold.
const ETCH_TOOLKIT_FONTS_WEIGHT_WORDS = array(
	'extrablack' => '900',
	'ultrablack' => '900',
	'extrabold'  => '800',
	'ultrabold'  => '800',
	'extralight' => '200',
	'ultralight' => '200',
	'semibold'   => '600',
	'demibold'   => '600',
	'semilight'  => '300',
	'regular'    => '400',
	'medium'     => '500',
	'normal'     => '400',
	'black'      => '900',
	'heavy'      => '900',
	'light'      => '300',
	'thin'       => '100',
	'hairline'   => '100',
	'book'       => '400',
	'bold'       => '700',
);

require __DIR__ . '/fonts-acss.php';

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! etch_toolkit_is_builder() ) {
			return;
		}
		etch_toolkit_enqueue_feature( 'fonts' );

		$wasm = ETCH_TOOLKIT_DIR . 'lib/woff2/woff2.wasm';
		wp_add_inline_script(
			'etch-toolkit-fonts',
			'window.etchToolkitFonts = ' . wp_json_encode(
				array(
					'stylesheetName' => ETCH_TOOLKIT_FONTS_STYLESHEET,
					'workerUrl'      => ETCH_TOOLKIT_URL . 'lib/woff2/woff2-worker.js?' . filemtime( $wasm ),
				)
			) . ';',
			'before'
		);
	}
);

// Preload hints, front end only. Etch prints the stylesheet itself.
add_action(
	'wp_head',
	function () {
		if ( etch_toolkit_is_builder() ) {
			return;
		}
		foreach ( etch_toolkit_fonts_preloads() as $url ) {
			printf( '<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n", esc_url( $url ) );
		}
	},
	1
);

// Block Google Fonts stylesheets and hints from themes and other plugins.
add_filter(
	'style_loader_tag',
	function ( $tag, $handle, $href ) {
		if ( etch_toolkit_fonts_settings()['blockGoogle'] && ! is_admin() && ! etch_toolkit_is_builder() && str_contains( (string) $href, 'fonts.googleapis.com' ) ) {
			return '';
		}
		return $tag;
	},
	10,
	3
);
add_filter(
	'wp_resource_hints',
	function ( $urls ) {
		if ( ! etch_toolkit_fonts_settings()['blockGoogle'] || is_admin() ) {
			return $urls;
		}
		return array_values(
			array_filter(
				$urls,
				function ( $url ) {
					$href = is_array( $url ) ? ( $url['href'] ?? '' ) : $url;
					return ! preg_match( '#fonts\.(googleapis|gstatic)\.com#', (string) $href );
				}
			)
		);
	}
);

add_action(
	'rest_api_init',
	function () {
		$routes = array(
			'/fonts'                => array( 'GET', fn() => etch_toolkit_fonts_state() ),
			'/fonts/families'       => array(
				'POST',
				function ( WP_REST_Request $r ) {
					etch_toolkit_fonts_save( (array) $r['families'] );
					return etch_toolkit_fonts_state();
				},
			),
			'/fonts/settings'       => array(
				'POST',
				function ( WP_REST_Request $r ) {
					etch_toolkit_fonts_save_settings( (array) $r->get_json_params() );
					return etch_toolkit_fonts_state();
				},
			),
			'/fonts/upload'         => array( 'POST', 'etch_toolkit_fonts_rest_upload' ),
			'/fonts/files/delete'   => array(
				'POST',
				function ( WP_REST_Request $r ) {
					$result = etch_toolkit_fonts_delete_file( (string) $r['name'] );
					return is_wp_error( $result ) ? $result : etch_toolkit_fonts_state();
				},
			),
			'/fonts/export'         => array( 'GET', fn( WP_REST_Request $r ) => etch_toolkit_fonts_export( (array) $r['families'] ) ),
			'/fonts/import'         => array(
				'POST',
				function ( WP_REST_Request $r ) {
					$result = etch_toolkit_fonts_import( (array) $r->get_json_params() );
					return is_wp_error( $result ) ? $result : etch_toolkit_fonts_state();
				},
			),
			'/fonts/google'         => array(
				'GET',
				function ( WP_REST_Request $r ) {
					return etch_toolkit_fonts_google_search(
						(string) $r['search'],
						array(
							'category' => (string) $r['category'],
							'subset'   => (string) $r['subset'],
							'sort'     => (string) $r['sort'],
							'variable' => (bool) $r['variable'],
							'offset'   => (int) $r['offset'],
						)
					);
				},
			),
			'/fonts/google/install' => array(
				'POST',
				function ( WP_REST_Request $r ) {
					$result = etch_toolkit_fonts_google_install( (string) $r['family'], (array) $r['subsets'], (bool) $r['variable'], (array) $r['cuts'] );
					return is_wp_error( $result ) ? $result : etch_toolkit_fonts_state();
				},
			),
		);

		foreach ( $routes as $route => [ $method, $callback ] ) {
			register_rest_route(
				ETCH_TOOLKIT_REST_NAMESPACE,
				$route,
				array(
					'methods'             => $method,
					'callback'            => function ( WP_REST_Request $r ) use ( $callback ) {
						$result = $callback( $r );
						return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
					},
					'permission_callback' => 'etch_toolkit_can_manage',
				)
			);
		}
	}
);

/*
 * Storage
 */

/**
 * WordPress's fonts folder, which core's Font Library uses too.
 *
 * @return array{path: string, url: string} Both with a trailing slash.
 */
function etch_toolkit_fonts_dir(): array {
	$dir = wp_get_font_dir();
	return array(
		'path' => trailingslashit( $dir['path'] ),
		'url'  => trailingslashit( $dir['url'] ),
	);
}

/**
 * Absolute path to a file in the fonts folder, or '' if the name is unsafe.
 */
function etch_toolkit_fonts_path( string $name ): string {
	$clean = sanitize_file_name( $name );
	if ( '' === $clean || $clean !== $name || ! isset( ETCH_TOOLKIT_FONTS_FORMATS[ strtolower( pathinfo( $clean, PATHINFO_EXTENSION ) ) ] ) ) {
		return '';
	}
	return etch_toolkit_fonts_dir()['path'] . $clean;
}

/**
 * Root-relative URL for a font file, so the stylesheet survives a domain change.
 */
function etch_toolkit_fonts_file_url( string $name ): string {
	return wp_make_link_relative( etch_toolkit_fonts_dir()['url'] . rawurlencode( $name ) );
}

/**
 * @return array<int, array<string, mixed>>
 */
function etch_toolkit_fonts_families(): array {
	$families = get_option( ETCH_TOOLKIT_FONTS_OPTION, array() );
	return is_array( $families ) ? $families : array();
}

function etch_toolkit_fonts_save( array $families ): void {
	update_option( ETCH_TOOLKIT_FONTS_OPTION, etch_toolkit_fonts_sanitize_families( $families ), false );
}

/**
 * @return array{blockGoogle: bool, stylesheetId: string}
 */
function etch_toolkit_fonts_settings(): array {
	$settings = (array) get_option( ETCH_TOOLKIT_FONTS_SETTINGS, array() );
	return array(
		'blockGoogle'  => ! empty( $settings['blockGoogle'] ),
		'stylesheetId' => (string) ( $settings['stylesheetId'] ?? '' ),
	);
}

function etch_toolkit_fonts_save_settings( array $input ): void {
	$settings = etch_toolkit_fonts_settings();
	if ( array_key_exists( 'blockGoogle', $input ) ) {
		$settings['blockGoogle'] = (bool) $input['blockGoogle'];
	}
	if ( array_key_exists( 'stylesheetId', $input ) ) {
		$settings['stylesheetId'] = preg_replace( '/[^\w-]/', '', (string) $input['stylesheetId'] );
	}
	update_option( ETCH_TOOLKIT_FONTS_SETTINGS, $settings, false );
}

/**
 * Everything the builder panel needs.
 */
function etch_toolkit_fonts_state(): array {
	$families = etch_toolkit_fonts_families();
	return array(
		'families' => $families,
		'files'    => etch_toolkit_fonts_files( $families ),
		'settings' => etch_toolkit_fonts_settings(),
		'acss'     => etch_toolkit_fonts_acss_active(),
		'css'      => etch_toolkit_fonts_css( $families ),
		// For specimen previews in the builder, where the stylesheet itself doesn't load.
		'faces'    => etch_toolkit_fonts_css( $families, true, true ),
	);
}

/*
 * Sanitizing
 */

function etch_toolkit_fonts_sanitize_name( string $name ): string {
	return trim( (string) preg_replace( '/["\'{};\\\\\/()<>]/', '', sanitize_text_field( $name ) ) );
}

function etch_toolkit_fonts_sanitize_stack( string $stack ): string {
	$stack = preg_replace( '/[^A-Za-z0-9 ,\'"_-]/', '', sanitize_text_field( $stack ) );
	return trim( (string) preg_replace( '/\s+/', ' ', (string) $stack ), " ,\t\n" );
}

/**
 * A single weight (100-900) or a variable range like "100 900".
 */
function etch_toolkit_fonts_sanitize_weight( string $weight ): string {
	$weight = preg_replace( '/\s+/', ' ', trim( $weight ) );
	if ( preg_match( '/^[1-9]00$/', $weight ) ) {
		return $weight;
	}
	if ( preg_match( '/^(\d{1,4}) (\d{1,4})$/', $weight, $m ) && (int) $m[1] >= 1 && (int) $m[2] <= 1000 && (int) $m[1] <= (int) $m[2] ) {
		return (int) $m[1] . ' ' . (int) $m[2];
	}
	return '400';
}

function etch_toolkit_fonts_sanitize_range( string $range ): string {
	$range = trim( $range );
	return preg_match( '/^[Uu]\+[0-9A-Fa-f?]+(-[0-9A-Fa-f]+)?(\s*,\s*[Uu]\+[0-9A-Fa-f?]+(-[0-9A-Fa-f]+)?)*$/', $range ) ? $range : '';
}

/**
 * A size-matched fallback's measurements, as percentages. Anything out of range
 * drops the lot: no fallback beats one that reshapes every line.
 *
 * @param mixed $metrics Raw metrics: size, ascent, descent, gap and local.
 * @return array<string, mixed> Empty when unusable.
 */
function etch_toolkit_fonts_sanitize_metrics( $metrics ): array {
	if ( ! is_array( $metrics ) || ! isset( ETCH_TOOLKIT_FONTS_LOCALS[ $metrics['local'] ?? '' ] ) ) {
		return array();
	}
	$clean = array( 'local' => $metrics['local'] );
	foreach ( array( 'size' => array( 50, 200 ), 'ascent' => array( 1, 400 ), 'descent' => array( 0, 400 ), 'gap' => array( 0, 400 ) ) as $key => [ $min, $max ] ) {
		$value = is_numeric( $metrics[ $key ] ?? null ) ? round( (float) $metrics[ $key ], 2 ) : -1;
		if ( $value < $min || $value > $max ) {
			return array();
		}
		$clean[ $key ] = $value;
	}
	return $clean;
}

/**
 * @param array<int, mixed> $input Raw families.
 * @return array<int, array<string, mixed>>
 */
function etch_toolkit_fonts_sanitize_families( array $input ): array {
	$clean = array();
	$names = array();
	$taken = array(); // Each role belongs to one enabled family, the first that claims it.

	foreach ( $input as $family ) {
		if ( ! is_array( $family ) ) {
			continue;
		}
		$name = etch_toolkit_fonts_sanitize_name( (string) ( $family['name'] ?? '' ) );
		if ( '' === $name || isset( $names[ strtolower( $name ) ] ) ) {
			continue;
		}
		$names[ strtolower( $name ) ] = true;

		$variants = array();
		foreach ( (array) ( $family['variants'] ?? array() ) as $variant ) {
			$file = (string) ( $variant['file'] ?? '' );
			if ( ! is_array( $variant ) || '' === etch_toolkit_fonts_path( $file ) ) {
				continue;
			}
			$clean_variant = array(
				'file'   => $file,
				'weight' => etch_toolkit_fonts_sanitize_weight( (string) ( $variant['weight'] ?? '400' ) ),
				'style'  => 'italic' === ( $variant['style'] ?? '' ) ? 'italic' : 'normal',
			);
			$subset        = sanitize_key( (string) ( $variant['subset'] ?? '' ) );
			$range         = etch_toolkit_fonts_sanitize_range( (string) ( $variant['range'] ?? '' ) );
			if ( '' !== $subset ) {
				$clean_variant['subset'] = $subset;
			}
			if ( '' !== $range ) {
				$clean_variant['range'] = $range;
			}
			$variants[] = $clean_variant;
		}

		$enabled = ! array_key_exists( 'enabled', $family ) || ! empty( $family['enabled'] );
		$roles   = array();
		foreach ( (array) ( $family['roles'] ?? array() ) as $role ) {
			if ( $enabled && isset( ETCH_TOOLKIT_FONTS_ROLES[ $role ] ) && ! isset( $taken[ $role ] ) ) {
				$taken[ $role ] = true;
				$roles[]        = $role;
			}
		}
		sort( $roles );

		$display = (string) ( $family['display'] ?? 'swap' );
		$entry   = array(
			'name'     => $name,
			'source'   => 'google' === ( $family['source'] ?? '' ) ? 'google' : 'upload',
			'variants' => $variants,
			'fallback' => etch_toolkit_fonts_sanitize_stack( (string) ( $family['fallback'] ?? '' ) ),
			'display'  => in_array( $display, ETCH_TOOLKIT_FONTS_DISPLAY, true ) ? $display : 'swap',
			'preload'  => ! empty( $family['preload'] ),
			'enabled'  => $enabled,
			'roles'    => $roles,
		);

		$metrics = etch_toolkit_fonts_sanitize_metrics( $family['metrics'] ?? null );
		if ( $metrics ) {
			$entry['metrics'] = $metrics;
		}

		if ( 'google' === $entry['source'] && is_array( $family['google'] ?? null ) ) {
			$entry['google'] = array(
				'subsets'  => array_values( array_filter( array_map( 'sanitize_key', (array) ( $family['google']['subsets'] ?? array() ) ) ) ),
				'variable' => ! empty( $family['google']['variable'] ),
				'script'   => sanitize_key( (string) ( $family['google']['script'] ?? '' ) ),
			);
		}

		$clean[] = $entry;
	}

	return $clean;
}

/**
 * Weight and style from a file name: "Inter-SemiBoldItalic", "Roboto-300", "Inter[wght]".
 *
 * @return array{weight: string, style: string}
 */
function etch_toolkit_fonts_guess_variant( string $filename ): array {
	$name   = strtolower( pathinfo( $filename, PATHINFO_FILENAME ) );
	$narrow = (string) preg_replace( '/[^a-z0-9]/', '', $name );
	$style  = ( str_contains( $narrow, 'italic' ) || str_contains( $narrow, 'oblique' ) ) ? 'italic' : 'normal';

	if ( str_contains( $narrow, 'variablefont' ) || str_contains( $narrow, 'wght' ) || str_contains( $narrow, 'variable' ) ) {
		return array(
			'weight' => '100 900',
			'style'  => $style,
		);
	}
	if ( preg_match( '/(?<!\d)([1-9]00)(?!\d)/', $name, $m ) ) {
		return array(
			'weight' => $m[1],
			'style'  => $style,
		);
	}

	$weight = '400';
	$best   = -1;
	$length = 0;
	foreach ( ETCH_TOOLKIT_FONTS_WEIGHT_WORDS as $word => $value ) {
		$at = strrpos( $narrow, $word );
		if ( false === $at ) {
			continue;
		}
		$end = $at + strlen( $word );
		if ( $end > $best || ( $end === $best && strlen( $word ) > $length ) ) {
			$weight = $value;
			$best   = $end;
			$length = strlen( $word );
		}
	}

	return array(
		'weight' => $weight,
		'style'  => $style,
	);
}

/*
 * CSS
 */

function etch_toolkit_fonts_slug( string $name ): string {
	return sanitize_title( $name );
}

/**
 * "Inter", "Inter fallback", system-ui, sans-serif
 *
 * The size-matched fallback sits right after the font, since it only matters
 * while the font loads.
 */
function etch_toolkit_fonts_stack( array $family ): string {
	$stack = '"' . $family['name'] . '"' . ( empty( $family['metrics'] ) ? '' : ', "' . $family['name'] . ' fallback"' );
	return '' === $family['fallback'] ? $stack : $stack . ', ' . $family['fallback'];
}

/**
 * The stylesheet: @font-face rules, a --font-{slug} variable per family and
 * the heading/body tokens (--heading-font-family, --text-font-family) that
 * Etch documents, unless Automatic.css is active and takes them instead.
 *
 * @param array<int, array<string, mixed>> $families   Sanitized families.
 * @param bool                             $faces_only Only @font-face rules, for the builder UI.
 * @param bool                             $absolute   Absolute file URLs, for the builder UI.
 */
function etch_toolkit_fonts_css( array $families, bool $faces_only = false, bool $absolute = false ): string {
	$faces  = '';
	$vars   = '';
	$tokens = '';
	$rules  = '';
	$slugs  = array();

	foreach ( $families as $family ) {
		if ( empty( $family['enabled'] ) ) {
			continue;
		}

		$has_face = false;
		foreach ( $family['variants'] as $variant ) {
			// A rule for a missing file makes the browser silently use the fallback.
			if ( ! file_exists( etch_toolkit_fonts_path( $variant['file'] ) ) ) {
				continue;
			}
			$has_face = true;
			$ext      = strtolower( pathinfo( $variant['file'], PATHINFO_EXTENSION ) );
			$url      = $absolute ? etch_toolkit_fonts_dir()['url'] . rawurlencode( $variant['file'] ) : etch_toolkit_fonts_file_url( $variant['file'] );
			$faces   .= "@font-face {\n"
				. "\tfont-family: \"{$family['name']}\";\n"
				. "\tsrc: url(\"{$url}\") format(\"" . ETCH_TOOLKIT_FONTS_FORMATS[ $ext ] . "\");\n"
				. "\tfont-weight: {$variant['weight']};\n"
				. "\tfont-style: {$variant['style']};\n"
				. "\tfont-display: {$family['display']};\n"
				. ( empty( $variant['range'] ) ? '' : "\tunicode-range: {$variant['range']};\n" )
				. "}\n\n";
		}

		if ( $has_face && ! $faces_only && ! empty( $family['metrics'] ) ) {
			$metrics = $family['metrics'];
			$faces  .= "@font-face {\n"
				. "\tfont-family: \"{$family['name']} fallback\";\n"
				. "\tsrc: " . implode( ', ', array_map( fn( $local ) => "local(\"{$local}\")", ETCH_TOOLKIT_FONTS_LOCALS[ $metrics['local'] ] ) ) . ";\n"
				. "\tsize-adjust: {$metrics['size']}%;\n"
				. "\tascent-override: {$metrics['ascent']}%;\n"
				. "\tdescent-override: {$metrics['descent']}%;\n"
				. "\tline-gap-override: {$metrics['gap']}%;\n"
				. "}\n\n";
		}

		$slug = etch_toolkit_fonts_slug( $family['name'] );
		if ( ! $has_face || '' === $slug || isset( $slugs[ $slug ] ) ) {
			continue;
		}
		$slugs[ $slug ] = true;
		$vars          .= "\t--font-{$slug}: " . etch_toolkit_fonts_stack( $family ) . ";\n";

		// With Automatic.css, the roles live in its settings instead. See fonts-acss.php.
		foreach ( etch_toolkit_fonts_acss_active() ? array() : $family['roles'] as $role ) {
			$tokens .= "\t--{$role}-font-family: var(--font-{$slug});\n";
			$rules  .= ETCH_TOOLKIT_FONTS_ROLES[ $role ] . " {\n\tfont-family: var(--{$role}-font-family);\n}\n\n";
		}
	}

	if ( $faces_only ) {
		return $faces;
	}

	$css = "/* Managed by Etch Toolkit. Edit fonts in the Fonts manager, changes made here are overwritten. */\n\n" . $faces;
	if ( '' !== $vars ) {
		$css .= ":root {\n{$vars}{$tokens}}\n\n{$rules}";
	}
	return rtrim( $css ) . "\n";
}

/**
 * One file per family that asks for it: the upright cut nearest 400, latin first.
 *
 * @return string[] URLs, at most four.
 */
function etch_toolkit_fonts_preloads(): array {
	$urls = array();

	foreach ( etch_toolkit_fonts_families() as $family ) {
		if ( empty( $family['enabled'] ) || empty( $family['preload'] ) ) {
			continue;
		}

		$best  = null;
		$score = null;
		foreach ( $family['variants'] as $variant ) {
			if ( ! str_ends_with( $variant['file'], '.woff2' ) || ! file_exists( etch_toolkit_fonts_path( $variant['file'] ) ) ) {
				continue;
			}
			$bounds   = array_map( 'intval', explode( ' ', $variant['weight'] ) );
			$min      = $bounds[0];
			$max      = $bounds[1] ?? $bounds[0];
			$distance = ( $min <= 400 && 400 <= $max ) ? 0 : min( abs( $min - 400 ), abs( $max - 400 ) );
			$key      = array( 'italic' === $variant['style'] ? 1 : 0, $distance, ( $variant['subset'] ?? 'latin' ) === 'latin' ? 0 : 1 );
			if ( null === $score || $key < $score ) {
				$score = $key;
				$best  = $variant;
			}
		}

		if ( $best ) {
			$urls[] = etch_toolkit_fonts_file_url( $best['file'] );
		}
		if ( count( $urls ) >= 4 ) {
			break;
		}
	}

	return $urls;
}

/*
 * Files
 */

/**
 * Every font file in the fonts folder, with the family using it, if any.
 *
 * @param array<int, array<string, mixed>> $families Families, to mark files in use.
 * @return array<int, array<string, mixed>>
 */
function etch_toolkit_fonts_files( array $families ): array {
	$dir = etch_toolkit_fonts_dir()['path'];
	if ( ! is_dir( $dir ) ) {
		return array();
	}

	$used = array();
	foreach ( $families as $family ) {
		foreach ( $family['variants'] as $variant ) {
			$used[ $variant['file'] ] = $family['name'];
		}
	}

	$files = array();
	foreach ( new DirectoryIterator( $dir ) as $file ) {
		$name = $file->getFilename();
		if ( ! $file->isFile() || '' === etch_toolkit_fonts_path( $name ) ) {
			continue;
		}
		$files[] = array(
			'name'   => $name,
			'ext'    => strtolower( $file->getExtension() ),
			'size'   => $file->getSize(),
			'family' => $used[ $name ] ?? '',
		) + etch_toolkit_fonts_guess_variant( $name );
	}

	usort( $files, fn( $a, $b ) => strcasecmp( $a['name'], $b['name'] ) );
	return $files;
}

/**
 * Do these bytes start with the signature for this font format?
 */
function etch_toolkit_fonts_is_font( string $bytes, string $ext ): bool {
	$signature = substr( $bytes, 0, 4 );
	switch ( $ext ) {
		case 'woff2':
			return 'wOF2' === $signature;
		case 'woff':
			return 'wOFF' === $signature;
		case 'ttf':
			return "\x00\x01\x00\x00" === $signature || 'true' === $signature;
		case 'otf':
			return 'OTTO' === $signature;
	}
	return false;
}

/**
 * Write font bytes into the fonts folder. An identical file already there is
 * reused, a different one under the same name gets a suffix.
 *
 * @return string|WP_Error File name written or reused.
 */
function etch_toolkit_fonts_write( string $name, string $bytes ) {
	$ext  = strtolower( pathinfo( $name, PATHINFO_EXTENSION ) );
	$name = sanitize_file_name( $name );

	if ( ! isset( ETCH_TOOLKIT_FONTS_FORMATS[ $ext ] ) ) {
		return new WP_Error( 'etch_toolkit_font_type', 'Only WOFF2, WOFF, TTF and OTF files are allowed.', array( 'status' => 400 ) );
	}
	if ( strlen( $bytes ) > ETCH_TOOLKIT_FONTS_MAX_FILE ) {
		return new WP_Error( 'etch_toolkit_font_size', sprintf( '%s is larger than 10 MB.', $name ), array( 'status' => 400 ) );
	}
	if ( ! etch_toolkit_fonts_is_font( $bytes, $ext ) ) {
		return new WP_Error( 'etch_toolkit_font_contents', sprintf( "%s isn't a valid %s file.", $name, strtoupper( $ext ) ), array( 'status' => 400 ) );
	}

	$dir = etch_toolkit_fonts_dir()['path'];
	if ( ! wp_mkdir_p( $dir ) ) {
		return new WP_Error( 'etch_toolkit_font_dir', 'Could not create the fonts folder.', array( 'status' => 500 ) );
	}

	// Reuse a byte-identical file under any name.
	$hash = md5( $bytes );
	foreach ( glob( $dir . '*.' . $ext ) ?: array() as $existing ) {
		if ( filesize( $existing ) === strlen( $bytes ) && md5_file( $existing ) === $hash ) {
			return basename( $existing );
		}
	}

	if ( file_exists( $dir . $name ) ) {
		$name = pathinfo( $name, PATHINFO_FILENAME ) . '-' . substr( $hash, 0, 8 ) . '.' . $ext;
	}
	if ( false === file_put_contents( $dir . $name, $bytes ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		return new WP_Error( 'etch_toolkit_font_write', sprintf( 'Could not save %s.', $name ), array( 'status' => 500 ) );
	}
	return $name;
}

/**
 * Upload one file, then add it to a family: the one named in the request,
 * or one named after the file ("Inter-BoldItalic.woff2" goes into "Inter").
 *
 * @return array|WP_Error
 */
function etch_toolkit_fonts_rest_upload( WP_REST_Request $request ) {
	$file = $request->get_file_params()['file'] ?? null;
	if ( ! is_array( $file ) || UPLOAD_ERR_OK !== ( $file['error'] ?? -1 ) || ! is_uploaded_file( $file['tmp_name'] ) ) {
		return new WP_Error( 'etch_toolkit_font_upload', 'The upload failed.', array( 'status' => 400 ) );
	}

	$name = etch_toolkit_fonts_write( (string) $file['name'], (string) file_get_contents( $file['tmp_name'] ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( is_wp_error( $name ) ) {
		return $name;
	}

	$family = etch_toolkit_fonts_sanitize_name( (string) $request['family'] );
	if ( '' === $family ) {
		$family = etch_toolkit_fonts_family_from_file( (string) $file['name'] );
	}
	etch_toolkit_fonts_add_file( $family, $name );

	return etch_toolkit_fonts_state() + array(
		'uploaded' => array(
			'file'   => $name,
			'family' => $family,
		),
	);
}

/**
 * "Inter-SemiBoldItalic.woff2" => "Inter", "open_sans_700.ttf" => "Open Sans".
 */
function etch_toolkit_fonts_family_from_file( string $filename ): string {
	$name  = pathinfo( $filename, PATHINFO_FILENAME );
	$name  = (string) preg_replace( '/\[[^\]]*\]|variablefont.*$/i', '', $name );
	$words = preg_split( '/[-_\s]+|(?<=[a-z])(?=[A-Z])/', $name, -1, PREG_SPLIT_NO_EMPTY );
	$skip  = array_merge( array_keys( ETCH_TOOLKIT_FONTS_WEIGHT_WORDS ), array( 'italic', 'oblique', 'variable', 'extra', 'ultra', 'semi', 'demi', 'it', 'vf', 'webfont' ) );

	$kept = array();
	foreach ( $words as $word ) {
		if ( in_array( strtolower( $word ), $skip, true ) || preg_match( '/^\d+i?$/', $word ) ) {
			break;
		}
		$kept[] = ucfirst( $word );
	}

	$family = etch_toolkit_fonts_sanitize_name( implode( ' ', $kept ) );
	return '' === $family ? etch_toolkit_fonts_sanitize_name( $name ) : $family;
}

/**
 * Map a file into a family, creating the family if needed. Weight and style
 * come from the file name.
 */
function etch_toolkit_fonts_add_file( string $family_name, string $file ): void {
	$families = etch_toolkit_fonts_families();
	$index    = null;
	foreach ( $families as $i => $family ) {
		if ( 0 === strcasecmp( $family['name'], $family_name ) ) {
			$index = $i;
		}
		foreach ( $family['variants'] as $variant ) {
			if ( $variant['file'] === $file ) {
				return; // Already mapped.
			}
		}
	}

	if ( null === $index ) {
		$families[] = array(
			'name'     => $family_name,
			'source'   => 'upload',
			'variants' => array(),
		);
		$index      = array_key_last( $families );
	}
	$families[ $index ]['variants'][] = array( 'file' => $file ) + etch_toolkit_fonts_guess_variant( $file );

	etch_toolkit_fonts_save( $families );
}

/**
 * @return true|WP_Error
 */
function etch_toolkit_fonts_delete_file( string $name ) {
	$path = etch_toolkit_fonts_path( $name );
	if ( '' === $path || ! file_exists( $path ) ) {
		return new WP_Error( 'etch_toolkit_font_missing', 'File not found.', array( 'status' => 404 ) );
	}
	foreach ( etch_toolkit_fonts_families() as $family ) {
		foreach ( $family['variants'] as $variant ) {
			if ( $variant['file'] === $name ) {
				return new WP_Error( 'etch_toolkit_font_in_use', sprintf( '%s is used by %s. Remove it from the family first.', $name, $family['name'] ), array( 'status' => 409 ) );
			}
		}
	}
	wp_delete_file( $path );
	return true;
}

/*
 * Import and export
 */

/**
 * Families plus their font files, base64-encoded, as one JSON document.
 *
 * @param string[] $names Families to export. Empty exports all.
 */
function etch_toolkit_fonts_export( array $names = array() ): array {
	$families = etch_toolkit_fonts_families();
	if ( $names ) {
		$families = array_values( array_filter( $families, fn( $f ) => in_array( $f['name'], $names, true ) ) );
	}
	$files    = array();
	foreach ( $families as $family ) {
		foreach ( $family['variants'] as $variant ) {
			$path = etch_toolkit_fonts_path( $variant['file'] );
			if ( file_exists( $path ) ) {
				$files[ $variant['file'] ] = base64_encode( (string) file_get_contents( $path ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			}
		}
	}

	return array(
		'etchToolkitFonts' => 1,
		'families'         => $families,
		'files'            => (object) $files,
	);
}

/**
 * Merge an export into this site. Families with the same name are replaced.
 *
 * @return true|WP_Error
 */
function etch_toolkit_fonts_import( array $data ) {
	if ( 1 !== ( $data['etchToolkitFonts'] ?? null ) || ! is_array( $data['families'] ?? null ) ) {
		return new WP_Error( 'etch_toolkit_font_import', "This isn't an Etch Toolkit fonts export.", array( 'status' => 400 ) );
	}

	// Decode and write every file first, so a bad one stops the import before anything changes.
	$renamed = array();
	$decoded = array();
	$total   = 0;
	foreach ( (array) ( $data['files'] ?? array() ) as $name => $encoded ) {
		$bytes = base64_decode( (string) $encoded, true );
		if ( false === $bytes ) {
			return new WP_Error( 'etch_toolkit_font_import', sprintf( '%s is damaged.', $name ), array( 'status' => 400 ) );
		}
		$total += strlen( $bytes );
		if ( $total > ETCH_TOOLKIT_FONTS_MAX_IMPORT ) {
			return new WP_Error( 'etch_toolkit_font_import', 'The export holds more than 50 MB of fonts.', array( 'status' => 400 ) );
		}
		$ext = strtolower( pathinfo( (string) $name, PATHINFO_EXTENSION ) );
		if ( ! etch_toolkit_fonts_is_font( $bytes, $ext ) ) {
			return new WP_Error( 'etch_toolkit_font_import', sprintf( "%s isn't a valid font file.", $name ), array( 'status' => 400 ) );
		}
		$decoded[ (string) $name ] = $bytes;
	}
	foreach ( $decoded as $name => $bytes ) {
		$written = etch_toolkit_fonts_write( $name, $bytes );
		if ( is_wp_error( $written ) ) {
			return $written;
		}
		$renamed[ $name ] = $written;
	}

	$incoming = etch_toolkit_fonts_sanitize_families(
		array_map(
			function ( $family ) use ( $renamed ) {
				foreach ( (array) ( $family['variants'] ?? array() ) as $i => $variant ) {
					$family['variants'][ $i ]['file'] = $renamed[ $variant['file'] ?? '' ] ?? ( $variant['file'] ?? '' );
				}
				return $family;
			},
			$data['families']
		)
	);

	$replaced = array_map( 'strtolower', array_column( $incoming, 'name' ) );
	$kept     = array_filter( etch_toolkit_fonts_families(), fn( $f ) => ! in_array( strtolower( $f['name'] ), $replaced, true ) );
	etch_toolkit_fonts_save( array_merge( array_values( $kept ), $incoming ) );

	return true;
}
