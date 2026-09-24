/**
 * Etch Toolkit core: shared config, REST helper and UI for features.
 * Extends window.etchToolkit (restUrl, nonce), printed before this script.
 */
( () => {
	const toolkit = window.etchToolkit || {};
	const { restUrl, nonce } = toolkit;

	const api = ( path, method = 'GET', body ) =>
		fetch( `${ restUrl }${ path }`, {
			method,
			headers: { 'X-WP-Nonce': nonce, ...( body ? { 'Content-Type': 'application/json' } : {} ) },
			credentials: 'same-origin',
			body: body ? JSON.stringify( body ) : undefined,
		} ).then( async ( res ) => {
			const data = await res.json().catch( () => ( {} ) );
			if ( ! res.ok ) throw new Error( data.message || `Request failed (${ res.status })` );
			return data;
		} );

	// Etch's hugeicons "delete-02", as bundled in the builder.
	const DELETE_ICON =
		'<svg class="etk-confirm__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
		'<path d="M19.5 5.5L18.6139 20.121C18.5499 21.1766 17.6751 22 16.6175 22H7.38246C6.32488 22 5.4501 21.1766 5.38612 20.121L4.5 5.5"/>' +
		'<path d="M3 5.5H8M21 5.5H16M16 5.5L14.7597 2.60608C14.6022 2.2384 14.2406 2 13.8406 2H10.1594C9.75937 2 9.39783 2.2384 9.24025 2.60608L8 5.5M16 5.5H8"/>' +
		'<path d="M9.5 16.5L9.5 10.5"/><path d="M14.5 16.5L14.5 10.5"/></svg>';

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
			result,
			close,
			confirm: () => confirm.click(),
			setConfirmEnabled( enabled ) {
				if ( ! busy ) confirm.disabled = ! enabled;
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

	Object.assign( toolkit, { api, el, confirmDialog, DELETE_ICON } );
	window.etchToolkit = toolkit;
} )();
