<?php
/**
 * Fonts: Google Fonts search and install.
 *
 * Installing downloads the WOFF2 files into the fonts folder, so pages make no
 * requests to Google.
 */

defined( 'ABSPATH' ) || exit;

const ETCH_TOOLKIT_GOOGLE_INDEX     = 'etch_toolkit_google_fonts_index';
const ETCH_TOOLKIT_GOOGLE_METADATA  = 'https://fonts.google.com/metadata/fonts';
const ETCH_TOOLKIT_GOOGLE_CSS       = 'https://fonts.googleapis.com/css2';
const ETCH_TOOLKIT_GOOGLE_PAGE_SIZE = 24;
// The CSS API only returns WOFF2 to a modern browser.
const ETCH_TOOLKIT_GOOGLE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * The Google Fonts catalogue, cached for a week.
 *
 * @return array<int, array<string, mixed>>|WP_Error
 */
function etch_toolkit_fonts_google_index() {
	$cached = get_transient( ETCH_TOOLKIT_GOOGLE_INDEX );
	if ( is_array( $cached ) && $cached ) {
		return $cached;
	}

	$response = wp_remote_get( ETCH_TOOLKIT_GOOGLE_METADATA, array( 'timeout' => 15 ) );
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	// Google prefixes the JSON with )]}' to stop JSON hijacking.
	$data = json_decode( (string) preg_replace( '/^\)\]\}\'\s*/', '', wp_remote_retrieve_body( $response ) ), true );
	if ( empty( $data['familyMetadataList'] ) ) {
		return new WP_Error( 'etch_toolkit_google_index', 'Could not load the Google Fonts catalogue.', array( 'status' => 502 ) );
	}

	$fonts = array();
	foreach ( $data['familyMetadataList'] as $meta ) {
		$wght = array();
		foreach ( (array) ( $meta['axes'] ?? array() ) as $axis ) {
			if ( 'wght' === ( $axis['tag'] ?? '' ) ) {
				$wght = array(
					'min' => (int) $axis['min'],
					'max' => (int) $axis['max'],
				);
			}
		}

		$fonts[] = array(
			'family'     => (string) ( $meta['family'] ?? '' ),
			'category'   => strtolower( (string) ( $meta['category'] ?? '' ) ),
			// Google's cut notation: "400" regular, "700i" bold italic.
			'cuts'       => array_map( 'strval', array_keys( (array) ( $meta['fonts'] ?? array() ) ) ),
			'subsets'    => array_values( array_diff( array_map( 'sanitize_key', (array) ( $meta['subsets'] ?? array() ) ), array( 'menu' ) ) ),
			'script'     => sanitize_key( (string) ( $meta['primaryScript'] ?? '' ) ),
			'wght'       => $wght,
			'popularity' => (int) ( $meta['popularity'] ?? PHP_INT_MAX ),
			'trending'   => (int) ( $meta['trending'] ?? PHP_INT_MAX ),
			'added'      => (string) ( $meta['dateAdded'] ?? '' ),
		);
	}

	set_transient( ETCH_TOOLKIT_GOOGLE_INDEX, $fonts, WEEK_IN_SECONDS );
	return $fonts;
}

/**
 * @param array{category?: string, subset?: string, sort?: string, offset?: int, variable?: bool} $args Filters. `variable` keeps only families with a variable weight axis.
 * @return array|WP_Error
 */
