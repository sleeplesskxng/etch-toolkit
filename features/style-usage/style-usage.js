/**
 * Etch Toolkit: style usage badges in the Style Manager.
 *
 * Etch has no UI extension API, so this watches the Style Manager DOM and
 * appends a count to each selector row. Counts come from the server (saved
 * content, site-wide) and are refetched each time the Style Manager opens.
 */
( () => {
	const { api } = window.etchToolkit || {};
	if ( ! api ) return;

	const LIST = '.style-overview-modal__left .virtual-list';
	const ROW_BUTTON = '.list-item > .main-button';
	const BADGE = 'etk-usage';
	// Blocks reference class, id and custom styles (e.g. `.card::before`, `.card:hover .title`).
	// Element styles and :root apply without a block reference, so a count would mislead.
	const isCounted = ( style ) =>
		[ 'class', 'id', 'custom' ].includes( style.type ) && style.selector.trim() !== ':root';

	let counts = null; // { styleId: number } | null
	let request = null;
	let frame = 0;

	const fetchCounts = () => {
		request = api( 'style-usage' )
			.then( ( data ) => {
				counts = data.counts || {};
				schedule();
			} )
			.catch( ( err ) => console.warn( '[Etch Toolkit] Style usage request failed:', err ) );
	};

	// Selector => total uses. Several style IDs can share a selector across collections.
	const countsBySelector = () => {
		const map = new Map();
		let styles = [];
		try {
			styles = window.etch.styles.list();
		} catch {
			return map;
		}
		for ( const style of styles ) {
			if ( ! isCounted( style ) ) continue;
			map.set( style.selector, ( map.get( style.selector ) || 0 ) + ( counts[ style.id ] || 0 ) );
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

	const update = () => {
		frame = 0;
		const list = document.querySelector( LIST );

		// Style Manager closed: drop the cache so the next open picks up saved changes.
		if ( ! list ) {
			counts = null;
			request = null;
			return;
		}

		if ( ! counts ) {
			if ( ! request ) fetchCounts();
			return;
		}

		const bySelector = countsBySelector();
		for ( const button of list.querySelectorAll( ROW_BUTTON ) ) {
			const label = button.querySelector( `:scope > span:not(.${ BADGE })` );
			renderBadge( button, label ? bySelector.get( label.textContent.trim() ) : undefined );
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
