<?php
/**
 * Shared helpers for Etch Toolkit features.
 */

defined( 'ABSPATH' ) || exit;

const ETCH_TOOLKIT_REST_NAMESPACE = 'etch-toolkit/v1';

/**
 * True when the current request is the Etch builder.
 */
function etch_toolkit_is_builder(): bool {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only context check, mirrors Etch.
	return ! is_admin() && isset( $_GET['etch'] ) && 'magic' === $_GET['etch'] && current_user_can( 'manage_options' );
}

function etch_toolkit_can_manage(): bool {
	return current_user_can( 'manage_options' );
}

/**
 * Register the core script and styles every feature builds on:
 * `window.etchToolkit` (REST URL, nonce, api(), el(), confirmDialog()).
 */
function etch_toolkit_register_core(): void {
	if ( wp_script_is( 'etch-toolkit', 'registered' ) ) {
		return;
	}

	$url  = ETCH_TOOLKIT_URL . 'assets/etch-toolkit';
	$path = ETCH_TOOLKIT_DIR . 'assets/etch-toolkit';

	wp_register_style( 'etch-toolkit', "{$url}.css", array(), (string) filemtime( "{$path}.css" ) );
	wp_register_script( 'etch-toolkit', "{$url}.js", array(), (string) filemtime( "{$path}.js" ), true );
	wp_add_inline_script(
		'etch-toolkit',
		'window.etchToolkit = ' . wp_json_encode(
			array(
				'restUrl' => esc_url_raw( rest_url( ETCH_TOOLKIT_REST_NAMESPACE . '/' ) ),
				'nonce'   => wp_create_nonce( 'wp_rest' ),
			)
		) . ';',
		'before'
	);
}

/**
 * Enqueue a feature's JS and CSS in the builder, after the core.
 *
 * @param string $feature Folder name under features/, also the file basename.
 */
function etch_toolkit_enqueue_feature( string $feature ): void {
	etch_toolkit_register_core();

	$handle = "etch-toolkit-{$feature}";
	$url    = ETCH_TOOLKIT_URL . "features/{$feature}/{$feature}";
	$path   = ETCH_TOOLKIT_DIR . "features/{$feature}/{$feature}";

	if ( file_exists( "{$path}.css" ) ) {
		wp_enqueue_style( $handle, "{$url}.css", array( 'etch-toolkit' ), (string) filemtime( "{$path}.css" ) );
	} else {
		wp_enqueue_style( 'etch-toolkit' );
	}
	wp_enqueue_script( $handle, "{$url}.js", array( 'etch-toolkit' ), (string) filemtime( "{$path}.js" ), true );
}

/**
 * IDs of every post whose content can hold Etch blocks: pages, posts,
 * custom post types, templates and components (wp_block).
 *
 * @return int[]
 */
function etch_toolkit_content_post_ids(): array {
	$ids = get_posts(
		array(
			'post_type'              => 'any',
			'post_status'            => array( 'publish', 'draft', 'pending', 'private', 'future' ),
			'numberposts'            => -1,
			'fields'                 => 'ids',
			'no_found_rows'          => true,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
		)
	);

	// 'any' skips post types excluded from search, which includes templates and components.
	$ids = array_merge(
		$ids,
		get_posts(
			array(
				'post_type'     => array( 'wp_template', 'wp_template_part', 'wp_block' ),
				'post_status'   => array( 'publish', 'draft', 'private' ),
				'numberposts'   => -1,
				'fields'        => 'ids',
				'no_found_rows' => true,
			)
		)
	);

	return array_values( array_unique( array_map( 'intval', $ids ) ) );
}

/**
 * Run a callback on every block comment's attributes in some post content,
 * rewriting only the blocks it changes.
 *
 * Edits each block's JSON in place instead of parse_blocks() + serialize_blocks(),
 * because that round trip turns empty JSON objects into arrays and rewrites
 * blocks that weren't touched.
 *
 * @param string   $content Post content.
 * @param callable $edit    fn( object $attrs ): bool. Mutates $attrs, returns true if it changed anything.
 * @param int      $changed Set to the number of blocks changed.
 * @return string Updated content.
 */
function etch_toolkit_edit_block_attrs( string $content, callable $edit, int &$changed ): string {
	$changed = 0;

	// Block opener tokenizer, same pattern as WP_Block_Parser.
	$pattern = '/<!--\s+wp:(?P<name>(?:[a-z][a-z0-9_-]*\/)?[a-z][a-z0-9_-]*)\s+(?P<attrs>{(?:(?:[^}]+|}+(?=})|(?!}\s+\/?-->).)*+)?}\s+)(?P<void>\/)?-->/s';

	return preg_replace_callback(
		$pattern,
		function ( $match ) use ( $edit, &$changed ) {
			$attrs = json_decode( $match['attrs'] );
			if ( ! is_object( $attrs ) || ! $edit( $attrs ) ) {
				return $match[0];
			}

			++$changed;
			return '<!-- wp:' . $match['name'] . ' ' . serialize_block_attributes( $attrs ) . ' ' . ( empty( $match['void'] ) ? '' : '/' ) . '-->';
		},
		$content
	);
}

/**
 * Save new post content, keeping a revision where the post type supports it.
 *
 * @return true|WP_Error
 */
function etch_toolkit_update_content( int $post_id, string $content ) {
	$result = wp_update_post(
		wp_slash(
			array(
				'ID'           => $post_id,
				'post_content' => $content,
			)
		),
		true
	);
	return is_wp_error( $result ) ? $result : true;
}

/**
 * @return array{id: int, title: string, type: string, elements: int}
 */
function etch_toolkit_post_summary( int $post_id, int $elements ): array {
	$type_object = get_post_type_object( get_post_type( $post_id ) );
	return array(
		'id'       => $post_id,
		'title'    => get_the_title( $post_id ),
		'type'     => $type_object ? $type_object->labels->singular_name : get_post_type( $post_id ),
		'elements' => $elements,
	);
}
