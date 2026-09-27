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
 * icon, render, open } ). icon names one of the core's icons (etchToolkit.ICONS)
 * for the nav. render( ui ) returns the section's nodes, built with ui's
 * helpers. open(), if given, runs each time the section shows, to load what
 * it needs. ui.refresh() renders the section again.
 */
( () => {
	const toolkit = window.etchToolkit || {};
	const { api, el, errorText, settingsBarButton, managerKeys, openManager } = toolkit;
	const icon = ( name ) => toolkit.icon( name, { className: 'etk-settings__icon' } );
	const config = window.etchToolkitSettings || {};
	if ( ! api ) return;

	const builder = config.context === 'builder';
	const CONTROL_ID = 'etch-toolkit-settings';

	// The toolkit's mark, filled with the current color.
	const LOGO =
		'<path d="M39.82 5.42L12.62 21.15C10.56 22.34 10.6 25.27 12.67 26.51L41.2 43.17C42.96 44.17 45.13 44.15 46.83 43.12L75.31 26.55C77.37 25.28 77.33 22.29 75.22 21.13L48.02 5.38C45.41 3.96 42.35 4 39.82 5.42Z" fill="currentColor"/>' +
		'<path d="M4.92 36.14L4.92 58.05C4.92 60.46 6.19 62.71 8.27 63.9L40.95 82.75C42.93 83.9 45.31 83.89 47.26 82.74L79.83 63.85C81.99 62.61 83.24 60.35 83.24 57.95L83.24 36.07C83.24 31.58 77.9 29.75 74.74 32.59L46.52 60.84C45.08 62.22 42.83 62.19 41.46 60.77L13.38 32.49C10.08 29.8 4.92 31.65 4.92 36.14Z" fill="currentColor"/>';

	let ids = 0;
	const uid = () => `etk-settings-${ ++ids }`;

	/* ------------------------------------------------------------------ */
	/* UI helpers, for sections                                            */
	/* ------------------------------------------------------------------ */

	// Variants: secondary (outlined), primary and danger. attrs.class adds to its classes.
	const button = ( label, onclick, { variant = 'secondary', attrs = {} } = {} ) => {
		const { class: extra, ...rest } = attrs;
		return el( 'button', { type: 'button', class: `etk-settings__btn etk-settings__btn--${ variant }${ extra ? ` ${ extra }` : '' }`, onclick, ...rest }, label );
	};

	// A labelled group: the label, then a card of rows, or the children as they are with
	// bare. action sits at the end of the label row, note under the card.
	const group = ( title, ...rows ) => {
		const { title: text, action, note, bare } = title && typeof title === 'object' ? title : { title };
		return el(
			'section',
			{ class: 'etk-manager__group' },
			el( 'div', { class: 'etk-manager__group-head' }, el( 'h3', { class: 'etk-manager__label', textContent: text } ), action || null ),
			bare ? rows : el( 'div', { class: 'etk-manager__card' }, ...rows ),
			note ? el( 'p', { class: 'etk-manager__help etk-settings__note', textContent: note } ) : null
		);
	};

	const row = ( ...children ) => el( 'div', { class: 'etk-manager__row' }, ...children );

	// A setting's name and its value, on one row.
	const value = ( label, text ) => row( el( 'span', { class: 'etk-settings__row-title', textContent: label } ), typeof text === 'string' ? el( 'span', { class: 'etk-manager__muted', textContent: text } ) : text );

	/**
	 * A switch row: title and help on the left, the switch on the right. A
	 * checkbox with role="switch", so it reads as on or off. onchange gets
	 * the new value and may return a promise. The switch is busy until it settles.
	 */
	const toggle = ( label, checked, onchange, help ) => {
		const id = uid();
		const helpId = help ? `${ id }-help` : null;
		const input = el( 'input', {
			type: 'checkbox',
			role: 'switch',
			id,
			class: 'etk-switch',
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
			el( 'div', { class: 'etk-settings__toggle' }, el( 'div', { class: 'etk-settings__toggle-text' }, el( 'label', { class: 'etk-settings__row-title', htmlFor: id, textContent: label } ), help ? el( 'p', { class: 'etk-manager__help', id: helpId, textContent: help } ) : null ), input )
		);
	};

	const check = ( label, checked, onchange, extra ) =>
		el( 'label', { class: 'etk-settings__check' }, el( 'input', { type: 'checkbox', class: 'etk-checkbox etk-checkbox--accent', checked, onchange: ( e ) => onchange( e.target.checked ) } ), label, extra || null );

	// A dashed drop target for one .json file, with a Choose file button.
	const dropzone = ( text, onfile ) => {
		const input = el( 'input', { type: 'file', accept: '.json,application/json', class: 'etk-sr', onchange: ( e ) => {
			const [ file ] = e.target.files;
			e.target.value = '';
			if ( file ) onfile( file );
		} } );
		const zone = el(
			'div',
			{
				class: 'etk-dropzone',
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
			el( 'span', { class: 'etk-dropzone__icon', html: icon( 'upload' ) } ),
			el( 'p', { class: 'etk-dropzone__text', textContent: text } ),
			el( 'label', { class: 'etk-settings__btn etk-settings__btn--secondary etk-settings__file-btn' }, input, 'Choose file' )
		);
		return zone;
	};

	// Save JSON as a file.
	const download = ( data, name ) => {
		const url = URL.createObjectURL( new Blob( [ typeof data === 'string' ? data : JSON.stringify( data ) ], { type: 'application/json' } ) );
		el( 'a', { href: url, download: name } ).click();
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

	// Tell screen readers what happened. Errors also show above the section.
	const announce = ( message, options ) => toolkit.announce( status, message, options );
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
			el( 'div', { class: 'etk-settings__page' }, el( 'h2', { class: 'etk-settings__page-title', tabindex: '-1', textContent: current.title } ), ...[ current.render( ui ) ].flat().filter( Boolean ) )
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
		nav.replaceChildren( ...sections.map( ( s ) => el( 'button', { type: 'button', class: 'etk-manager__nav-item', 'data-id': s.id, html: s.icon ? icon( s.icon ) : null, 'aria-current': s === current ? 'page' : null, onclick: () => show( s ) }, s.title ) ) );
	};

	const ui = { button, group, row, value, toggle, check, dropzone, download, announce, warn, refresh, builder };

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

	let settings = config.settings || { deleteData: false, layerSorting: true, componentManager: false };
	const save = async ( changes, message ) => {
		try {
			// Kept on window.etchToolkitSettings too, where features read it as it changes.
			settings = config.settings = await api( 'settings', 'POST', changes );
			window.dispatchEvent( new CustomEvent( 'etch-toolkit-settings', { detail: settings } ) );
			announce( message );
		} catch ( error ) {
			warn( errorText( error ) );
		}
		refresh();
	};

	section( {
		id: 'general',
		title: 'General',
		icon: 'settings',
		order: 0,
		render: () => [
			group(
				'Structure panel',
				toggle(
					'Enhanced layer sorting',
					settings.layerSorting,
					( on ) => save( { layerSorting: on }, on ? 'Enhanced layer sorting is on.' : 'Enhanced layer sorting is off.' ),
					'Smoother dragging, with a drop line in the panel and on the canvas.'
				)
			),
			group(
				'Components',
				toggle(
					'Component manager',
					settings.componentManager,
					( on ) => save( { componentManager: on }, on ? 'The component manager is on.' : 'The component manager is off.' ),
					'See your components and where they’re used. Update one from JSON after reviewing the changes. Opens from the Settings Bar.'
				)
			),
			group(
				{ title: 'Uninstall', note: 'Fonts and renamed classes always stay, so your site keeps working.' },
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
		status = el( 'div', { class: 'etk-manager__status', role: 'status', 'aria-live': 'polite' } );
		main = el( 'div', { class: 'etk-manager__main' } );
		nav = el( 'nav', { class: 'etk-manager__nav etk-track', 'aria-label': 'Settings' } );
		panel = el(
			builder ? 'section' : 'div',
			{
				id: 'etk-settings',
				class: `etk-manager etk-settings ${ builder ? 'etk-manager--panel' : 'etk-settings--page' }`,
				hidden: builder,
				'aria-labelledby': 'etk-settings-title',
				// In the builder, Etch's shortcuts stay out of it and Esc closes.
				...( builder ? managerKeys( () => close() ) : {} ),
			},
			el(
				'div',
				{ class: 'etk-manager__sidebar' },
				el(
					'header',
					{ class: 'etk-manager__header' },
					builder ? el( 'button', { type: 'button', class: 'etk-settings__btn etk-settings__btn--secondary etk-settings__icon-btn', 'aria-label': 'Back to the builder', title: 'Back to the builder', html: icon( 'arrow-left' ), onclick: () => close() } ) : null,
					el( 'span', { class: 'etk-settings__logo', html: `<svg viewBox="0 0 88 88" width="18" height="18" aria-hidden="true" focusable="false">${ LOGO }</svg>` } ),
					el( 'h1', { id: 'etk-settings-title', class: 'etk-manager__title', textContent: 'Etch Toolkit' } )
				),
				nav
			),
			el( 'div', { class: 'etk-manager__body' }, status, el( 'div', { class: 'etk-manager__content' }, main ) )
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
		openManager( panel );
		control?.expanded( true );
		show( current || lastSection() || sections[ 0 ] );
	};

	// focus: false when another Settings Bar button closed it, so focus stays on that one.
	const close = ( { focus = true } = {} ) => {
		if ( ! panel || panel.hidden ) return;
		panel.hidden = true;
		control?.expanded( false );
		if ( focus ) control?.focus();
	};

	/* ------------------------------------------------------------------ */
	/* Boot                                                                */
	/* ------------------------------------------------------------------ */

	// Etch draws its buttons' icons from a name. This one gets the logo drawn over it.
	const control = builder
		? settingsBarButton( {
				section: 'bottom',
				id: CONTROL_ID,
				icon: 'hugeicons:settings-02',
				tooltip: 'Etch Toolkit',
				label: 'Etch Toolkit settings',
				controls: 'etk-settings',
				className: 'etk-settings-control',
				svg: { viewBox: '0 0 88 88', paths: LOGO },
				onclick: () => ( panel && ! panel.hidden ? close() : open() ),
				onother: () => close( { focus: false } ),
		  } )
		: null;

	if ( ! builder ) {
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
