/**
 * Etch Toolkit: multi-select in the Style Manager.
 *
 * - A checkbox on each row (visible on hover, focus, or once anything is selected).
 * - Cmd/Ctrl-click a row to toggle it, Shift-click to select a range.
 * - A floating action bar, a copy of the Asset Manager's bulk bar: Clear,
 *   count, Select all, Rename, Delete.
 *
 * Rename is find/replace inside class names. The server previews and applies
 * it, renaming each changed class everywhere: every style's selector and CSS,
 * global stylesheets, and element class attributes across the site.
 *
 * Selection is kept here by style ID, because Etch's list is virtual and only
 * renders the rows in view. Range selection rebuilds the list's full order the
 * same way Etch does (skip :root and element styles, then filter by search
 * text, or by the active tab when the search is empty).
 */
( () => {
	const { api, el, confirmDialog } = window.etchToolkit || {};
	if ( ! confirmDialog ) return;

	const ROOT = '.style-overview-modal__left';
	const SEARCH = '.searchbar input';
	const ACTIVE_TAB = '.css-input-tabs__trigger[data-state="active"]';
	const LIST = '.virtual-list';
	const ROW = '.list-item';
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
	const visibleOrder = ( root ) => {
		const search = root.querySelector( SEARCH )?.value.trim().toLowerCase() ?? '';
		const tab = root.querySelector( ACTIVE_TAB )?.textContent.trim().toLowerCase() || 'all';
		return listable( allStyles() )
			.filter( ( s ) => ( search ? s.selector.toLowerCase().includes( search ) : tab === 'all' || s.type === tab ) )
			.map( ( s ) => s.id );
	};

	const rowSelector = ( row ) => row.querySelector( '.main-button > span:not(.etk-usage)' )?.textContent.trim() ?? '';

	// Selector => first style ID with it (the Style Manager lists all collections together).
	const idsBySelector = () => {
		const map = new Map();
		for ( const s of listable( allStyles() ) ) if ( ! map.has( s.selector ) ) map.set( s.selector, s.id );
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

	const renderRenamePreview = ( container, summary, plan, find ) => {
		if ( ! plan.styles.length ) {
			summary.textContent = `None of the selected class names contain "${ find }".`;
			container.replaceChildren();
			return;
		}

		const parts = [ plural( plan.styles.length, 'style' ) ];
		if ( plan.elements ) parts.push( `${ plural( plan.elements, 'element' ) } on ${ plural( plan.posts.length, 'page' ) }` );
		if ( plan.stylesheets.length ) parts.push( plural( plan.stylesheets.length, 'global stylesheet' ) );
		summary.textContent = `This updates ${ parts.join( ', ' ) }.`;

		const nodes = [];
		if ( plan.errors.length ) {
			nodes.push( el( 'ul', { className: 'etk-preview__errors' }, plan.errors.map( ( e ) => el( 'li', { textContent: e } ) ) ) );
		}

		// Selected styles first, then others that reference a renamed class.
		const rows = [ ...plan.styles ].sort( ( a, b ) => b.selected - a.selected );
		const bemSelectors = new Set( plan.bem.map( ( b ) => `.${ b.from }` ) );
		nodes.push(
			el(
				'ul',
				{ className: 'etk-confirm__list etk-preview__list' },
				rows.map( ( c ) =>
					el(
						'li',
						{},
						c.from === c.to
							? [ el( 'code', { textContent: c.from } ), el( 'span', { className: 'etk-preview__also', textContent: 'CSS updated' } ) ]
							: [
									el( 'code', { textContent: c.from } ),
									el( 'span', { className: 'etk-preview__arrow', textContent: '→' } ),
									el( 'code', { textContent: c.to } ),
									...( c.selected
										? []
										: [ el( 'span', { className: 'etk-preview__also', textContent: bemSelectors.has( c.from ) ? 'child/modifier' : 'related' } ) ] ),
							  ]
					)
				)
			)
		);

		container.replaceChildren( ...nodes );
	};

	// The BEM option, with a count, and the list of what it renames (shown when checked).
	const renderBemOption = ( option, list, plan ) => {
		option.hidden = ! plan.bem.length;
		if ( ! plan.bem.length ) {
			list.replaceChildren();
			return;
		}

		const count = option.querySelector( '.etk-bem__count' );
		const text = `(${ plan.bem.length })`;
		if ( count.textContent !== text ) count.textContent = text;

		list.replaceChildren(
			...plan.bem.map( ( b ) =>
				el( 'li', {}, [
					el( 'code', { textContent: `.${ b.from }` } ),
					el( 'span', { className: 'etk-preview__arrow', textContent: '→' } ),
					el( 'code', { textContent: `.${ b.to }` } ),
					el( 'span', { className: 'etk-preview__also', textContent: b.styled ? 'has a style' : 'class only' } ),
				] )
			)
		);
	};

	const bulkRename = async () => {
		const styles = allStyles().filter( ( s ) => selected.has( s.id ) );
		if ( ! styles.length ) return;
		const ids = styles.map( ( s ) => s.id );

		// Start from the first class name in the selection, e.g. "feature-card".
		const start = styles.map( ( s ) => s.selector.match( /\.(-?[_a-zA-Z][\w-]*)/ )?.[ 1 ] ).find( Boolean ) ?? '';

		const field = ( id, label, value ) => {
			const input = el( 'input', { id, type: 'text', value, spellcheck: false, autocomplete: 'off' } );
			return [ el( 'div', { className: 'etk-field' }, [ el( 'label', { htmlFor: id, textContent: label } ), input ] ), input ];
		};
		const [ findField, find ] = field( 'etk-rename-find', 'Find', start );
		const [ replaceField, replace ] = field( 'etk-rename-replace', 'Replace with', start );

		const bemBox = el( 'input', { type: 'checkbox', id: 'etk-rename-bem' } );
		const bemList = el( 'ul', { className: 'etk-confirm__list etk-preview__list etk-bem__list', id: 'etk-rename-bem-list' } );
		const bemOption = el( 'div', { className: 'etk-bem', hidden: true }, [
			el( 'label', { className: 'etk-bem__label', htmlFor: bemBox.id }, [
				bemBox,
				' Also rename BEM children and modifiers ',
				el( 'span', { className: 'etk-bem__count' } ),
			] ),
			bemList,
		] );

		const summary = el( 'p', { className: 'etk-preview__summary' } );
		summary.setAttribute( 'aria-live', 'polite' );
		const details = el( 'div', { className: 'etk-confirm__message' } );

		const dialog = confirmDialog( {
			title: `Renaming ${ plural( styles.length, 'style' ) }`,
			variant: 'primary',
			form: true,
			confirmLabel: 'Rename',
			busyLabel: 'Renaming…',
			failTitle: 'Rename failed',
			initialFocus: replace,
			message: [
				el( 'div', { className: 'etk-fields' }, [ findField, replaceField ] ),
				summary,
				details,
				bemOption,
				el( 'p', {
					className: 'etk-preview__also',
					textContent: "Class names are updated on every element across the site. Your changes will be saved and the builder will reload. This can't be undone.",
				} ),
			],
		} );
		replace.select();

		let seq = 0;
		let timer = 0;
		let ready = false;

		const refresh = () => {
			clearTimeout( timer );
			ready = false;
			dialog.setConfirmEnabled( false );

			const f = find.value.trim();
			const r = replace.value.trim();
			const fOk = /^[\w-]+$/.test( f );
			const rOk = /^[\w-]*$/.test( r );
			find.setAttribute( 'aria-invalid', String( ! fOk ) );
			replace.setAttribute( 'aria-invalid', String( ! rOk ) );

			if ( ! fOk || ! rOk || f === r ) {
				summary.textContent = f === r ? 'Type a new name to see what changes.' : 'Use letters, numbers, hyphens and underscores only.';
				details.replaceChildren();
				bemOption.hidden = true;
				return;
			}

			const mine = ++seq;
			timer = setTimeout( async () => {
				try {
					const plan = await api( 'styles/rename/preview', 'POST', { ids, find: f, replace: r, bem: bemBox.checked } );
					if ( mine !== seq ) return; // A newer keystroke is in flight.
					renderBemOption( bemOption, bemList, plan );
					renderRenamePreview( details, summary, plan, f );
					ready = plan.styles.length > 0 && ! plan.errors.length;
					dialog.setConfirmEnabled( ready );
				} catch ( err ) {
					if ( mine === seq ) summary.textContent = err.message;
				}
			}, 250 );
		};

		for ( const input of [ find, replace ] ) {
			input.addEventListener( 'input', refresh );
			input.addEventListener( 'keydown', ( event ) => {
				if ( event.key === 'Enter' && ready ) {
					event.preventDefault();
					dialog.confirm();
				}
			} );
		}
		bemBox.addEventListener( 'change', refresh );
		refresh();

		if ( ! ( await dialog.result ) ) return;
		find.disabled = true;
		replace.disabled = true;
		bemBox.disabled = true;

		try {
			await window.etch.saveAsync();
			await api( 'styles/rename', 'POST', { ids, find: find.value.trim(), replace: replace.value.trim(), bem: bemBox.checked } );
			window.location.reload();
		} catch ( err ) {
			dialog.fail( err.message );
		}
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
			el( 'span', { className: 'etk-bulk-bar__count-badge' } ),
			' ',
			el( 'span', { className: 'etk-bulk-bar__count-label', textContent: 'Selected' } ),
		] );
		count.setAttribute( 'role', 'status' );

		const selectAll = el( 'button', { type: 'button', className: 'etk-bulk-bar__select-all', textContent: 'Select All' } );
		selectAll.addEventListener( 'click', () => {
			const r = getRoot();
			if ( r ) visibleOrder( r ).forEach( ( id ) => selected.add( id ) );
			schedule();
		} );

		const bar = el( 'div', { className: 'etk-bulk-bar', hidden: true }, [
			el( 'div', { className: 'etk-bulk-bar__left' }, [ clearButton, count, selectAll ] ),
			el( 'div', { className: 'etk-bulk-bar__divider' } ),
			el( 'div', { className: 'etk-bulk-bar__actions' }, [
				etchButton( { variant: 'transparent', iconName: 'rename', label: 'Rename…', onClick: bulkRename } ),
				etchButton( {
					variant: 'transparent',
					iconName: 'delete',
					label: el( 'span', { textContent: 'Delete' } ),
					className: 'etk-bulk-bar__delete',
					onClick: bulkDelete,
				} ),
			] ),
		] );
		bar.setAttribute( 'role', 'toolbar' );
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
		let bar = document.querySelector( '.etk-bulk-bar' );
		const show = Boolean( screen && selected.size );

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

		const badge = bar.querySelector( '.etk-bulk-bar__count-badge' );
		const text = String( selected.size );
		if ( badge.textContent !== text ) badge.textContent = text;

		setHidden( bar.querySelector( '.etk-bulk-bar__select-all' ), visibleOrder( root ).every( ( id ) => selected.has( id ) ) );
	};

	const update = () => {
		frame = 0;
		const root = getRoot();

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
		root.querySelectorAll( `${ LIST } ${ ROW }` ).forEach( ( row ) => renderCheckbox( row, ids ) );
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
			const button = event.target.closest?.( `${ ROOT } ${ ROW } > .main-button` );
			const root = getRoot();
			if ( ! button || ! root ) return;

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

	// Esc clears the selection before it can close the Style Manager.
	document.addEventListener(
		'keydown',
		( event ) => {
			const root = getRoot();
			const focus = document.activeElement;
			if ( event.key !== 'Escape' || ! selected.size || ! ( root?.contains( focus ) || focus?.closest( '.etk-bulk-bar' ) ) ) return;
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