function etch_toolkit_fonts_google_search( string $search, array $args ) {
	$fonts = etch_toolkit_fonts_google_index();
	if ( is_wp_error( $fonts ) ) {
		return $fonts;
	}

	// Filter options come from the whole catalogue, before filtering.
	$categories = array_values( array_unique( array_filter( array_column( $fonts, 'category' ) ) ) );
	sort( $categories );
	$subsets = array();
	foreach ( $fonts as $font ) {
		foreach ( $font['subsets'] as $subset ) {
			$subsets[ $subset ] = ( $subsets[ $subset ] ?? 0 ) + 1;
		}
	}
	arsort( $subsets );

	$needle   = strtolower( trim( $search ) );
	$category = strtolower( (string) ( $args['category'] ?? '' ) );
	$subset   = sanitize_key( (string) ( $args['subset'] ?? '' ) );
	$variable = ! empty( $args['variable'] );
	$fonts    = array_values(
		array_filter(
			$fonts,
			fn( $font ) => ( '' === $needle || str_contains( strtolower( $font['family'] ), $needle ) )
				&& ( '' === $category || $font['category'] === $category )
				&& ( '' === $subset || in_array( $subset, $font['subsets'], true ) )
				&& ( ! $variable || $font['wght'] )
		)
	);

	$sort = (string) ( $args['sort'] ?? 'popularity' );
	usort(
		$fonts,
		function ( $a, $b ) use ( $needle, $sort ) {
			// Names starting with the search come first, whatever the sort.
			if ( '' !== $needle ) {
				$diff = (int) ! str_starts_with( strtolower( $a['family'] ), $needle ) - (int) ! str_starts_with( strtolower( $b['family'] ), $needle );
				if ( $diff ) {
					return $diff;
				}
			}
			switch ( $sort ) {
				case 'alphabetical':
					return strcasecmp( $a['family'], $b['family'] );
				case 'trending':
					return $a['trending'] <=> $b['trending'];
				case 'newest':
					return strcmp( $b['added'], $a['added'] );
			}
			return $a['popularity'] <=> $b['popularity'];
		}
	);

	$offset = max( 0, (int) ( $args['offset'] ?? 0 ) );
	return array(
		'results'    => array_slice( $fonts, $offset, ETCH_TOOLKIT_GOOGLE_PAGE_SIZE ),
		'total'      => count( $fonts ),
		'offset'     => $offset,
		'categories' => $categories,
		'subsets'    => array_keys( $subsets ),
	);
}

/**
 * Download a Google family and add it to the library, replacing its variants
 * if it's already installed.
 *
 * @param string   $family   Family name.
 * @param string[] $subsets  Subsets to download, e.g. latin, latin-ext.
 * @param bool     $variable One variable file per subset instead of one per cut.
 * @param string[] $cuts     Cuts for a static install ("400", "700i"). Empty for all.
 * @return true|WP_Error
 */
