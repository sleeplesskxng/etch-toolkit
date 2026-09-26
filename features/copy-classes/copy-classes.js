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
	const { isClassSelector } = window.etchToolkit || {};
	if ( ! isClassSelector ) return;

	const LAYER = '.etch-builder-accordion__header[data-blockid]';
	const BADGE = '.etch-css-selectors .etch-badges > *';
	const MENU = '.right-click-menu__content';
	const ITEM = '.right-click-menu__item';
	const LABEL = '.right-click-menu__item-label';
	const SEPARATOR = '.right-click-menu__separator';
	const OURS = 'etk-copy-classes';
	const STORE = 'etk-copied-classes';
	// Blocks with a class attribute. Components take classes through their properties.
	const ELEMENTS = new Set( [ 'etch/element', 'etch/svg', 'etch/dynamic-element', 'etch/dynamic-image' ] );

	let target = null; // { blockId } or { selector }, with `at`, for what was last right-clicked
	let copied = [];
	try {
		const stored = JSON.parse( localStorage.getItem( STORE ) );
		if ( Array.isArray( stored ) ) copied = stored.filter( ( name ) => typeof name === 'string' );
	} catch {}

	// Class names, keeping dynamic ones like `btn--{props.variant}` whole.
	const split = ( value ) => ( typeof value === 'string' ? value.trim().split( /\s+(?![^{]*})/ ).filter( Boolean ) : [] );

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

	// Esc closes Etch's menu. The keyup follows, or Etch, which tracks held keys, takes
	// Esc as still held and reads the next key pressed as Esc too, deselecting the block.
	const closeMenu = ( menu ) => {
		for ( const type of [ 'keydown', 'keyup' ] ) {
			menu.dispatchEvent( new KeyboardEvent( type, { key: 'Escape', bubbles: true, cancelable: true } ) );
		}
	};

	// A copy of one of the menu's plain rows, labelled and wired to run.
	const makeItem = ( menu, label, run ) => {
		const source = [ ...menu.querySelectorAll( ITEM ) ].find( ( item ) => ! item.matches( '.danger, [aria-haspopup]' ) );
		if ( ! source ) return null;

		const item = source.cloneNode( true );
		item.classList.add( OURS );
		item.removeAttribute( 'id' );
		item.removeAttribute( 'data-highlighted' );
		item.removeAttribute( 'textvalue' );
		item.querySelector( `${ ITEM }-shortcut` )?.remove();

		// Keep the label's icon (if any), replace only its text.
		const labelEl = item.querySelector( LABEL );
		const text = [ ...labelEl.childNodes ].find( ( n ) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() );
		if ( text ) text.textContent = ` ${ label }`;
		else labelEl.append( ` ${ label }` );

		const activate = ( event ) => {
			event.preventDefault();
			event.stopPropagation();
			closeMenu( menu );
			run();
		};
		item.addEventListener( 'click', activate );
		item.addEventListener( 'keydown', ( event ) => {
			if ( event.key === 'Enter' || event.key === ' ' ) activate( event );
		} );
		return item;
	};

	const findItem = ( menu, label ) => [ ...menu.querySelectorAll( ITEM ) ].find( ( item ) => item.querySelector( LABEL )?.textContent.trim() === label );

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

		const bem = findItem( menu, 'Generate BEM Classes' );
		if ( bem ) bem.after( ...items );
		else menu.prepend( ...items );
	};

	// Above Delete, and its separator if it has one.
	const addBadgeItem = ( menu, selector ) => {
		if ( ! isClassSelector( selector ) ) return;
		const name = selector.trim().slice( 1 );
		const item = makeItem( menu, 'Copy Class', () => copy( [ name ] ) );
		const deleteItem = findItem( menu, 'Delete' );
		if ( ! item || ! deleteItem ) return;

		const before = deleteItem.previousElementSibling?.matches( SEPARATOR ) ? deleteItem.previousElementSibling : deleteItem;
		before.before( item );
	};

	document.addEventListener(
		'contextmenu',
		( event ) => {
			const layer = event.target.closest?.( LAYER );
			const badge = ! layer && event.target.closest?.( BADGE );
			target = layer ? { blockId: layer.dataset.blockid, at: Date.now() } : badge ? { selector: badge.textContent.trim(), at: Date.now() } : null;
		},
		true
	);

	new MutationObserver( () => {
		// Only menus opened from a layer or class badge within the last second.
		if ( ! target || Date.now() - target.at > 1000 ) return;
		const menu = document.querySelector( MENU );
		if ( ! menu || menu.querySelector( `.${ OURS }` ) ) return;
		if ( target.blockId ) addLayerItems( menu, target.blockId );
		else addBadgeItem( menu, target.selector );
	} ).observe( document.body, { childList: true, subtree: true } );
} )();
