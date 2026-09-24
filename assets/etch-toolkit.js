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

	/**
	 * Save the builder and make sure it landed, before a feature changes saved
	 * data behind Etch's back and reloads.
	 *
	 * Etch's saveAsync() resolves without saving while a save runs and for a
	 * second after one, and reports failures as toasts. So this waits for
	 * onSave, which runs once a save completes (asking again after that second),
	 * then checks the server has the builder's styles and stylesheets, which
	 * Etch saves whole.
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

		const [ styles, sheets ] = await Promise.all( [ request( endpoint( restRoot, 'etch-api/styles' ) ), request( endpoint( restRoot, 'etch-api/stylesheets' ) ) ] );
		const same = ( list, saved, keys ) =>
			list.length === Object.keys( saved ).length && list.every( ( item ) => saved[ item.id ] && keys.every( ( key ) => ( item[ key ] ?? '' ) === ( saved[ item.id ][ key ] ?? '' ) ) );
		if ( ! same( window.etch.styles.list(), styles, [ 'selector', 'css' ] ) || ! same( window.etch.stylesheets.list(), sheets, [ 'name', 'css' ] ) ) {
			throw new Error( NOT_SAVED );
		}
	};

	// Etch's hugeicons "delete-02", as bundled in the builder.
	const DELETE_ICON =
		'<svg class="etk-confirm__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
		'<path d="M19.5 5.5L18.6139 20.121C18.5499 21.1766 17.6751 22 16.6175 22H7.38246C6.32488 22 5.4501 21.1766 5.38612 20.121L4.5 5.5"/>' +
		'<path d="M3 5.5H8M21 5.5H16M16 5.5L14.7597 2.60608C14.6022 2.2384 14.2406 2 13.8406 2H10.1594C9.75937 2 9.39783 2.2384 9.24025 2.60608L8 5.5M16 5.5H8"/>' +
		'<path d="M9.5 16.5L9.5 10.5"/><path d="M14.5 16.5L14.5 10.5"/></svg>';

	// A class selector's name, escapes included. Etch writes class names with CSS.escape()
	// when special character support is on. Mirrors ETCH_TOOLKIT_CLASS_PATTERN in includes/helpers.php.
	const CLASS_IN_CSS = /\.((?:-?(?:[_a-zA-Z]|[^\0-\x7F]|\\(?:[0-9a-fA-F]{1,6}\s?|[^\n\r\f0-9a-fA-F]))|--)(?:[\w-]|[^\0-\x7F]|\\(?:[0-9a-fA-F]{1,6}\s?|[^\n\r\f0-9a-fA-F]))*)/gu;
	const ONE_CLASS = new RegExp( `^${ CLASS_IN_CSS.source }$`, 'u' );

	// `md\:flex` => "md:flex", `\31 col` => "1col". An escape that isn't a character reads as U+FFFD.
	const unescapeCss = ( name ) =>
		name.replace( /\\(?:([0-9a-fA-F]{1,6})\s?|([^]))/gu, ( match, hex, char ) => {
			if ( char ) return char;
			const code = parseInt( hex, 16 );
			return String.fromCodePoint( code && code <= 0x10ffff && ( code < 0xd800 || code > 0xdfff ) ? code : 0xfffd );
		} );

	// The class names in a selector or CSS, unescaped, in order.
	const classesIn = ( css ) => [ ...css.matchAll( CLASS_IN_CSS ) ].map( ( match ) => unescapeCss( match[ 1 ] ) );

	// A selector that is one class and nothing else, like `.card` or `.md\:flex`.
	const isClassSelector = ( selector ) => ONE_CLASS.test( selector.trim() );

	const el = ( tag, props = {}, children = [] ) => {
		const node = Object.assign( document.createElement( tag ), props );
		node.append( ...children );
		return node;
	};

	/**
	 * Etch-styled confirm on a native <dialog>, which handles focus trapping,
	 * Esc, focus return and modal semantics. Resolves true on confirm and
	 * stays open (busy) so the caller can finish, then close(), reload or fail().
	 */
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
		const titleEl = el( 'p', { className: 'etk-confirm__title', id: 'etk-confirm-title', textContent: title } );
		const messageEl = el( 'div', { className: 'etk-confirm__message', id: 'etk-confirm-message' }, message );
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
		// Click on the backdrop (the dialog box itself, outside the panel).
		dialog.addEventListener( 'click', ( event ) => {
			if ( event.target === dialog && ! busy ) close();
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

	Object.assign( toolkit, { api, save, el, confirmDialog, reload, classesIn, isClassSelector, DELETE_ICON } );
	window.etchToolkit = toolkit;
} )();
