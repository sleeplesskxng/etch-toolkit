/**
 * Etch Toolkit: settings.
 *
 * One screen, shown two ways: in the builder, a button in the Settings Bar's
 * bottom section opens it beside the bar, like the Fonts manager. In
 * WordPress, Etch → Toolkit shows it on the page. Laid out like Etch's
 * Content Hub: a sidebar with the title and sections, then the section.
 *
 * Settings apply as you change them, in both places, like Etch's own.
 *
 * Features add sections with etchToolkit.settings.section( { id, title,
 * render, open } ). render( ui ) returns the section's nodes, built with ui's
 * helpers. open(), if given, runs each time the section shows, to load what
 * it needs. ui.refresh() renders the section again.
 */
( () => {
	const toolkit = window.etchToolkit || {};
	const { api, confirmDialog } = toolkit;
	const config = window.etchToolkitSettings || {};
	if ( ! api ) return;

	const builder = config.context === 'builder';
	const CONTROL_ID = 'etch-toolkit-settings';

	// The toolkit's mark, filled with the current color.
	const LOGO =
		'<path d="M39.82 5.42L12.62 21.15C10.56 22.34 10.6 25.27 12.67 26.51L41.2 43.17C42.96 44.17 45.13 44.15 46.83 43.12L75.31 26.55C77.37 25.28 77.33 22.29 75.22 21.13L48.02 5.38C45.41 3.96 42.35 4 39.82 5.42Z" fill="currentColor"/>' +
		'<path d="M4.92 36.14L4.92 58.05C4.92 60.46 6.19 62.71 8.27 63.9L40.95 82.75C42.93 83.9 45.31 83.89 47.26 82.74L79.83 63.85C81.99 62.61 83.24 60.35 83.24 57.95L83.24 36.07C83.24 31.58 77.9 29.75 74.74 32.59L46.52 60.84C45.08 62.22 42.83 62.19 41.46 60.77L13.38 32.49C10.08 29.8 4.92 31.65 4.92 36.14Z" fill="currentColor"/>';
	// Etch's hugeicons:arrow-left-02, the back button on its own managers.
	const BACK = '<path d="M8.99996 16.9998L4 11.9997L9 6.99976"/><path d="M4 12H20"/>';
	const UPLOAD = '<path d="M12 4.5L12 14.5M12 4.5C11.2998 4.5 9.99153 6.4943 9.5 7M12 4.5C12.7002 4.5 14.0085 6.4943 14.5 7"/><path d="M20 16.5C20 18.982 19.482 19.5 17 19.5H7C4.518 19.5 4 18.982 4 16.5"/>';
	const stroke = ( paths, size = 16 ) =>
		`<svg class="etk-settings__icon" viewBox="0 0 24 24" width="${ size }" height="${ size }" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ paths }</svg>`;

	/**
	 * h( 'button', { class: 'x', onclick, 'aria-label': 'y' }, child, … )
	 * Keys starting with "on" are listeners, DOM properties are set directly,
	 * everything else is an attribute. `html` sets innerHTML (icons only).
	 */
	const PROPS = new Set( [ 'value', 'checked', 'disabled', 'hidden', 'textContent', 'htmlFor', 'indeterminate' ] );
	const h = ( tag, attrs = {}, ...children ) => {
		const node = document.createElement( tag );
		for ( const [ key, value ] of Object.entries( attrs ) ) {
			if ( value === undefined || value === null || value === false ) continue;
			if ( key === 'class' ) node.className = value;
			else if ( key === 'html' ) node.innerHTML = value;
			else if ( key.startsWith( 'on' ) ) node.addEventListener( key.slice( 2 ), value );
			else if ( PROPS.has( key ) ) node[ key ] = value;
			else node.setAttribute( key, value === true ? '' : value );
		}
		node.append( ...children.flat().filter( ( c ) => c !== null && c !== undefined && c !== false ) );
		return node;
	};

	let ids = 0;
	const uid = () => `etk-settings-${ ++ids }`;
	const plural = ( n, one, many ) => `${ n } ${ n === 1 ? one : many }`;
	const size = ( bytes ) => ( bytes < 1024 * 1024 ? `${ Math.max( 1, Math.round( bytes / 1024 ) ) } KB` : `${ ( bytes / 1024 / 1024 ).toFixed( 1 ) } MB` );
	const errorText = ( error ) => error?.message || String( error );

	/* ------------------------------------------------------------------ */
	/* UI helpers, for sections                                            */
	/* ------------------------------------------------------------------ */

	// Variants: secondary (outlined), primary and danger. attrs.class adds to its classes.
	const button = ( label, onclick, { variant = 'secondary', attrs = {} } = {} ) => {
		const { class: extra, ...rest } = attrs;
		return h( 'button', { type: 'button', class: `etk-settings__btn etk-settings__btn--${ variant }${ extra ? ` ${ extra }` : '' }`, onclick, ...rest }, label );
	};

	// A labelled group: the label, then a card of rows. action sits at the end of the label row.
	const group = ( title, ...rows ) => {
		const { title: text, action, note } = title && typeof title === 'object' ? title : { title };
		return h(
			'section',
			{ class: 'etk-settings__group' },
			h( 'div', { class: 'etk-settings__group-head' }, h( 'h3', { class: 'etk-settings__label', textContent: text } ), action || null ),
			h( 'div', { class: 'etk-settings__card' }, ...rows ),
			note ? h( 'p', { class: 'etk-settings__help etk-settings__note', textContent: note } ) : null
		);
	};

	const row = ( ...children ) => h( 'div', { class: 'etk-settings__row' }, ...children );

	// A setting's name and its value, on one row.
	const value = ( label, text ) => row( h( 'span', { class: 'etk-settings__row-title', textContent: label } ), typeof text === 'string' ? h( 'span', { class: 'etk-settings__muted', textContent: text } ) : text );

	/**
	 * A switch row: title and help on the left, the switch on the right. A
	 * checkbox with role="switch", so it reads as on or off. onchange gets
	 * the new value and may return a promise. The switch is busy until it settles.
	 */
	const toggle = ( label, checked, onchange, help ) => {
		const id = uid();
		const helpId = help ? `${ id }-help` : null;
		const input = h( 'input', {
			type: 'checkbox',
			role: 'switch',
			id,
			class: 'etk-settings__switch',
			checked,
			'aria-describedby': helpId,
			onchange: async ( e ) => {
				input.disabled = true;
				try {
					await onchange( e.target.checked );
				} finally {
					input.disabled = false;
					input.focus();
				}
			},
		} );
		return row(
			h( 'div', { class: 'etk-settings__toggle' }, h( 'div', { class: 'etk-settings__toggle-text' }, h( 'label', { class: 'etk-settings__row-title', htmlFor: id, textContent: label } ), help ? h( 'p', { class: 'etk-settings__help', id: helpId, textContent: help } ) : null ), input )
		);
	};

	const check = ( label, checked, onchange, extra ) =>
		h( 'label', { class: 'etk-settings__check' }, h( 'input', { type: 'checkbox', checked, onchange: ( e ) => onchange( e.target.checked ) } ), label, extra || null );

	// A dashed drop target for one .json file, with a Choose file button.
	const dropzone = ( text, onfile ) => {
		const input = h( 'input', { type: 'file', accept: '.json,application/json', class: 'screen-reader-text', onchange: ( e ) => {
			const [ file ] = e.target.files;
			e.target.value = '';
			if ( file ) onfile( file );
		} } );
		const zone = h(
			'div',
			{
				class: 'etk-settings__dropzone',
				ondragover: ( e ) => {
					e.preventDefault();
					zone.classList.add( 'is-over' );
				},
				ondragleave: () => zone.classList.remove( 'is-over' ),
				ondrop: ( e ) => {
					e.preventDefault();
					zone.classList.remove( 'is-over' );
					if ( e.dataTransfer.files[ 0 ] ) onfile( e.dataTransfer.files[ 0 ] );
				},
			},
			h( 'span', { class: 'etk-settings__dropzone-icon', html: stroke( UPLOAD ) } ),
			h( 'p', { class: 'etk-settings__dropzone-text', textContent: text } ),
			h( 'label', { class: 'etk-settings__btn etk-settings__btn--secondary etk-settings__file-btn' }, input, 'Choose file' )
		);
		return zone;
	};

	// Save JSON as a file.
	const download = ( data, name ) => {
		const url = URL.createObjectURL( new Blob( [ typeof data === 'string' ? data : JSON.stringify( data ) ], { type: 'application/json' } ) );
		h( 'a', { href: url, download: name } ).click();
		// Revoking straight away can cancel the download in some browsers.
		window.setTimeout( () => URL.revokeObjectURL( url ), 60000 );
	};

	/* ------------------------------------------------------------------ */
	/* Sections                                                            */
	/* ------------------------------------------------------------------ */

	const sections = [];
	let current = null;
	let panel = null;
	let main = null;
	let status = null;
	let nav = null;
	let controlButton = null;

	/**
	 * Tell screen readers what happened. Confirmations are announced only,
	 * errors are also shown above the section.
	 */
	const announce = ( message, { error = false } = {} ) => {
		if ( ! status ) return;
		status.textContent = '';
		status.classList.toggle( 'is-error', error );
		// Cleared first so a repeated message is read again.
		window.setTimeout( () => ( status.textContent = message ), 50 );
	};
	const warn = ( message ) => announce( message, { error: true } );

	const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

	// Render the current section again. Focus stays on the same control if it's still
	// there (same tag and name), or the one now in its place, or the section's title.
	const refresh = () => {
		if ( ! main || ! current ) return;
		const active = main.contains( document.activeElement ) ? document.activeElement : null;
		const key = ( node ) => `${ node.tagName } ${ node.getAttribute( 'aria-label' ) || node.labels?.[ 0 ]?.textContent || node.textContent }`;
		const before = active ? [ ...main.querySelectorAll( FOCUSABLE ) ] : [];
		const at = before.indexOf( active );

		main.replaceChildren(
			h( 'div', { class: 'etk-settings__page' }, h( 'h2', { class: 'etk-settings__page-title', tabindex: '-1', textContent: current.title } ), ...[ current.render( ui ) ].flat().filter( Boolean ) )
		);

		if ( ! active ) return;
		const after = [ ...main.querySelectorAll( FOCUSABLE ) ].filter( ( node ) => ! node.disabled );
		( after.find( ( node ) => key( node ) === key( active ) ) || after[ Math.min( at, after.length - 1 ) ] || main.querySelector( '.etk-settings__page-title' ) )?.focus();
	};

	const show = async ( section, { focus = true } = {} ) => {
		current = section;
		nav?.querySelectorAll( 'button' ).forEach( ( b ) => ( b.dataset.id === section.id ? b.setAttribute( 'aria-current', 'page' ) : b.removeAttribute( 'aria-current' ) ) );
		status && ( status.textContent = '' );
		status?.classList.remove( 'is-error' );
		try {
			sessionStorage.setItem( 'etk-settings-section', section.id );
		} catch {}
		refresh();
		if ( focus ) main.querySelector( '.etk-settings__page-title' )?.focus();
		if ( section.open ) {
			try {
				await section.open();
			} catch ( error ) {
				warn( errorText( error ) );
			}
			if ( current === section ) refresh();
		}
	};

	const renderNav = () => {
		if ( ! nav ) return;
		nav.replaceChildren( ...sections.map( ( s ) => h( 'button', { type: 'button', class: 'etk-settings__nav-item', 'data-id': s.id, textContent: s.title, 'aria-current': s === current ? 'page' : null, onclick: () => show( s ) } ) ) );
	};

	const ui = { h, button, group, row, value, toggle, check, dropzone, download, announce, warn, refresh, confirmDialog, plural, size, errorText, builder };

	// Sections sort by order, then as added.
	const section = ( spec ) => {
		sections.push( { order: 50, ...spec } );
		sections.sort( ( a, b ) => a.order - b.order );
		renderNav();
		if ( panel && ( ! panel.hidden || ! builder ) && ! current ) show( sections[ 0 ], { focus: false } );
	};

	/* ------------------------------------------------------------------ */
	/* General                                                             */
	/* ------------------------------------------------------------------ */

	let settings = config.settings || { deleteData: false };
	const save = async ( changes, message ) => {
		try {
			settings = await api( 'settings', 'POST', changes );
			announce( message );
		} catch ( error ) {
			warn( errorText( error ) );
		}
		refresh();
	};

	section( {
		id: 'general',
		title: 'General',
		order: 0,
		render: () => [
			group(
				{ title: 'Uninstall', note: 'Fonts always stay, so the site’s fonts keep working: the Etch Toolkit Fonts stylesheet and the font files. So do changes the toolkit made in Etch, like renamed classes.' },
				toggle(
					'Delete data when the plugin is deleted',
					settings.deleteData,
					( on ) => save( { deleteData: on }, on ? 'Data will be deleted with the plugin.' : 'Data will be kept when the plugin is deleted.' ),
					'Removes your recipes, font list, settings and caches.'
				)
			),
		],
	} );

	/* ------------------------------------------------------------------ */
	/* Shell                                                               */
	/* ------------------------------------------------------------------ */

	const build = ( root ) => {
		status = h( 'div', { class: 'etk-settings__status', role: 'status', 'aria-live': 'polite' } );
		main = h( 'div', { class: 'etk-settings__main' } );
		nav = h( 'nav', { class: 'etk-settings__nav', 'aria-label': 'Settings' } );
		panel = h(
			builder ? 'section' : 'div',
			{
				id: 'etk-settings',
				class: `etk-settings ${ builder ? 'etk-settings--panel' : 'etk-settings--page' }`,
				hidden: builder,
				'aria-labelledby': 'etk-settings-title',
				// In the builder, keep typing here away from Etch's shortcuts. Esc closes.
				onkeydown: builder
					? ( e ) => {
							e.stopPropagation();
							if ( e.key === 'Escape' && ! e.target.closest( 'dialog' ) ) {
								e.preventDefault();
								close();
							}
					  }
					: null,
				onkeyup: builder ? ( e ) => e.stopPropagation() : null,
			},
			h(
				'div',
				{ class: 'etk-settings__sidebar' },
				h(
					'header',
					{ class: 'etk-settings__header' },
					builder ? h( 'button', { type: 'button', class: 'etk-settings__btn etk-settings__btn--secondary etk-settings__icon-btn', 'aria-label': 'Back to the builder', title: 'Back to the builder', html: stroke( BACK ), onclick: () => close() } ) : null,
					h( 'span', { class: 'etk-settings__logo', html: `<svg viewBox="0 0 88 88" width="18" height="18" aria-hidden="true" focusable="false">${ LOGO }</svg>` } ),
					h( 'h1', { id: 'etk-settings-title', class: 'etk-settings__title', textContent: 'Etch Toolkit' } )
				),
				nav
			),
			h( 'div', { class: 'etk-settings__body' }, status, h( 'div', { class: 'etk-settings__content' }, main ) )
		);
		root.append( panel );
		renderNav();
	};

	// The section you had open last, this session.
	const lastSection = () => {
		try {
			return sections.find( ( s ) => s.id === sessionStorage.getItem( 'etk-settings-section' ) );
		} catch {
			return undefined;
		}
	};

	const open = () => {
		if ( ! panel ) build( document.body );
		// One manager at a time, like Etch's own, so Back goes straight to the canvas.
		try {
			if ( window.etch.navigation.getCurrentPlace() !== 'builder' ) window.etch.navigation.goTo( 'builder' );
		} catch {}
		// Pinning Automatic.css's dashboard writes left and max-width onto every fixed element. Its place comes from settings.css.
		panel.removeAttribute( 'style' );
		panel.hidden = false;
		controlButton?.setAttribute( 'aria-expanded', 'true' );
		controlButton?.setAttribute( 'selected', 'true' );
		show( current || lastSection() || sections[ 0 ] );
	};

	// focus: false when another Settings Bar button closed it, so focus stays on that one.
	const close = ( { focus = true } = {} ) => {
		if ( ! panel || panel.hidden ) return;
		panel.hidden = true;
		controlButton?.setAttribute( 'aria-expanded', 'false' );
		controlButton?.removeAttribute( 'selected' );
		if ( focus ) controlButton?.focus();
	};

	/* ------------------------------------------------------------------ */
	/* Boot                                                                */
	/* ------------------------------------------------------------------ */

	// Etch draws its buttons' icons from a name. This one gets the logo swapped in after,
	// and again whenever Etch re-renders it. Compared as the browser writes it back.
	let drawn = '';
	const useLogo = () => {
		const svg = controlButton?.querySelector( 'svg' );
		if ( ! svg || svg.innerHTML === drawn ) return;
		svg.setAttribute( 'viewBox', '0 0 88 88' );
		svg.innerHTML = LOGO;
		drawn = svg.innerHTML;
	};

	const register = () => {
		const bar = window.etchControls?.builder?.settingsBar?.bottom;
		const bottom = document.querySelector( '.settings-bar__section.bottom' );
		if ( ! bar || ! bottom?.querySelector( 'button' ) ) return false;

		const before = new Set( bottom.querySelectorAll( 'button' ) );
		bar.addBefore( { id: CONTROL_ID, icon: 'hugeicons:settings-02', tooltip: 'Etch Toolkit', callback: () => ( panel && ! panel.hidden ? close() : open() ) } );

		// Etch renders the button on its next update. Label it for toggling state.
		const observer = new MutationObserver( () => {
			controlButton = [ ...bottom.querySelectorAll( 'button' ) ].find( ( b ) => ! before.has( b ) );
			if ( ! controlButton ) return;
			observer.disconnect();
			controlButton.setAttribute( 'aria-label', 'Etch Toolkit settings' );
			controlButton.setAttribute( 'aria-expanded', 'false' );
			controlButton.setAttribute( 'aria-controls', 'etk-settings' );
			controlButton.classList.add( 'etk-settings-control' );
			useLogo();
			new MutationObserver( useLogo ).observe( controlButton, { childList: true, subtree: true } );
		} );
		observer.observe( bottom, { childList: true, subtree: true } );

		// Opening one of Etch's own managers, or the Fonts manager, closes this one.
		document.querySelector( '.settings-bar' )?.addEventListener( 'click', ( e ) => {
			const clicked = e.target.closest( 'button, a' );
			if ( clicked && clicked !== controlButton ) close( { focus: false } );
		} );
		return true;
	};

	if ( builder ) {
		const boot = () => {
			let tries = 0;
			const timer = window.setInterval( () => {
				if ( register() || ++tries > 120 ) window.clearInterval( timer );
			}, 250 );
		};
		document.readyState === 'complete' ? boot() : window.addEventListener( 'load', boot );
	} else {
		// Sections' scripts load after this one, so the page opens once they've added theirs.
		const start = () => {
			const root = document.getElementById( 'etk-settings-root' );
			if ( ! root ) return;
			build( root );
			show( lastSection() || sections[ 0 ], { focus: false } );
		};
		document.readyState === 'loading' ? document.addEventListener( 'DOMContentLoaded', start ) : window.setTimeout( start );
	}

	toolkit.settings = { section, ui, close };
	window.etchToolkit = toolkit;
} )();
