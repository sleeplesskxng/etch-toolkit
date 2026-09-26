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

	// Etch's hugeicons "delete-02", as bundled in the builder.
	const DELETE_ICON =
		'<svg class="etk-confirm__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
		'<path d="M19.5 5.5L18.6139 20.121C18.5499 21.1766 17.6751 22 16.6175 22H7.38246C6.32488 22 5.4501 21.1766 5.38612 20.121L4.5 5.5"/>' +
		'<path d="M3 5.5H8M21 5.5H16M16 5.5L14.7597 2.60608C14.6022 2.2384 14.2406 2 13.8406 2H10.1594C9.75937 2 9.39783 2.2384 9.24025 2.60608L8 5.5M16 5.5H8"/>' +
		'<path d="M9.5 16.5L9.5 10.5"/><path d="M14.5 16.5L14.5 10.5"/></svg>';

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

	Object.assign( toolkit, { api, save, afterSave, unsaved, syncStyles, el, confirmDialog, slider, rebuild, reload, classesIn, isClassSelector, DELETE_ICON } );
	window.etchToolkit = toolkit;
} )();
