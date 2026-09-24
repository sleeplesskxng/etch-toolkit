/**
 * Etch Toolkit: Fonts manager.
 *
 * A Settings Bar control (Etch's Controls API) opens a manager beside the bar,
 * like Etch's own Style Manager. Views: Library, family editor, Upload, Google
 * Fonts and Settings.
 *
 * The server owns the families and builds the CSS. After every change this
 * writes that CSS into the Etch stylesheet "Etch Toolkit Fonts" through
 * window.etch.stylesheets, so Etch's in-memory copy never goes stale and the
 * canvas updates live. It also runs once on load, to repair the stylesheet if
 * it was edited or deleted.
 *
 * Uploads that aren't WOFF2 are converted in the browser first, by google/woff2
 * compiled to WebAssembly in a worker (lib/woff2). A WOFF is unwrapped to TTF
 * with DecompressionStream before that.
 */
( () => {
	const { api, confirmDialog, DELETE_ICON } = window.etchToolkit || {};
	const config = window.etchToolkitFonts || {};
	if ( ! confirmDialog ) return;

	const CONTROL_ID = 'etch-toolkit-fonts';
	const SAMPLE = 'The quick brown fox jumps over the lazy dog';
	const WEIGHTS = [ '100', '200', '300', '400', '500', '600', '700', '800', '900' ];
	const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
	const ROLES = { heading: 'Headings', text: 'Body text' };

	// Google's primary script codes: the subset that covers each, and a sample in it.
	const SCRIPTS = {
		arab: [ 'arabic', 'مرحبا بالعالم' ],
		armn: [ 'armenian', 'Բարեւ աշխարհ' ],
		beng: [ 'bengali', 'ওহে বিশ্ব' ],
		cyrl: [ 'cyrillic', 'Съешь же ещё этих мягких французских булок' ],
		deva: [ 'devanagari', 'नमस्ते दुनिया' ],
		ethi: [ 'ethiopic', 'ሰላም ዓለም' ],
		geor: [ 'georgian', 'გამარჯობა მსოფლიო' ],
		grek: [ 'greek', 'Γειά σου κόσμε' ],
		gujr: [ 'gujarati', 'નમસ્તે દુનિયા' ],
		guru: [ 'gurmukhi', 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਦੁਨੀਆ' ],
		hang: [ 'korean', '다람쥐 헌 쳇바퀴에 타고파' ],
		hans: [ 'chinese-simplified', '天地玄黄 宇宙洪荒' ],
		hant: [ 'chinese-traditional', '天地玄黃 宇宙洪荒' ],
		hebr: [ 'hebrew', 'שלום עולם' ],
		hira: [ 'japanese', 'いろはにほへと ちりぬるを' ],
		jpan: [ 'japanese', 'いろはにほへと 色は匂へど' ],
		khmr: [ 'khmer', 'សួស្តីពិភពលោក' ],
		knda: [ 'kannada', 'ನಮಸ್ಕಾರ ಪ್ರಪಂಚ' ],
		kore: [ 'korean', '다람쥐 헌 쳇바퀴에 타고파' ],
		laoo: [ 'lao', 'ສະບາຍດີ ໂລກ' ],
		mlym: [ 'malayalam', 'ഹലോ ലോകം' ],
		mymr: [ 'myanmar', 'မင်္ဂလာပါ ကမ္ဘာ' ],
		orya: [ 'oriya', 'ନମସ୍କାର ବିଶ୍ୱ' ],
		sinh: [ 'sinhala', 'ආයුබෝවන් ලෝකය' ],
		syrc: [ 'syriac', 'ܫܠܡܐ ܥܠܡܐ' ],
		taml: [ 'tamil', 'வணக்கம் உலகம்' ],
		telu: [ 'telugu', 'హలో ప్రపంచం' ],
		thai: [ 'thai', 'สวัสดีชาวโลก' ],
		tibt: [ 'tibetan', 'བཀྲ་ཤིས་བདེ་ལེགས།' ],
	};
	// Subsets Google serves in many small slices per style, which aren't downloaded here.
	const SLICED = { japanese: 'Japanese', korean: 'Korean', 'chinese-simplified': 'Chinese', 'chinese-traditional': 'Chinese', 'chinese-hongkong': 'Chinese', emoji: 'Emoji' };
	const VIEWS = { library: 'Library', upload: 'Upload', google: 'Google Fonts', settings: 'Settings' };

	// Hugeicons strokes, 24px grid, like Etch's own.
	const ICONS = {
		close: '<path d="M5 5L19 19"/><path d="M19 5L5 19"/>',
		back: '<path d="M15 6L9 12L15 18"/>',
		// Etch's hugeicons:arrow-left-02, the back button on its own managers.
		exit: '<path d="M8.99996 16.9998L4 11.9997L9 6.99976"/><path d="M4 12H20"/>',
		copy: '<path d="M9 15C9 12.1716 9 10.7574 9.87868 9.87868C10.7574 9 12.1716 9 15 9H16C18.8284 9 20.2426 9 21.1213 9.87868C22 10.7574 22 12.1716 22 15V16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H15C12.1716 22 10.7574 22 9.87868 21.1213C9 20.2426 9 18.8284 9 16V15Z"/><path d="M16.9999 9C16.9975 6.04291 16.9528 4.51121 16.092 3.46243C15.9258 3.25989 15.7401 3.07418 15.5376 2.90796C14.4312 2 12.7875 2 9.5 2C6.21252 2 4.56878 2 3.46243 2.90796C3.25989 3.07417 3.07418 3.25989 2.90796 3.46243C2 4.56878 2 6.21252 2 9.5C2 12.7875 2 14.4312 2.90796 15.5376C3.07417 15.7401 3.25989 15.9258 3.46243 16.092C4.51121 16.9528 6.04291 16.9975 9 16.9999"/>',
		// Hugeicons free arrow-up-right-01, as Etch uses for "Open in Builder".
		external: '<path d="M9 6.65s6.938-.542 7.915.435S17.35 15 17.35 15m-.85-7.5l-10 10"/>',
		// Etch's hugeicons:tick-02.
		tick: '<path d="M4.25 13.5L8.75 18L19.75 6"/>',
		upload: '<path d="M12 4.5L12 14.5M12 4.5C11.2998 4.5 9.99153 6.4943 9.5 7M12 4.5C12.7002 4.5 14.0085 6.4943 14.5 7"/><path d="M20 16.5C20 18.982 19.482 19.5 17 19.5H7C4.518 19.5 4 18.982 4 16.5"/>',
	};

	// Hugeicons free "text-font" (MIT). Etch bundles its own, different drawing under the same
	// name, so the Settings Bar button gets these paths swapped in after Etch renders it.
	const CONTROL_ICON =
		'<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m14 19l-2.893-8.252C9.763 6.916 9.092 5 8 5s-1.763 1.916-3.107 5.748L2 19m2.5-7h7m10.47 1.94v4.5m0-4.5c.046-.824.048-1.45-.05-1.963c-.234-1.206-1.494-1.933-2.714-2.081c-1.168-.142-2.104.159-3.052 1.54m5.815 2.503h-2.843c-.437 0-.878.021-1.299.138c-2.573.716-2.384 4.323.196 4.768c.287.05.58.07.87.058c.677-.03 1.302-.358 1.84-.773c.627-.486 1.236-1.165 1.236-2.19z"/>';

	const icon = ( name ) => `<svg class="etk-fonts__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ ICONS[ name ] }</svg>`;

	/**
	 * h( 'button', { class: 'x', onclick, 'aria-label': 'y' }, child, … )
	 * Keys starting with "on" are listeners, DOM properties are set directly,
	 * everything else is an attribute. `html` sets innerHTML (icons only).
	 */
	const PROPS = new Set( [ 'value', 'checked', 'disabled', 'selected', 'hidden', 'textContent', 'htmlFor', 'indeterminate' ] );
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

	const weightLabel = ( weight ) => ( weight.includes( ' ' ) ? `Variable ${ weight.replace( ' ', '–' ) }` : `${ weight } ${ WEIGHT_NAMES[ weight ] || '' }` ).trim();
	const size = ( bytes ) => ( bytes < 1024 * 1024 ? `${ Math.max( 1, Math.round( bytes / 1024 ) ) } KB` : `${ ( bytes / 1024 / 1024 ).toFixed( 1 ) } MB` );
	const plural = ( n, one, many ) => `${ n } ${ n === 1 ? one : many }`;
	const clone = ( value ) => JSON.parse( JSON.stringify( value ) );
	const errorText = ( error ) => error?.message || String( error );

	/* ------------------------------------------------------------------ */
	/* State and sync                                                      */
	/* ------------------------------------------------------------------ */

	let state = null; // { families, files, settings, css, faces, vars }
	let view = 'library';
	let draft = null; // Family being edited: { original: name|null, family }
	let panel = null;
	let main = null;
	let status = null;
	let controlButton = null;
	let sampleText = SAMPLE;

	// Layout and preview size, remembered per viewer in the browser.
	const PREFS_KEY = 'etk-fonts-view';
	const prefs = { google: 'grid', size: null };
	try {
		Object.assign( prefs, JSON.parse( window.localStorage.getItem( PREFS_KEY ) || '{}' ) );
		// On the size slider's steps: 16 to 80 by 8.
		if ( prefs.size ) prefs.size = Math.min( 80, Math.max( 16, Math.round( ( prefs.size - 16 ) / 8 ) * 8 + 16 ) );
	} catch {}
	const savePrefs = () => {
		try {
			window.localStorage.setItem( PREFS_KEY, JSON.stringify( prefs ) );
		} catch {}
	};

	const google = { search: '', category: '', subset: '', sort: 'popularity', results: [], total: 0, categories: [], subsets: [], loading: false, loaded: false, error: '', variable: false, weight: 400, font: null, scroll: 0 };

	// For the Google preview <link> ids. The server names the CSS variables, see varOf.
	const slugOf = ( name ) =>
		name
			.normalize( 'NFKD' )
			.replace( /[\u0300-\u036f]/g, '' )
			.toLowerCase()
			.replace( /[^a-z0-9]+/g, '-' )
			.replace( /^-|-$/g, '' );
	// A saved family's CSS variable, as the stylesheet has it.
	const varOf = ( name ) => ( state.vars[ name ] ? `var(${ state.vars[ name ] })` : '' );

	// A family without Latin letters previews in its own script, unless you've typed your own text.
	const scriptOf = ( script, subsets ) => ( subsets?.includes( 'latin' ) ? '' : script );
	const sampleFor = ( script ) => ( sampleText === SAMPLE && SCRIPTS[ script ]?.[ 1 ] ) || sampleText;
	const specimen = ( className, script, style, attrs = {} ) => h( 'p', { class: className, style, 'data-script': script || '', 'aria-hidden': 'true', textContent: sampleFor( script ), ...attrs } );

	/**
	 * Tell screen readers what happened. Confirmations are announced only,
	 * errors are also shown in the header.
	 */
	const announce = ( message, { error = false } = {} ) => {
		if ( ! status ) return;
		status.textContent = '';
		status.classList.toggle( 'is-error', error );
		// Cleared first so a repeated message is read again.
		window.setTimeout( () => ( status.textContent = message ), 50 );
	};
	const warn = ( message ) => announce( message, { error: true } );

	// @font-face rules in the builder document, for specimens. The canvas gets the real stylesheet.
	const loadFaces = () => {
		let style = document.getElementById( 'etk-fonts-faces' );
		if ( ! style ) {
			style = h( 'style', { id: 'etk-fonts-faces' } );
			document.head.append( style );
		}
		style.textContent = state?.faces || '';
	};

	const etchStylesheets = () => {
		try {
			return window.etch.stylesheets;
		} catch {
			return null;
		}
	};

	/**
	 * Write the server's CSS into the "Etch Toolkit Fonts" stylesheet, creating
	 * it if it's missing. Found by the stored ID first, then by name.
	 */
	const syncStylesheet = async () => {
		const sheets = etchStylesheets();
		if ( ! sheets || ! state ) return;

		const list = sheets.list();
		const sheet = list.find( ( s ) => s.id === state.settings.stylesheetId ) || list.find( ( s ) => s.name === config.stylesheetName );
		let id = sheet?.id;

		if ( sheet ) {
			if ( sheet.css !== state.css || sheet.name !== config.stylesheetName ) {
				await sheets.updateAsync( sheet.id, { css: state.css, name: config.stylesheetName } );
			}
		} else if ( state.families.length ) {
			id = await sheets.createAsync( { name: config.stylesheetName, css: state.css, type: 'default' } );
		}

		if ( id && id !== state.settings.stylesheetId ) {
			state.settings.stylesheetId = id;
			await api( 'fonts/settings', 'POST', { stylesheetId: id } );
		}
	};

	/**
	 * Take a new state from the server, then sync the stylesheet and re-render.
	 */
	const apply = async ( next, message ) => {
		state = next;
		loadFaces();
		render();
		try {
			await syncStylesheet();
			if ( message ) announce( message );
		} catch ( error ) {
			warn( `Fonts saved, but the Etch stylesheet didn't update: ${ errorText( error ) }` );
		}
	};

	const saveFamilies = ( families, message ) => api( 'fonts/families', 'POST', { families } ).then( ( next ) => apply( next, message ) );

	/* ------------------------------------------------------------------ */
	/* WOFF2 conversion                                                    */
	/* ------------------------------------------------------------------ */

	let worker = null;
	let jobId = 0;
	const jobs = new Map();

	// Fail every waiting job and start a fresh worker next time. The upload then
	// carries on with the original file.
	const failJobs = ( message ) => {
		for ( const job of jobs.values() ) job.reject( new Error( message ) );
		jobs.clear();
		worker?.terminate();
		worker = null;
	};

	const convertToWoff2 = ( buffer ) => {
		if ( ! worker ) {
			worker = new Worker( config.workerUrl );
			worker.onmessage = ( { data } ) => {
				const job = jobs.get( data.id );
				if ( ! job ) return;
				jobs.delete( data.id );
				data.type === 'done' ? job.resolve( data.buffer ) : job.reject( new Error( data.error ) );
			};
			// A worker that can't load never answers.
			worker.onerror = () => failJobs( 'The converter didn’t load.' );
		}
		return new Promise( ( resolve, reject ) => {
			const id = ++jobId;
			const timer = window.setTimeout( () => failJobs( 'Converting took too long.' ), 60000 );
			jobs.set( id, {
				resolve: ( result ) => ( window.clearTimeout( timer ), resolve( result ) ),
				reject: ( error ) => ( window.clearTimeout( timer ), reject( error ) ),
			} );
			worker.postMessage( { id, type: 'convert', buffer }, [ buffer ] );
		} );
	};

	// Inflate one zlib stream (WOFF tables use RFC 1950 'deflate') into a sized view.
	const inflate = async ( bytes, target ) => {
		const reader = new Blob( [ bytes ] ).stream().pipeThrough( new DecompressionStream( 'deflate' ) ).getReader();
		let written = 0;
		for ( ;; ) {
			const { done, value } = await reader.read();
			if ( done ) break;
			if ( value.length > target.length - written ) {
				await reader.cancel();
				throw new Error( 'Invalid WOFF table.' );
			}
			target.set( value, written );
			written += value.length;
		}
		if ( written !== target.length ) throw new Error( 'Invalid WOFF table.' );
	};

	/**
	 * Unwrap a WOFF into the TTF/OTF inside it, so the WOFF2 encoder can read it.
	 * The directory is validated before anything is allocated.
	 */
	const woffToSfnt = async ( buffer ) => {
		const damaged = () => new Error( 'This WOFF file is damaged.' );
		const view = new DataView( buffer );
		if ( buffer.byteLength < 44 || view.getUint32( 0 ) !== 0x774f4646 || view.getUint32( 8 ) !== buffer.byteLength ) throw damaged();

		const count = view.getUint16( 12 );
		if ( ! count || count > 4095 || 44 + count * 20 > buffer.byteLength ) throw damaged();

		const entries = [];
		let total = 12 + count * 16;
		for ( let i = 0; i < count; i++ ) {
			const at = 44 + i * 20;
			const entry = { tag: view.getUint32( at ), offset: view.getUint32( at + 4 ), compLength: view.getUint32( at + 8 ), origLength: view.getUint32( at + 12 ), checksum: view.getUint32( at + 16 ) };
			if ( entry.compLength > entry.origLength || entry.offset + entry.compLength > buffer.byteLength ) throw damaged();
			total += Math.ceil( entry.origLength / 4 ) * 4;
			if ( total > 64 * 1024 * 1024 ) throw damaged();
			entries.push( entry );
		}
		entries.sort( ( a, b ) => a.tag - b.tag );

		const out = new Uint8Array( total );
		const outView = new DataView( out.buffer );
		const exponent = Math.floor( Math.log2( count ) );
		const searchRange = 2 ** exponent * 16;
		outView.setUint32( 0, view.getUint32( 4 ) );
		outView.setUint16( 4, count );
		outView.setUint16( 6, searchRange );
		outView.setUint16( 8, exponent );
		outView.setUint16( 10, count * 16 - searchRange );

		const source = new Uint8Array( buffer );
		let offset = 12 + count * 16;
		for ( const [ i, entry ] of entries.entries() ) {
			const at = 12 + i * 16;
			outView.setUint32( at, entry.tag );
			outView.setUint32( at + 4, entry.checksum );
			outView.setUint32( at + 8, offset );
			outView.setUint32( at + 12, entry.origLength );
			const target = out.subarray( offset, offset + entry.origLength );
			const slice = source.subarray( entry.offset, entry.offset + entry.compLength );
			if ( entry.compLength === entry.origLength ) target.set( slice );
			else await inflate( slice, target ).catch( () => Promise.reject( damaged() ) );
			offset += Math.ceil( entry.origLength / 4 ) * 4;
		}
		return out.buffer;
	};

	/**
	 * The file to upload: WOFF2 as is, anything else converted to WOFF2. If
	 * conversion fails the original is uploaded, which still works, just larger.
	 *
	 * @return {Promise<{file: File, note: string}>}
	 */
	const prepareUpload = async ( file ) => {
		const ext = file.name.split( '.' ).pop().toLowerCase();
		if ( ext === 'woff2' || ! [ 'ttf', 'otf', 'woff' ].includes( ext ) ) return { file, note: '' };
		if ( ext === 'woff' && typeof DecompressionStream !== 'function' ) return { file, note: 'kept as WOFF' };

		try {
			let buffer = await file.arrayBuffer();
			if ( ext === 'woff' ) buffer = await woffToSfnt( buffer );
			const woff2 = await convertToWoff2( buffer );
			const name = file.name.replace( /\.[^.]+$/, '.woff2' );
			return { file: new File( [ woff2 ], name, { type: 'font/woff2' } ), note: `converted, ${ size( file.size ) } → ${ size( woff2.byteLength ) }` };
		} catch ( error ) {
			return { file, note: `kept as ${ ext.toUpperCase() }, conversion failed` };
		}
	};

	/* ------------------------------------------------------------------ */
	/* Shared pieces                                                       */
	/* ------------------------------------------------------------------ */

	const button = ( label, onclick, { variant = 'secondary', iconName, attrs = {} } = {} ) =>
		h(
			'button',
			{ type: 'button', class: `etk-fonts__btn etk-fonts__btn--${ variant }`, onclick, ...attrs },
			iconName ? h( 'span', { html: iconName === 'delete' ? DELETE_ICON : icon( iconName ) } ) : null,
			label
		);

	const iconButton = ( label, iconName, onclick ) =>
		h( 'button', { type: 'button', class: 'etk-fonts__icon-btn', 'aria-label': label, title: label, onclick, html: icon( iconName ) } );

	const field = ( label, control, help ) => {
		const id = control.id || ( control.id = `etk-fonts-${ Math.random().toString( 36 ).slice( 2, 8 ) }` );
		const helpId = help ? `${ id }-help` : null;
		if ( helpId ) control.setAttribute( 'aria-describedby', helpId );
		return h( 'div', { class: 'etk-fonts__field' }, h( 'label', { htmlFor: id, textContent: label } ), control, help ? h( 'p', { class: 'etk-fonts__help', id: helpId, textContent: help } ) : null );
	};

	const check = ( label, checked, onchange, help ) => {
		const input = h( 'input', { type: 'checkbox', checked, onchange: ( e ) => onchange( e.target.checked ) } );
		return h( 'label', { class: 'etk-fonts__check' }, input, h( 'span', {}, label, help ? h( 'span', { class: 'etk-fonts__help', textContent: help } ) : null ) );
	};

	const select = ( options, value, onchange, attrs = {} ) =>
		h(
			'select',
			{ class: 'etk-fonts__input', onchange: ( e ) => onchange( e.target.value ), ...attrs },
			options.map( ( [ optionValue, label ] ) => h( 'option', { value: optionValue, selected: optionValue === value, textContent: label } ) )
		);

	// Shows a tick for a moment after copying. Takes the saved name, so a family
	// renamed in the editor shows its variable as it is until it's saved.
	const copyVar = ( name ) => {
		const value = varOf( name );
		if ( ! value ) return null;
		const label = `Copy ${ value }`;
		const glyph = h( 'span', { html: icon( 'copy' ) } );
		let timer = 0;
		const node = h(
			'button',
			{
				type: 'button',
				class: 'etk-fonts__var',
				title: 'Copy CSS variable',
				'aria-label': label,
				onclick: async () => {
					try {
						await navigator.clipboard.writeText( value );
					} catch {
						return warn( 'Couldn’t copy. Select the variable and copy it instead.' );
					}
					node.classList.add( 'is-copied' );
					node.setAttribute( 'aria-label', 'Copied' );
					glyph.innerHTML = icon( 'tick' );
					announce( `Copied ${ value }` );
					window.clearTimeout( timer );
					timer = window.setTimeout( () => {
						node.classList.remove( 'is-copied' );
						node.setAttribute( 'aria-label', label );
						glyph.innerHTML = icon( 'copy' );
					}, 1500 );
				},
			},
			h( 'code', { textContent: value } ),
			glyph
		);
		return node;
	};

	const section = ( title, ...children ) => h( 'section', { class: 'etk-fonts__section' }, h( 'h3', { class: 'etk-fonts__section-title', textContent: title } ), ...children );

	// Tabs already name their view, so their titles are for screen readers only.
	const pageHeader = ( title, description, ...actions ) =>
		h( 'div', { class: 'etk-fonts__page-header' }, h( 'div', {}, h( 'h2', { class: `etk-fonts__page-title${ title === VIEWS[ view ] ? ' screen-reader-text' : '' }`, tabindex: '-1', textContent: title } ), description ? h( 'p', { class: 'etk-fonts__help', textContent: description } ) : null ), actions.length ? h( 'div', { class: 'etk-fonts__actions' }, ...actions ) : null );

	/* ------------------------------------------------------------------ */
	/* Library                                                             */
	/* ------------------------------------------------------------------ */

	// Preview text, shared by the Library and Google Fonts. Empty falls back to the pangram.
	const previewInput = ( onchange ) =>
		h( 'input', {
			class: 'etk-fonts__input etk-fonts__preview',
			type: 'text',
			value: sampleText === SAMPLE ? '' : sampleText,
			placeholder: SAMPLE,
			'aria-label': 'Preview text',
			oninput: ( e ) => {
				sampleText = e.target.value || SAMPLE;
				main.querySelectorAll( '[data-script]' ).forEach( ( node ) => ( node.textContent = sampleFor( node.dataset.script ) ) );
				onchange?.();
			},
		} );

	// Rows or grid for Google Fonts, as radios styled as a segmented control.
	const layoutToggle = ( key ) =>
		h(
			'fieldset',
			{ class: 'etk-fonts__seg' },
			h( 'legend', { class: 'screen-reader-text', textContent: 'Layout' } ),
			[
				[ 'rows', 'Rows' ],
				[ 'grid', 'Grid' ],
			].map( ( [ value, label ] ) =>
				h(
					'label',
					{},
					h( 'input', {
						type: 'radio',
						name: `etk-fonts-layout-${ key }`,
						value,
						checked: prefs[ key ] === value,
						onchange: () => {
							prefs[ key ] = value;
							savePrefs();
							main.querySelector( '[data-layout]' ).dataset.layout = value;
						},
					} ),
					label
				)
			)
		);

	const renderLibrary = () => {
		const families = state.families;
		const sample = previewInput();

		if ( ! families.length ) {
			return [
				pageHeader( 'Library' ),
				h( 'div', { class: 'etk-fonts__empty' }, h( 'p', { textContent: 'No fonts yet. Upload font files or add a family from Google Fonts.' } ), h( 'div', { class: 'etk-fonts__actions' }, button( 'Upload fonts', () => go( 'upload' ), { iconName: 'upload' } ), button( 'Browse Google Fonts', () => go( 'google' ) ) ) ),
			];
		}

		return [
			pageHeader( 'Library', `${ plural( families.length, 'family', 'families' ) }. Use a family anywhere with its CSS variable.` ),
			h( 'div', { class: 'etk-fonts__toolbar' }, sample, sizeSlider() ),
			h(
				'ul',
				{ class: 'etk-fonts__families', role: 'list' },
				families.map( ( family, index ) =>
					h(
						'li',
						{ class: `etk-fonts__family${ family.enabled ? '' : ' is-disabled' }` },
						specimen( 'etk-fonts__specimen', scriptOf( family.google?.script, family.google?.subsets ), `font-family: "${ family.name }", ${ family.fallback || 'sans-serif' }` ),
						h(
							'div',
							{ class: 'etk-fonts__family-meta' },
							h( 'h3', { class: 'etk-fonts__family-name', textContent: family.name } ),
							h(
								'span',
								{ class: 'etk-fonts__muted' },
								[ plural( family.variants.length, 'file', 'files' ), family.source === 'google' ? 'Google Fonts' : 'Uploaded', family.enabled ? null : 'Disabled' ].filter( Boolean ).join( ' · ' )
							),
							family.roles.map( ( role ) => h( 'span', { class: 'etk-fonts__badge', textContent: ROLES[ role ] } ) ),
							copyVar( family.name ),
							button( 'Edit', () => edit( index ), { attrs: { 'aria-label': `Edit ${ family.name }` } } )
						)
					)
				)
			),
		];
	};

	/* ------------------------------------------------------------------ */
	/* Family editor                                                       */
	/* ------------------------------------------------------------------ */

	const edit = ( index ) => {
		draft = { original: state.families[ index ].name, family: clone( state.families[ index ] ) };
		go( 'family' );
	};

	const dirty = () => draft && JSON.stringify( draft.family ) !== JSON.stringify( state.families.find( ( f ) => f.name === draft.original ) );

	const saveDraft = async () => {
		const family = draft.family;
		family.name = family.name.trim();
		if ( ! family.name ) return warn( 'Give the family a name.' );
		if ( state.families.some( ( f ) => f.name !== draft.original && f.name.toLowerCase() === family.name.toLowerCase() ) ) return warn( `There's already a family called ${ family.name }.` );

		// A role belongs to one family, so claiming it here takes it from the others.
		const index = state.families.findIndex( ( f ) => f.name === draft.original );
		const families = state.families.map( ( f, i ) => ( i === index ? family : { ...f, roles: f.roles.filter( ( r ) => ! family.roles.includes( r ) ) } ) );
		try {
			const next = await api( 'fonts/families', 'POST', { families } );
			// Found by position: the server can clean up the name, and a save never drops or reorders families.
			const saved = next.families[ index ];
			draft = { original: saved.name, family: clone( saved ) };
			await apply( next, `Saved ${ saved.name }.` );
		} catch ( error ) {
			warn( errorText( error ) );
		}
	};

	const deleteFamily = async () => {
		const family = state.families.find( ( f ) => f.name === draft.original );
		let alsoFiles = false;
		const dialog = confirmDialog( {
			title: `Delete ${ family.name }?`,
			message: [
				h( 'p', { textContent: 'Its @font-face rules and CSS variable are removed from the stylesheet. Anything using it falls back to the next font in the stack.' } ),
				check( `Also delete its ${ plural( family.variants.length, 'font file', 'font files' ) }`, false, ( value ) => ( alsoFiles = value ) ),
			],
			confirmLabel: 'Delete',
			form: true,
		} );
		if ( ! ( await dialog.result ) ) return;

		try {
			await saveFamilies( state.families.filter( ( f ) => f !== family ) );
			if ( alsoFiles ) {
				for ( const variant of family.variants ) {
					if ( state.files.some( ( f ) => f.name === variant.file && ! f.family ) ) await api( 'fonts/files/delete', 'POST', { name: variant.file } ).then( ( next ) => ( state = next ) );
				}
			}
			dialog.close();
			draft = null;
			go( 'library' );
			announce( `Deleted ${ family.name }.` );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
		}
	};

	const uploadInto = async ( files ) => {
		await uploadFiles( files, draft.original );
		const saved = state.families.find( ( f ) => f.name === draft.original );
		// Keep unsaved edits, take the new variants.
		draft.family.variants = [ ...draft.family.variants, ...saved.variants.filter( ( v ) => ! draft.family.variants.some( ( d ) => d.file === v.file ) ) ];
		render();
	};

	/**
	 * Measure a saved family against the local font its fallback is drawn from,
	 * in this browser: width for size-adjust, then ascent, descent and line gap
	 * at that size. The overrides are divided by size-adjust because the
	 * browser scales them by it too. Mirrors ETCH_TOOLKIT_FONTS_LOCALS.
	 */
	const LOCALS = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' };
	const METRICS_TEXT = 'The quick brown fox jumps over the lazy dog. THE QUICK BROWN FOX 0123456789';
	const measureMetrics = async ( name, fallback ) => {
		const font = `400 100px "${ name }"`;
		if ( ! ( await document.fonts.load( font, METRICS_TEXT ) ).length ) throw new Error( `Save ${ name } with its files first, then try again.` );

		const local = /monospace/.test( fallback ) ? 'mono' : /(^|[\s,"'])serif/.test( fallback ) ? 'serif' : 'sans';
		const context = document.createElement( 'canvas' ).getContext( '2d' );
		context.font = font;
		const own = context.measureText( METRICS_TEXT );
		context.font = `400 100px "${ LOCALS[ local ] }"`;
		const scale = own.width / context.measureText( METRICS_TEXT ).width;

		// A block with line-height: normal is ascent + descent + line gap tall.
		const probe = h( 'div', { style: `position: absolute; visibility: hidden; font: ${ font }; line-height: normal; white-space: nowrap`, textContent: 'Hg' } );
		document.body.append( probe );
		const height = probe.getBoundingClientRect().height;
		probe.remove();

		const ascent = own.fontBoundingBoxAscent;
		const descent = own.fontBoundingBoxDescent;
		const round = ( value ) => Math.round( value * 100 ) / 100;
		return { local, size: round( scale * 100 ), ascent: round( ascent / scale ), descent: round( descent / scale ), gap: round( Math.max( 0, height - ascent - descent ) / scale ) };
	};

	const renderFamily = () => {
		const family = draft.family;
		const update = ( changes ) => {
			Object.assign( family, changes );
			renderSavebar();
		};
		const unused = state.files.filter( ( f ) => ! f.family && ! family.variants.some( ( v ) => v.file === f.name ) );
		const takenBy = ( role ) => state.families.find( ( f ) => f.name !== draft.original && f.roles.includes( role ) );

		const variants = h(
			'table',
			{ class: 'etk-fonts__table' },
			h( 'thead', {}, h( 'tr', {}, h( 'th', { scope: 'col', textContent: 'File' } ), h( 'th', { scope: 'col', textContent: 'Weight' } ), h( 'th', { scope: 'col', textContent: 'Style' } ), h( 'th', { scope: 'col' }, h( 'span', { class: 'screen-reader-text', textContent: 'Actions' } ) ) ) ),
			h(
				'tbody',
				{},
				family.variants.map( ( variant, i ) => {
					const weights = variant.weight.includes( ' ' ) ? [ variant.weight, ...WEIGHTS ] : WEIGHTS;
					return h(
						'tr',
						{},
						h( 'td', {}, h( 'span', { class: 'etk-fonts__file', textContent: variant.file } ), variant.subset ? h( 'span', { class: 'etk-fonts__muted', textContent: ` ${ variant.subset }` } ) : null ),
						h( 'td', {}, select( weights.map( ( w ) => [ w, weightLabel( w ) ] ), variant.weight, ( value ) => ( ( variant.weight = value ), renderSavebar() ), { 'aria-label': `Weight of ${ variant.file }` } ) ),
						h( 'td', {}, select( [ [ 'normal', 'Normal' ], [ 'italic', 'Italic' ] ], variant.style, ( value ) => ( ( variant.style = value ), renderSavebar() ), { 'aria-label': `Style of ${ variant.file }` } ) ),
						h(
							'td',
							{},
							h( 'button', {
								type: 'button',
								class: 'etk-fonts__icon-btn',
								'aria-label': `Remove ${ variant.file } from ${ family.name }`,
								title: 'Remove from family (keeps the file)',
								html: icon( 'close' ),
								onclick: () => {
									family.variants.splice( i, 1 );
									render();
								},
							} )
						)
					);
				} )
			)
		);

		const fileInput = h( 'input', { type: 'file', multiple: true, accept: '.woff2,.woff,.ttf,.otf', class: 'screen-reader-text', onchange: ( e ) => uploadInto( [ ...e.target.files ] ) } );

		return [
			h( 'div', { class: 'etk-fonts__crumb' }, button( 'All fonts', () => leaveFamily( 'library' ), { variant: 'ghost', iconName: 'back' } ) ),
			pageHeader( draft.original, null, copyVar( draft.original ) ),
			specimen( 'etk-fonts__specimen etk-fonts__specimen--large', scriptOf( family.google?.script, family.google?.subsets ), `font-family: "${ draft.original }", ${ family.fallback || 'sans-serif' }` ),
			section(
				'Family',
				h(
					'div',
					{ class: 'etk-fonts__grid' },
					field( 'Name', h( 'input', { class: 'etk-fonts__input', type: 'text', value: family.name, oninput: ( e ) => update( { name: e.target.value } ) } ), 'Renaming changes the CSS variable too.' ),
					field( 'Fallback fonts', h( 'input', { class: 'etk-fonts__input', type: 'text', value: family.fallback, placeholder: 'system-ui, sans-serif', oninput: ( e ) => update( { fallback: e.target.value } ) } ), 'Used while the font loads, or if it fails.' ),
					field(
						'Font display',
						select(
							[
								[ 'swap', 'swap (recommended)' ],
								[ 'fallback', 'fallback' ],
								[ 'optional', 'optional' ],
								[ 'block', 'block' ],
								[ 'auto', 'auto' ],
							],
							family.display,
							( value ) => update( { display: value } )
						)
					)
				),
				h(
					'div',
					{ class: 'etk-fonts__checks' },
					check( 'Enabled', family.enabled, ( value ) => update( { enabled: value } ), 'Disabled families keep their files but add nothing to the stylesheet.' ),
					check( 'Preload', family.preload, ( value ) => update( { preload: value } ), 'Starts downloading the regular style before the CSS asks for it. Use it for the font above the fold.' ),
					check(
						'Size-matched fallback',
						!! family.metrics,
						async ( value ) => {
							if ( ! value ) {
								delete family.metrics;
								return renderSavebar();
							}
							try {
								update( { metrics: await measureMetrics( draft.original, family.fallback ) } );
								announce( `Measured ${ draft.original }. Save to add the fallback.` );
							} catch ( error ) {
								warn( errorText( error ) );
								render();
							}
						},
						family.metrics ? `Resized ${ LOCALS[ family.metrics.local ] } to ${ family.metrics.size }%, so text doesn’t jump when the font loads.` : 'Resizes a local font like Arial to match this one, so text doesn’t jump when the font loads.'
					)
				)
			),
			section(
				'Typography tokens',
				h( 'p', { class: 'etk-fonts__help', textContent: state.acss
					? 'Automatic.css is active, so this sets its heading or text font family instead of adding it to the fonts stylesheet.'
					: 'Adds --heading-font-family or --text-font-family to the fonts stylesheet and applies it to headings or the body.' } ),
				h(
					'div',
					{ class: 'etk-fonts__checks' },
					Object.entries( ROLES ).map( ( [ role, label ] ) => {
						const other = takenBy( role );
						return check( `Use for ${ label.toLowerCase() }`, family.roles.includes( role ), ( value ) => update( { roles: value ? [ ...family.roles, role ] : family.roles.filter( ( r ) => r !== role ) } ), other ? `${ other.name } has this now.` : null );
					} )
				)
			),
			section(
				'Files',
				family.variants.length ? variants : h( 'p', { class: 'etk-fonts__muted', textContent: 'No files. Add some below.' } ),
				h(
					'div',
					{ class: 'etk-fonts__actions' },
					h( 'label', { class: 'etk-fonts__btn etk-fonts__btn--secondary etk-fonts__file-btn' }, fileInput, h( 'span', { html: icon( 'upload' ) } ), 'Upload files' ),
					unused.length
						? select(
								[ [ '', 'Add an existing file…' ], ...unused.map( ( f ) => [ f.name, f.name ] ) ],
								'',
								( name ) => {
									const file = unused.find( ( f ) => f.name === name );
									if ( ! file ) return;
									family.variants.push( { file: file.name, weight: file.weight, style: file.style } );
									render();
								},
								{ 'aria-label': 'Add an existing file' }
						  )
						: null,
					family.source === 'google' ? button( 'Change styles…', () => installDialog( family.name ) ) : null
				)
			),
			h( 'div', { class: 'etk-fonts__danger-zone' }, button( 'Delete family', deleteFamily, { variant: 'danger', iconName: 'delete' } ) ),
		];
	};

	// Leaving the editor with unsaved changes asks first.
	const leaveFamily = async ( next ) => {
		if ( dirty() ) {
			const dialog = confirmDialog( { title: 'Discard changes?', message: [ h( 'p', { textContent: `Your changes to ${ draft.original } haven't been saved.` } ) ], confirmLabel: 'Discard' } );
			if ( ! ( await dialog.result ) ) return false;
			dialog.close();
		}
		draft = null;
		go( next );
		return true;
	};

	let savebar = null;
	const renderSavebar = () => {
		if ( ! savebar ) return;
		const show = view === 'family' && dirty();
		// Saving or discarding hides the bar under focus, so focus goes to the page title.
		if ( ! show && savebar.contains( document.activeElement ) ) panel.querySelector( '.etk-fonts__page-title' )?.focus();
		savebar.hidden = ! show;
	};

	/* ------------------------------------------------------------------ */
	/* Upload                                                              */
	/* ------------------------------------------------------------------ */

	let uploadLog = [];

	/**
	 * Convert and upload files one by one. Each lands in the named family, or
	 * a family named after the file.
	 */
	const uploadFiles = async ( files, family = '' ) => {
		const fonts = files.filter( ( f ) => /\.(woff2?|ttf|otf)$/i.test( f.name ) );
		if ( ! fonts.length ) return warn( 'Choose WOFF2, WOFF, TTF or OTF files.' );

		uploadLog = fonts.map( ( f ) => ( { name: f.name, text: 'Waiting' } ) );
		renderLog();
		let next = null;
		let added = 0;

		for ( const [ i, original ] of fonts.entries() ) {
			const entry = uploadLog[ i ];
			try {
				entry.text = 'Converting…';
				renderLog();
				const { file, note } = await prepareUpload( original );
				entry.text = 'Uploading…';
				renderLog();
				const body = new FormData();
				body.append( 'file', file );
				if ( family ) body.append( 'family', family );
				next = await api( 'fonts/upload', 'POST', body );
				entry.text = [ `Added to ${ next.uploaded.family }`, note ].filter( Boolean ).join( ', ' );
				entry.ok = true;
				added++;
			} catch ( error ) {
				entry.text = errorText( error );
				entry.error = true;
			}
			renderLog();
		}

		if ( next ) await apply( next, `Uploaded ${ plural( added, 'file', 'files' ) }.` );
		else warn( 'Nothing was uploaded.' );
	};

	const renderLog = () => {
		const log = panel?.querySelector( '.etk-fonts__log' );
		if ( ! log ) return;
		log.replaceChildren( ...uploadLog.map( ( entry ) => h( 'li', { class: entry.error ? 'is-error' : entry.ok ? 'is-ok' : '' }, h( 'span', { class: 'etk-fonts__file', textContent: entry.name } ), h( 'span', { class: 'etk-fonts__muted', textContent: entry.text } ) ) ) );
	};

	const adopt = async ( file, familyName ) => {
		const families = clone( state.families );
		let family = families.find( ( f ) => f.name === familyName );
		if ( ! family ) {
			family = { name: familyName, source: 'upload', variants: [], fallback: '', display: 'swap', preload: false, enabled: true, roles: [] };
			families.push( family );
		}
		family.variants.push( { file: file.name, weight: file.weight, style: file.style } );
		await saveFamilies( families, `Added ${ file.name } to ${ familyName }.` ).catch( ( error ) => warn( errorText( error ) ) );
	};

	const renderUpload = () => {
		const input = h( 'input', { type: 'file', multiple: true, accept: '.woff2,.woff,.ttf,.otf', class: 'screen-reader-text', onchange: ( e ) => uploadFiles( [ ...e.target.files ] ) } );
		const drop = h(
			'label',
			{
				class: 'etk-fonts__drop',
				ondragover: ( e ) => {
					e.preventDefault();
					drop.classList.add( 'is-over' );
				},
				ondragleave: () => drop.classList.remove( 'is-over' ),
				ondrop: ( e ) => {
					e.preventDefault();
					drop.classList.remove( 'is-over' );
					uploadFiles( [ ...e.dataTransfer.files ] );
				},
			},
			input,
			h( 'span', { html: icon( 'upload' ) } ),
			h( 'strong', { textContent: 'Drop font files here, or choose files' } ),
			h( 'span', { class: 'etk-fonts__muted', textContent: 'WOFF2, WOFF, TTF or OTF. Anything but WOFF2 is converted to WOFF2 in your browser first. Files are grouped into families by name, like Inter-BoldItalic.woff2.' } )
		);

		const unused = state.files.filter( ( f ) => ! f.family );
		const familyNames = state.families.map( ( f ) => f.name );

		return [
			pageHeader( 'Upload', null ),
			drop,
			h( 'ul', { class: 'etk-fonts__log', role: 'list', 'aria-live': 'polite' } ),
			section(
				`Font files (${ state.files.length })`,
				state.files.length
					? h(
							'table',
							{ class: 'etk-fonts__table' },
							h( 'thead', {}, h( 'tr', {}, h( 'th', { scope: 'col', textContent: 'File' } ), h( 'th', { scope: 'col', textContent: 'Size' } ), h( 'th', { scope: 'col', textContent: 'Family' } ), h( 'th', { scope: 'col' }, h( 'span', { class: 'screen-reader-text', textContent: 'Actions' } ) ) ) ),
							h(
								'tbody',
								{},
								state.files.map( ( file ) =>
									h(
										'tr',
										{},
										h( 'td', {}, h( 'span', { class: 'etk-fonts__file', textContent: file.name } ) ),
										h( 'td', { class: 'etk-fonts__muted', textContent: size( file.size ) } ),
										h(
											'td',
											{},
											file.family
												? file.family
												: select(
														[ [ '', 'Not used. Add to…' ], ...familyNames.map( ( n ) => [ n, n ] ), [ '__new', 'New family…' ] ],
														'',
														( value ) => {
															if ( value === '__new' ) {
																const name = window.prompt( 'Family name', file.name.replace( /[-_].*$|\.[^.]+$/g, '' ) );
																if ( name?.trim() ) adopt( file, name.trim() );
															} else if ( value ) adopt( file, value );
														},
														{ 'aria-label': `Add ${ file.name } to a family` }
												  )
										),
										h(
											'td',
											{},
											file.family
												? null
												: h( 'button', {
														type: 'button',
														class: 'etk-fonts__icon-btn etk-fonts__icon-btn--danger',
														'aria-label': `Delete ${ file.name }`,
														title: 'Delete file',
														html: DELETE_ICON,
														onclick: () => deleteFile( file ),
												  } )
										)
									)
								)
							)
					  )
					: h( 'p', { class: 'etk-fonts__muted', textContent: 'The fonts folder is empty.' } ),
				unused.length ? h( 'p', { class: 'etk-fonts__help', textContent: `${ plural( unused.length, 'file isn’t', 'files aren’t' ) } used by any family.` } ) : null
			),
		];
	};

	const deleteFile = async ( file ) => {
		const dialog = confirmDialog( { title: `Delete ${ file.name }?`, message: [ h( 'p', { textContent: 'The file is removed from the fonts folder. This can’t be undone.' } ) ], confirmLabel: 'Delete' } );
		if ( ! ( await dialog.result ) ) return;
		try {
			const next = await api( 'fonts/files/delete', 'POST', { name: file.name } );
			// Closed before the list re-renders, so focus is back in the list to be kept.
			dialog.close();
			await apply( next, `Deleted ${ file.name }.` );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
		}
	};

	/* ------------------------------------------------------------------ */
	/* Google Fonts                                                        */
	/* ------------------------------------------------------------------ */

	let searchTimer = 0;
	// Each search or Load more is numbered. Only the latest one's response counts, however late the others land.
	let searchId = 0;
	const searchGoogle = async ( more = false ) => {
		const id = ++searchId;
		google.loading = true;
		google.error = '';
		if ( ! more ) google.results = [];
		renderGoogleResults();
		try {
			const params = new URLSearchParams( { search: google.search, category: google.category, subset: google.subset, sort: google.sort, variable: google.variable ? 1 : '', offset: more ? google.results.length : 0 } );
			const data = await api( `fonts/google?${ params }` );
			if ( id !== searchId ) return;
			Object.assign( google, { results: [ ...google.results, ...data.results ], total: data.total, categories: data.categories, subsets: data.subsets } );
			loadGooglePreviews( data.results );
		} catch ( error ) {
			if ( id !== searchId ) return;
			google.error = errorText( error );
		}
		google.loading = false;
		keepFocus( () => {
			// The first response brings the category and language lists.
			if ( ! google.loaded && google.categories.length ) {
				google.loaded = true;
				panel?.querySelectorAll( '[data-filter]' ).forEach( ( node ) => node.replaceWith( googleFilter( node.dataset.filter ) ) );
			}
			renderGoogleResults();
		} );
	};

	/**
	 * Specimens load from Google's CSS API, in the builder only, and ask for
	 * just the letters in the preview text and the family name, which the add
	 * dialog shows in the font. A variable family loads its whole
	 * weight range once. A static one loads the weight nearest the slider,
	 * since asking for a weight it doesn't have is an error.
	 */
	const googleCss = ( font, spec ) => `https://fonts.googleapis.com/css2?family=${ encodeURIComponent( font.family ) }${ spec }&text=${ encodeURIComponent( [ ...new Set( sampleFor( scriptOf( font.script, font.subsets ) ) + font.family ) ].join( '' ) ) }&display=swap`;

	const nearestWeight = ( font, weight ) => {
		const weights = font.cuts.filter( ( c ) => ! c.endsWith( 'i' ) ).map( Number );
		return weights.length ? weights.reduce( ( a, b ) => ( Math.abs( b - weight ) < Math.abs( a - weight ) ? b : a ) ) : null;
	};

	const useStylesheet = ( id, href ) => {
		const link = document.getElementById( id );
		if ( ! link ) document.head.append( h( 'link', { id, rel: 'stylesheet', href } ) );
		else if ( link.href !== href ) link.href = href;
	};

	const loadGooglePreviews = ( fonts ) => {
		for ( const font of fonts ) {
			const weight = nearestWeight( font, google.weight );
			const spec = font.wght?.min ? `:wght@${ font.wght.min }..${ font.wght.max }` : weight ? `:wght@${ weight }` : '';
			useStylesheet( `etk-gf-${ slugOf( font.family ) }`, googleCss( font, spec ) );
		}
	};

	let previewTimer = 0;
	const reloadGooglePreviews = () => {
		window.clearTimeout( previewTimer );
		previewTimer = window.setTimeout( () => ( view === 'google-font' ? loadGoogleFont() : loadGooglePreviews( google.results ) ), 400 );
	};

	// Every style of the open family, for its detail screen.
	const loadGoogleFont = () => {
		const font = google.font;
		const italic = font.cuts.some( ( c ) => c.endsWith( 'i' ) );
		const range = font.wght?.min ? `${ font.wght.min }..${ font.wght.max }` : null;
		const tuples = font.cuts.map( ( c ) => [ c.endsWith( 'i' ) ? 1 : 0, parseInt( c, 10 ) ] ).sort( ( a, b ) => a[ 0 ] - b[ 0 ] || a[ 1 ] - b[ 1 ] );
		const spec = range ? ( italic ? `:ital,wght@0,${ range };1,${ range }` : `:wght@${ range }` ) : `:ital,wght@${ tuples.map( ( t ) => t.join( ',' ) ).join( ';' ) }`;
		useStylesheet( 'etk-gf-detail', googleCss( font, spec ) );
	};

	/**
	 * A native range input, styled, with nine notches: one per step from min.
	 * CSS reads --v (1-9) for the fill and notches.
	 */
	const notchedSlider = ( { name, label, min, step, value, text, spoken, onchange } ) => {
		const output = h( 'output', { class: 'etk-fonts__muted', textContent: text( value ) } );
		const range = h(
			'span',
			{ class: 'etk-range', style: `--v: ${ ( value - min ) / step + 1 }` },
			h( 'input', {
				type: 'range',
				min: String( min ),
				max: String( min + step * 8 ),
				step: String( step ),
				value: String( value ),
				'aria-label': label,
				'aria-valuetext': spoken( value ),
				oninput: ( e ) => {
					const next = Number( e.target.value );
					output.textContent = text( next );
					e.target.setAttribute( 'aria-valuetext', spoken( next ) );
					range.style.setProperty( '--v', ( next - min ) / step + 1 );
					onchange( next );
				},
			} ),
			h( 'span', { class: 'etk-range__notches', 'aria-hidden': 'true' }, WEIGHTS.map( ( w, i ) => h( 'span', { style: `--t: ${ i + 1 }` } ) ) )
		);
		return h( 'div', { class: 'etk-fonts__slider' }, h( 'span', { 'aria-hidden': 'true', textContent: name } ), range, output );
	};

	const weightSlider = () =>
		notchedSlider( {
			name: 'Weight',
			label: 'Preview weight',
			min: 100,
			step: 100,
			value: google.weight,
			text: ( value ) => weightLabel( String( value ) ),
			spoken: ( value ) => weightLabel( String( value ) ),
			onchange: ( value ) => {
				google.weight = value;
				main.querySelectorAll( '.etk-fonts__card-specimen' ).forEach( ( node ) => ( node.style.fontWeight = value ) );
				reloadGooglePreviews();
			},
		} );

	// Each list starts at its own size until you pick one, then they all share it.
	const SIZE_DEFAULT = { library: 32, google: 40, 'google-font': 40 };
	const sizeSlider = () =>
		notchedSlider( {
			name: 'Size',
			label: 'Preview size',
			min: 16,
			step: 8,
			value: prefs.size ?? SIZE_DEFAULT[ view ],
			text: ( value ) => `${ value }px`,
			spoken: ( value ) => `${ value } pixels`,
			onchange: ( value ) => {
				prefs.size = value;
				savePrefs();
				main.style.setProperty( '--etk-fonts-size', `${ value }px` );
			},
		} );

	const openGoogleFont = ( font ) => {
		google.font = font;
		google.scroll = panel.querySelector( '.etk-fonts__content' ).scrollTop;
		loadGoogleFont();
		go( 'google-font' );
	};

	// Back to the results where you left them, focus on the family you opened.
	const closeGoogleFont = () => {
		const family = google.font.family;
		view = 'google';
		render();
		panel.querySelector( '.etk-fonts__content' ).scrollTop = google.scroll;
		[ ...panel.querySelectorAll( '.etk-fonts__card-view' ) ].find( ( b ) => b.dataset.family === family )?.focus( { preventScroll: true } );
	};

	const addButton = ( font ) => {
		const have = installed( font.family );
		return have
			? button( 'Installed', () => edit( state.families.indexOf( have ) ), { variant: 'ghost', attrs: { 'aria-label': `${ font.family } is installed. Edit it` } } )
			: button( 'Add', () => installDialog( font.family, font ), { attrs: { 'aria-label': `Add ${ font.family }` } } );
	};

	const fontSummary = ( font ) => [ font.category.replace( /\b\w/g, ( c ) => c.toUpperCase() ), plural( font.cuts.length, 'style', 'styles' ), font.wght?.min ? 'variable' : null ].filter( Boolean ).join( ' · ' );

	const installed = ( name ) => state.families.find( ( f ) => f.name.toLowerCase() === name.toLowerCase() );

	const renderGoogleResults = () => {
		const list = panel?.querySelector( '.etk-fonts__google-results' );
		if ( ! list ) return;
		const summary = panel.querySelector( '.etk-fonts__google-summary' );
		summary.textContent = google.error || ( google.loading && ! google.results.length ? 'Loading…' : `${ google.total.toLocaleString() } families` );

		list.replaceChildren(
			...google.results.map( ( font ) => {
				return h(
					'li',
					{ class: 'etk-fonts__card' },
					// View is the keyboard target. The specimen is a larger click target for the same thing.
					specimen( 'etk-fonts__card-specimen', scriptOf( font.script, font.subsets ), `font-family: "${ font.family }", ${ font.category === 'serif' ? 'serif' : 'sans-serif' }; font-weight: ${ google.weight }`, { onclick: () => openGoogleFont( font ) } ),
					h(
						'div',
						{ class: 'etk-fonts__card-meta' },
						h( 'h3', { class: 'etk-fonts__family-name', textContent: font.family } ),
						h( 'span', { class: 'etk-fonts__muted', textContent: fontSummary( font ) } )
					),
					h(
						'div',
						{ class: 'etk-fonts__actions' },
						addButton( font ),
						button( 'View', () => openGoogleFont( font ), { attrs: { class: 'etk-fonts__btn etk-fonts__btn--ghost etk-fonts__card-view', 'data-family': font.family, 'aria-label': `View ${ font.family }` } } )
					)
				);
			} )
		);

		const more = panel.querySelector( '.etk-fonts__more' );
		more.hidden = google.results.length >= google.total || ! google.results.length;
		// Not disabled, which would drop focus to <body> while it loads.
		more.setAttribute( 'aria-disabled', String( google.loading ) );
	};

	/**
	 * Choose subsets and styles, then install. Reinstalling starts from what's
	 * installed and replaces the family's files.
	 */
	let lookingUp = false; // "Change styles…" finds the family first. Clicks meanwhile would open more dialogs.
	const installDialog = async ( name, meta ) => {
		if ( ! meta ) {
			if ( lookingUp ) return;
			lookingUp = true;
			const data = await api( `fonts/google?${ new URLSearchParams( { search: name } ) }` ).catch( () => null );
			lookingUp = false;
			meta = data?.results.find( ( f ) => f.family.toLowerCase() === name.toLowerCase() );
			if ( ! meta ) return warn( `Couldn't find ${ name } on Google Fonts.` );
		}

		const current = installed( meta.family );
		const hasItalic = meta.cuts.some( ( c ) => c.endsWith( 'i' ) );
		const canVary = !! meta.wght?.min;
		const offered = meta.subsets.filter( ( s ) => ! SLICED[ s ] );
		const sliced = [ ...new Set( meta.subsets.filter( ( s ) => SLICED[ s ] ).map( ( s ) => SLICED[ s ] ) ) ];
		// A font with no subsets at all comes as one file. One with only sliced subsets can't be added.
		const addable = offered.length > 0 || ! sliced.length;
		const choice = {
			subsets: new Set( ( current?.google?.subsets || [ 'latin', SCRIPTS[ meta.script ]?.[ 0 ] ] ).filter( ( s ) => offered.includes( s ) ) ),
			variable: current ? !! current.google?.variable : canVary,
			italic: current ? current.variants.some( ( v ) => v.style === 'italic' ) : false,
			cuts: new Set( current && ! current.google?.variable ? current.variants.map( ( v ) => v.weight + ( v.style === 'italic' ? 'i' : '' ) ) : [ '400', '700' ].filter( ( c ) => meta.cuts.includes( c ) ) ),
		};
		if ( ! choice.subsets.size && offered.length ) choice.subsets.add( offered[ 0 ] );
		if ( ! choice.cuts.size ) choice.cuts.add( meta.cuts[ 0 ] );
		const ready = () => addable && ( ! offered.length || choice.subsets.size > 0 ) && ( choice.variable || choice.cuts.size > 0 );

		const cutsBox = h( 'fieldset', { class: 'etk-fonts__fieldset' } );
		const renderCuts = () => {
			cutsBox.replaceChildren(
				h( 'legend', { textContent: 'Styles' } ),
				choice.variable
					? hasItalic
						? check( 'Include italics', choice.italic, ( value ) => ( choice.italic = value ) )
						: h( 'p', { class: 'etk-fonts__help', textContent: `One file per subset covers weights ${ meta.wght.min }–${ meta.wght.max }.` } )
					: h(
							'div',
							{ class: 'etk-fonts__cuts' },
							meta.cuts.map( ( cut ) =>
								check( `${ weightLabel( cut.replace( 'i', '' ) ) }${ cut.endsWith( 'i' ) ? ' Italic' : '' }`, choice.cuts.has( cut ), ( value ) => {
									value ? choice.cuts.add( cut ) : choice.cuts.delete( cut );
									dialog.setConfirmEnabled( ready() );
								} )
							)
					  )
			);
		};
		renderCuts();

		const dialog = confirmDialog( {
			title: current ? `Change ${ meta.family } styles` : `Add ${ meta.family }`,
			message: [
				h( 'p', { class: 'etk-fonts__dialog-specimen', style: `font-family: "${ meta.family }"`, textContent: meta.family } ),
				offered.length
					? h(
							'fieldset',
							{ class: 'etk-fonts__fieldset' },
							h( 'legend', { textContent: 'Subsets' } ),
							h(
								'div',
								{ class: 'etk-fonts__cuts' },
								offered.map( ( subset ) =>
									check( subset, choice.subsets.has( subset ), ( value ) => {
										value ? choice.subsets.add( subset ) : choice.subsets.delete( subset );
										dialog.setConfirmEnabled( ready() );
									} )
								)
							)
					  )
					: null,
				sliced.length
					? h( 'p', {
							class: 'etk-fonts__help',
							textContent: `${ addable ? `${ sliced.join( ' and ' ) } ${ sliced.length > 1 ? 'aren’t' : 'isn’t' } offered` : `${ meta.family } can’t be added` }. Google serves ${ sliced.join( ' and ' ) } in many small files per style, which aren’t downloaded here.`,
					  } )
					: null,
				canVary
					? check( 'Variable font', choice.variable, ( value ) => {
							choice.variable = value;
							renderCuts();
							dialog.setConfirmEnabled( ready() );
					  }, 'Fewer files, every weight in between.' )
					: null,
				cutsBox,
				current ? h( 'p', { class: 'etk-fonts__help', textContent: 'This replaces the family’s current files. Settings like fallback and tokens are kept.' } ) : null,
			].filter( Boolean ),
			confirmLabel: current ? 'Update' : 'Add',
			busyLabel: 'Downloading…',
			variant: 'primary',
			form: true,
		} );
		dialog.setConfirmEnabled( ready() );
		if ( ! ( await dialog.result ) ) return;

		const cuts = choice.variable ? ( choice.italic ? meta.cuts : meta.cuts.filter( ( c ) => ! c.endsWith( 'i' ) ) ) : [ ...choice.cuts ];
		try {
			const next = await api( 'fonts/google/install', 'POST', { family: meta.family, subsets: [ ...choice.subsets ], variable: choice.variable, cuts } );
			dialog.close();
			if ( draft?.original === meta.family ) {
				draft.family.variants = clone( next.families.find( ( f ) => f.name === meta.family ).variants );
			}
			await apply( next, `${ current ? 'Updated' : 'Added' } ${ meta.family }.` );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
		}
	};

	const googleFilter = ( key ) => {
		const [ label, options ] = key === 'category' ? [ 'All categories', google.categories ] : [ 'All languages', google.subsets ];
		return select( [ [ '', label ], ...options.map( ( o ) => [ o, o.replace( /-/g, ' ' ) ] ) ], google[ key ], ( value ) => ( ( google[ key ] = value ), searchGoogle() ), { 'aria-label': label, 'data-filter': key } );
	};

	const renderGoogle = () => {
		const search = h( 'input', {
			class: 'etk-fonts__input',
			type: 'search',
			value: google.search,
			placeholder: 'Search Google Fonts',
			'aria-label': 'Search Google Fonts',
			oninput: ( e ) => {
				google.search = e.target.value;
				window.clearTimeout( searchTimer );
				searchTimer = window.setTimeout( () => searchGoogle(), 300 );
			},
		} );

		if ( ! google.loaded && ! google.loading ) window.setTimeout( () => searchGoogle() );

		return [
			pageHeader( 'Google Fonts', 'Fonts are downloaded to your site, so pages make no requests to Google.' ),
			h(
				'div',
				{ class: 'etk-fonts__toolbar etk-fonts__google-filters' },
				search,
				googleFilter( 'category' ),
				googleFilter( 'subset' ),
				select(
					[
						[ 'popularity', 'Popular' ],
						[ 'trending', 'Trending' ],
						[ 'newest', 'Newest' ],
						[ 'alphabetical', 'A to Z' ],
					],
					google.sort,
					( value ) => ( ( google.sort = value ), searchGoogle() ),
					{ 'aria-label': 'Sort' }
				),
				check( 'Variable only', google.variable, ( value ) => ( ( google.variable = value ), searchGoogle() ) )
			),
			h( 'div', { class: 'etk-fonts__toolbar' }, previewInput( reloadGooglePreviews ), weightSlider(), sizeSlider(), layoutToggle( 'google' ) ),
			h( 'p', { class: 'etk-fonts__muted etk-fonts__google-summary', role: 'status' } ),
			h( 'ul', { class: 'etk-fonts__cards etk-fonts__google-results', role: 'list', 'data-layout': prefs.google } ),
			h( 'div', { class: 'etk-fonts__actions etk-fonts__actions--center' }, button( 'Load more', () => google.loading || searchGoogle( true ), { attrs: { class: 'etk-fonts__btn etk-fonts__btn--secondary etk-fonts__more', hidden: true } } ) ),
		];
	};

	const renderGoogleFont = () => {
		const font = google.font;
		const styles = [ ...font.cuts ].sort( ( a, b ) => a.endsWith( 'i' ) - b.endsWith( 'i' ) || parseInt( a, 10 ) - parseInt( b, 10 ) );
		const stack = `"${ font.family }", ${ font.category === 'serif' ? 'serif' : 'sans-serif' }`;

		return [
			h( 'div', { class: 'etk-fonts__crumb' }, button( 'Google Fonts', closeGoogleFont, { variant: 'ghost', iconName: 'back' } ) ),
			pageHeader(
				font.family,
				[ fontSummary( font ), font.wght?.min ? `weights ${ font.wght.min }–${ font.wght.max }` : null, plural( font.subsets.length, 'language set', 'language sets' ) ].filter( Boolean ).join( ' · ' ),
				h(
					'a',
					{ class: 'etk-fonts__btn etk-fonts__btn--ghost', href: `https://fonts.google.com/specimen/${ font.family.replace( / /g, '+' ) }`, target: '_blank', rel: 'noopener' },
					'View on Google Fonts',
					h( 'span', { class: 'screen-reader-text', textContent: ' (opens in a new tab)' } ),
					h( 'span', { html: icon( 'external' ) } )
				),
				addButton( font )
			),
			h( 'div', { class: 'etk-fonts__toolbar' }, previewInput( reloadGooglePreviews ), sizeSlider() ),
			h(
				'ul',
				{ class: 'etk-fonts__styles', role: 'list' },
				styles.map( ( cut ) => {
					const weight = String( parseInt( cut, 10 ) );
					const italic = cut.endsWith( 'i' );
					return h(
						'li',
						{ class: 'etk-fonts__style' },
						h( 'span', { class: 'etk-fonts__muted', textContent: `${ weightLabel( weight ) }${ italic ? ' Italic' : '' }` } ),
						specimen( 'etk-fonts__specimen', scriptOf( font.script, font.subsets ), `font-family: ${ stack }; font-weight: ${ weight }; font-style: ${ italic ? 'italic' : 'normal' }` )
					);
				} )
			),
		];
	};

	/* ------------------------------------------------------------------ */
	/* Settings                                                            */
	/* ------------------------------------------------------------------ */

	// Choose families, then download them with their files as one JSON file.
	const exportFonts = async () => {
		const chosen = new Set( state.families.map( ( f ) => f.name ) );
		const toggleAll = h( 'input', { type: 'checkbox', checked: true } );
		const boxes = state.families.map( ( family ) =>
			check( family.name, true, ( value ) => {
				value ? chosen.add( family.name ) : chosen.delete( family.name );
				sync();
			} )
		);
		const sync = () => {
			toggleAll.checked = chosen.size === state.families.length;
			toggleAll.indeterminate = chosen.size > 0 && ! toggleAll.checked;
			dialog.setConfirmEnabled( chosen.size > 0 );
		};
		toggleAll.addEventListener( 'change', () => {
			boxes.forEach( ( box, i ) => {
				box.querySelector( 'input' ).checked = toggleAll.checked;
				toggleAll.checked ? chosen.add( state.families[ i ].name ) : chosen.delete( state.families[ i ].name );
			} );
			sync();
		} );

		const dialog = confirmDialog( {
			title: 'Export fonts',
			message: [
				h( 'p', { class: 'etk-fonts__help', textContent: 'Each family is exported with its font files.' } ),
				h( 'fieldset', { class: 'etk-fonts__fieldset' }, h( 'legend', { class: 'screen-reader-text', textContent: 'Families to export' } ), h( 'label', { class: 'etk-fonts__check etk-fonts__check--all' }, toggleAll, h( 'span', { textContent: 'All families' } ) ), h( 'div', { class: 'etk-fonts__cuts' }, boxes ) ),
			],
			confirmLabel: 'Export',
			busyLabel: 'Exporting…',
			variant: 'primary',
			form: true,
		} );
		if ( ! ( await dialog.result ) ) return;

		try {
			const params = new URLSearchParams();
			chosen.forEach( ( name ) => params.append( 'families[]', name ) );
			const data = await api( `fonts/export?${ params }` );
			const url = URL.createObjectURL( new Blob( [ JSON.stringify( data ) ], { type: 'application/json' } ) );
			h( 'a', { href: url, download: `fonts-${ location.hostname }.json` } ).click();
			// Revoking straight away can cancel the download in some browsers.
			window.setTimeout( () => URL.revokeObjectURL( url ), 60000 );
			dialog.close();
			announce( `Exported ${ plural( data.families.length, 'family', 'families' ) }.` );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
		}
	};

	/**
	 * Preview what an import changes, from the file alone, before anything is
	 * sent. Families are added or replaced by name, never removed. A family
	 * already here keeps its typography token, as the server decides it.
	 */
	const importFonts = async ( file ) => {
		if ( ! file ) return;
		let data;
		try {
			data = JSON.parse( await file.text() );
			if ( data.etchToolkitFonts !== 1 || ! Array.isArray( data.families ) ) throw new Error();
		} catch {
			return warn( 'That file isn’t a fonts export.' );
		}

		// The server skips nameless families too.
		const families = data.families.filter( ( f ) => typeof f?.name === 'string' && f.name.trim() );
		const incoming = ( name ) => families.some( ( f ) => f.name?.toLowerCase() === name.toLowerCase() );
		const added = families.filter( ( f ) => ! installed( f.name ) );
		const replaced = families.filter( ( f ) => installed( f.name ) );
		const bytes = Object.values( data.files || {} ).reduce( ( sum, encoded ) => sum + Math.floor( ( String( encoded ).length * 3 ) / 4 ), 0 );

		const tokens = Object.entries( ROLES ).flatMap( ( [ role, label ] ) => {
			const claim = families.find( ( f ) => f.enabled !== false && f.roles?.includes( role ) );
			const keeper = state.families.find( ( f ) => f.enabled && f.roles.includes( role ) && ! incoming( f.name ) );
			if ( claim ) return keeper ? [ `${ label } stays with ${ keeper.name }. ${ claim.name } is imported without it.` ] : [ `${ claim.name } becomes the ${ label.toLowerCase() } font.` ];
			const lost = state.families.find( ( f ) => f.roles.includes( role ) && incoming( f.name ) );
			return lost && ! keeper ? [ `${ label } is cleared. The imported ${ lost.name } isn’t used for it.` ] : [];
		} );

		const summary = ( f ) => `${ f.name } · ${ plural( f.variants?.length || 0, 'file', 'files' ) }`;
		const group = ( title, items, help ) =>
			items.length
				? h(
						'div',
						{ class: 'etk-fonts__import-group' },
						h( 'p', { class: 'etk-fonts__import-title', textContent: title } ),
						h( 'ul', { class: 'etk-fonts__import-list' }, items.map( ( text ) => h( 'li', { textContent: text } ) ) ),
						help ? h( 'p', { class: 'etk-fonts__help', textContent: help } ) : null
				  )
				: null;

		const dialog = confirmDialog( {
			title: `Import ${ plural( families.length, 'family', 'families' ) }?`,
			message: [
				group( 'Adds', added.map( summary ) ),
				group( 'Replaces', replaced.map( summary ), 'Their current files stay in the fonts folder, unused.' ),
				group( 'Typography tokens', tokens ),
				h( 'p', { class: 'etk-fonts__help', textContent: `${ size( bytes ) } of font files. Nothing changes until you import.` } ),
			].filter( Boolean ),
			confirmLabel: 'Import',
			busyLabel: 'Importing…',
			variant: 'primary',
		} );
		if ( ! ( await dialog.result ) ) return;
		try {
			const next = await api( 'fonts/import', 'POST', data );
			// Closed before re-rendering, so focus is back on the import button to be kept.
			dialog.close();
			await apply( next, `Imported ${ plural( families.length, 'family', 'families' ) }.` );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
		}
	};

	const renderSettings = () => {
		const importInput = h( 'input', { type: 'file', accept: '.json,application/json', class: 'screen-reader-text', onchange: ( e ) => importFonts( e.target.files[ 0 ] ) } );
		return [
			pageHeader( 'Settings' ),
			section(
				'Stylesheet',
				h( 'p', { class: 'etk-fonts__help' }, 'Fonts are written to the Etch stylesheet ', h( 'strong', { textContent: config.stylesheetName } ), '. Etch loads it, so your fonts keep working even without Etch Toolkit. Edits made to it directly are overwritten when fonts change.' )
			),
			section(
				'Privacy',
				h(
					'div',
					{ class: 'etk-fonts__checks' },
					check(
						'Block Google Fonts from other plugins and themes',
						state.settings.blockGoogle,
						async ( value ) => {
							try {
								await apply( await api( 'fonts/settings', 'POST', { blockGoogle: value } ), value ? 'Google Fonts from other plugins are now blocked.' : 'Google Fonts are no longer blocked.' );
							} catch ( error ) {
								warn( errorText( error ) );
							}
						},
						'Removes stylesheets and hints for fonts.googleapis.com on the front end. Stops if Etch Toolkit is removed.'
					)
				)
			),
			section(
				'Import and export',
				h( 'p', { class: 'etk-fonts__help', textContent: 'Export the families you choose, with their font files, to import on another site. Importing replaces families with the same name.' } ),
				h( 'div', { class: 'etk-fonts__actions' }, button( 'Export fonts…', exportFonts, { attrs: { disabled: ! state.families.length } } ), h( 'label', { class: 'etk-fonts__btn etk-fonts__btn--secondary etk-fonts__file-btn' }, importInput, 'Import fonts' ) )
			),
		];
	};

	/* ------------------------------------------------------------------ */
	/* Shell                                                               */
	/* ------------------------------------------------------------------ */

	const go = ( next ) => {
		view = next;
		render();
		panel.querySelector( '.etk-fonts__page-title' )?.focus();
	};

	/**
	 * Run an update that rebuilds controls, then put focus back if it was in
	 * them: on the same control if it's still there (same tag and accessible
	 * name), else the one now in its place in its list, section or view, else
	 * the page title. Left on <body>, Esc wouldn't close the panel and keys
	 * would reach Etch.
	 */
	const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
	const focusables = ( root ) => ( root ? [ ...root.querySelectorAll( FOCUSABLE ) ].filter( ( node ) => ! node.disabled && node.getClientRects().length ) : [] );
	const focusKey = ( node ) => `${ node.tagName } ${ node.getAttribute( 'aria-label' ) || node.labels?.[ 0 ]?.textContent || node.textContent }`;
	const keepFocus = ( update ) => {
		const active = document.activeElement;
		if ( ! main.contains( active ) ) return update();
		const key = focusKey( active );
		// Its place in its list, its section and the view, innermost first. A list or section
		// is found again as the same one of its kind, counting from the top.
		const places = [];
		for ( const group of [ active.closest( 'ul, tbody' ), active.closest( 'section' ) ] ) {
			if ( group ) places.push( { tag: group.tagName, at: [ ...main.querySelectorAll( group.tagName ) ].indexOf( group ), index: focusables( group ).indexOf( active ) } );
		}
		places.push( { index: focusables( main ).indexOf( active ) } );

		update();
		const after = focusables( main );
		if ( document.activeElement === active && after.includes( active ) ) return;
		let target = after.find( ( node ) => focusKey( node ) === key );
		for ( const { tag, at, index } of places ) {
			const nodes = tag ? focusables( main.querySelectorAll( tag )[ at ] ) : after;
			target = target || nodes[ Math.min( index, nodes.length - 1 ) ];
		}
		( target || panel.querySelector( '.etk-fonts__page-title' ) )?.focus();
	};

	const render = () => {
		if ( ! panel || panel.hidden || ! state ) return;
		const views = { library: renderLibrary, family: renderFamily, upload: renderUpload, google: renderGoogle, 'google-font': renderGoogleFont, settings: renderSettings };
		const parents = { family: 'library', 'google-font': 'google' };
		if ( view === 'family' && ! draft ) view = 'library';

		panel.querySelectorAll( '.etk-fonts__nav button' ).forEach( ( b ) => {
			const current = b.dataset.view === ( parents[ view ] || view );
			current ? b.setAttribute( 'aria-current', 'page' ) : b.removeAttribute( 'aria-current' );
		} );
		// The same view rebuilt keeps focus. A new one gives it to its title, in go().
		const inPlace = main.dataset.view === view;
		main.dataset.view = view;
		prefs.size ? main.style.setProperty( '--etk-fonts-size', `${ prefs.size }px` ) : main.style.removeProperty( '--etk-fonts-size' );
		const update = () => {
			main.replaceChildren( ...views[ view ]() );
			renderLog();
			renderGoogleResults();
		};
		inPlace ? keepFocus( update ) : update();
		renderSavebar();
	};

	const build = () => {
		status = h( 'div', { class: 'etk-fonts__status', role: 'status', 'aria-live': 'polite' } );
		main = h( 'div', { class: 'etk-fonts__main' } );
		savebar = h(
			'div',
			{ class: 'etk-fonts__savebar', hidden: true },
			h( 'span', { class: 'etk-fonts__muted', textContent: 'Unsaved changes' } ),
			button( 'Discard', () => {
				const index = state.families.findIndex( ( f ) => f.name === draft.original );
				edit( index );
			} ),
			button( 'Save', saveDraft, { variant: 'primary' } )
		);

		panel = h(
			'section',
			{
				id: 'etk-fonts',
				class: 'etk-fonts',
				hidden: true,
				'aria-labelledby': 'etk-fonts-title',
				// Keep typing in the panel away from Etch's keyboard shortcuts.
				onkeydown: ( e ) => {
					e.stopPropagation();
					if ( e.key === 'Escape' && ! e.target.closest( 'dialog' ) ) close();
					// Except Cmd/Ctrl+S, which saves instead of opening the browser's Save Page. Etch only
					// matches a shortcut when it saw the Cmd or Ctrl press too, so this calls its save directly.
					if ( ( e.metaKey || e.ctrlKey ) && ( e.code === 'KeyS' || e.key.toLowerCase() === 's' ) ) {
						e.preventDefault();
						window.etch?.saveAsync?.();
					}
				},
				onkeyup: ( e ) => e.stopPropagation(),
			},
			// Etch's manager header: a back button to the builder, then the title.
			h( 'header', { class: 'etk-fonts__header' }, iconButton( 'Back to the builder', 'exit', () => close() ), h( 'h1', { id: 'etk-fonts-title', class: 'etk-fonts__title', textContent: 'Fonts' } ), status ),
			h(
				'nav',
				{ class: 'etk-fonts__nav', 'aria-label': 'Fonts' },
				Object.entries( VIEWS ).map( ( [ key, label ] ) => h( 'button', { type: 'button', 'data-view': key, textContent: label, onclick: () => ( view === 'family' ? leaveFamily( key ) : go( key ) ) } ) )
			),
			h( 'div', { class: 'etk-fonts__content' }, main ),
			savebar
		);
		document.body.append( panel );
	};

	const open = async () => {
		if ( ! panel ) build();
		panel.hidden = false;
		document.body.classList.add( 'etk-fonts-open' );
		controlButton?.setAttribute( 'aria-expanded', 'true' );
		controlButton?.setAttribute( 'selected', 'true' );
		if ( ! state ) {
			main.replaceChildren( h( 'p', { class: 'etk-fonts__muted', textContent: 'Loading fonts…' } ) );
			await load();
		}
		if ( ! state ) {
			main.replaceChildren( h( 'div', { class: 'etk-fonts__empty' }, h( 'p', { textContent: 'Your fonts didn’t load.' } ), button( 'Try again', open ) ) );
			return;
		}
		render();
		panel.querySelector( '.etk-fonts__page-title' )?.focus();
	};

	const close = async () => {
		if ( ! panel || panel.hidden ) return;
		if ( view === 'family' && ! ( await leaveFamily( 'library' ) ) ) return;
		panel.hidden = true;
		document.body.classList.remove( 'etk-fonts-open' );
		controlButton?.setAttribute( 'aria-expanded', 'false' );
		controlButton?.removeAttribute( 'selected' );
		controlButton?.focus();
	};

	const toggle = () => ( panel && ! panel.hidden ? close() : open() );

	const load = async () => {
		try {
			state = await api( 'fonts' );
			loadFaces();
			await syncStylesheet();
		} catch ( error ) {
			warn( `Couldn't load fonts: ${ errorText( error ) }` );
		}
	};

	/* ------------------------------------------------------------------ */
	/* Boot                                                                */
	/* ------------------------------------------------------------------ */

	// Compared as the browser writes it back (<path …></path>), not as CONTROL_ICON is
	// spelled, or every swap would look like Etch re-rendering and trigger another.
	let freeIcon = '';
	const useFreeIcon = () => {
		const svg = controlButton?.querySelector( 'svg' );
		if ( ! svg || svg.innerHTML === freeIcon ) return;
		svg.innerHTML = CONTROL_ICON;
		freeIcon = svg.innerHTML;
	};

	const register = () => {
		const bar = window.etchControls?.builder?.settingsBar?.top;
		const section = document.querySelector( '.settings-bar__section.top' );
		if ( ! bar || ! section?.querySelector( 'button' ) ) return false;

		const before = new Set( section.querySelectorAll( 'button' ) );
		bar.addAfter( { id: CONTROL_ID, icon: 'hugeicons:text-font', tooltip: 'Fonts', callback: toggle } );

		// Etch renders the button on its next update. Label it for toggling state.
		const observer = new MutationObserver( () => {
			controlButton = [ ...section.querySelectorAll( 'button' ) ].find( ( b ) => ! before.has( b ) );
			if ( ! controlButton ) return;
			observer.disconnect();
			controlButton.setAttribute( 'aria-label', 'Fonts' );
			controlButton.setAttribute( 'aria-expanded', 'false' );
			controlButton.setAttribute( 'aria-controls', 'etk-fonts' );
			controlButton.classList.add( 'etk-fonts-control' );
			useFreeIcon();
			new MutationObserver( useFreeIcon ).observe( controlButton, { childList: true, subtree: true } );
		} );
		observer.observe( section, { childList: true, subtree: true } );

		// Opening one of Etch's own managers closes this one.
		document.querySelector( '.settings-bar' )?.addEventListener( 'click', ( e ) => {
			const clicked = e.target.closest( 'button' );
			if ( clicked && clicked !== controlButton ) close();
		} );
		return true;
	};

	const boot = () => {
		let tries = 0;
		const timer = window.setInterval( () => {
			if ( register() || ++tries > 120 ) {
				window.clearInterval( timer );
				// Repair the stylesheet if it was edited or deleted since the last change.
				if ( etchStylesheets() ) load();
			}
		}, 250 );
	};

	document.readyState === 'complete' ? boot() : window.addEventListener( 'load', boot );
} )();
