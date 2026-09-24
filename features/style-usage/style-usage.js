/**
 * Etch Toolkit: style usage badges in the Style Manager.
 *
 * Etch has no UI extension API, so this watches the Style Manager DOM and
 * appends a count to each selector row. Counts come from the server (saved
 * content, site-wide) and are refetched each time the Style Manager opens.
 *
 * It also adds an "Unused" tab. Etch's tabs are a fixed list and its list is
 * virtual, so the tab shows its own list over Etch's (switched to "All").
 * Picking a selector there opens it by searching Etch's list for it and
 * clicking the matching row, since the selected style isn't exposed.
 */
( () => {
	const { api, el } = window.etchToolkit || {};
	if ( ! api ) return;

	const MODAL = '.style-overview-modal__inner';
	const LEFT = '.style-overview-modal__left';
	const LIST = `${ LEFT } .virtual-list`;
	const SEARCH = `${ LEFT } .searchbar input`;
	const TABS = `${ LEFT } .css-input-tabs__wrapper`;
	const TRIGGER = '.css-input-tabs__trigger';
	const CURRENT = '.style-overview-modal__right .input-button-inline input'; // Rename field: the open style's selector.
	const ROW_BUTTON = '.list-item > .main-button';
	const BADGE = 'etk-usage';
	const UNUSED = 'etk-unused';
	// Blocks reference class, id and custom styles (e.g. `.card::before`, `.card:hover .title`).
	// Element styles and :root apply without a block reference, so a count would mislead.
	const isCounted = ( style ) =>
		[ 'class', 'id', 'custom' ].includes( style.type ) && style.selector.trim() !== ':root';

	let counts = null; // { selector: number } | null
	let request = null;
	let frame = 0;
	let unusedOn = false;
	let selecting = false; // Driving Etch's search to open a style.

	const fetchCounts = () => {
		request = api( 'style-usage' )
			.then( ( data ) => {
				counts = data.counts || {};
				schedule();
			} )
			.catch( ( err ) => console.warn( '[Etch Toolkit] Style usage request failed:', err ) );
	};

	// Counted selectors => uses, in the Style Manager's order. Several styles can
	// share a selector across collections, and the server counts by selector. It
	// leaves out selectors it can't count, like `.card > p`, so they get no badge.
	const countsBySelector = () => {
		const map = new Map();
		let styles = [];
		try {
			styles = window.etch.styles.list();
		} catch {
			return map;
		}
		for ( const style of styles ) {
			if ( isCounted( style ) && style.selector.trim() in counts ) map.set( style.selector, counts[ style.selector.trim() ] );
		}
		return map;
	};

	const renderBadge = ( button, count ) => {
		let badge = button.querySelector( `:scope > .${ BADGE }` );

		if ( count === undefined ) {
			badge?.remove();
			return;
		}

		const label = `Used ${ count } ${ count === 1 ? 'time' : 'times' }`;
		if ( badge?.dataset.count === String( count ) ) return;

		if ( ! badge ) {
			badge = document.createElement( 'span' );
			badge.className = BADGE;
			badge.innerHTML = '<span aria-hidden="true"></span><span class="etk-sr"></span>';
			button.append( badge );
		}

		badge.dataset.count = String( count );
		badge.classList.toggle( `${ BADGE }--unused`, count === 0 );
		badge.title = label;
		badge.firstChild.textContent = String( count );
		badge.lastChild.textContent = `, ${ label.toLowerCase() }`;
	};

	/* ---- Unused tab ---- */

	const rowLabel = ( button ) => button.querySelector( `:scope > span:not(.${ BADGE })` )?.textContent.trim() ?? '';
	const nextFrame = () => new Promise( ( resolve ) => requestAnimationFrame( resolve ) );

	const setSearch = ( input, value ) => {
		input.value = value;
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	};

	const setUnused = ( on ) => {
		if ( on && ! unusedOn ) {
			// Etch's list sits under ours and opens styles for it, so it should list everything.
			const search = document.querySelector( SEARCH );
			if ( search?.value ) setSearch( search, '' );
			const all = document.querySelector( `${ TABS } > ${ TRIGGER }:not(.${ UNUSED }-tab)` );
			if ( all && all.dataset.state !== 'active' ) all.click();
		}
		unusedOn = on;
		schedule();
	};

	const openStyle = async ( selector ) => {
		const search = document.querySelector( SEARCH );
		if ( ! search || selecting ) return;

		selecting = true;
		setSearch( search, selector );
		let row;
		for ( let i = 0; i < 20 && ! row; i++ ) {
			await nextFrame();
			row = [ ...document.querySelectorAll( `${ LIST } ${ ROW_BUTTON }` ) ].find( ( b ) => rowLabel( b ) === selector );
		}
		selecting = false;

		if ( row ) {
			row.click();
			setSearch( search, '' );
		} else {
			// Not in view: leave the search for it in Etch's list.
			setUnused( false );
		}
	};

	const renderTab = ( wrapper ) => {
		let tab = wrapper.querySelector( `:scope > .${ UNUSED }-tab` );
		if ( ! tab ) {
			tab = el( 'button', { type: 'button', className: `${ TRIGGER.slice( 1 ) } ${ UNUSED }-tab`, textContent: 'Unused' } );
			tab.setAttribute( 'role', 'tab' );
			tab.addEventListener( 'click', () => setUnused( true ) );
			wrapper.append( tab );
		}

		tab.dataset.state = unusedOn ? 'active' : 'inactive';
		tab.setAttribute( 'aria-selected', String( unusedOn ) );
		wrapper.classList.toggle( `${ UNUSED }-on`, unusedOn );

		// One tab stop, on whichever tab looks active.
		for ( const trigger of wrapper.querySelectorAll( `:scope > ${ TRIGGER }` ) ) {
			trigger.tabIndex = trigger === tab ? ( unusedOn ? 0 : -1 ) : ! unusedOn && trigger.dataset.state === 'active' ? 0 : -1;
		}
	};

	const renderList = ( host ) => {
		let list = document.querySelector( `.${ UNUSED }` );
		if ( ! unusedOn || ! host ) {
			list?.remove();
			return;
		}

		if ( list?.parentElement !== host ) {
			list?.remove();
			list = el( 'div', { className: UNUSED } );
			list.setAttribute( 'role', 'tabpanel' );
			list.setAttribute( 'aria-label', 'Unused selectors' );
			host.append( list );
		}

		const selectors = counts ? [ ...countsBySelector() ].filter( ( [ , n ] ) => n === 0 ).map( ( [ s ] ) => s ) : null;
		const key = JSON.stringify( selectors );
		if ( list.dataset.key !== key ) {
			list.dataset.key = key;
			if ( ! selectors || ! selectors.length ) {
				list.replaceChildren(
					el( 'p', { className: `${ UNUSED }__empty`, textContent: selectors ? 'No unused selectors.' : 'Checking usage…' } )
				);
			} else {
				list.replaceChildren(
					el(
						'ul',
						{ className: `${ UNUSED }__items` },
						selectors.map( ( selector ) => {
							const button = el( 'button', { type: 'button', className: `${ UNUSED }__button`, textContent: selector } );
							button.addEventListener( 'click', () => openStyle( selector ) );
							return el( 'li', {}, [ button ] );
						} )
					)
				);
			}
		}

		const current = document.querySelector( CURRENT )?.value.trim();
		for ( const button of list.querySelectorAll( `.${ UNUSED }__button` ) ) {
			if ( button.textContent === current ) button.setAttribute( 'aria-current', 'true' );
			else button.removeAttribute( 'aria-current' );
		}
	};

	// Clicking one of Etch's tabs, or typing a search, leaves the Unused tab.
	document.addEventListener(
		'click',
		( event ) => {
			if ( unusedOn && event.target.closest?.( `${ TABS } > ${ TRIGGER }:not(.${ UNUSED }-tab)` ) ) setUnused( false );
		},
		true
	);
	document.addEventListener(
		'input',
		( event ) => {
			if ( unusedOn && ! selecting && event.target.matches?.( SEARCH ) && event.target.value ) setUnused( false );
		},
		true
	);

	// Arrow keys across Etch's tabs and ours. Etch's own handling doesn't know about ours.
	document.addEventListener(
		'keydown',
		( event ) => {
			const wrapper = event.target.closest?.( TABS );
			if ( ! wrapper ) return;
			const triggers = [ ...wrapper.querySelectorAll( `:scope > ${ TRIGGER }` ) ];
			const i = triggers.indexOf( event.target );
			const n = triggers.length;
			const next = { ArrowRight: ( i + 1 ) % n, ArrowLeft: ( i - 1 + n ) % n, Home: 0, End: n - 1 }[ event.key ];
			if ( i === -1 || next === undefined ) return;

			event.preventDefault();
			event.stopPropagation();
			triggers[ next ].focus();
			triggers[ next ].click();
		},
		true
	);

	/* ---- Render ---- */

	const update = () => {
		frame = 0;

		// Style Manager closed: drop the cache so the next open picks up saved changes.
		if ( ! document.querySelector( MODAL ) ) {
			counts = null;
			request = null;
			unusedOn = false;
			return;
		}

		const tabs = document.querySelector( TABS );
		if ( ! tabs ) unusedOn = false; // Another mode, like Variables.
		else renderTab( tabs );

		if ( ! counts && ! request ) fetchCounts();

		const list = document.querySelector( LIST );
		renderList( list ?? document.querySelector( `${ LEFT } .etch-css-selectors` ) );
		if ( ! counts || ! list ) return;

		const bySelector = countsBySelector();
		for ( const button of list.querySelectorAll( ROW_BUTTON ) ) {
			renderBadge( button, bySelector.get( rowLabel( button ) ) );
		}
	};

	const schedule = () => {
		if ( ! frame ) frame = requestAnimationFrame( update );
	};

	new MutationObserver( schedule ).observe( document.body, {
		childList: true,
		subtree: true,
		characterData: true,
	} );
} )();
