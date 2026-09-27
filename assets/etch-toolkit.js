/**
 * Etch Toolkit core: shared config, REST helpers and UI for features.
 * Extends window.etchToolkit (restRoot, restUrl, ajaxUrl, nonce), printed before this script.
 */
( () => {
	const toolkit = window.etchToolkit || {};
	const { restRoot, restUrl, ajaxUrl } = toolkit;

	// A REST URL from a base and a path with an optional query. new URL() keeps
	// plain permalinks working, where the base already has one (?rest_route=…).
	const endpoint = ( base, path ) => {
		const [ route, query = '' ] = path.split( '?' );
		const url = new URL( `${ base }${ route }`, window.location.href );
		new URLSearchParams( query ).forEach( ( value, key ) => url.searchParams.append( key, value ) );
		return url;
	};

	// A fresh REST nonce, for a builder left open longer than a nonce lasts (up to a day).
	const refreshNonce = async () => {
		try {
			const res = await fetch( `${ ajaxUrl }?action=rest-nonce`, { credentials: 'same-origin', cache: 'no-store' } );
			const nonce = res.ok ? ( await res.text() ).trim() : '';
			if ( ! /^[a-f0-9]{10}$/.test( nonce ) ) return false;
			toolkit.nonce = nonce;
			return true;
		} catch {
			return false;
		}
	};

	// JSON in and out. FormData bodies go as they are.
	const request = async ( url, method = 'GET', body, retried = false ) => {
		const form = body instanceof FormData;
		const res = await fetch( url, {
			method,
			headers: { 'X-WP-Nonce': toolkit.nonce, ...( body && ! form ? { 'Content-Type': 'application/json' } : {} ) },
			credentials: 'same-origin',
			cache: 'no-store',
			body: form ? body : body ? JSON.stringify( body ) : undefined,
		} );
		const data = await res.json().catch( () => ( {} ) );
		// WordPress refuses an expired nonce before the request runs, so it's safe to send again.
		if ( data?.code === 'rest_cookie_invalid_nonce' && ! retried ) {
			if ( await refreshNonce() ) return request( url, method, body, true );
			throw new Error( 'Your login has expired. Log in again in another tab, then try again.' );
		}
		if ( ! res.ok ) throw Object.assign( new Error( data?.message || `Request failed (${ res.status })` ), { code: data?.code, status: res.status } );
		return data;
	};

	// The toolkit's own endpoints: api( 'fonts/google?search=x' ).
	const api = ( path, method = 'GET', body ) => request( endpoint( restUrl, path ), method, body );

	const NOT_SAVED = "Your changes didn't all save, so nothing was changed. Save, then try again.";

	/*
	 * Etch's Save, for features that hold changes until then, the way Etch holds
	 * its own. afterSave( fn ) runs fn once Etch has saved, as part of its save:
	 * Etch waits for it, and shows a failure as its own error toast. unsaved( fn )
	 * adds a check for held changes, so leaving the builder asks first, as it
	 * does for Etch's.
	 */
	const afterSaves = new Set();
	const unsavedChecks = new Set();
	let committing = Promise.resolve();
	const afterSave = ( fn ) => afterSaves.add( fn );
	const unsaved = ( fn ) => unsavedChecks.add( fn );
	let hookTries = 0;
	const hook = setInterval( () => {
		const onSave = window.etchControls?.builder?.onSave;
		if ( typeof onSave === 'function' ) onSave( () => ( committing = Promise.all( [ ...afterSaves ].map( ( fn ) => fn() ) ) ) );
		if ( typeof onSave === 'function' || ++hookTries > 600 ) clearInterval( hook );
	}, 100 );
	window.addEventListener( 'beforeunload', ( event ) => {
		if ( [ ...unsavedChecks ].some( ( fn ) => fn() ) ) {
			event.preventDefault();
			event.returnValue = '';
		}
	} );

	// The server's copy of Etch's styles and global stylesheets, each keyed by ID.
	const savedStyles = () => Promise.all( [ request( endpoint( restRoot, 'etch-api/styles' ) ), request( endpoint( restRoot, 'etch-api/stylesheets' ) ) ] );

	/**
	 * Save the builder and make sure it landed, before a feature changes saved
	 * data behind Etch's back and reloads.
	 *
	 * Etch's saveAsync() resolves without saving while a save runs and for a
	 * second after one, and reports failures as toasts. So this waits for
	 * onSave, which runs once a save completes (asking again after that second),
	 * and for what features commit then, then checks the server has the
	 * builder's styles and stylesheets, which Etch saves whole.
	 */
	const save = async () => {
		const onSave = window.etchControls?.builder?.onSave;
		if ( typeof onSave === 'function' ) {
			await new Promise( ( resolve, reject ) => {
				const timers = [];
				const off = onSave( () => {
					timers.forEach( clearTimeout );
					off?.();
					resolve();
				} );
				window.etch.saveAsync();
				timers.push( setTimeout( () => window.etch.saveAsync(), 1500 ) );
				timers.push(
					setTimeout( () => {
						off?.();
						reject( new Error( NOT_SAVED ) );
					}, 20000 )
				);
			} );
		} else {
			await window.etch.saveAsync();
		}
		await committing;

		const [ styles, sheets ] = await savedStyles();
		const same = ( list, saved, keys ) =>
			list.length === Object.keys( saved ).length && list.every( ( item ) => saved[ item.id ] && keys.every( ( key ) => ( item[ key ] ?? '' ) === ( saved[ item.id ][ key ] ?? '' ) ) );
		if ( ! same( window.etch.styles.list(), styles, [ 'selector', 'css' ] ) || ! same( window.etch.stylesheets.list(), sheets, [ 'name', 'css' ] ) ) {
			throw new Error( NOT_SAVED );
		}
	};

	/**
	 * Bring the builder's styles and global stylesheets up to date with the
	 * server's, after a feature changed them there. Updating a style through
	 * Etch's API also renames its class on every element linked to it, on every
	 * page Etch has open, the way Etch's own rename does.
	 *
	 * Every change, and any from alongside(), is made at once, so Etch's undo
	 * history takes them as one step. Etch writes a stylesheet to the server
	 * as it updates it, which is waited for after.
	 */
	const syncStyles = async ( alongside = () => {} ) => {
		const [ styles, sheets ] = await savedStyles();
		for ( const style of window.etch.styles.list() ) {
			const saved = styles[ style.id ];
			if ( saved && ( saved.selector !== style.selector || ( saved.css ?? '' ) !== ( style.css ?? '' ) ) ) {
				window.etch.styles.update( style.id, { selector: saved.selector, css: saved.css ?? '' } );
			}
		}
		const writes = window.etch.stylesheets
			.list()
			.filter( ( sheet ) => sheets[ sheet.id ] && ( sheets[ sheet.id ].css ?? '' ) !== ( sheet.css ?? '' ) )
			.map( ( sheet ) => window.etch.stylesheets.updateAsync( sheet.id, { css: sheets[ sheet.id ].css ?? '' } ) );
		alongside();
		await Promise.all( writes );
	};

	// Hugeicons strokes on a 24px grid, like Etch's own, by name.
	const ICONS = {
		// Etch's hugeicons:arrow-left-02, the back button on its own managers.
		'arrow-left': '<path d="M8.99996 16.9998L4 11.9997L9 6.99976"/><path d="M4 12H20"/>',
		'chevron-left': '<path d="M15 6L9 12L15 18"/>',
		'chevron-right': '<path d="M9 6l6 6-6 6"/>',
		'chevron-down': '<path d="M6 9l6 6 6-6"/>',
		close: '<path d="M5 5L19 19"/><path d="M19 5L5 19"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
		// Etch's hugeicons:tick-02.
		tick: '<path d="M4.25 13.5L8.75 18L19.75 6"/>',
		alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/>',
		eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
		copy: '<path d="M9 15C9 12.1716 9 10.7574 9.87868 9.87868C10.7574 9 12.1716 9 15 9H16C18.8284 9 20.2426 9 21.1213 9.87868C22 10.7574 22 12.1716 22 15V16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H15C12.1716 22 10.7574 22 9.87868 21.1213C9 20.2426 9 18.8284 9 16V15Z"/><path d="M16.9999 9C16.9975 6.04291 16.9528 4.51121 16.092 3.46243C15.9258 3.25989 15.7401 3.07418 15.5376 2.90796C14.4312 2 12.7875 2 9.5 2C6.21252 2 4.56878 2 3.46243 2.90796C3.25989 3.07417 3.07418 3.25989 2.90796 3.46243C2 4.56878 2 6.21252 2 9.5C2 12.7875 2 14.4312 2.90796 15.5376C3.07417 15.7401 3.25989 15.9258 3.46243 16.092C4.51121 16.9528 6.04291 16.9975 9 16.9999"/>',
		upload: '<path d="M12 4.5L12 14.5M12 4.5C11.2998 4.5 9.99153 6.4943 9.5 7M12 4.5C12.7002 4.5 14.0085 6.4943 14.5 7"/><path d="M20 16.5C20 18.982 19.482 19.5 17 19.5H7C4.518 19.5 4 18.982 4 16.5"/>',
		// Etch's hugeicons:search-01, as on the Selectors tab.
		search: '<path d="M17.5 17.5L22 22"/><path d="M20 11C20 6.02944 15.9706 2 11 2C6.02944 2 2 6.02944 2 11C2 15.9706 6.02944 20 11 20C15.9706 20 20 15.9706 20 11Z"/>',
		// Hugeicons free arrow-up-right-01, as Etch uses for "Open in Builder".
		external: '<path d="M9 6.65s6.938-.542 7.915.435S17.35 15 17.35 15m-.85-7.5l-10 10"/>',
		// Etch's hugeicons:delete-02.
		delete: '<path d="M19.5 5.5L18.6139 20.121C18.5499 21.1766 17.6751 22 16.6175 22H7.38246C6.32488 22 5.4501 21.1766 5.38612 20.121L4.5 5.5"/><path d="M3 5.5H8M21 5.5H16M16 5.5L14.7597 2.60608C14.6022 2.2384 14.2406 2 13.8406 2H10.1594C9.75937 2 9.39783 2.2384 9.24025 2.60608L8 5.5M16 5.5H8"/><path d="M9.5 16.5L9.5 10.5"/><path d="M14.5 16.5L14.5 10.5"/>',
		// Etch's rename, on its bulk bars.
		rename: '<path d="M14 7L5.39171 15.6083C5.1354 15.8646 4.95356 16.1858 4.86564 16.5374L4 20L7.46257 19.1344C7.81424 19.0464 8.1354 18.8646 8.39171 18.6083L17 10M14 7L16.2929 4.70711C16.6834 4.31658 17.3166 4.31658 17.7071 4.70711L19.2929 6.29289C19.6834 6.68342 19.6834 7.31658 19.2929 7.70711L17 10M14 7L17 10"/><path d="M11.5 20H17.5"/>',
		// Hugeicons pencil-edit-01.
		edit: '<path d="M15.2141 5.98239L16.6158 4.58063C17.39 3.80646 18.6452 3.80646 19.4194 4.58063C20.1935 5.3548 20.1935 6.60998 19.4194 7.38415L18.0176 8.78591M15.2141 5.98239L6.98023 14.2163C5.93493 15.2616 5.41226 15.7842 5.05637 16.4211C4.70047 17.058 4.3424 18.5619 4 20C5.43809 19.6576 6.94199 19.2995 7.57889 18.9436C8.21579 18.5877 8.73844 18.0651 9.78375 17.0198L18.0176 8.78591M15.2141 5.98239L18.0176 8.78591"/><path d="M11 20H17"/>',
		grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
		list: '<path d="M4 7h16M4 12h16M4 17h16"/>',
		// Hugeicons free library, google, settings-02, text-font and cook-book, for navs.
		library: '<path d="M2 7c0-1.4 0-2.1.272-2.635a2.5 2.5 0 0 1 1.093-1.093C3.9 3 4.6 3 6 3s2.1 0 2.635.272a2.5 2.5 0 0 1 1.093 1.093C10 4.9 10 5.6 10 7v10c0 1.4 0 2.1-.272 2.635a2.5 2.5 0 0 1-1.093 1.092C8.1 21 7.4 21 6 21s-2.1 0-2.635-.273a2.5 2.5 0 0 1-1.093-1.092C2 19.1 2 18.4 2 17z"/><path d="M6.125 17H6m.25 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0m11.656-.307h-.125m.25 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0M2 7h8"/><path d="M11.449 8.268c-.355-1.33-.533-1.995-.41-2.572a2.46 2.46 0 0 1 .756-1.316c.437-.395 1.1-.573 2.424-.93c1.324-.356 1.987-.534 2.561-.411a2.44 2.44 0 0 1 1.31.76c.394.438.572 1.103.927 2.433l2.534 9.5c.355 1.33.533 1.995.41 2.572a2.46 2.46 0 0 1-.756 1.316c-.437.395-1.1.573-2.424.93c-1.324.356-1.986.534-2.561.411a2.45 2.45 0 0 1-1.31-.76c-.394-.438-.572-1.103-.927-2.433zM12 8l6.5-2"/>',
		google: '<circle cx="12" cy="12" r="10"/><path d="M12 12h5a5 5 0 1 1-1.464-3.536"/>',
		settings: '<path d="M15.5 12a3.5 3.5 0 1 1-7 0a3.5 3.5 0 0 1 7 0Z"/><path d="M21.011 14.097c.522-.141.783-.212.886-.346c.103-.135.103-.351.103-.784v-1.934c0-.433 0-.65-.103-.784s-.364-.205-.886-.345c-1.95-.526-3.171-2.565-2.668-4.503c.139-.533.208-.8.142-.956s-.256-.264-.635-.479l-1.725-.98c-.372-.21-.558-.316-.725-.294s-.356.21-.733.587c-1.459 1.455-3.873 1.455-5.333 0c-.377-.376-.565-.564-.732-.587c-.167-.022-.353.083-.725.295l-1.725.979c-.38.215-.57.323-.635.48c-.066.155.003.422.141.955c.503 1.938-.718 3.977-2.669 4.503c-.522.14-.783.21-.886.345S2 10.6 2 11.033v1.934c0 .433 0 .65.103.784s.364.205.886.346c1.95.526 3.171 2.565 2.668 4.502c-.139.533-.208.8-.142.956s.256.264.635.48l1.725.978c.372.212.558.317.725.295s.356-.21.733-.587c1.46-1.457 3.876-1.457 5.336 0c.377.376.565.564.732.587c.167.022.353-.083.726-.295l1.724-.979c.38-.215.57-.323.635-.48s-.003-.422-.141-.955c-.504-1.937.716-3.976 2.666-4.502Z"/>',
		'text-font': '<path d="m14 19l-2.893-8.252C9.763 6.916 9.092 5 8 5s-1.763 1.916-3.107 5.748L2 19m2.5-7h7m10.47 1.94v4.5m0-4.5c.046-.824.048-1.45-.05-1.963c-.234-1.206-1.494-1.933-2.714-2.081c-1.168-.142-2.104.159-3.052 1.54m5.815 2.503h-2.843c-.437 0-.878.021-1.299.138c-2.573.716-2.384 4.323.196 4.768c.287.05.58.07.87.058c.677-.03 1.302-.358 1.84-.773c.627-.486 1.236-1.165 1.236-2.19z"/>',
		'cook-book': '<path d="M21 16.929V10c0-3.771 0-5.657-1.172-6.828S16.771 2 13 2h-1C8.229 2 6.343 2 5.172 3.172S4 6.229 4 10v9.5"/><path d="M21 17H6.5a2.5 2.5 0 0 0 0 5H21"/><path d="M21 22a2.5 2.5 0 0 1 0-5"/><path d="M14.388 6.85a1.97 1.97 0 0 1 1.112-.341c1.105 0 2 .903 2 2.017c0 1.097-.904 2.014-2 2.014v.96c0 .943 0 1.414-.293 1.707s-.764.293-1.707.293h-2c-.943 0-1.414 0-1.707-.293S9.5 12.443 9.5 11.5v-.835c-1.168 0-2-.87-2-2.139c0-1.114.895-2.017 2-2.017c.412 0 .794.125 1.112.34A2 2 0 0 1 12.5 5.5c.872 0 1.614.563 1.888 1.35m0 0q.11.314.112.668"/>',
	};

	/**
	 * An icon's <svg> markup. size sets it, 16px if not given. Without it, a
	 * feature's CSS can size it from where it sits, through --etk-icon-size.
	 */
	const icon = ( name, { size, className } = {} ) =>
		`<svg class="etk-icon${ className ? ` ${ className }` : '' }" viewBox="0 0 24 24" width="${ size || 16 }" height="${ size || 16 }"${ size ? ` style="--etk-icon-size: ${ size }px"` : '' } aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ ICONS[ name ] || '' }</svg>`;

	const DELETE_ICON = icon( 'delete', { className: 'etk-confirm__icon' } );

	// A CSS identifier, escapes included. Etch writes class names with CSS.escape() when
	// special character support is on. Mirrors ETCH_TOOLKIT_CSS_IDENT in includes/helpers.php.
	const IDENT = String.raw`(?:-?(?:[_a-zA-Z]|[^\0-\x7F]|\\(?:[0-9a-fA-F]{1,6}\s?|[^\n\r\f0-9a-fA-F]))|--)(?:[\w-]|[^\0-\x7F]|\\(?:[0-9a-fA-F]{1,6}\s?|[^\n\r\f0-9a-fA-F]))*`;
	// A class selector's name, in group 1. Comments, strings and url()s match with no group 1,
	// so ".png" in a URL isn't a class. Mirrors ETCH_TOOLKIT_CLASS_PATTERN.
	const CLASS_IN_CSS = new RegExp( String.raw`/\*[^]*?\*/|"(?:[^"\\\n]|\\[^])*"|'(?:[^'\\\n]|\\[^])*'|\b[uU][rR][lL]\(\s*(?:"(?:[^"\\]|\\[^])*"|'(?:[^'\\]|\\[^])*'|[^)]*)\s*\)|\.(${ IDENT })`, 'gu' );
	const ONE_CLASS = new RegExp( String.raw`^\.(?:${ IDENT })$`, 'u' );

	// `md\:flex` => "md:flex", `\31 col` => "1col". An escape that isn't a character reads as U+FFFD.
	const unescapeCss = ( name ) =>
		name.replace( /\\(?:([0-9a-fA-F]{1,6})\s?|([^]))/gu, ( match, hex, char ) => {
			if ( char ) return char;
			const code = parseInt( hex, 16 );
			return String.fromCodePoint( code && code <= 0x10ffff && ( code < 0xd800 || code > 0xdfff ) ? code : 0xfffd );
		} );

	// The class names in a selector or CSS, unescaped, in order.
	const classesIn = ( css ) => [ ...css.matchAll( CLASS_IN_CSS ) ].filter( ( match ) => match[ 1 ] ).map( ( match ) => unescapeCss( match[ 1 ] ) );

	// A selector that is one class and nothing else, like `.card` or `.md\:flex`.
	const isClassSelector = ( selector ) => ONE_CLASS.test( selector.trim() );

	/**
	 * el( 'button', { class: 'x', onclick, 'aria-label': 'y' }, child, [ more ], … )
	 * Keys starting with "on" are listeners, the DOM properties in PROPS are set
	 * directly, everything else is an attribute, true as an empty one. `html`
	 * sets innerHTML (icons only). A null, undefined or false value or child
	 * is left out. Children can come in arrays.
	 */
	const PROPS = new Set( [ 'value', 'checked', 'disabled', 'selected', 'hidden', 'textContent', 'htmlFor', 'indeterminate' ] );
	const el = ( tag, attrs = {}, ...children ) => {
		const node = document.createElement( tag );
		for ( const [ key, value ] of Object.entries( attrs ) ) {
			if ( value === undefined || value === null || value === false ) continue;
			if ( key === 'class' || key === 'className' ) node.className = value;
			else if ( key === 'html' ) node.innerHTML = value;
			else if ( key.startsWith( 'on' ) ) node.addEventListener( key.slice( 2 ), value );
			else if ( PROPS.has( key ) ) node[ key ] = value;
			else node.setAttribute( key, value === true ? '' : value );
		}
		node.append( ...children.flat( Infinity ).filter( ( c ) => c !== null && c !== undefined && c !== false ) );
		return node;
	};

	const plural = ( n, one, many = `${ one }s` ) => `${ n } ${ n === 1 ? one : many }`;
	const errorText = ( error ) => error?.message || String( error );
	const fileSize = ( bytes ) => ( bytes < 1024 * 1024 ? `${ Math.max( 1, Math.round( bytes / 1024 ) ) } KB` : `${ ( bytes / 1024 / 1024 ).toFixed( 1 ) } MB` );

	// A class attribute's names, split the way Etch splits them: on whitespace outside {…},
	// so a dynamic part like {item.on ? 'is-on' : ''} is one name. Mirrors etch_toolkit_class_tokens().
	const classNames = ( value ) => ( typeof value === 'string' ? value.trim().split( /\s+(?![^{]*})/ ).filter( Boolean ) : [] );

	// Every element's class names on the open page, through edit( names ), which returns
	// them changed. Etch updates the elements whose names change.
	const editPageClasses = ( edit ) => {
		const walk = ( blocks ) => {
			for ( const block of blocks ) {
				const names = classNames( block.attributes?.class );
				const next = edit( names );
				if ( next.join( ' ' ) !== names.join( ' ' ) ) window.etch.blocks.update( block.id, { attributes: { class: next.join( ' ' ) || undefined } } );
				walk( block.children || [] );
			}
		};
		walk( window.etch.blocks.getTree() );
	};

	/**
	 * Etch-styled confirm on a native <dialog>, which handles focus trapping,
	 * Esc, focus return and modal semantics. Resolves true on confirm and
	 * stays open (busy) so the caller can finish, then close(), reload or fail().
	 */
	let dialogs = 0;
	const confirmDialog = ( {
		title,
		message,
		confirmLabel,
		busyLabel = 'Deleting…',
		failTitle = 'Something went wrong',
		variant = 'danger', // 'danger' | 'primary'
		form = false, // left-aligned layout for dialogs with fields
		initialFocus = null, // element to focus instead of Cancel
	} ) => {
		const danger = variant === 'danger';
		const n = ++dialogs;
		const titleEl = el( 'p', { className: 'etk-confirm__title', id: `etk-confirm-title-${ n }`, textContent: title } );
		const messageEl = el( 'div', { className: 'etk-confirm__message', id: `etk-confirm-message-${ n }` }, message );
		const cancel = el( 'button', { type: 'button', className: 'etk-confirm__btn etk-confirm__btn--cancel', textContent: 'Cancel', autofocus: ! initialFocus } );
		const confirm = el( 'button', { type: 'button', className: `etk-confirm__btn etk-confirm__btn--${ variant }` } );
		if ( danger ) confirm.innerHTML = DELETE_ICON;
		confirm.append( ` ${ confirmLabel }` );

		const header = el( 'div', { className: `etk-confirm__header${ danger ? ' etk-confirm__header--danger' : '' }` }, [ titleEl ] );
		if ( danger ) header.insertAdjacentHTML( 'afterbegin', DELETE_ICON );

		const dialog = el( 'dialog', { className: `etk-confirm${ form ? ' etk-confirm--form' : '' }` }, [
			el( 'div', { className: 'etk-confirm__panel' }, [ header, messageEl, el( 'div', { className: 'etk-confirm__actions' }, [ cancel, confirm ] ) ] ),
		] );
		dialog.setAttribute( 'aria-labelledby', titleEl.id );
		dialog.setAttribute( 'aria-describedby', messageEl.id );

		let busy = false;
		let resolveResult;
		const result = new Promise( ( resolve ) => ( resolveResult = resolve ) );

		const close = () => {
			dialog.close();
			dialog.remove();
			resolveResult( false );
		};

		cancel.addEventListener( 'click', close );
		// Keep Esc (and other keys) from reaching Etch's shortcuts behind the dialog.
		dialog.addEventListener( 'keydown', ( event ) => event.stopPropagation() );
		dialog.addEventListener( 'cancel', ( event ) => {
			event.preventDefault();
			if ( ! busy ) close();
		} );
		// Click on the backdrop (the dialog box itself, outside the panel). It has to start
		// there too, or selecting text in a field and letting go outside would close it.
		let pressedBackdrop = false;
		dialog.addEventListener( 'pointerdown', ( event ) => ( pressedBackdrop = event.target === dialog ) );
		dialog.addEventListener( 'click', ( event ) => {
			if ( event.target === dialog && pressedBackdrop && ! busy ) close();
		} );
		confirm.addEventListener( 'click', () => {
			if ( confirm.disabled ) return;
			busy = true;
			dialog.setAttribute( 'aria-busy', 'true' );
			cancel.disabled = true;
			confirm.disabled = true;
			confirm.lastChild.textContent = ` ${ busyLabel }`;
			resolveResult( true );
		} );

		document.body.append( dialog );
		dialog.showModal();
		initialFocus?.focus();

		return {
			element: dialog,
			result,
			close,
			confirm: () => confirm.click(),
			setConfirmEnabled( enabled ) {
				if ( ! busy ) confirm.disabled = ! enabled;
			},
			setConfirmLabel( label ) {
				if ( ! busy ) confirm.lastChild.textContent = ` ${ label }`;
			},
			// Swap to an error state with a single Close button.
			fail( error ) {
				busy = false;
				dialog.removeAttribute( 'aria-busy' );
				titleEl.textContent = failTitle;
				messageEl.replaceChildren( el( 'p', { textContent: error } ) );
				messageEl.setAttribute( 'role', 'alert' );
				confirm.remove();
				cancel.disabled = false;
				cancel.textContent = 'Close';
				cancel.focus();
			},
		};
	};

	// An error on the confirm dialog, with a single Close button.
	const errorDialog = ( title, message ) => confirmDialog( { title, message: [], confirmLabel: '', variant: 'primary', failTitle: title } ).fail( message );

	/**
	 * Runs update(), which replaces what's in root, and starts each new
	 * .etk-track's highlight where the old one's was, so a pick that rebuilds
	 * the view still slides. Tracks match by name and order.
	 */
	const rebuild = ( root, update ) => {
		const tracks = () => {
			const seen = {};
			return [ ...root.querySelectorAll( '.etk-track' ) ].map( ( track ) => {
				const name = track.getAttribute( 'aria-label' ) || track.querySelector( ':scope > legend' )?.textContent || '';
				seen[ name ] = ( seen[ name ] || 0 ) + 1;
				return [ `${ name } ${ seen[ name ] }`, track ];
			} );
		};
		const sides = [ 'top', 'left', 'width', 'height' ];
		const spots = new Map();
		for ( const [ key, track ] of tracks() ) {
			const highlight = getComputedStyle( track, '::before' );
			if ( parseFloat( highlight.width ) > 0 ) spots.set( key, sides.map( ( side ) => highlight[ side ] ) );
		}
		update();
		const started = tracks().filter( ( [ key ] ) => spots.has( key ) );
		for ( const [ key, track ] of started ) sides.forEach( ( side, i ) => track.style.setProperty( `--etk-track-from-${ side }`, spots.get( key )[ i ] ) );
		// Only for their first frame. A track shown again later, say in a panel that was hidden, starts in place.
		requestAnimationFrame( () => requestAnimationFrame( () => started.forEach( ( [ , track ] ) => sides.forEach( ( side ) => track.style.removeProperty( `--etk-track-from-${ side }` ) ) ) ) );
	};

	/**
	 * A slider you can press or drag anywhere on: a bordered box with the name
	 * on the left, the value on the right and a fill up to the thumb. A native
	 * range input in it keeps the keyboard and screen readers. The box handles
	 * the pointer, so all of it maps to the range: a press glides to the
	 * nearest step, a drag follows the pointer and settles on the nearest
	 * step when you let go. onchange( value ) runs as the value changes.
	 * name shows, label is spoken. text( value ) shows the value, spoken( value ) is read out.
	 */
	const slider = ( { name, label = name, min, max, step = 1, value, text = String, spoken = text, onchange = () => {} } ) => {
		const steps = Math.round( ( max - min ) / step );
		const fraction = ( v ) => ( v - min ) / ( max - min );
		const snap = ( p ) => min + Math.round( p * steps ) * step;

		const input = el( 'input', { type: 'range', className: 'etk-slider__input', min, max, step, value } );
		input.setAttribute( 'aria-label', label );
		input.setAttribute( 'aria-valuetext', spoken( value ) );
		const nameEl = el( 'span', { className: 'etk-slider__name', textContent: name } );
		const output = el( 'span', { className: 'etk-slider__value', textContent: text( value ) } );
		// A tick at each step between the ends, while they fit.
		const ticks = el(
			'span',
			{ className: 'etk-slider__ticks' },
			steps > 20
				? []
				: Array.from( { length: steps - 1 }, ( _, i ) => {
						const tick = el( 'span', { className: 'etk-slider__tick' } );
						tick.style.setProperty( '--etk-slider-at', ( i + 1 ) / steps );
						return tick;
				  } )
		);
		[ ticks, nameEl, output ].forEach( ( node ) => node.setAttribute( 'aria-hidden', 'true' ) );
		const root = el( 'div', { className: 'etk-slider' }, [ ticks, nameEl, output, input ] );

		let current = value;
		const place = ( p ) => root.style.setProperty( '--etk-slider-p', p );
		const set = ( next ) => {
			if ( next === current ) return;
			current = next;
			input.value = next;
			output.textContent = text( next );
			input.setAttribute( 'aria-valuetext', spoken( next ) );
			onchange( next );
		};
		place( fraction( value ) );

		let press = null;
		// Where x falls on the thumb's travel, 0 to 1.
		const along = ( x ) => Math.min( 1, Math.max( 0, ( x - press.start ) / press.travel ) );
		root.addEventListener( 'pointerdown', ( event ) => {
			if ( event.button !== 0 ) return;
			// No text selection, and the native input stays out of it. It still takes focus, for the keyboard.
			event.preventDefault();
			input.focus( { preventScroll: true } );
			root.setPointerCapture( event.pointerId );
			const inset = parseFloat( getComputedStyle( root ).getPropertyValue( '--etk-slider-inset' ) ) || 0;
			const start = root.getBoundingClientRect().left + root.clientLeft + inset;
			press = { id: event.pointerId, x: event.clientX, from: current, dragging: false, start, travel: root.clientWidth - 2 * inset };
			const next = snap( along( event.clientX ) );
			place( fraction( next ) );
			set( next );
		} );
		root.addEventListener( 'pointermove', ( event ) => {
			if ( event.pointerId !== press?.id ) return;
			// A few pixels first, so a press that wobbles stays a press.
			if ( ! press.dragging && Math.abs( event.clientX - press.x ) < 3 ) return;
			press.dragging = true;
			root.classList.add( 'is-dragging' );
			const p = along( event.clientX );
			place( p );
			set( snap( p ) );
		} );
		// Letting go settles on the step. A cancelled press, like a touch that became a scroll, puts the value back.
		const release = ( event ) => {
			if ( event.pointerId !== press?.id ) return;
			if ( event.type === 'pointercancel' ) set( press.from );
			press = null;
			root.classList.remove( 'is-dragging' );
			place( fraction( current ) );
		};
		root.addEventListener( 'pointerup', release );
		root.addEventListener( 'pointercancel', release );
		// Arrow keys, Page Up and Down, Home and End.
		input.addEventListener( 'input', () => {
			const next = Number( input.value );
			place( fraction( next ) );
			set( next );
		} );
		return root;
	};

	// Etch's button markup, as its bulk bars have it, so its .etch-builder-button styles apply. label is text or a node, or null for an icon alone.
	const barButton = ( label, iconName, onclick, { variant = 'transparent', className = '', size = 'm', iconSize = 14 } = {} ) =>
		el(
			'button',
			{ type: 'button', class: `etch-builder-button etch-builder-button--icon-placement-before etch-builder-button--variant-${ variant } ${ className }`, style: `--button-font-size: var(--e-font-size-${ size })`, onclick },
			el( 'div', { class: 'etk-bulk-bar__icon', html: icon( iconName, { size: iconSize, className: 'etch-icon' } ) } ),
			label ? [ ' ', label ] : null
		);

	/**
	 * The Asset Manager's bulk bar: Clear, "3 selected" and Select All, then
	 * actions (barButton()s). Built once, then shown and hidden, so CSS can
	 * animate both ways. Put scrim, then bar, in the positioned box it floats
	 * over. update( count, all ) shows it while count is above 0, with Select
	 * All until all are selected, and writes only what changed. When it hides
	 * with focus in it, focus goes to refocus()'s element.
	 */
	const bulkBar = ( { label, className = '', actions, onClear, onSelectAll, refocus = () => null } ) => {
		const number = el( 'span', { class: 'etk-bulk-bar__count-number' } );
		const selectAll = el( 'button', {
			type: 'button',
			class: 'etk-bulk-bar__select-all',
			textContent: 'Select All',
			onclick: () => {
				// It hides once everything is selected. Keep focus in the bar, not on the page behind.
				if ( document.activeElement === selectAll ) bar.querySelector( '.etk-bulk-bar__actions button:not(:disabled)' )?.focus();
				onSelectAll();
			},
		} );
		const clear = barButton( null, 'close', onClear, { variant: 'icon', className: 'etk-bulk-bar__clear', size: 's', iconSize: 12 } );
		clear.setAttribute( 'aria-label', 'Clear selection' );
		clear.title = 'Clear selection';
		const bar = el(
			'div',
			{ class: `etk-bulk-bar ${ className }`, hidden: true, role: 'group', 'aria-label': label },
			el( 'div', { class: 'etk-bulk-bar__left' }, clear, el( 'div', { class: 'etk-bulk-bar__count', role: 'status' }, number, ' ', el( 'span', { class: 'etk-bulk-bar__count-label', textContent: 'selected' } ) ), selectAll ),
			el( 'div', { class: 'etk-bulk-bar__divider' } ),
			el( 'div', { class: 'etk-bulk-bar__actions' }, actions )
		);
		const scrim = el( 'div', { class: 'etk-bulk-bar-scrim', hidden: true } );
		// Only write on change: a feature watching the DOM would take every write as news.
		const setHidden = ( node, hidden ) => node.hidden !== hidden && ( node.hidden = hidden );
		const update = ( count, all ) => {
			const show = count > 0;
			if ( ! show && bar.contains( document.activeElement ) ) refocus()?.focus();
			setHidden( bar, ! show );
			setHidden( scrim, ! show );
			if ( ! show ) return;
			if ( number.textContent !== String( count ) ) number.textContent = String( count );
			setHidden( selectAll, all );
		};
		return { bar, scrim, update };
	};

	/*
	 * onPageChange( fn, { text } ): run fn once in the next frame after the
	 * page's elements change, for features that fit themselves into Etch's UI
	 * as it redraws. text: true counts changes to text too. One observer for
	 * every feature, each fn run at most once a frame.
	 */
	const pageWatchers = [];
	const due = new Set();
	let pageFrame = 0;
	const onPageChange = ( fn, { text = false } = {} ) => {
		if ( ! pageWatchers.length ) {
			new MutationObserver( ( records ) => {
				const nodes = records.some( ( r ) => r.type === 'childList' );
				pageWatchers.forEach( ( w ) => ( w.text || nodes ) && due.add( w.fn ) );
				if ( ! due.size || pageFrame ) return;
				pageFrame = requestAnimationFrame( () => {
					pageFrame = 0;
					const run = [ ...due ];
					due.clear();
					run.forEach( ( f ) => f() );
				} );
			} ).observe( document.body, { childList: true, subtree: true, characterData: true } );
		}
		pageWatchers.push( { fn, text } );
	};

	/*
	 * Etch's right-click menus take no outside items, so features clone rows
	 * from them. onMenu( from, className, add ): when a menu opens from an
	 * element in `from` (a selector), add( menu, element ) runs, until the menu
	 * has an item with className. menuItem( menu, label, run, { className,
	 * like } ) copies a row (like, or the menu's first plain one) as label,
	 * which closes the menu and runs run.
	 */
	const MENU = '.right-click-menu__content';
	const MENU_ITEM = '.right-click-menu__item';
	const MENU_LABEL = '.right-click-menu__item-label';
	const menus = [];
	let opened = null; // { at, hits }: when the last right-click was, and what it hit for each of menus.

	const onMenu = ( from, className, add ) => {
		if ( ! menus.length ) {
			document.addEventListener(
				'contextmenu',
				( event ) => ( opened = { at: Date.now(), hits: menus.map( ( m ) => event.target.closest?.( m.from ) || null ) } ),
				true
			);
			new MutationObserver( () => {
				// Only a menu opened within the last second.
				if ( ! opened || Date.now() - opened.at > 1000 ) return;
				const menu = document.querySelector( MENU );
				if ( ! menu ) return;
				menus.forEach( ( m, i ) => opened.hits[ i ] && ! menu.querySelector( `.${ m.className }` ) && m.add( menu, opened.hits[ i ] ) );
			} ).observe( document.body, { childList: true, subtree: true } );
		}
		menus.push( { from, className, add } );
	};

	// Esc closes Etch's menu. The keyup follows, or Etch, which tracks held keys, takes
	// Esc as still held and reads the next key pressed as Esc too, deselecting the block.
	const closeMenu = ( menu ) => {
		for ( const type of [ 'keydown', 'keyup' ] ) {
			menu.dispatchEvent( new KeyboardEvent( type, { key: 'Escape', bubbles: true, cancelable: true } ) );
		}
	};

	const findMenuItem = ( menu, label ) => [ ...menu.querySelectorAll( MENU_ITEM ) ].find( ( item ) => item.querySelector( MENU_LABEL )?.textContent.trim() === label );

	const menuItem = ( menu, label, run, { className, like } = {} ) => {
		const source = like || [ ...menu.querySelectorAll( MENU_ITEM ) ].find( ( item ) => ! item.matches( '.danger, [aria-haspopup]' ) );
		if ( ! source ) return null;

		const item = source.cloneNode( true );
		item.classList.add( className );
		item.removeAttribute( 'id' );
		item.removeAttribute( 'data-highlighted' );
		item.removeAttribute( 'textvalue' );
		item.querySelector( `${ MENU_ITEM }-shortcut` )?.remove();

		// Keep the label's icon (if any), replace only its text.
		const labelEl = item.querySelector( MENU_LABEL );
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

	/*
	 * Managers: the Fonts manager, the component manager and settings, each an
	 * .etk-manager--panel beside the Settings Bar.
	 */

	/**
	 * A button in Etch's Settings Bar, added once Etch's bar is up: { section:
	 * 'top' (after Etch's) or 'bottom' (before them), id, icon (an Etch icon
	 * name), tooltip, label, controls (the panel's id), className, onclick }.
	 * svg, { paths, viewBox }, is drawn over Etch's icon, and again whenever
	 * Etch redraws it. onother() runs when another button in the bar is
	 * clicked. ready() runs once the button's added, or Etch's bar never came.
	 * While enabled() is false it isn't added. Returns { expanded( open ),
	 * focus(), add(), remove() }: add() adds it again after remove().
	 */
	const settingsBarButton = ( { section, id, icon, tooltip, label, controls, className, svg, onclick, onother = () => {}, ready = () => {}, enabled = () => true } ) => {
		let button = null;
		let added = false;
		let drawn = '';
		// Compared as the browser writes it back, or every swap would look like Etch redrawing and trigger another.
		const draw = () => {
			const node = button?.querySelector( 'svg' );
			if ( ! svg || ! node || node.innerHTML === drawn ) return;
			if ( svg.viewBox ) node.setAttribute( 'viewBox', svg.viewBox );
			node.innerHTML = svg.paths;
			drawn = node.innerHTML;
		};
		let listening = false;
		const add = () => {
			const bar = window.etchControls?.builder?.settingsBar?.[ section ];
			const box = document.querySelector( `.settings-bar__section.${ section }` );
			if ( ! bar || ! box?.querySelector( 'button' ) ) return false;

			const before = new Set( box.querySelectorAll( 'button' ) );
			bar[ section === 'top' ? 'addAfter' : 'addBefore' ]( { id, icon, tooltip, callback: onclick } );
			added = true;

			// Etch renders the button on its next update. Label it for toggling state.
			const observer = new MutationObserver( () => {
				button = [ ...box.querySelectorAll( 'button' ) ].find( ( b ) => ! before.has( b ) );
				if ( ! button ) return;
				observer.disconnect();
				button.setAttribute( 'aria-label', label );
				button.setAttribute( 'aria-expanded', 'false' );
				button.setAttribute( 'aria-controls', controls );
				if ( className ) button.classList.add( className );
				draw();
				new MutationObserver( draw ).observe( button, { childList: true, subtree: true } );
			} );
			observer.observe( box, { childList: true, subtree: true } );

			// Opening one of Etch's own managers, or another of the toolkit's, closes this one.
			if ( ! listening ) {
				listening = true;
				document.querySelector( '.settings-bar' )?.addEventListener( 'click', ( e ) => {
					const clicked = e.target.closest( 'button, a' );
					if ( clicked && clicked !== button ) onother();
				} );
			}
			return true;
		};
		const boot = () => {
			let tries = 0;
			const timer = window.setInterval( () => {
				if ( ! enabled() || add() || ++tries > 120 ) {
					window.clearInterval( timer );
					ready();
				}
			}, 250 );
		};
		document.readyState === 'complete' ? boot() : window.addEventListener( 'load', boot );

		return {
			expanded( open ) {
				button?.setAttribute( 'aria-expanded', String( open ) );
				open ? button?.setAttribute( 'selected', 'true' ) : button?.removeAttribute( 'selected' );
			},
			focus: () => button?.focus(),
			add: () => added || boot(),
			remove() {
				window.etchControls?.builder?.settingsBar?.[ section ]?.remove( id );
				button = null;
				added = false;
			},
		};
	};

	/**
	 * A manager's key handlers, for its root: typing stays away from Etch's
	 * shortcuts, Esc (outside a dialog) runs onescape, and Cmd/Ctrl+S saves
	 * instead of opening the browser's Save Page. Etch only matches a shortcut
	 * when it saw the Cmd or Ctrl press too, so this calls its save directly.
	 */
	const managerKeys = ( onescape ) => ( {
		onkeydown: ( e ) => {
			e.stopPropagation();
			if ( e.key === 'Escape' && ! e.target.closest( 'dialog' ) ) {
				// Or the Escape would also cancel a dialog onescape opens.
				e.preventDefault();
				onescape();
			}
			if ( ( e.metaKey || e.ctrlKey ) && ( e.code === 'KeyS' || e.key.toLowerCase() === 's' ) ) {
				e.preventDefault();
				window.etch?.saveAsync?.();
			}
		},
		onkeyup: ( e ) => e.stopPropagation(),
	} );

	// Show a manager's panel. One at a time, like Etch's own, so Back goes straight to the canvas.
	const openManager = ( panel ) => {
		try {
			if ( window.etch.navigation.getCurrentPlace() !== 'builder' ) window.etch.navigation.goTo( 'builder' );
		} catch {}
		// Pinning Automatic.css's dashboard writes left and max-width onto every fixed element. The panel's place comes from .etk-manager--panel.
		panel.removeAttribute( 'style' );
		panel.hidden = false;
	};

	// A search field like the Selectors tab's: Etch's magnifier, then input, a bare field. attrs go on the box.
	const searchBox = ( input, attrs = {} ) => {
		input.classList.add( 'etk-search__input' );
		return el( 'div', { ...attrs, class: `etk-search${ attrs.class ? ` ${ attrs.class }` : '' }` }, el( 'span', { class: 'etk-search__icon', html: icon( 'search', { size: 14 } ) } ), input );
	};

	// Save data as a .json file. A string goes as it is, anything else as JSON.
	const downloadJson = ( data, name ) => {
		const url = URL.createObjectURL( new Blob( [ typeof data === 'string' ? data : JSON.stringify( data ) ], { type: 'application/json' } ) );
		el( 'a', { href: url, download: name } ).click();
		// Revoking straight away can cancel the download in some browsers.
		window.setTimeout( () => URL.revokeObjectURL( url ), 60000 );
	};

	// A dashed drop target for one .json file, with a Choose file button. onfile( file ) gets it.
	const jsonDropzone = ( text, onfile ) => {
		const input = el( 'input', {
			type: 'file',
			accept: '.json,application/json',
			class: 'etk-sr',
			onchange: ( e ) => {
				const [ file ] = e.target.files;
				e.target.value = '';
				if ( file ) onfile( file );
			},
		} );
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
			el( 'label', { class: 'etk-btn etk-btn--file' }, input, 'Choose file' )
		);
		return zone;
	};

	/**
	 * Tell screen readers what happened, through a manager's status line.
	 * Confirmations are announced only, errors also show there.
	 */
	const announce = ( status, message, { error = false } = {} ) => {
		if ( ! status ) return;
		status.textContent = '';
		status.classList.toggle( 'is-error', error );
		// Cleared first so a repeated message is read again.
		window.setTimeout( () => ( status.textContent = message ), 50 );
	};

	// Etch always reopens in the builder. reload() remembers where you were (e.g. the
	// Style Manager) and goes back there once Etch's API is up.
	const PLACE_KEY = 'etk-return-place';

	const reload = () => {
		try {
			sessionStorage.setItem( PLACE_KEY, window.etch.navigation.getCurrentPlace() );
		} catch {}
		window.location.reload();
	};

	try {
		const place = sessionStorage.getItem( PLACE_KEY );
		sessionStorage.removeItem( PLACE_KEY );
		const started = Date.now();
		const tick = () => {
			const navigation = window.etch?.navigation;
			if ( ! navigation ) {
				if ( Date.now() - started < 20000 ) setTimeout( tick, 100 );
				return;
			}
			try {
				navigation.goTo( place );
			} catch {} // A place that's gone, like a disabled Asset Manager.
		};
		if ( place && place !== 'builder' ) tick();
	} catch {}

	Object.assign( toolkit, { api, save, afterSave, unsaved, syncStyles, el, plural, errorText, fileSize, classNames, editPageClasses, confirmDialog, errorDialog, slider, rebuild, barButton, bulkBar, onPageChange, onMenu, menuItem, findMenuItem, settingsBarButton, managerKeys, openManager, announce, downloadJson, jsonDropzone, searchBox, reload, classesIn, isClassSelector, ICONS, icon, DELETE_ICON } );
	window.etchToolkit = toolkit;
} )();
