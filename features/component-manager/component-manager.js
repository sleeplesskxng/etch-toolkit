/**
 * Etch Toolkit: component manager.
 *
 * A Settings Bar control opens a manager beside the bar, like the Fonts
 * manager. Drop a JSON file or paste JSON, and it lists the components in it,
 * each matched to one on this site by key, the way Etch's paste matches them.
 *
 * It reads three shapes:
 * - Etch's copy (Cmd+C on a layer): { version, gutenbergBlock, styles,
 *   components }, where components holds each component's Gutenberg blocks.
 * - One component, or a list of them: { name, key, blocks, properties }, with
 *   blocks as Etch's layer JSON (window.etch.components.getJson()) or as
 *   Gutenberg blocks (Etch's REST API).
 *
 * Every component's blocks become Etch's layer JSON, the shape
 * window.etch.components.getJson() gives and updateAsync() takes.
 *
 * Shown while the toolkit's Component manager setting (General) is on.
 */
( () => {
	const toolkit = window.etchToolkit || {};
	if ( ! toolkit.api ) return;

	const CONTROL_ID = 'etch-toolkit-component-manager';
	// Hugeicons free git-compare.
	const CONTROL_ICON =
		'<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M19 17v-6c0-2.828 0-4.243-.879-5.121C17.243 5 15.828 5 13 5h-3m0 0c0-.7 1.994-2.008 2.5-2.5M10 5c0 .7 1.994 2.008 2.5 2.5M5 7.5v6c0 2.828 0 4.243.879 5.121c.878.879 2.293.879 5.121.879h3m0 0c0 .7-1.994 2.009-2.5 2.5m2.5-2.5c0-.7-1.994-2.009-2.5-2.5"/><circle cx="19" cy="19" r="2"/><circle cx="5" cy="5" r="2"/></g>';
	// Etch's hugeicons:arrow-left-02, the back button on its own managers.
	const BACK = '<path d="M8.99996 16.9998L4 11.9997L9 6.99976"/><path d="M4 12H20"/>';
	const UPLOAD = '<path d="M12 4.5L12 14.5M12 4.5C11.2998 4.5 9.99153 6.4943 9.5 7M12 4.5C12.7002 4.5 14.0085 6.4943 14.5 7"/><path d="M20 16.5C20 18.982 19.482 19.5 17 19.5H7C4.518 19.5 4 18.982 4 16.5"/>';
	const stroke = ( paths, size = 16 ) =>
		`<svg class="etk-components__icon" viewBox="0 0 24 24" width="${ size }" height="${ size }" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ paths }</svg>`;

	const enabled = () => window.etchToolkitSettings?.settings?.componentManager === true && typeof window.etch?.components?.updateAsync === 'function';

	// h( 'button', { class: 'x', onclick }, child, … ), like the settings screen's.
	const PROPS = new Set( [ 'value', 'checked', 'disabled', 'hidden', 'textContent', 'htmlFor' ] );
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

	const plural = ( n, one, many ) => `${ n } ${ n === 1 ? one : many }`;
	const errorText = ( error ) => error?.message || String( error );
	const isObject = ( value ) => !! value && typeof value === 'object' && ! Array.isArray( value );

	/* ------------------------------------------------------------------ */
	/* Reading JSON                                                        */
	/* ------------------------------------------------------------------ */

	// Etch saves a layer's script as base64 of its UTF-8.
	const fromBase64 = ( text ) => new TextDecoder().decode( Uint8Array.from( atob( text ), ( c ) => c.charCodeAt( 0 ) ) );
	const stringValues = ( attributes ) => ( isObject( attributes ) ? Object.fromEntries( Object.entries( attributes ).map( ( [ k, v ] ) => [ k, String( v ) ] ) ) : {} );

	/**
	 * A Gutenberg block as Etch's layer JSON, the way Etch's builder reads a
	 * saved block. Blocks Etch doesn't draw as its own pass through whole, and
	 * an empty paragraph is dropped, as Etch drops it.
	 */
	const fromGutenberg = ( block ) => {
		const attrs = isObject( block.attrs ) ? block.attrs : {};
		const context = {};
		if ( attrs.hidden ) context.hidden = true;
		if ( attrs.metadata?.name ) context.name = attrs.metadata.name;
		const base = { type: block.blockName, version: 1, context, options: isObject( attrs.options ) ? { ...attrs.options } : {}, children: [] };
		if ( typeof attrs.script?.code === 'string' ) base.script = { code: fromBase64( attrs.script.code ) };
		const children = () => fromGutenbergList( block.innerBlocks || [] );

		switch ( block.blockName ) {
			case 'etch/text':
				return { ...base, text: attrs.content || '' };
			case 'etch/element':
				return { ...base, tag: attrs.tag || 'div', attributes: stringValues( attrs.attributes ), styles: attrs.styles || [], children: children() };
			case 'etch/svg':
			case 'etch/dynamic-image':
				return { ...base, attributes: stringValues( attrs.attributes ), styles: attrs.styles || [] };
			case 'etch/dynamic-element': {
				const attributes = stringValues( attrs.attributes );
				if ( attrs.tag && ( attributes.tag ? attributes.tag !== attrs.tag : attrs.tag !== 'div' ) ) attributes.tag = attrs.tag;
				return { ...base, attributes, styles: attrs.styles || [], children: children() };
			}
			case 'etch/loop':
				return { ...base, target: attrs.target, loopId: attrs.loopId, loopParams: attrs.loopParams, itemId: attrs.itemId ?? 'item', indexId: attrs.indexId, children: children() };
			case 'etch/component':
				return { ...base, componentId: attrs.ref, attributes: isObject( attrs.attributes ) ? attrs.attributes : {}, children: children() };
			case 'etch/condition':
				return { ...base, conditionString: attrs.conditionString, children: children() };
			case 'etch/slot-content':
				return { ...base, slotName: attrs.name, children: children() };
			case 'etch/slot-placeholder':
				return { ...base, slotName: attrs.name };
			case 'etch/raw-html':
				return { ...base, content: attrs.content || '', unsafe: attrs.unsafe || '' };
		}
		if ( block.blockName === 'core/paragraph' && ! block.innerBlocks?.length && block.innerHTML?.trim() === '<p></p>' ) return null;
		return { ...base, type: 'etch/passthrough', gutenbergBlock: block };
	};
	const fromGutenbergList = ( blocks ) => blocks.filter( ( block ) => block?.blockName ).map( fromGutenberg ).filter( Boolean );

	// Blocks in either shape, as layer JSON. Etch's layer JSON has a type, Gutenberg's a blockName.
	const layerJson = ( blocks ) => {
		if ( ! Array.isArray( blocks ) ) throw new Error( 'A component’s blocks should be a list.' );
		return blocks.some( ( block ) => block?.blockName ) ? fromGutenbergList( blocks ) : blocks.filter( ( block ) => block?.type );
	};

	const readComponent = ( source, extra = {} ) => {
		if ( ! isObject( source ) || ! Array.isArray( source.blocks ) || ! ( source.key || source.name ) ) return null;
		return {
			sourceId: source.id ?? null,
			name: String( source.name || source.key ),
			key: String( source.key || '' ),
			description: String( source.description || '' ),
			properties: Array.isArray( source.properties ) ? source.properties : [],
			blocks: layerJson( source.blocks ),
			// The source site's styles and components, by their IDs there, which the blocks refer to.
			styles: isObject( extra.styles ) ? extra.styles : isObject( source.styles ) ? source.styles : {},
			components: extra.components || {},
		};
	};

	/**
	 * The components in some JSON text. Throws with a message for the manager
	 * to show when it isn't JSON or has none.
	 */
	const parse = ( text ) => {
		let data;
		try {
			data = JSON.parse( text );
		} catch {
			throw new Error( 'That isn’t valid JSON. Check it was copied whole.' );
		}

		let found = [];
		if ( isObject( data ) && ( data.gutenbergBlock || isObject( data.components ) ) ) {
			// Etch's copy. Nested components refer to each other by their IDs on the source site.
			const sources = Object.values( data.components || {} );
			const components = Object.fromEntries( sources.filter( isObject ).map( ( c ) => [ c.id, { key: c.key, name: c.name } ] ) );
			found = sources.map( ( source ) => readComponent( source, { styles: data.styles, components } ) );
			if ( ! found.length ) throw new Error( 'This JSON has layers but no components. In Etch, select a component and copy it (Cmd+C), then paste that here.' );
		} else {
			found = ( Array.isArray( data ) ? data : [ data ] ).map( ( source ) => readComponent( source ) );
		}

		found = found.filter( Boolean );
		if ( ! found.length ) throw new Error( 'No components found. Paste Etch’s copy of a component, or a component’s JSON with its key and blocks.' );
		return found;
	};

	// Each component matched to this site's by key, as Etch's paste matches them.
	const match = ( components ) => {
		const local = window.etch.components.list();
		return components.map( ( incoming ) => ( { incoming, current: local.find( ( c ) => incoming.key && c.key === incoming.key ) || null } ) );
	};

	// Layers in a tree, counted.
	const countLayers = ( blocks ) => blocks.reduce( ( n, block ) => n + 1 + countLayers( block.children || [] ), 0 );

	/* ------------------------------------------------------------------ */
	/* Views                                                               */
	/* ------------------------------------------------------------------ */

	let panel = null;
	let main = null;
	let status = null;
	let controlButton = null;
	let view = 'import';
	let pasted = '';
	let matches = [];
	let reviewing = null;
	let fileName = '';

	const announce = ( message, { error = false } = {} ) => {
		if ( ! status ) return;
		status.textContent = '';
		status.classList.toggle( 'is-error', error );
		// Cleared first so a repeated message is read again.
		window.setTimeout( () => ( status.textContent = message ), 50 );
	};
	const warn = ( message ) => announce( message, { error: true } );

	const button = ( label, onclick, { variant = 'secondary', ...attrs } = {} ) => h( 'button', { type: 'button', class: `etk-components__btn etk-components__btn--${ variant }`, onclick, ...attrs }, label );

	const read = ( text, from = '' ) => {
		try {
			matches = match( parse( text ) );
			fileName = from;
			status.textContent = '';
			status.classList.remove( 'is-error' );
			render();
			announce( `Found ${ plural( matches.length, 'component', 'components' ) }.` );
			main.querySelector( '.etk-components__found-title' )?.focus();
		} catch ( error ) {
			matches = [];
			render();
			warn( errorText( error ) );
		}
	};

	const readFile = async ( file ) => read( await file.text(), file.name );

	const dropzone = () => {
		const input = h( 'input', {
			type: 'file',
			accept: '.json,application/json',
			class: 'screen-reader-text',
			onchange: ( e ) => {
				const [ file ] = e.target.files;
				e.target.value = '';
				if ( file ) readFile( file );
			},
		} );
		const zone = h(
			'div',
			{
				class: 'etk-components__dropzone',
				ondragover: ( e ) => {
					e.preventDefault();
					zone.classList.add( 'is-over' );
				},
				ondragleave: () => zone.classList.remove( 'is-over' ),
				ondrop: ( e ) => {
					e.preventDefault();
					zone.classList.remove( 'is-over' );
					if ( e.dataTransfer.files[ 0 ] ) readFile( e.dataTransfer.files[ 0 ] );
				},
			},
			h( 'span', { class: 'etk-components__dropzone-icon', html: stroke( UPLOAD ) } ),
			h( 'p', { class: 'etk-components__dropzone-text', textContent: 'Drop a .json file here' } ),
			h( 'label', { class: 'etk-components__btn etk-components__btn--secondary etk-components__file-btn' }, input, 'Choose file' )
		);
		return zone;
	};

	const foundRow = ( { incoming, current } ) =>
		h(
			'li',
			{ class: 'etk-components__found-row' },
			h(
				'div',
				{ class: 'etk-components__found-text' },
				h( 'span', { class: 'etk-components__found-name', textContent: incoming.name } ),
				h( 'span', { class: 'etk-components__muted', textContent: current ? `Updates ${ current.name } on this site` : `Not on this site${ incoming.key ? ` (key ${ incoming.key })` : '' }` } )
			),
			current
				? button( 'Review', () => review( { incoming, current } ), { 'aria-label': `Review changes to ${ current.name }` } )
				: null
		);

	const views = {
		import: () => [
			h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: 'Update a component' } ),
			h( 'p', { class: 'etk-components__help', textContent: 'Drop in a JSON file or paste JSON: Etch’s copy of a component (select it and press Cmd+C), or a component’s JSON. You’ll see what changed before anything is saved.' } ),
			dropzone(),
			h(
				'div',
				{ class: 'etk-components__paste' },
				h( 'label', { class: 'etk-components__label', htmlFor: 'etk-components-json', textContent: 'Or paste JSON' } ),
				h( 'textarea', {
					id: 'etk-components-json',
					class: 'etk-components__textarea',
					spellcheck: 'false',
					rows: '6',
					value: pasted,
					oninput: ( e ) => ( pasted = e.target.value ),
				} ),
				h( 'div', { class: 'etk-components__actions' }, button( 'Find components', () => ( pasted.trim() ? read( pasted ) : warn( 'Paste some JSON first.' ) ), { variant: 'primary' } ) )
			),
			matches.length
				? h(
						'section',
						{ class: 'etk-components__found', 'aria-labelledby': 'etk-components-found-title' },
						h( 'h3', { id: 'etk-components-found-title', class: 'etk-components__found-title', tabindex: '-1', textContent: `${ plural( matches.length, 'component', 'components' ) } in ${ fileName || 'the JSON' }` } ),
						h( 'ul', { class: 'etk-components__found-list', role: 'list' }, matches.map( foundRow ) )
				  )
				: null,
		],

		review: () => {
			const { incoming, current } = reviewing;
			const now = window.etch.components.getJson( current.id );
			return [
				h( 'div', { class: 'etk-components__review-head' }, button( '', () => go( 'import' ), { class: 'etk-components__btn etk-components__btn--secondary etk-components__icon-btn', 'aria-label': 'Back to import', title: 'Back to import', html: stroke( BACK ) } ), h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: current.name } ) ),
				h(
					'dl',
					{ class: 'etk-components__summary' },
					h( 'dt', { textContent: 'Layers' } ),
					h( 'dd', { textContent: `${ countLayers( now.blocks ) } now, ${ countLayers( incoming.blocks ) } incoming` } ),
					h( 'dt', { textContent: 'Props' } ),
					h( 'dd', { textContent: `${ now.properties.length } now, ${ incoming.properties.length } incoming` } )
				),
			];
		},
	};

	const render = () => main && main.replaceChildren( h( 'div', { class: `etk-components__page etk-components__page--${ view }` }, ...views[ view ]() ) );

	const go = ( next ) => {
		view = next;
		render();
		main.querySelector( '.etk-components__page-title' )?.focus();
	};

	const review = ( pair ) => {
		reviewing = pair;
		go( 'review' );
	};

	/* ------------------------------------------------------------------ */
	/* Panel                                                               */
	/* ------------------------------------------------------------------ */

	const build = () => {
		status = h( 'div', { class: 'etk-components__status', role: 'status', 'aria-live': 'polite' } );
		main = h( 'div', { class: 'etk-components__main' } );
		panel = h(
			'section',
			{
				id: 'etk-components',
				class: 'etk-components',
				hidden: true,
				'aria-labelledby': 'etk-components-title',
				// Keep typing in the panel away from Etch's keyboard shortcuts. Esc closes.
				onkeydown: ( e ) => {
					e.stopPropagation();
					if ( e.key === 'Escape' && ! e.target.closest( 'dialog' ) ) {
						e.preventDefault();
						close();
					}
					// Except Cmd/Ctrl+S, which saves instead of opening the browser's Save Page.
					if ( ( e.metaKey || e.ctrlKey ) && ( e.code === 'KeyS' || e.key.toLowerCase() === 's' ) ) {
						e.preventDefault();
						window.etch?.saveAsync?.();
					}
				},
				onkeyup: ( e ) => e.stopPropagation(),
			},
			h(
				'header',
				{ class: 'etk-components__header' },
				h( 'button', { type: 'button', class: 'etk-components__btn etk-components__btn--secondary etk-components__icon-btn', 'aria-label': 'Back to the builder', title: 'Back to the builder', html: stroke( BACK ), onclick: () => close() } ),
				h( 'h1', { id: 'etk-components-title', class: 'etk-components__title', textContent: 'Component manager' } )
			),
			h( 'div', { class: 'etk-components__body' }, status, h( 'div', { class: 'etk-components__content' }, main ) )
		);
		document.body.append( panel );
	};

	const open = () => {
		if ( ! panel ) build();
		// One manager at a time, like Etch's own, so Back goes straight to the canvas.
		try {
			if ( window.etch.navigation.getCurrentPlace() !== 'builder' ) window.etch.navigation.goTo( 'builder' );
		} catch {}
		// Pinning Automatic.css's dashboard writes left and max-width onto every fixed element. Its place comes from the CSS.
		panel.removeAttribute( 'style' );
		panel.hidden = false;
		controlButton?.setAttribute( 'aria-expanded', 'true' );
		controlButton?.setAttribute( 'selected', 'true' );
		go( view );
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

	// Etch draws its buttons' icons from a name. This one gets its own swapped in after,
	// and again whenever Etch re-renders it. Compared as the browser writes it back.
	let drawn = '';
	const useIcon = () => {
		const svg = controlButton?.querySelector( 'svg' );
		if ( ! svg || svg.innerHTML === drawn ) return;
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.innerHTML = CONTROL_ICON;
		drawn = svg.innerHTML;
	};

	let listening = false;
	let added = false;
	const addControl = () => {
		const bar = window.etchControls?.builder?.settingsBar?.top;
		const section = document.querySelector( '.settings-bar__section.top' );
		if ( ! bar || ! section?.querySelector( 'button' ) ) return false;

		const before = new Set( section.querySelectorAll( 'button' ) );
		added = true;
		bar.addAfter( { id: CONTROL_ID, icon: 'hugeicons:layers-01', tooltip: 'Component manager', callback: () => ( panel && ! panel.hidden ? close() : open() ) } );

		// Etch renders the button on its next update. Label it for toggling state.
		const observer = new MutationObserver( () => {
			controlButton = [ ...section.querySelectorAll( 'button' ) ].find( ( b ) => ! before.has( b ) );
			if ( ! controlButton ) return;
			observer.disconnect();
			controlButton.setAttribute( 'aria-label', 'Component manager' );
			controlButton.setAttribute( 'aria-expanded', 'false' );
			controlButton.setAttribute( 'aria-controls', 'etk-components' );
			useIcon();
			new MutationObserver( useIcon ).observe( controlButton, { childList: true, subtree: true } );
		} );
		observer.observe( section, { childList: true, subtree: true } );

		// Opening one of Etch's own managers, or another of the toolkit's, closes this one.
		if ( ! listening ) {
			listening = true;
			document.querySelector( '.settings-bar' )?.addEventListener( 'click', ( e ) => {
				const clicked = e.target.closest( 'button, a' );
				if ( clicked && clicked !== controlButton ) close( { focus: false } );
			} );
		}
		return true;
	};

	const removeControl = () => {
		close( { focus: false } );
		window.etchControls?.builder?.settingsBar?.top?.remove( CONTROL_ID );
		controlButton = null;
		added = false;
		drawn = '';
	};

	const boot = () => {
		let tries = 0;
		const timer = window.setInterval( () => {
			if ( ! enabled() || addControl() || ++tries > 120 ) window.clearInterval( timer );
		}, 250 );
	};

	// Turned on or off in the toolkit's settings.
	window.addEventListener( 'etch-toolkit-settings', () => ( enabled() ? ! added && boot() : removeControl() ) );

	document.readyState === 'complete' ? boot() : window.addEventListener( 'load', boot );

	// For tests and other features.
	toolkit.components = { parse, match, fromGutenberg };
} )();
