/**
 * Etch Toolkit: "Delete Everywhere" in the CSS editor's class right-click menu.
 *
 * Etch's menus take no outside items, so this clones the menu's own "Delete"
 * row and inserts it underneath. Running it saves the current page, has the
 * server strip the class from all content and delete the style, then reloads
 * the builder so no stale copy of a page or component can bring the class back.
 */
( () => {
	const { restUrl, api, save, el, confirmDialog, reload } = window.etchToolkit || {};
	if ( ! restUrl || ! confirmDialog ) return;

	const BADGE = '.etch-css-selectors .etch-badges > *';
	const MENU = '.right-click-menu__content';
	const ITEM = '.right-click-menu__item';
	const LABEL = '.right-click-menu__item-label';
	const OUR_ITEM = 'etk-delete-everywhere';

	let target = null; // { selector, at } for the class badge last right-clicked
	let running = false;

	const findClassStyle = ( selector ) => {
		try {
			return window.etch.styles.list( { type: 'class' } ).find( ( s ) => s.selector === selector );
		} catch {
			return undefined;
		}
	};

	const usageMessage = ( usage ) => {
		const strong = ( text ) => el( 'strong', { textContent: text } );
		const code = ( text ) => el( 'code', { textContent: text } );
		const nodes = [];

		if ( usage.elements ) {
			const count = `${ usage.elements } ${ usage.elements === 1 ? 'element' : 'elements' }`;
			nodes.push(
				el( 'p', {}, [ "You're about to remove ", code( usage.selector ), ` from ${ count } and delete the style.` ] ),
				el(
					'ul',
					{ className: 'etk-confirm__list' },
					usage.posts.map( ( post ) =>
						el( 'li', {}, [
							el( 'span', { textContent: `${ post.title || '(no title)' } ` } ),
							el( 'span', { className: 'etk-confirm__meta', textContent: `${ post.type }, ${ post.elements }` } ),
						] )
					)
				)
			);
		} else {
			nodes.push( el( 'p', {}, [ "You're about to delete ", code( usage.selector ), ". It isn't used on any saved content." ] ) );
		}

		nodes.push(
			el( 'p', {}, [ 'Your changes will be saved and the builder will reload. This action ', strong( 'cannot be undone' ), '. Are you sure?' ] )
		);
		return nodes;
	};

	const run = async ( styleId ) => {
		if ( running ) return;
		running = true;

		let dialog;
		try {
			// Counts reflect saved content. Unsaved uses get saved below, then stripped with the rest.
			// A style made since the last save isn't on the server yet, so that one saves first.
			const usage = await api( `styles/${ styleId }/usage` ).catch( async ( err ) => {
				if ( err.code !== 'etch_toolkit_style_not_found' ) throw err;
				await save();
				return api( `styles/${ styleId }/usage` );
			} );
			dialog = confirmDialog( {
				title: 'Deleting a class everywhere',
				message: usageMessage( usage ),
				confirmLabel: 'Yes, delete',
				failTitle: 'Delete Everywhere failed',
			} );
			if ( ! ( await dialog.result ) ) return;

			await save();
			await api( `styles/${ styleId }/delete-everywhere`, 'POST' );
			reload();
		} catch ( err ) {
			if ( dialog ) dialog.fail( err.message );
			else window.alert( `Delete Everywhere failed: ${ err.message }` );
		} finally {
			running = false;
		}
	};

	const closeMenu = ( menu ) =>
		menu.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );

	const addItem = ( menu ) => {
		if ( menu.querySelector( `.${ OUR_ITEM }` ) ) return;

		const deleteItem = [ ...menu.querySelectorAll( ITEM ) ].find(
			( item ) => item.querySelector( LABEL )?.textContent.trim() === 'Delete'
		);
		const style = findClassStyle( target.selector );
		if ( ! deleteItem || ! style ) return;

		const item = deleteItem.cloneNode( true );
		item.classList.add( OUR_ITEM );
		item.removeAttribute( 'id' );
		item.removeAttribute( 'data-highlighted' );

		// Keep the label's icon (if any), replace only its text.
		const label = item.querySelector( LABEL );
		const text = [ ...label.childNodes ].find( ( n ) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() );
		if ( text ) text.textContent = 'Delete Everywhere';
		else label.append( 'Delete Everywhere' );

		const activate = ( event ) => {
			event.preventDefault();
			event.stopPropagation();
			closeMenu( menu );
			run( style.id );
		};
		item.addEventListener( 'click', activate );
		item.addEventListener( 'keydown', ( event ) => {
			if ( event.key === 'Enter' || event.key === ' ' ) activate( event );
		} );

		deleteItem.after( item );
	};

	document.addEventListener(
		'contextmenu',
		( event ) => {
			const badge = event.target.closest?.( BADGE );
			target = badge ? { selector: badge.textContent.trim(), at: Date.now() } : null;
		},
		true
	);

	new MutationObserver( () => {
		// Only menus opened from a class badge within the last second.
		if ( ! target || Date.now() - target.at > 1000 ) return;
		const menu = document.querySelector( MENU );
		if ( menu ) addItem( menu );
	} ).observe( document.body, { childList: true, subtree: true } );
} )();
