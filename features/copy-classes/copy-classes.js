/**
 * Etch Toolkit: copy and paste classes.
 *
 * - "Copy Classes" and "Paste Classes" in a layer's right-click menu. Paste
 *   adds the copied classes to the layer, after any it already has.
 * - "Copy Class" in the CSS editor's class right-click menu, to paste that
 *   one class onto a layer.
 *
 * Etch's menus take no outside items, so this clones rows from the menu and
 * inserts them. What's copied is kept for the browser, so it pastes onto
 * another page too, and goes on the clipboard as text.
 */
( () => {
	const { isClassSelector, classNames: split, onMenu, menuItem, findMenuItem } = window.etchToolkit || {};
	if ( ! isClassSelector ) return;

	const LAYER = '.etch-builder-accordion__header[data-blockid]';
	const BADGE = '.etch-css-selectors .etch-badges > *';
	const SEPARATOR = '.right-click-menu__separator';
	const OURS = 'etk-copy-classes';
	const STORE = 'etk-copied-classes';
	// Blocks with a class attribute. Components take classes through their properties.
	const ELEMENTS = new Set( [ 'etch/element', 'etch/svg', 'etch/dynamic-element', 'etch/dynamic-image' ] );

	let copied = [];
	try {
		const stored = JSON.parse( localStorage.getItem( STORE ) );
		if ( Array.isArray( stored ) ) copied = stored.filter( ( name ) => typeof name === 'string' );
	} catch {}

	const element = ( id ) => {
		try {
			const block = window.etch.blocks.getJson( id );
			return ELEMENTS.has( block?.type ) ? block : null;
		} catch {
			return null;
		}
	};

	const copy = ( names ) => {
		copied = names;
		try {
			localStorage.setItem( STORE, JSON.stringify( names ) );
		} catch {}
		navigator.clipboard?.writeText( names.join( ' ' ) ).catch( () => {} );
	};

	const paste = ( id ) => {
		const block = element( id );
		if ( ! block ) return;
		const names = split( block.attributes?.class );
		const added = copied.filter( ( name ) => ! names.includes( name ) );
		if ( added.length ) window.etch.blocks.update( id, { attributes: { class: [ ...names, ...added ].join( ' ' ) } } );
	};

	const makeItem = ( menu, label, run ) => menuItem( menu, label, run, { className: OURS } );

	// After Generate BEM Classes, Etch's class item, or at the top.
	const addLayerItems = ( menu, id ) => {
		const block = element( id );
		if ( ! block ) return;
		const names = split( block.attributes?.class );
		const items = [
			names.length && makeItem( menu, 'Copy Classes', () => copy( names ) ),
			copied.length && makeItem( menu, 'Paste Classes', () => paste( id ) ),
		].filter( Boolean );
		if ( ! items.length ) return;

		const bem = findMenuItem( menu, 'Generate BEM Classes' );
		if ( bem ) bem.after( ...items );
		else menu.prepend( ...items );
	};

	// Above Delete, and its separator if it has one.
	const addBadgeItem = ( menu, selector ) => {
		if ( ! isClassSelector( selector ) ) return;
		const name = selector.trim().slice( 1 );
		const item = makeItem( menu, 'Copy Class', () => copy( [ name ] ) );
		const deleteItem = findMenuItem( menu, 'Delete' );
		if ( ! item || ! deleteItem ) return;

		const before = deleteItem.previousElementSibling?.matches( SEPARATOR ) ? deleteItem.previousElementSibling : deleteItem;
		before.before( item );
	};

	onMenu( LAYER, OURS, ( menu, layer ) => addLayerItems( menu, layer.dataset.blockid ) );
	onMenu( BADGE, OURS, ( menu, badge ) => addBadgeItem( menu, badge.textContent.trim() ) );
} )();
