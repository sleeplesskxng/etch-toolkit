/**
 * Etch Toolkit: "Delete Everywhere" in the CSS editor's class right-click menu.
 *
 * Etch's menus take no outside items, so this clones the menu's own "Delete"
 * row and inserts it underneath.
 *
 * It works like Etch's own delete, in the builder: the style goes, and the
 * class comes off the open page's elements, in one step Cmd+Z undoes. Once
 * Etch has saved, the server takes the class off everything else. It does
 * that again after each save while the style stays deleted, since Etch's
 * copies of pages opened earlier still have the class and save it back. If an
 * undo brings the style back, saving puts the class back where it came off.
 */
( () => {
	const { restUrl, api, save, afterSave, el, plural, editPageClasses, confirmDialog, onMenu, menuItem, findMenuItem } = window.etchToolkit || {};
	if ( ! restUrl || ! confirmDialog ) return;

	const BADGE = '.etch-css-selectors .etch-badges > *';
	const OUR_ITEM = 'etk-delete-everywhere';

	let running = false;

	// The selected block's style IDs.
	const selectedStyles = () => {
		try {
			const id = window.etch.blocks.getSelectedId();
			const styles = id ? window.etch.blocks.getJson( id ).styles : null;
			return Array.isArray( styles ) ? styles : [];
		} catch {
			return [];
		}
	};

	// Styles in different collections can share a selector. Then the one on the
	// selected block is the badge's, or failing that, the first.
	const findClassStyle = ( selector ) => {
		try {
			const styles = window.etch.styles.list( { type: 'class' } ).filter( ( s ) => s.selector === selector );
			const own = styles.length > 1 ? selectedStyles() : [];
			return styles.find( ( s ) => own.includes( s.id ) ) ?? styles[ 0 ];
		} catch {
			return undefined;
		}
	};

	const usageMessage = ( usage ) => {
		const code = ( text ) => el( 'code', { textContent: text } );
		const nodes = [];

		if ( usage.elements ) {
			const count = plural( usage.elements, 'element' );
			nodes.push(
				usage.shared
					? el( 'p', {}, [ "You're about to delete this ", code( usage.selector ), ` style, used by ${ count }.` ] )
					: el( 'p', {}, [ "You're about to remove ", code( usage.selector ), ` from ${ count } and delete the style.` ] ),
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

		if ( usage.shared ) {
			nodes.push( el( 'p', {}, [ "There's another ", code( usage.selector ), ' style, so elements keep the class and use that one.' ] ) );
		} else if ( usage.dynamic ) {
			const one = usage.dynamic === 1;
			nodes.push(
				el( 'p', {}, [
					`${ usage.dynamic } ${ one ? 'element has a dynamic class' : 'elements have dynamic classes' } that could still become `,
					code( usage.selector ),
					one ? ". It's left as it is." : ". They're left as they are.",
				] )
			);
		}

		if ( usage.defaults ) {
			const components = plural( usage.defaults, 'component' );
			nodes.push(
				el( 'p', {
					textContent: usage.shared
						? `It's also the default class in ${ components }, which will use the other style instead.`
						: `It's also the default class in ${ components }. That goes too.`,
				} )
			);
		}

		nodes.push( el( 'p', { textContent: 'It’s deleted here now, and across the site when you save.' } ) );
		return nodes;
	};

	// Deleted styles, by ID: { name, stripped }, whether the server has taken the class off.
	const deleted = new Map();
	afterSave( async () => {
		const styles = new Set( window.etch.styles.list().map( ( s ) => s.id ) );
		for ( const [ id, entry ] of deleted ) {
			const back = styles.has( id );
			if ( back && ! entry.stripped ) continue;
			try {
				await api( `styles/${ id }/${ back ? 'unstrip' : 'strip' }`, 'POST', back ? undefined : { class: entry.name } );
				entry.stripped = ! back;
			} catch ( err ) {
				throw new Error( `Delete Everywhere didn’t finish for .${ entry.name }. ${ err.message }` );
			}
		}
	} );

	// The class off the open page's elements, as the server takes it off the rest.
	const stripOpenPage = ( name ) => editPageClasses( ( names ) => names.filter( ( n ) => n !== name ) );

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

			// Both at once, so Etch's undo takes them as one step.
			window.etch.styles.delete( styleId );
			if ( ! usage.shared ) stripOpenPage( usage.class );
			deleted.set( styleId, { name: usage.class, stripped: false } );
			dialog.close();
		} catch ( err ) {
			if ( dialog ) dialog.fail( err.message );
			else window.alert( `Delete Everywhere failed: ${ err.message }` );
		} finally {
			running = false;
		}
	};

	// Under the class badge menu's Delete.
	onMenu( BADGE, OUR_ITEM, ( menu, badge ) => {
		const deleteItem = findMenuItem( menu, 'Delete' );
		const style = findClassStyle( badge.textContent.trim() );
		if ( ! deleteItem || ! style ) return;
		deleteItem.after( menuItem( menu, 'Delete Everywhere', () => run( style.id ), { className: OUR_ITEM, like: deleteItem } ) );
	} );
} )();
