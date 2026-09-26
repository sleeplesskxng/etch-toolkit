/**
 * Etch Toolkit: multi-select in the Style Manager.
 *
 * - A checkbox on each row (visible on hover, focus, or once anything is selected).
 * - Cmd/Ctrl-click a row to toggle it, Shift-click to select a range.
 * - A floating action bar, a copy of the Asset Manager's bulk bar: Clear,
 *   count, Select all, Rename, Delete.
 *
 * Rename takes over the Style Manager below its tabs and lists each class name
 * in the selection with its new name, grouped by BEM block. A bulk action (add
 * prefix, add suffix, find and replace) fills them in, a block's classes follow
 * its new name, and any can be edited by hand. The server previews and applies the old => new map,
 * renaming each changed class everywhere: every style's selector and CSS,
 * global stylesheets, and element class attributes across the site. The
 * builder then catches up the way Etch's own rename does, without a reload,
 * unless the rename reaches something Etch holds that this can't update.
 *
 * Selection is kept here by style ID, because Etch's list is virtual and only
 * renders the rows in view. Range selection rebuilds the list's full order the
 * same way Etch does (skip :root and element styles, then filter by search
 * text, or by the active tab when the search is empty).
 *
 * Style usage's Unused tab shows its own list over Etch's. Its rows get
 * checkboxes too, and Select All and ranges follow what it lists.
 */