function etch_toolkit_fonts_google_install( string $family, array $subsets, bool $variable, array $cuts ) {
	$meta = null;
	$all  = etch_toolkit_fonts_google_index();
	if ( is_wp_error( $all ) ) {
		return $all;
	}
	foreach ( $all as $font ) {
		if ( 0 === strcasecmp( $font['family'], $family ) ) {
			$meta = $font;
		}
	}
	if ( ! $meta ) {
		return new WP_Error( 'etch_toolkit_google_family', sprintf( '%s is not a Google font.', $family ), array( 'status' => 404 ) );
	}

	$subsets = array_values( array_intersect( array_map( 'sanitize_key', $subsets ), $meta['subsets'] ) ) ?: array( 'latin' );
	$cuts    = array_values( array_intersect( array_map( 'strval', $cuts ), $meta['cuts'] ) ) ?: $meta['cuts'];
	$axis    = $variable ? $meta['wght'] : array();

	// A variable request is a range per style, a static one lists each cut. Tuples must be sorted.
	$italics = array_filter( $cuts, fn( $cut ) => str_ends_with( $cut, 'i' ) );
	if ( $axis ) {
		$range = $axis['min'] . '..' . $axis['max'];
		$spec  = $italics ? ":ital,wght@0,{$range};1,{$range}" : ":wght@{$range}";
	} else {
		$tuples = array_map( fn( $cut ) => ( str_ends_with( $cut, 'i' ) ? '1,' : '0,' ) . (int) $cut, $cuts );
		sort( $tuples, SORT_NATURAL );
		$spec = ':ital,wght@' . implode( ';', $tuples );
	}

	$response = wp_remote_get(
		ETCH_TOOLKIT_GOOGLE_CSS . '?family=' . rawurlencode( $meta['family'] ) . $spec . '&display=swap',
		array(
			'timeout'    => 20,
			'user-agent' => ETCH_TOOLKIT_GOOGLE_UA,
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}
	$css = wp_remote_retrieve_body( $response );
	if ( 200 !== wp_remote_retrieve_response_code( $response ) || '' === $css ) {
		return new WP_Error( 'etch_toolkit_google_css', sprintf( 'Google Fonts did not return %s.', $meta['family'] ), array( 'status' => 502 ) );
	}

	// One @font-face per subset, each after a comment naming it: /* latin */.
	$slug     = sanitize_file_name( strtolower( str_replace( ' ', '-', $meta['family'] ) ) );
	$variants = array();
	$chunks   = preg_split( '/\/\*\s*([\w-]+)\s*\*\//', $css, -1, PREG_SPLIT_DELIM_CAPTURE );
	for ( $i = 1; $i < count( $chunks ) - 1; $i += 2 ) {
		$subset = sanitize_key( $chunks[ $i ] );
		$block  = $chunks[ $i + 1 ];
		if ( ! in_array( $subset, $subsets, true ) || ! preg_match( '/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/', $block, $url ) ) {
			continue;
		}
		$style  = preg_match( '/font-style:\s*italic/', $block ) ? 'italic' : 'normal';
		$weight = preg_match( '/font-weight:\s*(\d+(?:\s+\d+)?)/', $block, $m ) ? etch_toolkit_fonts_sanitize_weight( $m[1] ) : '400';
		$file   = $slug . '-' . ( $axis ? 'variable' : $weight ) . ( 'italic' === $style ? 'i' : '' ) . '-' . $subset . '.woff2';
		$path   = etch_toolkit_fonts_path( $file );

		if ( '' === $path ) {
			continue;
		}
		if ( ! file_exists( $path ) ) {
			wp_mkdir_p( dirname( $path ) );
			$download = wp_remote_get(
				$url[1],
				array(
					'timeout'  => 30,
					'stream'   => true,
					'filename' => $path,
				)
			);
			if ( is_wp_error( $download ) || 200 !== wp_remote_retrieve_response_code( $download ) ) {
				wp_delete_file( $path );
				continue;
			}
		}

		$variants[] = array(
			'file'   => $file,
			'weight' => $weight,
			'style'  => $style,
			'subset' => $subset,
			'range'  => preg_match( '/unicode-range:\s*([^;}]+)/', $block, $m ) ? $m[1] : '',
		);
	}

	if ( ! $variants ) {
		return new WP_Error( 'etch_toolkit_google_download', sprintf( 'Could not download %s.', $meta['family'] ), array( 'status' => 502 ) );
	}
	usort( $variants, fn( $a, $b ) => array( $a['style'], (int) $a['weight'] ) <=> array( $b['style'], (int) $b['weight'] ) );

	$entry = array(
		'name'     => $meta['family'],
		'source'   => 'google',
		'variants' => $variants,
		'google'   => array(
			'subsets'  => $subsets,
			'variable' => (bool) $axis,
		),
	);

	$families = etch_toolkit_fonts_families();
	$found    = false;
	foreach ( $families as $i => $existing ) {
		if ( 0 === strcasecmp( $existing['name'], $meta['family'] ) ) {
			$families[ $i ] = array_merge( $existing, $entry );
			$found          = true;
		}
	}
	if ( ! $found ) {
		$entry['fallback'] = etch_toolkit_fonts_google_fallback( $meta['category'] );
		$families[]        = $entry;
	}
	etch_toolkit_fonts_save( $families );

	return true;
}

/**
 * A generic family to fall back to, from Google's category.
 */
function etch_toolkit_fonts_google_fallback( string $category ): string {
	switch ( $category ) {
		case 'serif':
			return 'serif';
		case 'monospace':
			return 'monospace';
		case 'handwriting':
			return 'cursive';
	}
	return 'sans-serif';
}
