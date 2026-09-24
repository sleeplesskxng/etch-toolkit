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

	$subsets = array_values( array_intersect( array_map( 'sanitize_key', $subsets ), $meta['subsets'] ) ) ?: array_slice( $meta['subsets'], 0, 1 );
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

	// Each @font-face follows a comment naming its subset, /* latin */, except in fonts
	// Google serves as one file per style, or in slices, like Japanese (a hundred or so
	// per style). Slices aren't downloaded, and the add dialog doesn't offer them.
	preg_match_all( '/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/', $css, $blocks, PREG_SET_ORDER );
	$face    = fn( $body ) => ( preg_match( '/font-style:\s*italic/', $body ) ? 'italic' : 'normal' ) . ( preg_match( '/font-weight:\s*(\d+(?:\s+\d+)?)/', $body, $m ) ? $m[1] : '400' );
	$wanted  = array();
	$unnamed = array();
	foreach ( $blocks as $block ) {
		$subset = sanitize_key( $block[1] );
		if ( '' === $subset ) {
			$unnamed[ $face( $block[2] ) ][] = $block[2];
		} elseif ( in_array( $subset, $subsets, true ) ) {
			$wanted[] = array( $subset, $block[2] );
		}
	}
	$missing = array_values( array_diff( $subsets, array_column( $wanted, 0 ) ) );
	if ( ( $missing || ! $wanted ) && $unnamed && 1 === max( array_map( 'count', $unnamed ) ) ) {
		foreach ( $unnamed as $bodies ) {
			$wanted[] = array( $missing[0] ?? 'all', $bodies[0] );
		}
		$missing = array();
	}
	if ( $missing || ! $wanted ) {
		return new WP_Error( 'etch_toolkit_google_subset', sprintf( "Google Fonts doesn't serve %s as files to download.", $missing ? implode( ', ', $missing ) . ' of ' . $meta['family'] : $meta['family'] ), array( 'status' => 400 ) );
	}

	// All or nothing: the family only changes once every file is here and whole.
	$slug     = sanitize_file_name( strtolower( str_replace( ' ', '-', $meta['family'] ) ) );
	$variants = array();
	foreach ( $wanted as [ $subset, $body ] ) {
		$style  = preg_match( '/font-style:\s*italic/', $body ) ? 'italic' : 'normal';
		$weight = preg_match( '/font-weight:\s*(\d+(?:\s+\d+)?)/', $body, $m ) ? etch_toolkit_fonts_sanitize_weight( $m[1] ) : '400';
		$file   = $slug . '-' . ( $axis ? 'variable' : $weight ) . ( 'italic' === $style ? 'i' : '' ) . '-' . $subset . '.woff2';
		$path   = etch_toolkit_fonts_path( $file );
		// An earlier download is reused if it's whole.
		$have = '' !== $path && is_file( $path ) && etch_toolkit_fonts_is_font( (string) file_get_contents( $path ), 'woff2' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( ! $have && ( '' === $path || ! preg_match( '/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/', $body, $url ) || ! etch_toolkit_fonts_download( $url[1], $path ) ) ) {
			return new WP_Error( 'etch_toolkit_google_download', sprintf( 'Could not download all of %s, so nothing changed. Try again.', $meta['family'] ), array( 'status' => 502 ) );
		}

		$variants[] = array(
			'file'   => $file,
			'weight' => $weight,
			'style'  => $style,
			'subset' => $subset,
			'range'  => preg_match( '/unicode-range:\s*([^;}]+)/', $body, $m ) ? $m[1] : '',
		);
	}

	usort( $variants, fn( $a, $b ) => array( $a['style'], (int) $a['weight'] ) <=> array( $b['style'], (int) $b['weight'] ) );

	$entry = array(
		'name'     => $meta['family'],
		'source'   => 'google',
		'variants' => $variants,
		'google'   => array(
			'subsets'  => $subsets,
			'variable' => (bool) $axis,
			'script'   => $meta['script'],
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
 * Download a font file from Google into the fonts folder, keeping it only if
 * it's a whole WOFF2. It's written under a temporary name first, so a page
 * never loads half a file.
 */
function etch_toolkit_fonts_download( string $url, string $path ): bool {
	$partial = $path . '.part';
	wp_mkdir_p( dirname( $path ) );
	$response = wp_remote_get(
		$url,
		array(
			'timeout'  => 30,
			'stream'   => true,
			'filename' => $partial,
		)
	);
	$ok = ! is_wp_error( $response ) && 200 === wp_remote_retrieve_response_code( $response )
		&& etch_toolkit_fonts_is_font( (string) file_get_contents( $partial ), 'woff2' ) // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		&& rename( $partial, $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename
	if ( ! $ok ) {
		wp_delete_file( $partial );
	}
	return $ok;
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