( () => {
	const { api, save, afterSave, syncStyles, el, confirmDialog, reload, classesIn, isClassSelector } = window.etchToolkit || {};
	if ( ! confirmDialog ) return;

	const ROOT = '.style-overview-modal__left';
	const SEARCH = '.searchbar input';
	const ACTIVE_TAB = '.css-input-tabs__trigger[data-state="active"]';
	const LIST = '.virtual-list';
	const ROW = '.list-item';
	const UNUSED = '.etk-unused'; // Style usage's Unused tab.
	const ROWS = `${ LIST } ${ ROW }, ${ UNUSED } li`;
	const ROW_BUTTON = `${ ROW } > .main-button, ${ UNUSED }__button`;
	const CHECK = 'etk-select';
	const SCREEN = '#full-screen'; // Etch's full-screen view, where the bar floats.

	// Etch's hugeicons, as bundled in the builder.
	const ICONS = {
		clear: '<path d="M5 5L19 19"/><path d="M19 5L5 19"/>',
		rename:
			'<path d="M14 7L5.39171 15.6083C5.1354 15.8646 4.95356 16.1858 4.86564 16.5374L4 20L7.46257 19.1344C7.81424 19.0464 8.1354 18.8646 8.39171 18.6083L17 10M14 7L16.2929 4.70711C16.6834 4.31658 17.3166 4.31658 17.7071 4.70711L19.2929 6.29289C19.6834 6.68342 19.6834 7.31658 19.2929 7.70711L17 10M14 7L17 10"/><path d="M11.5 20H17.5"/>',
		delete:
			'<path d="M19.5 5.5L18.6139 20.121C18.5499 21.1766 17.6751 22 16.6175 22H7.38246C6.32488 22 5.4501 21.1766 5.38612 20.121L4.5 5.5"/><path d="M3 5.5H8M21 5.5H16M16 5.5L14.7597 2.60608C14.6022 2.2384 14.2406 2 13.8406 2H10.1594C9.75937 2 9.39783 2.2384 9.24025 2.60608L8 5.5M16 5.5H8"/><path d="M9.5 16.5L9.5 10.5"/><path d="M14.5 16.5L14.5 10.5"/>',
	};

	const selected = new Set(); // style IDs

	// Pages opened in the builder this session. Etch keeps each one and saves it again
	// with every save. It notes the switch in the URL, with history.replaceState().
	const opened = new Set();
	const noteOpened = () => {
		try {
			const id = window.etch.navigation.getActivePostId();
			if ( id ) opened.add( id );
			return !! id;
		} catch {
			return false;
		}
	};
	const replaceState = history.replaceState;
	history.replaceState = function ( ...args ) {
		const result = replaceState.apply( this, args );
		noteOpened();
		return result;
	};
	const firstPage = setInterval( () => noteOpened() && clearInterval( firstPage ), 250 );
	let anchor = null; // style ID the next Shift-click ranges from
	let frame = 0;

	const allStyles = () => {
		try {
			return window.etch.styles.list();
		} catch {
			return [];
		}
	};

	// Styles the Style Manager lists at all, in its order.
	const listable = ( styles ) => styles.filter( ( s ) => s.selector !== ':root' && s.type !== 'element' );

	// Find the selector list root. The collections view has no search bar, so it's skipped.
	const getRoot = () => {
		const root = document.querySelector( ROOT );
		return root?.querySelector( SEARCH ) ? root : null;
	};

	// The list's full order as Etch computes it, including rows scrolled out of view.
	// With the Unused tab on, what it lists instead.
	const visibleOrder = ( root ) => {
		const unused = root.querySelector( UNUSED );
		if ( unused ) {
			const shown = new Set( [ ...unused.querySelectorAll( `${ UNUSED }__button` ) ].map( ( b ) => b.textContent ) );
			return listable( allStyles() )
				.filter( ( s ) => shown.has( s.selector.trim() ) )
				.map( ( s ) => s.id );
		}
		const search = root.querySelector( SEARCH )?.value.toLowerCase() ?? '';
		const tab = root.querySelector( ACTIVE_TAB )?.textContent.trim().toLowerCase() || 'all';
		return listable( allStyles() )
			.filter( ( s ) => ( search ? s.selector.toLowerCase().includes( search ) : tab === 'all' || s.type === tab ) )
			.map( ( s ) => s.id );
	};

	const rowSelector = ( row ) => row.querySelector( `.main-button > span:not(.etk-usage), ${ UNUSED }__button` )?.textContent.trim() ?? '';

	// Selector => first style ID with it (the Style Manager lists all collections together).
	const idsBySelector = () => {
		const map = new Map();
		for ( const s of listable( allStyles() ) ) if ( ! map.has( s.selector.trim() ) ) map.set( s.selector.trim(), s.id );
		return map;
	};

	const toggle = ( id ) => {
		if ( selected.has( id ) ) selected.delete( id );
		else selected.add( id );
		anchor = id;
		schedule();
	};

	const selectRange = ( root, id ) => {
		const order = visibleOrder( root );
		const from = order.indexOf( anchor );
		const to = order.indexOf( id );
		if ( from === -1 || to === -1 ) return toggle( id );

		const [ start, end ] = from < to ? [ from, to ] : [ to, from ];
		order.slice( start, end + 1 ).forEach( ( rangeId ) => selected.add( rangeId ) );
		schedule();
	};

	const clear = () => {
		selected.clear();
		anchor = null;
		schedule();
	};

	/* ---- Bulk actions ---- */

	// Where Etch shows other posts around the open page, from copies it doesn't reload.
	const SHOWN_AROUND = new Set( [ 'wp_template', 'wp_template_part', 'wp_block' ] );

	/**
	 * After the server renamed, bring the builder up to date the way Etch's own
	 * rename works: update the styles, and Etch renames the class on every element
	 * linked to them, on every page it has open, then save. A renamed class on an
	 * element that isn't linked to its style, like a BEM child with no style, is
	 * renamed here on the open page. Anywhere else Etch holds, like a page opened
	 * earlier, a template or a component, it can't be reached, so this returns
	 * false before changing anything and the builder reloads instead.
	 */
	const renameInBuilder = async ( plan ) => {
		const active = window.etch.navigation.getActivePostId();
		if ( plan.unlinked.some( ( post ) => post.id !== active && ( opened.has( post.id ) || SHOWN_AROUND.has( post.type ) ) ) ) return false;

		// Linked classes follow their styles. The rest are renamed on the open page, in the same undo step.
		const map = plan.classMap;
		const walk = ( blocks ) => {
			for ( const block of blocks ) {
				const value = block.attributes?.class;
				const names = typeof value === 'string' ? value.trim().split( /\s+(?![^{]*})/ ) : [];
				if ( names.some( ( name ) => Object.hasOwn( map, name ) ) ) {
					window.etch.blocks.update( block.id, { attributes: { class: names.map( ( name ) => ( Object.hasOwn( map, name ) ? map[ name ] : name ) ).join( ' ' ) } } );
				}
				walk( block.children || [] );
			}
		};
		await syncStyles( () => walk( window.etch.blocks.getTree() ) );

		await save();
		return true;
	};

	/*
	 * Renames made this session. Etch can undo one in the builder, like its own
	 * rename, and saves that for the pages it has open. Once it has, the rest of
	 * the site follows: when a rename's styles are back to their old selectors,
	 * the old names go back on every other page, and forward again after a redo.
	 * A name that merged with one already on the site stays, since those
	 * elements can't be told apart.
	 */
	const renames = [];
	let following = Promise.resolve();
	afterSave( () =>
		( following = following.then( async () => {
			const selectors = new Map( window.etch.styles.list().map( ( s ) => [ s.id, s.selector ] ) );
			for ( const rename of renames ) {
				const at = ( side ) => rename.styles.every( ( s ) => selectors.get( s.id ) === s[ side ] );
				const undone = at( 'from' ) ? true : at( 'to' ) ? false : rename.undone;
				if ( undone === rename.undone ) continue;

				const pairs = Object.entries( rename.map );
				const map = Object.fromEntries( undone ? pairs.filter( ( [ , to ] ) => ! rename.merged.includes( to ) ).map( ( [ from, to ] ) => [ to, from ] ) : pairs );
				try {
					await api( 'styles/rename/content', 'POST', { map, skip: [ ...opened ] } );
					rename.undone = undone;
				} catch ( err ) {
					const notice = confirmDialog( { title: '', message: [], confirmLabel: '', failTitle: 'Other pages weren’t updated' } );
					notice.fail( `The rename wasn’t ${ undone ? 'undone' : 'redone' } on pages that aren’t open. ${ err.message } Save again to try again.` );
				}
			}
		} ) )
	);
	const remember = ( plan ) => {
		const styles = plan.styles.filter( ( s ) => s.from !== s.to ).map( ( { id, from, to } ) => ( { id, from, to } ) );
		if ( styles.length ) renames.push( { map: plan.classMap, merged: plan.merged, styles, undone: false } );
	};

	const bulkDelete = async () => {
		// In the Style Manager's order, not the order they were clicked.
		const styles = allStyles().filter( ( s ) => selected.has( s.id ) );
		if ( ! styles.length ) return;

		const noun = styles.length === 1 ? 'style' : 'styles';
		const dialog = confirmDialog( {
			title: `Deleting ${ styles.length } ${ noun }`,
			confirmLabel: 'Yes, delete',
			failTitle: 'Delete failed',
			message: [
				el( 'p', { textContent: `You're about to delete these ${ noun }:` } ),
				el(
					'ul',
					{ className: 'etk-confirm__list' },
					styles.map( ( s ) => el( 'li', {}, [ el( 'code', { textContent: s.selector } ) ] ) )
				),
				el( 'p', { textContent: 'Elements that use them keep their class names, the same as deleting one row at a time.' } ),
			],
		} );
		if ( ! ( await dialog.result ) ) return;

		const failed = [];
		for ( const style of styles ) {
			try {
				window.etch.styles.delete( style.id );
				selected.delete( style.id );
			} catch ( err ) {
				failed.push( `${ style.selector }: ${ err.message }` );
			}
		}

		if ( failed.length ) {
			dialog.fail( `Some styles couldn't be deleted. ${ failed.join( ' ' ) }` );
		} else {
			dialog.close();
			clear();
		}
	};

	const plural = ( n, word ) => `${ n } ${ word }${ n === 1 ? '' : 's' }`;

	const classes = ( n ) => `${ n } class${ n === 1 ? '' : 'es' }`;
	// Etch only reads a selector as a class when the name starts with a letter.
	const CLASS_NAME = /^[a-zA-Z][\w-]*$/;
	const CHEVRON =
		'<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

	// What the rename touches, e.g. "Updates 5 styles, 38 elements on 12 pages."
	const renameSummary = ( plan ) => {
		const parts = [ plural( plan.styles.length, 'style' ) ];
		if ( plan.elements ) parts.push( `${ plural( plan.elements, 'element' ) } on ${ plural( plan.posts.length, 'page' ) }` );
		if ( plan.stylesheets.length ) parts.push( plural( plan.stylesheets.length, 'global stylesheet' ) );
		return `Updates ${ parts.join( ', ' ) }.`;
	};

	/*
	 * Rename takes over the Style Manager below its tabs, like the Recipes tab does.
	 * Classes are grouped by BEM block: a block's elements and modifiers sit under it,
	 * folded away, and follow its new name. A block opens by itself when something in
	 * it needs fixing. Ticked rows are renamed. A run of them reads as one card, and an
	 * open block is a card of its own.
	 */
	const BODY_OF = '.style-overview-modal__inner'; // Its parent holds the tabs and every tab's view.
	let renaming = null; // The open rename view: { panel, close }.

	// The block a class belongs to: .card for .card__title and .card--wide.
	const blockOf = ( name ) => name.replace( /(__|--).*$/, '' );

	// A new name split around what changed from the old one: [same, changed, same].
	const changed = ( from, to ) => {
		let start = 0;
		while ( start < from.length && start < to.length && from[ start ] === to[ start ] ) start++;
		let end = 0;
		while ( end < from.length - start && end < to.length - start && from[ from.length - 1 - end ] === to[ to.length - 1 - end ] ) end++;
		return [ to.slice( 0, start ), to.slice( start, to.length - end ), to.slice( to.length - end ) ];
	};

	const bulkRename = () => {
		const body = document.querySelector( BODY_OF )?.parentElement;
		const styles = allStyles().filter( ( s ) => selected.has( s.id ) );
		const ids = styles.map( ( s ) => s.id );
		const names = [ ...new Set( styles.flatMap( ( s ) => classesIn( s.selector ) ) ) ];
		if ( renaming || ! body || ! names.length ) return;

		/* ---- Rows ---- */

		let count = 0;
		const makeRow = ( name, parent = null ) => {
			const id = `etk-rn-${ ++count }`;
			const check = el( 'input', { type: 'checkbox', className: 'etk-rn__checkbox', checked: true } );
			check.setAttribute( 'aria-label', `Rename .${ name }` );
			const input = el( 'input', { id, type: 'text', className: 'etk-rn__input', value: name, spellcheck: false, autocomplete: 'off' } );
			input.setAttribute( 'aria-label', `New name for .${ name }` );
			const mirror = el( 'span', { className: 'etk-rn__mirror', ariaHidden: 'true' } );
			const toggle = el( 'button', { type: 'button', className: 'etk-rn__toggle', innerHTML: CHEVRON, hidden: true } );
			const pill = el( 'span', { className: 'etk-rn__pill', hidden: true } );
			const message = el( 'span', { className: 'etk-rn__message', id: `${ id }-message`, hidden: true } );
			const reset = el( 'button', { type: 'button', className: 'etk-rn__reset', textContent: 'Reset', hidden: true } );
			reset.setAttribute( 'aria-label', `Reset the new name for .${ name }` );
			const li = el( 'li', { className: `etk-rn__row${ parent ? ' etk-rn__row--child' : '' }` }, [
				el( 'span', { className: 'etk-rn__check' }, [ check ] ),
				el( 'span', { className: 'etk-rn__fold' }, [ toggle ] ),
				el( 'span', { className: 'etk-rn__old', textContent: parent ? name.slice( parent.name.length ) : `.${ name }`, title: `.${ name }` } ),
				el( 'span', { className: 'etk-rn__new' }, [
					el( 'span', { className: 'etk-rn__field' }, [ input, mirror ] ),
					el( 'span', { className: 'etk-rn__kept', textContent: 'Keeps its name' } ),
				] ),
				el( 'span', { className: 'etk-rn__count' } ),
				el( 'span', { className: 'etk-rn__status' }, [ pill, message, reset ] ),
			] );
			return { name, parent, children: [], selectors: [], check, input, mirror, toggle, pill, message, reset, li, edited: false, open: false, error: '', hadErrors: false };
		};

		// A class whose block is in the selection goes under it. Everything else is a row of its own.
		const blocks = new Map();
		for ( const name of names ) if ( blockOf( name ) === name || ! names.includes( blockOf( name ) ) ) blocks.set( name, makeRow( name ) );
		for ( const name of names ) if ( ! blocks.has( name ) ) blocks.get( blockOf( name ) ).children.push( makeRow( name, blocks.get( blockOf( name ) ) ) );
		const top = [ ...blocks.values() ];
		const rows = top.flatMap( ( row ) => [ row, ...row.children ] );
		const grouped = top.some( ( row ) => row.children.length );
		const byName = new Map( rows.map( ( row ) => [ row.name, row ] ) );

		// Every style beyond a plain class that uses one of these classes, like .card:hover
		// or .card__title::before, sits under the first of them. The rename updates it too,
		// selected or not. It can't be edited: it follows the new names.
		const makeSelector = ( selector, owner ) => {
			const block = owner.parent ?? owner;
			const dot = `.${ block.name }`;
			const text = el( 'span', { className: 'etk-rn__static' } );
			const li = el( 'li', { className: 'etk-rn__row etk-rn__row--child etk-rn__row--selector' }, [
				el( 'span' ),
				el( 'span' ),
				el( 'span', { className: 'etk-rn__old', textContent: selector.startsWith( dot ) ? selector.slice( dot.length ) : selector, title: selector } ),
				el( 'span', { className: 'etk-rn__new' }, [ text ] ),
				el( 'span' ),
				el( 'span' ),
			] );
			return { selector, parent: block, text, li, open: false };
		};
		const listed = new Set();
		for ( const style of listable( allStyles() ) ) {
			const selector = style.selector.trim();
			if ( isClassSelector( selector ) || listed.has( selector ) ) continue;
			const owner = classesIn( selector ).map( ( name ) => byName.get( name ) ).find( Boolean );
			if ( ! owner ) continue;
			listed.add( selector );
			owner.selectors.push( makeSelector( selector, owner ) );
		}
		// A block with what's in it, in order: each class followed by its selectors. BEM
		// classes you didn't select, with the switch on, go in among its classes by name.
		const contents = ( row ) => {
			const items = [ ...row.children ];
			for ( const other of row.others ) {
				const at = items.findIndex( ( item ) => item.name > other.name );
				items.splice( at < 0 ? items.length : at, 0, other );
			}
			return [ ...row.selectors, ...items.flatMap( ( item ) => [ item, ...item.selectors ] ) ];
		};
		for ( const row of top ) row.others = [];

		/* ---- Bulk action ---- */

		const MODES = { replace: 'Find and replace', prefix: 'Add prefix', suffix: 'Add suffix' };
		const modeSelect = el(
			'select',
			{ className: 'etk-rn__mode' },
			Object.entries( MODES ).map( ( [ value, label ] ) => el( 'option', { value, textContent: label } ) )
		);
		modeSelect.setAttribute( 'aria-label', 'Rename by' );
		const textInput = ( label ) => {
			const input = el( 'input', { type: 'text', className: 'etk-rn__action-input', spellcheck: false, autocomplete: 'off', placeholder: label } );
			input.setAttribute( 'aria-label', label );
			return input;
		};
		const affix = textInput( 'Prefix' );
		const find = textInput( 'Find' );
		const replace = textInput( 'Replace with' );
		const hint = el( 'p', { className: 'etk-rn__hint' } );
		const mode = () => modeSelect.value;

		const base = ( name ) => {
			const value = affix.value.trim();
			if ( mode() === 'prefix' ) return value + name;
			if ( mode() === 'suffix' ) return name + value;
			const f = find.value.trim();
			return f ? name.split( f ).join( replace.value.trim() ) : name;
		};
		// A class in a ticked block follows the block's new name.
		const follows = ( row ) => row.parent && row.parent.check.checked;
		const auto = ( row ) => ( follows( row ) ? row.parent.input.value.trim() + row.name.slice( row.parent.name.length ) : base( row.name ) );
		const fill = () => {
			for ( const row of rows ) if ( ! row.edited ) row.input.value = auto( row );
		};

		const setHint = () => {
			const m = mode();
			affix.hidden = m === 'replace';
			find.hidden = replace.hidden = m !== 'replace';
			affix.placeholder = m === 'suffix' ? 'Suffix' : 'Prefix';
			affix.setAttribute( 'aria-label', affix.placeholder );
			const where = m === 'replace' ? 'in' : 'to';
			hint.textContent = grouped ? `${ where } every block. Classes inside follow along.` : `${ where } every class.`;
		};

		/* ---- The view ---- */

		const allBox = el( 'input', { type: 'checkbox', className: 'etk-rn__checkbox' } );
		allBox.setAttribute( 'aria-label', 'Rename all' );
		const list = el( 'ul', { className: 'etk-rn__rows' } );
		list.setAttribute( 'aria-label', 'Classes to rename' );

		const title = el( 'h2', { className: 'etk-rn__title', id: 'etk-rn-title' } );
		const problem = el( 'button', { type: 'button', className: 'etk-rn__problem', hidden: true } );
		const note = el( 'p', { className: 'etk-rn__note', hidden: true } );
		const status = el( 'div', { className: 'etk-rn__state' }, [ problem, note ] );
		status.setAttribute( 'aria-live', 'polite' );
		const cancel = el( 'button', { type: 'button', className: 'etk-confirm__btn etk-confirm__btn--cancel', textContent: 'Cancel' } );
		const confirm = el( 'button', { type: 'button', className: 'etk-confirm__btn etk-confirm__btn--primary', textContent: 'Rename', disabled: true } );

		// What the rename touches, at the top right of the table.
		const summary = el( 'p', { className: 'etk-rn__summary' } );
		summary.setAttribute( 'aria-live', 'polite' );
		// What else changes, in a toolbar at the bottom like the Style Manager's bulk bar.
		const warnList = el( 'ul', { className: 'etk-rn__warnings', id: 'etk-rn-warnings', hidden: true } );
		const warnButton = el( 'button', { type: 'button', className: 'etk-rn__warn', hidden: true } );
		warnButton.setAttribute( 'aria-expanded', 'false' );
		warnButton.setAttribute( 'aria-controls', warnList.id );
		const showWarnings = ( show ) => {
			warnList.hidden = ! show;
			warnButton.setAttribute( 'aria-expanded', String( show ) );
		};
		warnButton.addEventListener( 'click', () => showWarnings( warnList.hidden ) );
		const bemBox = el( 'input', { type: 'checkbox', className: 'etk-rn__switch', id: 'etk-rn-bem' } );
		bemBox.setAttribute( 'role', 'switch' );
		const bemText = el( 'label', { className: 'etk-rn__switch-label', htmlFor: bemBox.id } );
		const bemOption = el( 'div', { className: 'etk-rn__option', hidden: true }, [ bemText, bemBox ] );
		const toolbar = el( 'div', { className: 'etk-bulk-bar etk-rn__toolbar', hidden: true }, [
			warnButton,
			el( 'div', { className: 'etk-bulk-bar__divider' } ),
			bemOption,
			warnList,
		] );
		toolbar.setAttribute( 'role', 'group' );
		toolbar.setAttribute( 'aria-label', 'What else changes' );

		// Classes and selectors the rename reaches beyond the list, in sections at its end.
		let extras = [];
		// A BEM class you didn't select sits in its block like the classes you did, with a
		// field but no checkbox: the switch decides. Kept across previews, so what you
		// type and where you are survive each one.
		const bemRows = new Map();
		let bemActive = []; // The ones showing now.
		let openBem = false; // Open their blocks once they first show.
		const bemRow = ( name, parent ) => {
			if ( bemRows.has( name ) ) return bemRows.get( name );
			const id = `etk-rn-${ ++count }`;
			const input = el( 'input', { id, type: 'text', className: 'etk-rn__input', spellcheck: false, autocomplete: 'off' } );
			input.setAttribute( 'aria-label', `New name for .${ name }` );
			const mirror = el( 'span', { className: 'etk-rn__mirror', ariaHidden: 'true' } );
			const pill = el( 'span', { className: 'etk-rn__pill', hidden: true } );
			const message = el( 'span', { className: 'etk-rn__message', id: `${ id }-message`, hidden: true } );
			const reset = el( 'button', { type: 'button', className: 'etk-rn__reset', textContent: 'Reset', hidden: true } );
			reset.setAttribute( 'aria-label', `Reset the new name for .${ name }` );
			const li = el( 'li', { className: 'etk-rn__row etk-rn__row--child etk-rn__row--bem' }, [
				el( 'span' ),
				el( 'span' ),
				el( 'span', { className: 'etk-rn__old', textContent: name.slice( parent.name.length ), title: `.${ name }` } ),
				el( 'span', { className: 'etk-rn__new' }, [ el( 'span', { className: 'etk-rn__field' }, [ input, mirror ] ) ] ),
				el( 'span' ),
				el( 'span', { className: 'etk-rn__status' }, [ pill, message, reset ] ),
			] );
			const row = { name, parent, bem: true, selectors: [], input, mirror, pill, message, reset, li, auto: '', note: '', edited: false, error: '' };
			input.addEventListener( 'input', () => {
				row.edited = input.value !== row.auto;
				refresh();
			} );
			reset.addEventListener( 'click', () => {
				row.edited = false;
				input.value = row.auto;
				input.focus();
				refresh();
			} );
			bemRows.set( name, row );
			return row;
		};
		const extraRow = ( section, from, to, note ) => {
			const text = el(
				'span',
				{ className: 'etk-rn__static' },
				changed( from.replace( /^\./, '' ), to ).map( ( part, i ) => ( i === 1 ? el( 'span', { className: 'etk-rn__added', textContent: part } ) : part ) )
			);
			const status = el( 'span', { className: 'etk-rn__status' }, note ? [ el( 'span', { className: 'etk-rn__pill', textContent: note } ) ] : [] );
			const li = el( 'li', { className: 'etk-rn__row etk-rn__row--extra' }, [
				el( 'span' ),
				el( 'span' ),
				el( 'span', { className: 'etk-rn__old', textContent: from, title: from } ),
				el( 'span', { className: 'etk-rn__new' }, [ text ] ),
				el( 'span' ),
				status,
			] );
			return { li, extra: section };
		};
		// Before a preview, the BEM classes of the ticked blocks keep their names for now.
		const parentOf = ( name ) =>
			names.filter( ( n ) => name.startsWith( `${ n }__` ) || name.startsWith( `${ n }--` ) ).sort( ( a, b ) => b.length - a.length )[ 0 ];
		const bemNow = () => bemFound.filter( ( b ) => byName.get( parentOf( b.from ) )?.check.checked ).map( ( b ) => ( { ...b, to: b.from } ) );
		const buildExtras = () => {
			extras = [];
			bemActive = [];
			for ( const row of top ) row.others = [];
			const label = ( text ) => extras.push( { li: el( 'li', { className: 'etk-rn__section', textContent: text } ), label: true } );
			const bem = plan ? plan.bem : bemNow();
			const add = ( text, section, items ) => {
				if ( ! items.length ) return;
				label( text );
				extras.push( ...items.map( ( [ from, to, note ] ) => extraRow( section, from, to, note ) ) );
			};
			if ( bemBox.checked ) {
				for ( const b of bem ) {
					const direct = byName.get( parentOf( b.from ) );
					if ( ! direct ) continue;
					const row = bemRow( b.from, direct.parent ?? direct );
					row.auto = b.to;
					row.note = b.styled ? '' : 'Class only';
					if ( ! row.edited ) row.input.value = b.to;
					row.error = row.error || ( plan?.rowErrors[ b.from ] ?? '' ).replace( /\.$/, '' );
					row.parent.others.push( row );
					bemActive.push( row );
				}
				if ( openBem && bemActive.length ) {
					for ( const row of bemActive ) row.parent.open = true;
					openBem = false;
				}
			}
			if ( ! plan ) return;
			add( 'From nested rules like &__title', 'nested', plan.nested.map( ( x ) => [ `.${ x.from }`, x.to ] ) );
			// Selectors under their classes are in the list already.
			const others = plan.styles.filter( ( x ) => ! isClassSelector( x.from ) && x.from !== x.to && ! listed.has( x.from.trim() ) );
			add( 'Other selectors that use these classes', 'other', others.map( ( x ) => [ x.from, x.to.replace( /^\./, '' ) ] ) );
		};

		// Between previews: only what the list itself shows.
		// The BEM classes you didn't select, before there's a preview to say.
		let bemFound = [];
		const bemLabel = ( n ) => {
			bemText.textContent = `Include ${ n } related BEM ${ n === 1 ? 'class' : 'classes' }`;
			bemOption.hidden = ! n;
		};
		const clearToolbar = ( text ) => {
			summary.textContent = text;
			warnButton.hidden = true;
			bemLabel( bemNow().length );
			toolbar.hidden = bemOption.hidden;
			showWarnings( false );
			buildExtras();
		};
		const renderToolbar = () => {
			summary.textContent = plan.styles.length ? renameSummary( plan ) : 'Nothing to rename.';
			warnButton.hidden = ! plan.warnings.length;
			warnButton.textContent = plural( plan.warnings.length, 'warning' );
			warnList.replaceChildren( ...plan.warnings.map( ( w ) => el( 'li', { textContent: w } ) ) );
			if ( ! plan.warnings.length ) showWarnings( false );
			bemLabel( plan.bem.length );
			toolbar.hidden = warnButton.hidden && bemOption.hidden;
			buildExtras();
		};

		const head = el( 'div', { className: 'etk-rn__head' }, [
			el( 'div', { className: 'etk-rn__heading' }, [
				title,
				el( 'p', { className: 'etk-rn__sub', textContent: "Renaming updates every page that uses these classes and saves right away. It can't be undone." } ),
			] ),
			el( 'div', { className: 'etk-rn__actions' }, [ status, cancel, confirm ] ),
		] );
		const header = el( 'div', { className: 'etk-rn__thead' }, [
			el( 'span', { className: 'etk-rn__check' }, [ allBox ] ),
			el( 'span' ),
			el( 'span', { className: 'etk-rn__th', textContent: 'Class' } ),
			el( 'span', { className: 'etk-rn__th etk-rn__th--new', textContent: 'New name' } ),
			el( 'span', { className: 'etk-rn__th', textContent: 'Child selectors' } ),
			el( 'span', { className: 'etk-rn__th', textContent: 'Status' } ),
		] );
		header.setAttribute( 'aria-hidden', 'true' );
		const panel = el( 'section', { className: 'etk-rn' }, [
			head,
			el( 'div', { className: 'etk-rn__body' }, [
				el( 'div', { className: 'etk-rn__bar' }, [ modeSelect, affix, find, replace, hint, summary ] ),
				el( 'div', { className: 'etk-rn__table' }, [ header, list ] ),
			] ),
			toolbar,
		] );
		panel.setAttribute( 'aria-labelledby', title.id );

		/* ---- Render ---- */

		let plan = null;
		let busy = false;
		let ready = false;

		const rowErrors = () => rows.filter( ( r ) => r.check.checked && r.error );
		const errored = () => [ ...rowErrors(), ...bemActive.filter( ( r ) => r.error ) ];

		// A new name with what changed picked out, and the first `quiet` characters, the
		// part that comes from its block, quieter than the rest.
		const highlight = ( old, value, quiet = 0 ) => {
			const parts = [];
			let at = 0;
			changed( old, value ).forEach( ( text, i ) => {
				if ( i === 1 ) parts.push( [ 'added', text ] );
				else if ( at < quiet ) parts.push( [ 'inherited', text.slice( 0, quiet - at ) ], [ '', text.slice( quiet - at ) ] );
				else parts.push( [ '', text ] );
				at += text.length;
			} );
			return parts.filter( ( [ , text ] ) => text ).map( ( [ kind, text ] ) => ( kind ? el( 'span', { className: `etk-rn__${ kind }`, textContent: text } ) : text ) );
		};

		// The new name as text over its field. A class that follows its block shows the
		// block's part quieter than its own.
		const paint = ( row ) => {
			const value = row.input.value;
			const from = follows( row ) && ! row.edited ? row.parent.input.value.trim() : '';
			row.mirror.replaceChildren( ...highlight( row.name, value, from && value.startsWith( from ) ? from.length : 0 ) );
		};

		// A selector as it will read, with each class in it under its new name.
		const current = ( name ) => {
			const row = byName.get( name );
			return row?.check.checked && ! row.error ? row.input.value.trim() || name : name;
		};
		const paintSelector = ( item ) => {
			const value = item.selector.replace( /\.([a-zA-Z_][\w-]*)/g, ( match, name ) => `.${ current( name ) }` ).replace( /^\./, '' );
			const old = item.selector.replace( /^\./, '' );
			const head = current( item.parent.name );
			item.text.replaceChildren( ...( value === old ? [ el( 'span', { className: 'etk-rn__inherited', textContent: value } ) ] : highlight( old, value, value.startsWith( head ) ? head.length : 0 ) ) );
		};

		const setPill = ( row, text, tone ) => {
			row.pill.hidden = ! text;
			if ( row.pill.textContent !== text ) row.pill.textContent = text;
			row.pill.className = `etk-rn__pill${ tone ? ` etk-rn__pill--${ tone }` : '' }`;
		};

		const renderStatus = ( row ) => {
			const on = row.check.checked;
			const merged = on && plan?.merged?.includes( row.input.value.trim() );
			const kids = row.open ? [] : [ ...row.children.filter( ( c ) => c.check.checked ), ...( row.others ?? [] ) ];
			const bad = kids.filter( ( c ) => c.error ).length;
			const edits = kids.filter( ( c ) => c.edited ).length;

			row.message.hidden = ! ( on && row.error );
			if ( row.message.textContent !== row.error ) row.message.textContent = row.error;
			row.input.setAttribute( 'aria-invalid', String( !! ( on && row.error ) ) );
			if ( on && row.error ) row.input.setAttribute( 'aria-describedby', row.message.id );
			else row.input.removeAttribute( 'aria-describedby' );

			if ( on && row.error ) setPill( row, '' );
			else if ( bad ) setPill( row, `${ plural( bad, 'name' ) } to fix`, 'danger' );
			else if ( merged ) setPill( row, `Merges with .${ row.input.value.trim() }`, 'warning' );
			else if ( edits ) setPill( row, `${ edits } edited`, '' );
			else setPill( row, '' );
			row.reset.hidden = ! ( on && row.edited && ! row.error );
		};

		const renderBemStatus = ( row ) => {
			row.message.hidden = ! row.error;
			if ( row.message.textContent !== row.error ) row.message.textContent = row.error;
			row.input.setAttribute( 'aria-invalid', String( !! row.error ) );
			if ( row.error ) row.input.setAttribute( 'aria-describedby', row.message.id );
			else row.input.removeAttribute( 'aria-describedby' );
			setPill( row, row.error || row.edited ? '' : row.note );
			row.reset.hidden = ! ( row.edited && ! row.error );
		};

		const render = () => {
			// Its child selectors: classes like .card__title and selectors like .card:hover.
			for ( const row of top ) {
				const inside = contents( row ).length;
				if ( ! inside ) row.open = false;
				row.toggle.hidden = ! inside;
				row.li.querySelector( '.etk-rn__count' ).textContent = inside ? String( inside ) : '';
			}
			// An open block's classes sit under it.
			const visible = [ ...top.flatMap( ( row ) => ( row.open ? [ row, ...contents( row ) ] : [ row ] ) ), ...extras ];
			if ( visible.length !== list.children.length || visible.some( ( row, i ) => list.children[ i ] !== row.li ) ) {
				const focus = document.activeElement;
				list.replaceChildren( ...visible.map( ( row ) => row.li ) );
				if ( list.contains( focus ) && document.activeElement !== focus ) focus.focus();
			}

			// Cards: a run of ticked rows, or an open block with its classes.
			const card = ( row ) => ( row.label ? null : row.extra ? `extra-${ row.extra }` : row.open ? row : row.parent?.open ? row.parent : row.check?.checked ? 'run' : null );
			const cards = visible.map( card );
			visible.forEach( ( row, i ) => {
				const c = cards[ i ];
				const cls = row.li.classList;
				cls.toggle( 'etk-rn__row--card', !! c );
				cls.toggle( 'etk-rn__row--block', !! c && c !== 'run' );
				cls.toggle( 'etk-rn__row--top', !! c && cards[ i - 1 ] !== c );
				cls.toggle( 'etk-rn__row--bottom', !! c && cards[ i + 1 ] !== c );
				if ( row.bem ) {
					row.input.disabled = busy;
					paint( row );
					renderBemStatus( row );
					return;
				}
				if ( row.label || row.extra ) return;
				if ( row.selector ) return paintSelector( row );
				cls.toggle( 'etk-rn__row--off', ! row.check.checked );
				row.input.disabled = busy || ! row.check.checked;
				row.toggle.setAttribute( 'aria-expanded', String( row.open ) );
				if ( ! row.toggle.hidden ) row.toggle.setAttribute( 'aria-label', `${ row.open ? 'Hide' : 'Show' } what's in .${ row.name }` );
				paint( row );
				renderStatus( row );
			} );

			const on = rows.filter( ( r ) => r.check.checked ).length;
			allBox.checked = on === rows.length;
			allBox.indeterminate = on > 0 && on < rows.length;

			const total = plan ? Object.keys( plan.classMap ).length : on;
			title.textContent = `Rename ${ classes( total ) }`;

			const bad = errored().length;
			problem.hidden = ! bad;
			problem.textContent = `${ plural( bad, 'name' ) } need${ bad === 1 ? 's' : '' } fixing`;
			confirm.disabled = busy || ! ready;
		};

		/* ---- Preview ---- */

		let seq = 0;
		let timer = 0;
		let map = {};
		const keep = () => rows.filter( ( r ) => ! r.check.checked ).map( ( r ) => r.name );
		const setNote = ( text ) => {
			note.hidden = ! text;
			note.textContent = text;
		};

		// Open a block when something in it first needs fixing. After that it's yours to fold.
		const openProblems = () => {
			for ( const row of top ) {
				const has = row.children.some( ( c ) => c.check.checked && c.error ) || row.others.some( ( c ) => c.error );
				if ( has && ! row.hadErrors ) row.open = true;
				row.hadErrors = has;
			}
		};

		const refresh = () => {
			clearTimeout( timer );
			seq++; // A preview still on its way is out of date now.
			ready = false;
			plan = null;
			setNote( '' );

			map = {};
			for ( const row of rows ) {
				row.error = '';
				if ( ! row.check.checked ) continue;
				const value = row.input.value.trim();
				// An unchanged name is left as it is, even one with special characters like "md:flex".
				const ok = value === row.name || CLASS_NAME.test( value );
				row.error = ok ? '' : value ? 'Letters, numbers, - and _ only, starting with a letter' : 'Enter a class name';
				if ( ok && value !== row.name ) map[ row.name ] = value;
			}
			const n = Object.keys( map ).length;
			// A BEM class's own name, sent only when it's edited. An invalid one waits here.
			for ( const row of bemRows.values() ) {
				row.error = '';
				if ( ! bemBox.checked || ! row.edited ) continue;
				const value = row.input.value.trim();
				const ok = value === row.name || CLASS_NAME.test( value );
				row.error = ok ? '' : value ? 'Letters, numbers, - and _ only, starting with a letter' : 'Enter a class name';
				if ( ok ) map[ row.name ] = value;
			}

			if ( rowErrors().length || ! n ) {
				clearToolbar( rowErrors().length ? `${ plural( rowErrors().length, 'name' ) } to fix before it can rename.` : rows.every( ( r ) => ! r.check.checked ) ? 'Nothing left to rename.' : 'Add a prefix or edit a name to see what changes.' );
				openProblems();
				render();
				return;
			}
			render();

			const mine = ++seq;
			const request = map;
			timer = setTimeout( async () => {
				try {
					const next = await api( 'styles/rename/preview', 'POST', { ids, map: request, bem: bemBox.checked, keep: keep() } );
					if ( mine !== seq ) return; // A newer keystroke is in flight.
					plan = next;
					renderToolbar();
					for ( const row of rows ) if ( row.check.checked ) row.error = ( plan.rowErrors[ row.name ] ?? '' ).replace( /\.$/, '' );
					// Errors with no row to show on, like a clash from a BEM class you didn't select.
					const onRows = Object.keys( plan.rowErrors ).filter( ( name ) => rows.some( ( r ) => r.check.checked && r.name === name ) || bemActive.some( ( r ) => r.name === name ) ).length;
					if ( plan.errors.length && ! onRows ) setNote( plan.errors[ 0 ] );
					ready = plan.styles.length > 0 && ! plan.errors.length && ! errored().length;
					openProblems();
					render();
				} catch ( err ) {
					if ( mine === seq ) {
						setNote( err.message );
						render();
					}
				}
			}, 150 );
		};

		/* ---- Open, close, rename ---- */

		const close = () => {
			if ( ! renaming ) return;
			clearTimeout( timer );
			seq++;
			renaming = null;
			panel.remove();
			body.classList.remove( 'etk-renaming' );
			schedule();
			// Back to where it started, once the bar is showing again.
			requestAnimationFrame( () => document.querySelector( '.etk-bulk-bar__rename' )?.focus() );
		};

		const go = async () => {
			if ( ! ready || busy ) return;
			clearTimeout( timer );
			seq++;
			busy = true;
			panel.setAttribute( 'aria-busy', 'true' );
			for ( const control of panel.querySelectorAll( 'input, select, button' ) ) control.disabled = true;
			confirm.textContent = 'Renaming…';

			let result;
			try {
				await save();
				result = await api( 'styles/rename', 'POST', { ids, map, bem: bemBox.checked, keep: keep() } );
			} catch ( err ) {
				busy = false;
				panel.removeAttribute( 'aria-busy' );
				for ( const control of panel.querySelectorAll( 'input, select, button' ) ) control.disabled = false;
				confirm.textContent = 'Rename';
				refresh();
				setNote( `The rename didn't go through. ${ err.message }` );
				return;
			}
			// Renamed on the server by now, so if the builder can't catch up, it starts over.
			if ( ! ( await renameInBuilder( result ).catch( () => false ) ) ) {
				reload();
				return;
			}
			remember( result );
			close();
		};

		modeSelect.addEventListener( 'change', () => {
			setHint();
			fill();
			refresh();
			( mode() === 'replace' ? find : affix ).focus();
		} );
		for ( const input of [ affix, find, replace ] ) {
			input.addEventListener( 'input', () => {
				fill();
				refresh();
			} );
		}
		for ( const row of rows ) {
			row.input.addEventListener( 'input', () => {
				row.edited = row.input.value !== auto( row );
				// A block's classes follow as you type its name.
				for ( const child of row.children ) if ( ! child.edited ) child.input.value = auto( child );
				refresh();
			} );
			row.check.addEventListener( 'change', () => {
				fill();
				refresh();
			} );
			row.reset.addEventListener( 'click', () => {
				row.edited = false;
				row.input.value = auto( row );
				for ( const child of row.children ) if ( ! child.edited ) child.input.value = auto( child );
				row.input.focus();
				refresh();
			} );
			row.toggle.addEventListener( 'click', () => {
				row.open = ! row.open;
				render();
			} );
		}
		allBox.addEventListener( 'change', () => {
			for ( const row of rows ) row.check.checked = allBox.checked;
			fill();
			refresh();
		} );
		bemBox.addEventListener( 'change', () => {
			openBem = bemBox.checked;
			refresh();
		} );
		problem.addEventListener( 'click', () => {
			const row = errored()[ 0 ];
			if ( ! row ) return;
			if ( row.parent ) row.parent.open = true;
			render();
			row.li.scrollIntoView( { block: 'center' } );
			row.input.focus();
		} );
		cancel.addEventListener( 'click', () => busy || close() );
		confirm.addEventListener( 'click', go );
		panel.addEventListener( 'keydown', ( event ) => {
			// Keep keys away from Etch's shortcuts while typing here.
			event.stopPropagation();
			if ( event.key === 'Escape' && ! warnList.hidden ) {
				event.preventDefault();
				showWarnings( false );
				warnButton.focus();
			} else if ( event.key === 'Escape' && ! busy ) {
				event.preventDefault();
				close();
			} else if ( event.key === 'Enter' && event.target.matches( 'input[type="text"]' ) ) {
				event.preventDefault();
				go();
			}
		} );

		renaming = { panel, close };
		setHint();
		body.classList.add( 'etk-renaming' );
		body.append( panel );
		refresh();
		find.focus();
		schedule(); // Hides the bar.

		// Ask what renaming every selected class would reach, for the BEM switch.
		const probe = Object.fromEntries( names.map( ( name ) => [ name, `etk-probe-${ name }` ] ) );
		api( 'styles/rename/preview', 'POST', { ids, map: probe, bem: false, keep: [] } )
			.then( ( found ) => {
				bemFound = found.bem;
				if ( renaming?.panel === panel && ! plan && ! busy ) refresh();
			} )
			.catch( () => {} );
	};

	/* ---- Rendering ---- */

	const renderCheckbox = ( row, ids ) => {
		const selector = rowSelector( row );
		const id = ids.get( selector );
		let box = row.querySelector( `:scope > .${ CHECK }` );

		if ( ! id ) {
			box?.remove();
			return;
		}

		if ( ! box ) {
			box = el( 'input', { type: 'checkbox', className: CHECK } );
			box.addEventListener( 'click', ( event ) => {
				event.stopPropagation();
				const root = getRoot();
				const boxId = box.dataset.styleId;
				if ( event.shiftKey && anchor && root ) {
					event.preventDefault();
					selectRange( root, boxId );
				} else {
					toggle( boxId );
				}
			} );
			row.prepend( box );
		}

		// Rows are reused as the virtual list scrolls, so always resync.
		box.dataset.styleId = id;
		box.checked = selected.has( id );
		if ( box.getAttribute( 'aria-label' ) !== `Select ${ selector }` ) box.setAttribute( 'aria-label', `Select ${ selector }` );
		row.classList.toggle( 'etk-row--checked', box.checked );
	};

	const icon = ( name, size ) =>
		`<svg class="etch-icon" viewBox="0 0 24 24" width="${ size }" height="${ size }" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ ICONS[ name ] }</svg>`;

	// Markup of Etch's own button component, so its global .etch-builder-button styles apply.
	const etchButton = ( { variant, size = 'm', iconName, iconSize = 14, label, className = '', onClick } ) => {
		const b = el( 'button', {
			type: 'button',
			className: `etch-builder-button etch-builder-button--icon-placement-before etch-builder-button--variant-${ variant } ${ className }`,
		} );
		b.style.setProperty( '--button-font-size', `var(--e-font-size-${ size })` );
		b.innerHTML = `<div class="etk-bulk-bar__icon">${ icon( iconName, iconSize ) }</div>`;
		if ( label ) b.append( ' ', label );
		b.addEventListener( 'click', onClick );
		return b;
	};

	// Built once per full-screen view and shown or hidden, so CSS can animate both ways.
	const buildBar = ( screen ) => {
		const clearButton = etchButton( { variant: 'icon', size: 's', iconName: 'clear', iconSize: 12, className: 'etk-bulk-bar__clear', onClick: clear } );
		clearButton.setAttribute( 'aria-label', 'Clear selection' );
		clearButton.title = 'Clear selection';

		const count = el( 'div', { className: 'etk-bulk-bar__count' }, [
			el( 'span', { className: 'etk-bulk-bar__count-number' } ),
			' ',
			el( 'span', { className: 'etk-bulk-bar__count-label', textContent: 'selected' } ),
		] );
		count.setAttribute( 'role', 'status' );

		const selectAll = el( 'button', { type: 'button', className: 'etk-bulk-bar__select-all', textContent: 'Select All' } );
		selectAll.addEventListener( 'click', () => {
			const r = getRoot();
			if ( r ) visibleOrder( r ).forEach( ( id ) => selected.add( id ) );
			// It hides once everything is selected. Keep focus in the bar, not on the page behind.
			if ( document.activeElement === selectAll ) bar.querySelector( '.etk-bulk-bar__actions button:not(:disabled)' )?.focus();
			schedule();
		} );

		const bar = el( 'div', { className: 'etk-bulk-bar etk-bulk-bar--styles', hidden: true }, [
			el( 'div', { className: 'etk-bulk-bar__left' }, [ clearButton, count, selectAll ] ),
			el( 'div', { className: 'etk-bulk-bar__divider' } ),
			el( 'div', { className: 'etk-bulk-bar__actions' }, [
				etchButton( { variant: 'transparent', iconName: 'rename', label: 'Rename…', className: 'etk-bulk-bar__rename', onClick: bulkRename } ),
				etchButton( {
					variant: 'transparent',
					iconName: 'delete',
					label: el( 'span', { textContent: 'Delete' } ),
					className: 'etk-bulk-bar__delete',
					onClick: bulkDelete,
				} ),
			] ),
		] );
		bar.setAttribute( 'role', 'group' );
		bar.setAttribute( 'aria-label', 'Bulk style actions' );

		screen.append( el( 'div', { className: 'etk-bulk-bar-scrim', hidden: true } ), bar );
		return bar;
	};

	// Only write on change: every write is a DOM mutation, which would schedule another update.
	const setHidden = ( node, hidden ) => {
		if ( node && node.hidden !== hidden ) node.hidden = hidden;
	};

	const renderBar = ( root ) => {
		const screen = root && ( root.closest( SCREEN ) ?? root );
		let bar = document.querySelector( '.etk-bulk-bar--styles' );
		const show = Boolean( screen && selected.size && ! renaming );

		if ( ! bar ) {
			if ( ! show ) return;
			bar = buildBar( screen );
		} else if ( show && bar.parentElement !== screen ) {
			screen.append( bar.previousElementSibling, bar );
		}

		// Don't strand keyboard focus on a bar that's going away.
		if ( ! show && bar.contains( document.activeElement ) ) root?.querySelector( SEARCH )?.focus();

		setHidden( bar, ! show );
		setHidden( bar.previousElementSibling, ! show );
		if ( ! show ) return;

		const number = bar.querySelector( '.etk-bulk-bar__count-number' );
		const text = String( selected.size );
		if ( number.textContent !== text ) number.textContent = text;

		setHidden( bar.querySelector( '.etk-bulk-bar__select-all' ), visibleOrder( root ).every( ( id ) => selected.has( id ) ) );

		// Rename works on class names, which a selection of only #id styles doesn't have.
		const rename = bar.querySelector( '.etk-bulk-bar__rename' );
		const renamable = allStyles().some( ( s ) => selected.has( s.id ) && classesIn( s.selector ).length );
		if ( rename.disabled === renamable ) {
			rename.disabled = ! renamable;
			rename.title = renamable ? '' : 'Only class names can be renamed';
		}
	};

	const update = () => {
		frame = 0;
		const root = getRoot();

		// The Style Manager closed under the rename view.
		if ( renaming && ! renaming.panel.isConnected ) renaming.close();

		// Style Manager closed or on another view: drop the selection.
		if ( ! root ) {
			if ( selected.size ) clear();
			renderBar( null );
			return;
		}

		// Forget styles that no longer exist.
		const existing = new Set( allStyles().map( ( s ) => s.id ) );
		[ ...selected ].forEach( ( id ) => existing.has( id ) || selected.delete( id ) );

		root.classList.toggle( 'etk-selecting', selected.size > 0 );
		const ids = idsBySelector();
		root.querySelectorAll( ROWS ).forEach( ( row ) => renderCheckbox( row, ids ) );
		renderBar( root );
	};

	function schedule() {
		if ( ! frame ) frame = requestAnimationFrame( update );
	}

	/* ---- Events ---- */

	// Cmd/Ctrl-click toggles, Shift-click ranges. Capture phase so Etch's own
	// click handler (which opens the style) never sees these clicks.
	document.addEventListener(
		'click',
		( event ) => {
			const root = getRoot();
			const button = root && event.target.closest?.( ROW_BUTTON );
			if ( ! button || ! root.contains( button ) ) return;

			const id = idsBySelector().get( rowSelector( button.parentElement ) );
			if ( ! id ) return;

			if ( event.metaKey || event.ctrlKey || ( event.shiftKey && anchor ) ) {
				event.preventDefault();
				event.stopPropagation();
				if ( event.shiftKey ) selectRange( root, id );
				else toggle( id );
				return;
			}

			// A plain click opens the style as usual and becomes the range anchor.
			anchor = id;
		},
		true
	);

	// Another tab, Etch's or Recipes, leaves the rename view.
	document.addEventListener(
		'click',
		( event ) => {
			if ( renaming && event.target.closest?.( '.etch-advanced-switch--tabs .etch-advanced-switch__button' ) ) renaming.close();
		},
		true
	);

	// Esc clears the selection before it can close the Style Manager.
	document.addEventListener(
		'keydown',
		( event ) => {
			const root = getRoot();
			const focus = document.activeElement;
			if ( event.key !== 'Escape' || ! selected.size || ! ( root?.contains( focus ) || focus?.closest( '.etk-bulk-bar--styles' ) ) ) return;
			event.preventDefault();
			event.stopPropagation();
			clear();
		},
		true
	);

	new MutationObserver( schedule ).observe( document.body, {
		childList: true,
		subtree: true,
		characterData: true,
	} );
} )();
