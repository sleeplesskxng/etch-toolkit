/**
 * Etch Toolkit: Fonts manager.
 *
 * A Settings Bar control (Etch's Controls API) opens a manager beside the bar,
 * like Etch's own Style Manager. Views: Library (families and files), family
 * editor, Google Fonts and Settings.
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
	// Every view's name. The sidebar lists NAV.
	const VIEWS = { library: 'Library', google: 'Google Fonts', settings: 'Settings' };
	const NAV = [ 'library', 'google', 'settings' ];
	// Views that light up another view's nav item.
	const PARENTS = { family: 'library', 'google-font': 'google' };

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
		// From the Paper designs.
		plus: '<path d="M12 5v14M5 12h14"/>',
		'chevron-down': '<path d="M6 9l6 6 6-6"/>',
		'chevron-right': '<path d="M9 6l6 6-6 6"/>',
		more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
		check: '<path d="M5 13l4 4 10-10"/>',
		alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/>',
		trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
		grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
		list: '<path d="M4 7h16M4 12h16M4 17h16"/>',
	};

	// Hugeicons free "text-font" (MIT). Etch bundles its own, different drawing under the same
	// name, so the Settings Bar button gets these paths swapped in after Etch renders it.
	const CONTROL_ICON =
		'<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m14 19l-2.893-8.252C9.763 6.916 9.092 5 8 5s-1.763 1.916-3.107 5.748L2 19m2.5-7h7m10.47 1.94v4.5m0-4.5c.046-.824.048-1.45-.05-1.963c-.234-1.206-1.494-1.933-2.714-2.081c-1.168-.142-2.104.159-3.052 1.54m5.815 2.503h-2.843c-.437 0-.878.021-1.299.138c-2.573.716-2.384 4.323.196 4.768c.287.05.58.07.87.058c.677-.03 1.302-.358 1.84-.773c.627-.486 1.236-1.165 1.236-2.19z"/>';

	// An icon's markup. Its size comes from where it sits (16px, 14px in buttons), or from size.
	const icon = ( name, size ) =>
		`<svg class="etk-fonts__icon" viewBox="0 0 24 24"${ size ? ` style="--etk-icon-size: ${ size }px"` : '' } aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ ICONS[ name ] }</svg>`;

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
	const variantLabel = ( variant ) => `${ weightLabel( variant.weight ) }${ variant.style === 'italic' ? ' Italic' : '' }`;
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
	// size is the Google results' preview size, detailSize a single font's.
	const prefs = { google: 'grid', size: null, detailSize: null };
	try {
		Object.assign( prefs, JSON.parse( window.localStorage.getItem( PREFS_KEY ) || '{}' ) );
		// On the size sliders' steps: 16 to 80 by 8.
		for ( const key of [ 'size', 'detailSize' ] ) {
			if ( prefs[ key ] ) prefs[ key ] = Math.min( 80, Math.max( 16, Math.round( ( prefs[ key ] - 16 ) / 8 ) * 8 + 16 ) );
		}
	} catch {}
	const savePrefs = () => {
		try {
			window.localStorage.setItem( PREFS_KEY, JSON.stringify( prefs ) );
		} catch {}
	};

	const google = { search: '', category: '', subset: '', sort: 'popularity', results: [], total: 0, categories: [], subsets: [], counts: {}, catalogue: 0, loading: false, loaded: false, error: '', variable: false, weight: 400, font: null, pick: null, installing: false, scroll: 0 };

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
		if ( ext === 'woff' && typeof DecompressionStream !== 'function' ) return { file, note: 'Kept as WOFF' };

		try {
			let buffer = await file.arrayBuffer();
			if ( ext === 'woff' ) buffer = await woffToSfnt( buffer );
			const woff2 = await convertToWoff2( buffer );
			const name = file.name.replace( /\.[^.]+$/, '.woff2' );
			return { file: new File( [ woff2 ], name, { type: 'font/woff2' } ), note: `Converted from ${ ext.toUpperCase() }` };
		} catch ( error ) {
			return { file, note: `Kept as ${ ext.toUpperCase() }, conversion failed` };
		}
	};

	/* ------------------------------------------------------------------ */
	/* Shared pieces                                                       */
	/* ------------------------------------------------------------------ */

	let uidCount = 0;
	const uid = ( prefix = 'etk-fonts' ) => `${ prefix }-${ ++uidCount }`;

	/**
	 * Buttons use Etch's own button component classes, so its global
	 * .etch-builder-button styles apply. etk-fonts__btn adds sizing only.
	 * Variants: primary (accent), secondary (outlined), ghost (text), danger, icon.
	 */
	const ETCH_VARIANTS = { primary: 'default', secondary: 'outline', ghost: 'transparent', danger: 'outline', icon: 'icon' };
	const btnClass = ( variant = 'secondary', extra = '' ) =>
		`etch-builder-button etch-builder-button--icon-placement-before etch-builder-button--variant-${ ETCH_VARIANTS[ variant ] || 'outline' } etk-fonts__btn etk-fonts__btn--${ variant }${ extra ? ` ${ extra }` : '' }`;

	const btnIcon = ( name ) => h( 'span', { class: 'etk-fonts__btn-icon', html: name === 'delete' ? DELETE_ICON : icon( name ) } );

	// attrs.class adds to the button's classes.
	const button = ( label, onclick, { variant = 'secondary', iconName, iconAfter, attrs = {} } = {} ) => {
		const { class: extra, ...rest } = attrs;
		return h( 'button', { type: 'button', class: btnClass( variant, extra ), onclick, ...rest }, iconName ? btnIcon( iconName ) : null, label, iconAfter ? btnIcon( iconAfter ) : null );
	};

	/**
	 * A square icon button, named by label. Variants: icon (bare, the default),
	 * secondary (outlined, like the back buttons) and danger.
	 */
	const iconButton = ( label, iconName, onclick, { variant = 'icon', title = label, attrs = {} } = {} ) => {
		const { class: extra, ...rest } = attrs;
		return h( 'button', { type: 'button', class: btnClass( variant, `etk-fonts__icon-btn${ extra ? ` ${ extra }` : '' }` ), 'aria-label': label, title, onclick, html: iconName === 'delete' ? DELETE_ICON : icon( iconName ), ...rest } );
	};

	// A label over its control, or beside it in a 72px column with row: true.
	// A wrapper's own input gets the label.
	const field = ( label, control, help, { row = false } = {} ) => {
		const target = control.matches( 'input, select, textarea, button' ) ? control : control.querySelector( 'input, select, textarea' ) || control;
		const id = target.id || ( target.id = uid() );
		const helpId = help ? `${ id }-help` : null;
		if ( helpId ) target.setAttribute( 'aria-describedby', helpId );
		return h( 'div', { class: `etk-fonts__field${ row ? ' etk-fonts__field--row' : '' }` }, h( 'label', { htmlFor: id, textContent: label } ), control, help ? h( 'p', { class: 'etk-fonts__help', id: helpId, textContent: help } ) : null );
	};

	const check = ( label, checked, onchange, help ) => {
		const input = h( 'input', { type: 'checkbox', checked, onchange: ( e ) => onchange( e.target.checked ) } );
		return h( 'label', { class: 'etk-fonts__check' }, input, h( 'span', {}, label, help ? h( 'span', { class: 'etk-fonts__help', textContent: help } ) : null ) );
	};

	/**
	 * A switch row: title and help on the left, the switch on the right. Same
	 * arguments as check(). A checkbox with role="switch", so it reads as on or off.
	 */
	const toggle = ( label, checked, onchange, help, attrs = {} ) => {
		const id = uid();
		const helpId = help ? `${ id }-help` : null;
		return h(
			'div',
			{ class: 'etk-fonts__toggle' },
			h( 'div', { class: 'etk-fonts__toggle-text' }, h( 'label', { class: 'etk-fonts__toggle-title', htmlFor: id, textContent: label } ), help ? h( 'p', { class: 'etk-fonts__toggle-help', id: helpId, textContent: help } ) : null ),
			h( 'input', { type: 'checkbox', role: 'switch', id, class: 'etk-fonts__switch', checked, 'aria-describedby': helpId, onchange: ( e ) => onchange( e.target.checked ), ...attrs } )
		);
	};

	// attrs.class adds to the select's classes.
	const select = ( options, value, onchange, attrs = {} ) => {
		const { class: extra, ...rest } = attrs;
		return h(
			'select',
			{ class: `etk-fonts__input etk-fonts__select${ extra ? ` ${ extra }` : '' }`, onchange: ( e ) => onchange( e.target.value ), ...rest },
			options.map( ( [ optionValue, label ] ) => h( 'option', { value: optionValue, selected: optionValue === value, textContent: label } ) )
		);
	};

	/**
	 * A bordered box with a small label, the control, then anything trailing,
	 * like the Preview field. The control loses its own box.
	 */
	const inputBox = ( label, control, ...trailing ) => {
		const id = control.id || ( control.id = uid() );
		control.classList.add( 'etk-fonts__inputbox-control' );
		return h( 'div', { class: 'etk-fonts__inputbox' }, h( 'label', { class: 'etk-fonts__inputbox-label', htmlFor: id, textContent: label } ), control, ...trailing );
	};

	// Variants: neutral, accent (roles), warning (unused), tag (categories).
	const badge = ( text, variant = 'neutral' ) => h( 'span', { class: `etk-fonts__badge etk-fonts__badge--${ variant }`, textContent: text } );

	// An on/off pill, like the language chips.
	const chip = ( label, pressed, onchange ) => {
		const node = h( 'button', {
			type: 'button',
			class: 'etk-fonts__chip',
			'aria-pressed': String( !! pressed ),
			textContent: label,
			onclick: () => {
				pressed = ! pressed;
				node.setAttribute( 'aria-pressed', String( pressed ) );
				onchange( pressed );
			},
		} );
		return node;
	};

	/**
	 * Tabs as a pill group, with counts. items: [ { id, label, count } ].
	 * Arrow keys, Home and End move and select. Pair each tab with tabPanel( key, id ).
	 */
	const tabs = ( { key, label, items, value, onchange } ) => {
		const buttons = items.map( ( item ) =>
			h(
				'button',
				{
					type: 'button',
					role: 'tab',
					class: 'etk-fonts__tab',
					id: `etk-fonts-${ key }-tab-${ item.id }`,
					'aria-controls': `etk-fonts-${ key }-panel-${ item.id }`,
					'aria-selected': String( item.id === value ),
					tabindex: item.id === value ? '0' : '-1',
					onclick: () => pick( item.id ),
				},
				h( 'span', { textContent: item.label } ),
				item.count === undefined ? null : h( 'span', { class: 'etk-fonts__count', textContent: String( item.count ) } )
			)
		);
		// Focus moves first, so a re-render in onchange keeps it on the tab.
		const pick = ( id, focus = false ) => {
			buttons.forEach( ( b, i ) => {
				const on = items[ i ].id === id;
				b.setAttribute( 'aria-selected', String( on ) );
				b.tabIndex = on ? 0 : -1;
				if ( on && focus ) b.focus();
			} );
			if ( id === value ) return;
			value = id;
			onchange( id );
		};
		return h(
			'div',
			{
				class: 'etk-fonts__tabs',
				role: 'tablist',
				'aria-label': label,
				onkeydown: ( e ) => {
					const i = buttons.indexOf( document.activeElement );
					const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1 }[ e.key ];
					if ( i < 0 || next === undefined ) return;
					e.preventDefault();
					pick( items[ ( next + buttons.length ) % buttons.length ].id, true );
				},
			},
			buttons
		);
	};

	const tabPanel = ( key, id, ...children ) => h( 'div', { class: 'etk-fonts__tabpanel', role: 'tabpanel', id: `etk-fonts-${ key }-panel-${ id }`, 'aria-labelledby': `etk-fonts-${ key }-tab-${ id }` }, ...children );

	/**
	 * One choice from a few, as radios styled as a segmented control.
	 * options: [ { value, label, count, icon } ]. With an icon the label is for
	 * screen readers only. fill stretches the segments, boxed borders the track.
	 */
	const segmented = ( { name, legend, options, value, onchange, fill = false, boxed = false } ) =>
		h(
			'fieldset',
			{ class: `etk-fonts__seg${ fill ? ' etk-fonts__seg--fill' : '' }${ boxed ? ' etk-fonts__seg--boxed' : '' }` },
			h( 'legend', { class: 'screen-reader-text', textContent: legend } ),
			options.map( ( option ) =>
				h(
					'label',
					{ title: option.icon ? option.label : null },
					h( 'input', { type: 'radio', name: `etk-fonts-${ name }`, value: option.value, checked: option.value === value, onchange: () => onchange( option.value ) } ),
					option.icon ? h( 'span', { class: 'etk-fonts__seg-icon', html: icon( option.icon, 14 ) } ) : null,
					h( 'span', { class: option.icon ? 'screen-reader-text' : null, textContent: option.label } ),
					option.count === undefined ? null : h( 'span', { class: 'etk-fonts__count', textContent: String( option.count ) } )
				)
			)
		);

	/**
	 * A menu on a button, styled like Etch's context menu. items: [ { label,
	 * onselect, icon, danger, disabled } ], '-' for a separator, or a function
	 * returning them, read on open. Arrow keys, Home and End move, Enter picks,
	 * Escape closes, Tab closes and moves on. Focus returns to the button.
	 */
	let openMenu = null;
	const onMenuOutside = ( e ) => {
		if ( e.type === 'pointerdown' && ( openMenu?.popup.contains( e.target ) || openMenu?.trigger.contains( e.target ) ) ) return;
		if ( e.type === 'scroll' && openMenu?.popup.contains( e.target ) ) return;
		closeMenu();
	};
	const closeMenu = ( { focus = false } = {} ) => {
		if ( ! openMenu ) return;
		const { trigger, popup, onclose } = openMenu;
		openMenu = null;
		popup.remove();
		trigger.setAttribute( 'aria-expanded', 'false' );
		trigger.removeAttribute( 'selected' );
		document.removeEventListener( 'pointerdown', onMenuOutside, true );
		document.removeEventListener( 'scroll', onMenuOutside, true );
		window.removeEventListener( 'resize', onMenuOutside );
		if ( focus && trigger.isConnected ) trigger.focus();
		onclose?.();
	};

	// Show a menu or popover under its trigger, or above when there's no room.
	const openPopup = ( trigger, popup, { align = 'end', onclose } = {} ) => {
		// In the panel, for its tokens and its keyboard fence. Fixed, so no scroller clips it.
		panel.append( popup );
		const box = trigger.getBoundingClientRect();
		const size = popup.getBoundingClientRect();
		const left = Math.max( 8, Math.min( align === 'end' ? box.right - size.width : box.left, window.innerWidth - size.width - 8 ) );
		const top = box.bottom + 4 + size.height > window.innerHeight - 8 ? Math.max( 8, box.top - 4 - size.height ) : box.bottom + 4;
		popup.style.left = `${ left }px`;
		popup.style.top = `${ top }px`;

		openMenu = { trigger, popup, onclose };
		trigger.setAttribute( 'aria-expanded', 'true' );
		trigger.setAttribute( 'selected', 'true' );
		document.addEventListener( 'pointerdown', onMenuOutside, true );
		document.addEventListener( 'scroll', onMenuOutside, true );
		window.addEventListener( 'resize', onMenuOutside );
	};

	const menu = ( trigger, items, { label, align = 'end' } = {} ) => {
		trigger.setAttribute( 'aria-haspopup', 'menu' );
		trigger.setAttribute( 'aria-expanded', 'false' );

		const show = ( first ) => {
			closeMenu();
			const entries = ( typeof items === 'function' ? items() : items ).filter( Boolean );
			const choices = [];
			const popup = h(
				'div',
				{
					class: 'right-click-menu__content etk-fonts__menu',
					role: 'menu',
					'aria-label': label || trigger.getAttribute( 'aria-label' ) || trigger.textContent.trim(),
					onkeydown: ( e ) => {
						const i = choices.indexOf( document.activeElement );
						const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: choices.length - 1 }[ e.key ];
						if ( next !== undefined ) {
							e.preventDefault();
							choices[ ( next + choices.length ) % choices.length ]?.focus();
						} else if ( e.key === 'Escape' ) {
							// Not the panel's Escape, which would close the fonts manager.
							e.preventDefault();
							e.stopPropagation();
							closeMenu( { focus: true } );
						} else if ( e.key === 'Tab' ) {
							// Back on the button first, so Tab moves on from there.
							closeMenu( { focus: true } );
						}
					},
				},
				entries.map( ( item ) => {
					if ( item === '-' ) return h( 'div', { class: 'right-click-menu__separator etk-fonts__menu-separator', role: 'separator' } );
					const node = h(
						'button',
						{
							type: 'button',
							role: 'menuitem',
							tabindex: '-1',
							class: `right-click-menu__item etk-fonts__menu-item${ item.danger ? ' danger' : '' }`,
							'aria-disabled': item.disabled ? 'true' : null,
							'data-disabled': item.disabled ? '' : null,
							onclick: () => {
								if ( item.disabled ) return;
								closeMenu( { focus: true } );
								item.onselect();
							},
						},
						h( 'span', { class: 'right-click-menu__item-label etk-fonts__menu-label' }, item.icon ? h( 'span', { class: 'etk-fonts__menu-icon', html: item.icon === 'delete' ? DELETE_ICON : icon( item.icon, 14 ) } ) : null, item.label )
					);
					choices.push( node );
					return node;
				} )
			);
			openPopup( trigger, popup, { align } );
			choices.at( first )?.focus();
		};

		trigger.addEventListener( 'click', () => ( openMenu?.trigger === trigger ? closeMenu() : show( 0 ) ) );
		trigger.addEventListener( 'keydown', ( e ) => {
			if ( e.key !== 'ArrowDown' && e.key !== 'ArrowUp' ) return;
			e.preventDefault();
			show( e.key === 'ArrowUp' ? -1 : 0 );
		} );
		return trigger;
	};

	/**
	 * A family's CSS variable, with a copy button that shows a tick for a moment.
	 * Takes the saved name, so a family renamed in the editor shows its variable
	 * as it is until it's saved. Variants: chip (inline), field (a full-width
	 * field, as in the inspector) and icon (the copy button alone). Shows the
	 * bare name, --font-x, and copies it wrapped, var(--font-x). get, for the
	 * icon alone, reads what to copy at the time, like a name being typed.
	 */
	const copyVar = ( name, { variant = 'chip', get } = {} ) => {
		if ( ! get && ! varOf( name ) ) return null;
		const current = () => ( get ? get() : varOf( name ) );
		const label = get ? 'Copy CSS variable' : `Copy ${ current() }`;
		const iconOnly = variant === 'icon';
		const glyph = h( 'span', { class: 'etk-fonts__var-icon', html: icon( 'copy' ) } );
		let timer = 0;
		const node = h(
			'button',
			{
				type: 'button',
				class: iconOnly ? btnClass( 'icon', 'etk-fonts__icon-btn etk-fonts__copy' ) : `etk-fonts__var etk-fonts__var--${ variant }`,
				title: 'Copy CSS variable',
				'aria-label': label,
				onclick: async () => {
					const value = current();
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
			iconOnly ? null : h( 'code', { textContent: state.vars[ name ] } ),
			glyph
		);
		return node;
	};

	/**
	 * A labelled group. section( title, ...children ), or { title, variant,
	 * action } in place of title. Variants: card (the default: children in a
	 * padded card under the label), rows (an unpadded card, for
	 * .etk-fonts__card-row children) and panel (an inspector section, with a
	 * divider under it). action sits at the end of the label row.
	 */
	const section = ( title, ...children ) => {
		const { title: text, variant = 'card', action } = title && typeof title === 'object' ? title : { title };
		const head = h( 'div', { class: 'etk-fonts__section-head' }, h( 'h3', { class: 'etk-fonts__label', textContent: text } ), action || null );
		return h(
			'section',
			{ class: `etk-fonts__section etk-fonts__section--${ variant }` },
			head,
			variant === 'panel' ? children : h( 'div', { class: `etk-fonts__card${ variant === 'card' ? ' etk-fonts__card--padded' : '' }` }, ...children )
		);
	};

	/**
	 * A view's header: an optional back button, the title (focused when the
	 * view opens), meta, tabs, then actions at the end.
	 * pageHeader( title, description, ...actions ), or pageHeader( { title,
	 * hidden, description, back: { label, onclick, crumb }, meta, tabs, actions, bar } ).
	 * crumb names where back goes, as a breadcrumb before the title.
	 * A title that repeats its nav item is for screen readers only, unless
	 * hidden is false. bar makes it the 52px bar over a split view.
	 */
	const pageHeader = ( title, description, ...actions ) => {
		const o = title && typeof title === 'object' ? title : { title, description, actions };
		const hidden = o.hidden ?? o.title === VIEWS[ view ];
		const list = ( o.actions || [] ).filter( Boolean );
		const bare = hidden && ! o.back && ! o.meta && ! o.tabs && ! list.length && ! o.description;
		return h(
			'div',
			{ class: `etk-fonts__page-header${ o.bar ? ' etk-fonts__page-header--bar' : '' }${ bare ? ' etk-fonts__page-header--bare' : '' }` },
			h(
				'div',
				{ class: 'etk-fonts__page-lead' },
				o.back ? iconButton( o.back.label, 'back', o.back.onclick, { variant: 'secondary' } ) : null,
				o.back?.crumb
					? h( 'nav', { class: 'etk-fonts__crumbs', 'aria-label': 'Breadcrumb' }, h( 'button', { type: 'button', class: 'etk-fonts__crumb', textContent: o.back.crumb, onclick: o.back.onclick } ), h( 'span', { class: 'etk-fonts__crumb-sep', 'aria-hidden': 'true', textContent: '/' } ) )
					: null,
				h( 'h2', { class: `etk-fonts__page-title${ hidden ? ' screen-reader-text' : '' }`, tabindex: '-1', textContent: o.title } ),
				typeof o.meta === 'string' ? h( 'span', { class: 'etk-fonts__page-meta', textContent: o.meta } ) : o.meta || null,
				o.tabs || null
			),
			list.length ? h( 'div', { class: 'etk-fonts__actions' }, ...list ) : null,
			o.description ? h( 'p', { class: 'etk-fonts__help etk-fonts__page-description', textContent: o.description } ) : null
		);
	};

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

	// Grid or list for Google Fonts.
	const layoutToggle = ( key ) =>
		segmented( {
			name: `layout-${ key }`,
			legend: 'Layout',
			value: prefs[ key ],
			boxed: true,
			options: [
				{ value: 'grid', label: 'Grid', icon: 'grid' },
				{ value: 'rows', label: 'List', icon: 'list' },
			],
			onchange: ( value ) => {
				prefs[ key ] = value;
				savePrefs();
				main.querySelector( '[data-layout]' ).dataset.layout = value;
			},
		} );

	/*
	 * The upload illustration: two file cards, with "Rg" in Instrument Serif and
	 * "Aa" in Fraunces drawn as outlines, so no font loads for it. Colors are in CSS.
	 */
	const GLYPH_STACK = '<svg class="etk-fonts__glyphs" viewBox="0 0 290 210" width="290" height="210" aria-hidden="true" focusable="false"><defs><filter id="etk-fonts-glyph-shadow" x="-40%" y="-30%" width="180%" height="180%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000" flood-opacity=".35"/></filter></defs><g class="etk-fonts__glyph-card etk-fonts__glyph-card--back" transform="translate(0 32) rotate(-10)"><rect x=".5" y=".5" width="143" height="171" rx="9.5"/><text x="14" y="23.5">.ttf</text><path d="M44.6 147.7Q38.7 147.7 37.1 140L35.5 132.4Q34.7 128.8 33.8 126.9Q32.9 125 31.3 124.3Q29.7 123.6 26.9 123.6Q26 123.6 25.4 124.1Q24.9 124.6 24.9 125.4L24.9 142.4Q24.9 143.8 25.4 144.3Q26 144.8 27.9 145.1L30.4 145.6Q31.1 145.7 31.1 146.3Q31.1 147.1 30.1 147.1L16.3 147.1Q15.3 147.1 15.3 146.4Q15.3 145.8 16.2 145.6L17.7 145.3Q19.2 145 19.6 144.5Q20.1 144.1 20.1 142.6L20.1 102.6Q20.1 101.2 19.6 100.7Q19.2 100.3 17.7 100L16.2 99.7Q15.3 99.5 15.3 98.9Q15.3 98.2 16.3 98.2L30.1 98.2Q34.1 98.2 37.3 99.7Q40.4 101.3 42.2 104Q43.9 106.8 43.9 110.4Q43.9 114.7 41.3 118.1Q38.8 121.6 34.8 123Q34.3 123.1 34.3 123.4Q34.3 123.7 34.7 123.9Q36.9 125 38.2 126.8Q39.4 128.6 40.1 131.7L41.6 138.6Q42.4 142.2 43.4 143.7Q44.4 145.1 46 145.1Q46.5 145.1 46.9 145Q47.4 144.8 48.1 144.3Q48.6 144 49.1 144.2Q49.6 144.3 49.6 144.9Q49.6 146 48.1 146.9Q46.6 147.7 44.6 147.7zM29.4 121.9Q34.1 121.9 36.4 118.8Q38.8 115.7 38.8 110.5Q38.8 105.5 36.1 102.7Q33.3 99.9 28.5 99.9Q24.9 99.9 24.9 102.6L24.9 118.2Q24.9 121.9 29.4 121.9zM59.8 161.7Q54.6 161.7 51.6 159.7Q48.6 157.6 48.6 154.7Q48.6 153.4 49 152.5Q49.3 151.5 50.4 150.2Q51.5 148.9 53.8 146.8Q54.7 146.1 54.7 145.5Q54.7 144.8 53.8 144.5Q51.4 143.4 50.9 141.9Q50.4 140.3 52.1 138.9L57 134.7Q57.8 134 56.9 133.5Q54.1 132.2 52.5 129.3Q50.9 126.4 50.9 123.2Q50.9 120.1 52.2 117.5Q53.6 115 55.9 113.5Q58.2 112 61.1 112Q62.7 112 64.2 112.6Q65.1 112.9 65.3 112Q66 109.4 67.6 107.9Q69.3 106.5 70.9 106.5Q72.5 106.5 73.5 107.4Q74.5 108.3 74.5 109.7Q74.5 110.8 73.8 111.5Q73.1 112.2 72.1 112.2Q71.2 112.2 70.8 111.8Q70.4 111.5 70 111.1Q69.7 110.8 68.9 110.8Q67.3 110.8 66.9 112.6Q66.7 113.3 66.9 113.7Q67.2 114.2 67.7 114.7Q69.3 116.2 70.2 118.5Q71.1 120.7 71.1 123.5Q71.1 126.7 69.8 129.3Q68.5 131.9 66.2 133.4Q63.9 134.9 61.1 134.9Q59.8 134.9 58.9 135.4Q58.1 135.9 57.2 136.9L56 138.1Q55.1 139.2 55.5 140.2Q55.9 141.2 57.4 141.2L63.2 141.2Q68.1 141.2 71 143.6Q73.8 146 73.8 150.2Q73.8 153.6 71.9 156.2Q70 158.7 66.9 160.2Q63.7 161.7 59.8 161.7zM61 133.2Q63.4 133.2 64.9 130.5Q66.3 127.9 66.3 123.3Q66.3 118.9 64.8 116.2Q63.4 113.5 61 113.5Q58.6 113.5 57.1 116.2Q55.7 118.9 55.7 123.3Q55.7 127.9 57.1 130.5Q58.5 133.2 61 133.2zM60.6 160.2Q63 160.2 65.1 159.2Q67.1 158.1 68.3 156.1Q69.5 154.2 69.5 151.7Q69.5 148.7 67.7 147Q65.9 145.4 62.6 145.4L61.1 145.4Q58.9 145.4 57.9 145.8Q56.8 146.2 55.9 147.2Q53.8 149.4 53.2 150.8Q52.7 152.2 52.7 153.6Q52.7 156.6 54.8 158.4Q56.8 160.2 60.6 160.2z"/></g><g class="etk-fonts__glyph-card etk-fonts__glyph-card--front" transform="translate(126 12) rotate(6)"><rect x=".5" y=".5" width="143" height="171" rx="9.5" filter="url(#etk-fonts-glyph-shadow)"/><text x="14" y="23.5">.woff2</text><path d="M24.3 131.7L24.6 129.9L43.7 129.9L43.9 131.7L24.3 131.7zM26.8 147.8Q26.8 148.1 26.5 148.4Q26.2 148.6 25.7 148.6L15.5 148.6Q15 148.6 14.8 148.4Q14.5 148.2 14.5 147.8Q14.5 147.6 14.7 147.4Q14.9 147.2 15.3 147.1L16.7 146.6Q17.7 146.2 18.4 145.4Q19 144.6 19.6 142.6L31.5 105.2Q31.9 104.1 31.6 103.5Q31.3 103 30.1 102.6Q29.5 102.4 29.2 102.2Q28.9 102 28.9 101.7Q28.9 101.4 29.2 101.2Q29.5 101 30 101L42.5 101Q43.1 101 43.3 101.2Q43.6 101.4 43.6 101.7Q43.6 102 43.3 102.3Q43.1 102.5 42.5 102.6Q41.5 102.8 41.3 103.1Q41.1 103.5 41.4 104.4L54.6 144.5Q55 145.6 55.6 146.2Q56.2 146.7 57.3 146.9Q57.9 147.1 58.1 147.3Q58.3 147.5 58.3 147.8Q58.3 148.1 58 148.4Q57.7 148.6 57.2 148.6L44.1 148.6Q43.5 148.6 43.3 148.4Q43 148.1 43 147.8Q43 147.5 43.2 147.3Q43.4 147.2 43.9 147.1L46 146.7Q46.8 146.5 46.9 146Q47 145.5 46.7 144.5L33.5 103.9L34.3 103.1L21.9 142.4Q21.5 143.6 21.6 144.5Q21.7 145.3 22.3 145.8Q23 146.3 24.1 146.7L25.9 147.1Q26.3 147.2 26.5 147.4Q26.8 147.5 26.8 147.8zM80.7 144.9L80.7 144.4L80.3 144.4L80.3 124.5Q80.3 121.5 79 119.9Q77.6 118.4 75 118.4Q72.4 118.4 71.2 119.5Q69.9 120.6 69.9 122.1L69.9 124.6Q69.9 126.1 68.9 127Q67.9 127.9 66.2 127.9Q64.8 127.9 64 127.1Q63.2 126.3 63.2 125Q63.2 123 64.7 121.2Q66.2 119.4 69.1 118.2Q72 117 76.1 117Q81.6 117 84.2 119.4Q86.9 121.8 86.9 125.9L86.9 144.2Q86.9 145.4 87.4 145.9Q87.8 146.5 88.5 146.5Q89.2 146.5 89.7 146.1Q90.1 145.7 90.3 145.1Q90.4 145 90.5 144.9Q90.6 144.8 90.8 144.8Q91 144.8 91.1 144.9Q91.2 145.1 91.2 145.4Q91.2 146.2 90.7 147.1Q90.1 148 88.9 148.6Q87.7 149.3 85.9 149.3Q83.4 149.3 82 148.1Q80.7 147 80.7 144.9zM61.7 141.8Q61.7 138 64.9 135.6Q68.2 133.1 74.4 133.1Q76.8 133.1 78.5 133.6Q80.3 134 81.7 134.7L81.3 135.8Q80 135.2 78.5 134.8Q77 134.4 75.3 134.4Q72 134.4 70.3 136.1Q68.5 137.8 68.5 140.7Q68.5 143.5 70 145.1Q71.6 146.6 74 146.6Q76 146.6 77.9 145.7Q79.8 144.8 81.2 143.1L81.7 144.1Q79.9 146.6 77 147.9Q74.1 149.3 70.8 149.3Q66.7 149.3 64.2 147.2Q61.7 145.1 61.7 141.8z"/></g></svg>';

	// The Library's tab, and the Files tab's filter.
	let libTab = 'families';
	let fileFilter = 'all';

	// The Files tab, where uploads show their progress.
	const showFiles = () => {
		if ( view === 'library' && libTab === 'files' ) return;
		libTab = 'files';
		view === 'library' ? render() : go( 'library' );
	};

	// From a menu: open the picker from the Files tab, with focus on its Choose files button.
	const chooseFiles = () => {
		showFiles();
		const input = panel.querySelector( '.etk-fonts__upload-input' );
		input?.focus();
		input?.click();
	};

	const ADD_FONT = [
		{ label: 'Upload files', icon: 'upload', onselect: chooseFiles },
		{ label: 'Browse Google Fonts', icon: 'search', onselect: () => go( 'google' ) },
	];
	const addFontMenu = () => menu( button( 'Add font', null, { variant: 'primary', iconName: 'plus', iconAfter: 'chevron-down' } ), ADD_FONT, { label: 'Add font' } );

	/**
	 * Font files dropped anywhere on node upload and show on the Files tab.
	 * highlight gets is-over while files are dragged over node.
	 */
	const dropTarget = ( node, highlight = node ) => {
		const hasFiles = ( e ) => [ ...( e.dataTransfer?.types || [] ) ].includes( 'Files' );
		node.addEventListener( 'dragover', ( e ) => {
			if ( ! hasFiles( e ) ) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'copy';
			highlight.classList.add( 'is-over' );
		} );
		node.addEventListener( 'dragleave', ( e ) => {
			if ( ! node.contains( e.relatedTarget ) ) highlight.classList.remove( 'is-over' );
		} );
		node.addEventListener( 'drop', ( e ) => {
			if ( ! hasFiles( e ) ) return;
			e.preventDefault();
			highlight.classList.remove( 'is-over' );
			const files = [ ...e.dataTransfer.files ];
			showFiles();
			uploadFiles( files );
		} );
		return node;
	};

	// "100–900", or "400" for one weight.
	const weightRange = ( family ) => {
		const weights = family.variants.flatMap( ( v ) => String( v.weight ).split( ' ' ).map( Number ) ).filter( Boolean );
		if ( ! weights.length ) return '';
		const min = Math.min( ...weights );
		const max = Math.max( ...weights );
		return min === max ? String( min ) : `${ min }–${ max }`;
	};

	const familyTile = ( family, index ) => {
		const script = scriptOf( family.google?.script, family.google?.subsets );
		const glyphs = SCRIPTS[ script ] ? [ ...SCRIPTS[ script ][ 1 ] ].slice( 0, 2 ).join( '' ) : 'Aa';
		const badges = family.enabled ? family.roles.map( ( role ) => badge( ROLES[ role ], 'accent' ) ) : [ badge( 'Disabled' ) ];
		const weights = weightRange( family );
		return h(
			'li',
			{ class: `etk-fonts__card etk-fonts__tile${ family.enabled ? '' : ' is-disabled' }` },
			h(
				'div',
				{ class: 'etk-fonts__tile-canvas' },
				h(
					'div',
					{ class: 'etk-fonts__tile-top' },
					badges.length ? h( 'div', { class: 'etk-fonts__family-badges' }, badges ) : null,
					weights ? h( 'span', { class: 'etk-fonts__tile-note' }, h( 'span', { class: 'screen-reader-text', textContent: 'Weights ' } ), weights ) : null
				),
				h( 'p', { class: 'etk-fonts__tile-specimen etk-fonts__family-specimen', 'aria-hidden': 'true', style: `font-family: "${ family.name }", ${ family.fallback || 'sans-serif' }`, textContent: glyphs } )
			),
			h(
				'div',
				{ class: 'etk-fonts__tile-meta' },
				h( 'div', { class: 'etk-fonts__tile-title' }, h( 'h3', { class: 'etk-fonts__tile-name', textContent: family.name } ), state.vars[ family.name ] ? h( 'span', { class: 'etk-fonts__tile-sub', textContent: state.vars[ family.name ] } ) : null ),
				h( 'div', { class: 'etk-fonts__tile-actions' }, copyVar( family.name, { variant: 'icon' } ), button( 'Edit', () => edit( index ), { attrs: { class: 'etk-fonts__card-link', 'aria-label': `Edit ${ family.name }` } } ) )
			)
		);
	};

	// The dashed "Add a family" tile: a drop target, and the Add font menu on click.
	const addTile = () =>
		menu(
			h(
				'button',
				{ type: 'button', class: 'etk-fonts__card etk-fonts__card--dashed etk-fonts__family-add' },
				h( 'span', { class: 'etk-fonts__family-add-icon', html: icon( 'plus' ) } ),
				h( 'span', { class: 'etk-fonts__family-add-text' }, h( 'span', { class: 'etk-fonts__family-add-title', textContent: 'Add a family' } ), h( 'span', { class: 'etk-fonts__family-add-hint', textContent: 'Drop files here or browse Google Fonts' } ) )
			),
			ADD_FONT,
			{ label: 'Add a family', align: 'start' }
		);

	const renderFamilies = () => {
		const add = addTile();
		return dropTarget( tabPanel( 'library', 'families', h( 'ul', { class: 'etk-fonts__tiles', role: 'list' }, state.families.map( familyTile ), h( 'li', { class: 'etk-fonts__family-add-item' }, add ) ) ), add );
	};

	// Files: uploads in progress or failed first, then the fonts folder.
	const iconCell = ( name ) =>
		h(
			'td',
			{ class: 'etk-fonts__files-icon', 'aria-hidden': 'true' },
			name === 'spinner' ? h( 'span', { class: 'etk-fonts__spinner' } ) : name ? h( 'span', { class: `etk-fonts__files-glyph etk-fonts__files-glyph--${ name }`, html: icon( name, 15 ) } ) : null
		);

	const STAGES = { waiting: 'Waiting', converting: 'Converting', uploading: 'Uploading' };
	const logRow = ( entry ) => {
		const busy = entry.stage === 'converting' || entry.stage === 'uploading';
		return h(
			'tr',
			{},
			h( 'td', { class: 'etk-fonts__files-pick' } ),
			iconCell( entry.error ? 'alert' : entry.done ? 'check' : busy ? 'spinner' : null ),
			h( 'td', {}, h( 'span', { class: 'etk-fonts__files-name', textContent: entry.name } ) ),
			h( 'td' ),
			h(
				'td',
				{},
				entry.error || entry.done
					? h( 'span', { class: entry.error ? 'etk-fonts__files-error' : 'etk-fonts__muted', textContent: entry.text } )
					: h( 'span', { class: 'etk-fonts__files-progress' }, busy ? h( 'span', { class: 'etk-fonts__progress' } ) : null, h( 'span', { class: 'etk-fonts__muted', textContent: STAGES[ entry.stage ] } ) )
			),
			h( 'td', { textContent: size( entry.size ) } ),
			h( 'td', { class: entry.family ? null : 'etk-fonts__files-none', textContent: entry.family || '—' } ),
			h(
				'td',
				{},
				entry.error
					? iconButton( `Dismiss ${ entry.name }`, 'close', () => {
							uploadLog = uploadLog.filter( ( e ) => e !== entry );
							renderLog();
					  } )
					: null
			)
		);
	};

	/*
	 * Files picked for the bulk bar, by name. Files in WordPress's Font Library
	 * can't be changed here, so they can't be picked.
	 */
	const picked = new Set();
	let pickAnchor = null;
	let bulkBar = null;

	const editable = ( file ) => ! file.unsafe && ( ! file.family || state.families.some( ( f ) => f.name === file.family ) );
	const shownFiles = () => state.files.filter( ( f ) => fileFilter === 'all' || ( fileFilter === 'unused' ? ! f.family : !! f.family ) );
	const pickable = () => shownFiles().filter( editable );
	const pickedFiles = () => state.files.filter( ( f ) => picked.has( f.name ) );

	const pickBox = ( file ) =>
		h( 'input', {
			type: 'checkbox',
			class: 'etk-fonts__pick',
			'data-file': file.name,
			checked: picked.has( file.name ),
			'aria-label': `Select ${ file.name }`,
			// Shift-click sets everything from the last one clicked to this one.
			onclick: ( e ) => {
				const on = e.target.checked;
				const names = pickable().map( ( f ) => f.name );
				const from = names.indexOf( pickAnchor );
				const to = names.indexOf( file.name );
				const range = e.shiftKey && from >= 0 ? names.slice( Math.min( from, to ), Math.max( from, to ) + 1 ) : [ file.name ];
				range.forEach( ( name ) => ( on ? picked.add( name ) : picked.delete( name ) ) );
				pickAnchor = file.name;
				syncPicks();
			},
		} );

	// Checkboxes, rows and the bulk bar, after the selection or the list changes.
	const syncPicks = () => {
		const shown = view === 'library' && libTab === 'files' && state ? pickable().map( ( f ) => f.name ) : [];
		// Only files in view stay picked.
		[ ...picked ].forEach( ( name ) => shown.includes( name ) || picked.delete( name ) );
		main?.querySelectorAll( '.etk-fonts__pick[data-file]' ).forEach( ( box ) => {
			box.checked = picked.has( box.dataset.file );
			box.closest( 'tr' ).classList.toggle( 'is-picked', box.checked );
		} );
		const all = main?.querySelector( '.etk-fonts__pick-all' );
		if ( all ) {
			all.checked = shown.length > 0 && picked.size === shown.length;
			all.indeterminate = picked.size > 0 && picked.size < shown.length;
			all.disabled = ! shown.length;
		}
		renderBulkBar( shown );
	};

	const clearPicks = () => {
		picked.clear();
		syncPicks();
	};

	const renderBulkBar = ( shown ) => {
		if ( ! bulkBar ) return;
		const show = picked.size > 0;
		// Don't strand focus on a bar that's going away.
		if ( ! show && bulkBar.contains( document.activeElement ) ) ( main.querySelector( '.etk-fonts__pick-all:not(:disabled)' ) || panel.querySelector( '.etk-fonts__page-title' ) )?.focus();
		bulkBar.hidden = ! show;
		bulkBar.previousElementSibling.hidden = ! show;
		if ( ! show ) return;
		bulkBar.querySelector( '.etk-bulk-bar__count-number' ).textContent = String( picked.size );
		bulkBar.querySelector( '.etk-bulk-bar__select-all' ).hidden = picked.size >= shown.length;
		bulkBar.querySelector( '.etk-fonts__bulk-remove' ).disabled = ! pickedFiles().some( ( f ) => f.family );
	};

	// Etch's button markup, as the Style Manager's bulk bar has it.
	const barButton = ( label, iconName, onclick, { variant = 'transparent', className = '', size = 'm', iconSize = 14 } = {} ) =>
		h(
			'button',
			{ type: 'button', class: `etch-builder-button etch-builder-button--icon-placement-before etch-builder-button--variant-${ variant } ${ className }`, style: `--button-font-size: var(--e-font-size-${ size })`, onclick },
			h( 'div', { class: 'etk-bulk-bar__icon', html: iconName === 'delete' ? DELETE_ICON : icon( iconName, iconSize ) } ),
			label ? [ ' ', label ] : null
		);

	// The Style Manager's bulk bar, for the Files tab. Built once, then shown and hidden.
	const buildBulkBar = () => {
		const clearButton = barButton( null, 'close', clearPicks, { variant: 'icon', className: 'etk-bulk-bar__clear', size: 's', iconSize: 12 } );
		clearButton.setAttribute( 'aria-label', 'Clear selection' );
		clearButton.title = 'Clear selection';
		const selectAll = h( 'button', {
			type: 'button',
			class: 'etk-bulk-bar__select-all',
			textContent: 'Select All',
			onclick: () => {
				pickable().forEach( ( f ) => picked.add( f.name ) );
				// It hides once everything is picked. Keep focus in the bar.
				if ( document.activeElement === selectAll ) bulkBar.querySelector( '.etk-bulk-bar__actions button:not(:disabled)' )?.focus();
				syncPicks();
			},
		} );
		const add = menu(
			barButton( 'Add to family', 'plus', null ),
			() => [
				...state.families.map( ( family ) => ( { label: family.name, onselect: () => moveFiles( pickedFiles(), family.name ) } ) ),
				state.families.length ? '-' : null,
				{ label: 'New family…', icon: 'plus', onselect: () => newFamily( pickedFiles() ) },
			],
			{ label: 'Add to family', align: 'start' }
		);
		bulkBar = h(
			'div',
			{ class: 'etk-bulk-bar etk-fonts__bulk', hidden: true, role: 'group', 'aria-label': 'Bulk file actions' },
			h(
				'div',
				{ class: 'etk-bulk-bar__left' },
				clearButton,
				h( 'div', { class: 'etk-bulk-bar__count', role: 'status' }, h( 'span', { class: 'etk-bulk-bar__count-number' } ), ' ', h( 'span', { class: 'etk-bulk-bar__count-label', textContent: 'selected' } ) ),
				selectAll
			),
			h( 'div', { class: 'etk-bulk-bar__divider' } ),
			h(
				'div',
				{ class: 'etk-bulk-bar__actions' },
				add,
				barButton( 'Remove from family', 'close', () => moveFiles( pickedFiles().filter( ( f ) => f.family ), null ), { className: 'etk-fonts__bulk-remove' } ),
				barButton( h( 'span', { textContent: 'Delete' } ), 'delete', () => deleteFiles( pickedFiles() ), { className: 'etk-bulk-bar__delete' } )
			)
		);
		return [ h( 'div', { class: 'etk-bulk-bar-scrim', hidden: true } ), bulkBar ];
	};

	const newFamily = ( files ) => {
		const name = window.prompt( 'Family name', files[ 0 ].name.replace( /[-_].*$|\.[^.]+$/g, '' ) );
		if ( name?.trim() ) moveFiles( files, name.trim() );
	};

	const fileMenu = ( file ) => {
		const index = state.families.findIndex( ( f ) => f.name === file.family );
		return menu( iconButton( `Actions for ${ file.name }`, 'more', null ), () => [
			index >= 0 ? { label: `Edit ${ file.family }`, onselect: () => edit( index ) } : null,
			index >= 0 ? '-' : null,
			...state.families.filter( ( f ) => f.name !== file.family ).map( ( family ) => ( { label: `${ file.family ? 'Move' : 'Add' } to ${ family.name }`, icon: 'plus', onselect: () => moveFiles( [ file ], family.name ) } ) ),
			{ label: 'New family…', icon: 'plus', onselect: () => newFamily( [ file ] ) },
			file.family ? { label: `Remove from ${ file.family }`, icon: 'close', onselect: () => moveFiles( [ file ], null ) } : null,
			'-',
			{ label: 'Delete file', icon: 'delete', danger: true, onselect: () => deleteFiles( [ file ] ) },
		] );
	};

	// Save one file's weight and style into its family.
	const saveVariant = async ( familyName, variant ) => {
		const families = clone( state.families );
		const variants = families.find( ( f ) => f.name === familyName )?.variants || [];
		const i = variants.findIndex( ( v ) => v.file === variant.file );
		if ( i < 0 ) return;
		variants[ i ] = variant;
		try {
			await saveFamilies( families, `Saved ${ variant.file } as ${ variantLabel( variant ) }.` );
		} catch ( error ) {
			warn( errorText( error ) );
		}
	};

	/*
	 * A file's weight and style, on a button that opens them in a popover.
	 * Changes save to its family when the popover closes. A file with no
	 * family has nowhere to keep them yet.
	 */
	const weightCell = ( file ) => {
		const family = state.families.find( ( f ) => f.name === file.family );
		const variant = family?.variants.find( ( v ) => v.file === file.name );
		if ( ! variant ) return h( 'td', { class: 'etk-fonts__files-none', title: 'Add it to a family to set its weight and style.', textContent: '—' } );
		const label = variantLabel( variant );
		const trigger = h(
			'button',
			{ type: 'button', class: 'etk-fonts__weight-cell', 'data-file': file.name, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': `${ label }, change weight and style of ${ file.name }` },
			h( 'span', { class: 'etk-fonts__weight-cell-label', textContent: label } ),
			h( 'span', { class: 'etk-fonts__weight-cell-icon', html: icon( 'chevron-down', 10 ) } )
		);
		trigger.addEventListener( 'click', () => {
			if ( openMenu?.trigger === trigger ) return closeMenu();
			closeMenu();
			const edited = clone( variant );
			const title = h( 'span', { class: 'etk-fonts__file-title' } );
			const body = h( 'div', { class: 'etk-fonts__popover-body' } );
			const fill = () => {
				title.textContent = variantLabel( edited );
				body.replaceChildren( weightFields( edited, fill ) );
			};
			fill();
			const popup = h(
				'div',
				{
					class: 'etk-fonts__popover',
					role: 'dialog',
					'aria-label': `Weight and style of ${ file.name }`,
					onkeydown: ( e ) => {
						if ( e.key === 'Escape' ) {
							// Not the panel's Escape, which would close the fonts manager.
							e.preventDefault();
							e.stopPropagation();
							closeMenu( { focus: true } );
						} else if ( e.key === 'Tab' ) {
							// Tabbing past either end goes back to the button.
							const stops = [ ...popup.querySelectorAll( 'input:checked, select' ) ];
							if ( document.activeElement === ( e.shiftKey ? stops[ 0 ] : stops.at( -1 ) ) ) {
								e.preventDefault();
								closeMenu( { focus: true } );
							}
						}
					},
				},
				h( 'div', { class: 'etk-fonts__popover-head' }, title, h( 'span', { class: 'etk-fonts__file-name', textContent: file.name } ) ),
				body
			);
			openPopup( trigger, popup, {
				align: 'start',
				onclose: async () => {
					if ( JSON.stringify( edited ) === JSON.stringify( variant ) ) return;
					const refocus = document.activeElement === trigger;
					await saveVariant( family.name, edited );
					if ( refocus ) main.querySelector( `.etk-fonts__weight-cell[data-file="${ CSS.escape( file.name ) }"]` )?.focus();
				},
			} );
			popup.querySelector( 'input:checked' )?.focus();
		} );
		return h( 'td', {}, trigger );
	};

	const renameFile = async ( file ) => {
		try {
			await apply( await api( 'fonts/files/rename', 'POST', { name: file.name } ), `Renamed ${ file.name }.` );
		} catch ( error ) {
			warn( errorText( error ) );
		}
	};

	const fileRow = ( file ) => {
		const done = uploadLog.find( ( e ) => e.done && e.file === file.name );
		const unused = ! file.family;
		const own = editable( file );
		return h(
			'tr',
			{ class: [ unused ? 'is-unused' : '', picked.has( file.name ) ? 'is-picked' : '' ].join( ' ' ).trim() || null },
			h( 'td', { class: 'etk-fonts__files-pick' }, own ? pickBox( file ) : null ),
			iconCell( done ? 'check' : null ),
			h( 'td', {}, h( 'span', { class: 'etk-fonts__files-name', textContent: file.name } ) ),
			own ? weightCell( file ) : h( 'td', { class: 'etk-fonts__files-none', textContent: '—' } ),
			h( 'td', {}, done ? h( 'span', { class: 'etk-fonts__muted', textContent: done.text } ) : file.unsafe ? h( 'span', { class: 'etk-fonts__files-status etk-fonts__files-status--warning', textContent: 'Needs rename', title: 'Added outside Etch Toolkit with characters it can\'t use, like brackets.' } ) : h( 'span', { class: `etk-fonts__files-status etk-fonts__files-status--${ unused ? 'warning' : 'success' }`, textContent: unused ? 'Unused' : 'In use' } ) ),
			h( 'td', { textContent: size( file.size ) } ),
			h( 'td', { class: unused ? 'etk-fonts__files-none' : null, textContent: file.family || 'No family' } ),
			h( 'td', {}, own ? fileMenu( file ) : file.unsafe ? menu( iconButton( `Actions for ${ file.name }`, 'more', null ), () => [ { label: 'Rename file', onselect: () => renameFile( file ) } ] ) : null )
		);
	};

	const FILES_EMPTY = { all: 'The fonts folder is empty.', family: 'No files are in a family yet.', unused: 'Every file is in a family.' };
	const fileRows = () => {
		const pending = fileFilter === 'all' ? uploadLog.filter( ( e ) => ! e.done || ! state.files.some( ( f ) => f.name === e.file ) ) : [];
		const rows = [ ...pending.map( logRow ), ...shownFiles().map( fileRow ) ];
		return rows.length ? rows : [ h( 'tr', {}, h( 'td', { colspan: '8', class: 'etk-fonts__files-empty etk-fonts__muted', textContent: FILES_EMPTY[ fileFilter ] } ) ) ];
	};

	const renderFiles = () => {
		const input = h( 'input', {
			type: 'file',
			multiple: true,
			accept: '.woff2,.woff,.ttf,.otf',
			class: 'screen-reader-text etk-fonts__upload-input',
			onchange: ( e ) => {
				const files = [ ...e.target.files ];
				e.target.value = '';
				uploadFiles( files );
			},
		} );
		const zone = h(
			'div',
			{ class: 'etk-fonts__dropzone etk-fonts__upload' },
			h(
				'div',
				{ class: 'etk-fonts__upload-text' },
				h( 'p', { class: 'etk-fonts__upload-eyebrow', textContent: 'Upload' } ),
				h( 'h3', { class: 'etk-fonts__upload-title', textContent: 'Drop font files anywhere.' } ),
				h( 'p', { class: 'etk-fonts__upload-body', textContent: 'Files are grouped into families by name, like Inter-BoldItalic.woff2. Anything but WOFF2 is converted in your browser first.' } ),
				h( 'div', { class: 'etk-fonts__upload-actions' }, h( 'label', { class: btnClass( 'primary', 'etk-fonts__file-btn' ) }, input, btnIcon( 'upload' ), 'Choose files' ), h( 'span', { class: 'etk-fonts__upload-formats', textContent: '.woff2 .woff .ttf .otf' } ) )
			),
			h( 'div', { class: 'etk-fonts__upload-art', html: GLYPH_STACK } )
		);
		const unused = state.files.filter( ( f ) => ! f.family ).length;
		const filter = segmented( {
			name: 'library-files',
			legend: 'Show',
			value: fileFilter,
			options: [
				{ value: 'all', label: 'All' },
				{ value: 'family', label: 'In a family' },
				{ value: 'unused', label: 'Unused', count: unused || undefined },
			],
			onchange: ( value ) => {
				fileFilter = value;
				render();
			},
		} );
		const th = ( text ) => h( 'th', { scope: 'col', textContent: text } );
		return dropTarget(
			tabPanel(
				'library',
				'files',
				zone,
				h(
					'div',
					{ class: 'etk-fonts__files' },
					h( 'div', { class: 'etk-fonts__files-toolbar' }, filter, config.fontsPath ? h( 'span', { class: 'etk-fonts__files-path', textContent: config.fontsPath } ) : null ),
					h(
						'table',
						{ class: 'etk-fonts__table etk-fonts__files-table', 'aria-label': 'Font files' },
						h(
							'thead',
							{},
							h(
								'tr',
								{},
								h(
									'td',
									{ class: 'etk-fonts__files-pick' },
									h( 'input', {
										type: 'checkbox',
										class: 'etk-fonts__pick etk-fonts__pick-all',
										'aria-label': 'Select all files',
										onclick: ( e ) => {
											const on = e.target.checked;
											pickable().forEach( ( f ) => ( on ? picked.add( f.name ) : picked.delete( f.name ) ) );
											syncPicks();
										},
									} )
								),
								h( 'td', { class: 'etk-fonts__files-icon', 'aria-hidden': 'true' } ), th( 'File' ), th( 'Weight · Style' ), th( 'Status' ), th( 'Size' ), th( 'Family' ),
								h( 'th', { scope: 'col' }, h( 'span', { class: 'screen-reader-text', textContent: 'Actions' } ) )
							)
						),
						h( 'tbody', { class: 'etk-fonts__files-body' }, fileRows() )
					)
				)
			),
			zone
		);
	};

	const renderLibrary = () => [
		pageHeader( {
			title: 'Library',
			hidden: false,
			tabs: tabs( {
				key: 'library',
				label: 'Library',
				value: libTab,
				items: [
					{ id: 'families', label: 'Families', count: state.families.length },
					{ id: 'files', label: 'Files', count: state.files.length },
				],
				onchange: ( id ) => {
					libTab = id;
					render();
				},
			} ),
			actions: [ libTab === 'families' ? addFontMenu() : null ],
		} ),
		libTab === 'files' ? renderFiles() : renderFamilies(),
	];

	/* ------------------------------------------------------------------ */
	/* Family editor                                                       */
	/* ------------------------------------------------------------------ */

	/*
	 * A family's CSS variable, after a fixed --. Empty uses the default,
	 * --font-{name}, shown as the placeholder. The copy button copies what's typed.
	 */
	const defaultVar = ( family ) => ( family.name === draft.original && ! state.families.find( ( f ) => f.name === family.name )?.variable ? state.vars[ family.name ]?.slice( 2 ) : null ) || `font-${ slugOf( family.name ) }`;
	const varField = ( family, update ) => {
		const input = h( 'input', {
			class: 'etk-fonts__input etk-fonts__input--mono etk-fonts__var-name',
			type: 'text',
			value: family.variable || '',
			placeholder: defaultVar( family ),
			spellcheck: false,
			autocomplete: 'off',
			oninput: ( e ) => {
				// Cleared, it has no key at all, so it matches the saved family again.
				const value = e.target.value.trim().replace( /^-+/, '' );
				if ( value ) family.variable = value;
				else delete family.variable;
				update( {} );
			},
		} );
		return h(
			'div',
			{ class: 'etk-fonts__var-edit' },
			h( 'span', { class: 'etk-fonts__var-prefix', 'aria-hidden': 'true', textContent: '--' } ),
			input,
			copyVar( family.name, { variant: 'icon', get: () => `var(--${ input.value.trim().replace( /^-+/, '' ) || input.placeholder })` } )
		);
	};

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
		if ( family.variable ) {
			if ( ! /^[A-Za-z0-9_-]+$/.test( family.variable ) ) return warn( 'Use letters, numbers, - and _ in the variable name.' );
			if ( Object.keys( ROLES ).some( ( role ) => family.variable === `${ role }-font-family` ) ) return warn( `--${ family.variable } is set from the heading and body roles. Pick another name.` );
			const owner = state.families.find( ( f ) => f.name !== draft.original && state.vars[ f.name ] === `--${ family.variable }` );
			if ( owner ) return warn( `${ owner.name } already uses --${ family.variable }.` );
		}

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
				const names = family.variants.map( ( v ) => v.file ).filter( ( name ) => state.files.some( ( f ) => f.name === name && ! f.family ) );
				if ( names.length ) state = await api( 'fonts/files/delete', 'POST', { names } );
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

	// Every hundred a family's files cover, and whether one covers a weight in a style.
	const weightSpan = ( weight ) => {
		const [ min, max = min ] = weight.split( ' ' ).map( Number );
		return [ min, max ];
	};
	const familyWeights = ( variants ) => {
		const weights = new Set();
		for ( const v of variants ) {
			const [ min, max ] = weightSpan( v.weight );
			weights.add( min ).add( max );
			for ( let w = Math.ceil( min / 100 ) * 100; w <= max; w += 100 ) weights.add( w );
		}
		return [ ...weights ].filter( Boolean ).sort( ( a, b ) => a - b );
	};
	const covers = ( variants, weight, style ) =>
		variants.some( ( v ) => {
			const [ min, max ] = weightSpan( v.weight );
			return v.style === style && weight >= min && weight <= max;
		} );

	// Its weight as a number for font-weight: a variable range shows at 400, or its nearest end.
	const variantWeight = ( weight ) => {
		const [ min, max = min ] = weight.split( ' ' ).map( Number );
		return Math.min( Math.max( 400, min ), max );
	};

	// Files could be edited in place: the one whose weight and style are open.
	let editingFile = null;

	/*
	 * A variant's Type, Weights (a range) or Weight, and Style, as rows. Changes
	 * go into the variant, then onchange runs. Switching Type back brings back
	 * what that side last had, for as long as the panel is open.
	 */
	const lastWeight = new Map(); // File name → { variable, static }
	const withWeight = ( list, weight ) => ( list.includes( weight ) ? list : [ ...list, weight ].sort( ( a, b ) => a - b ) );
	const weightFields = ( variant, onchange ) => {
		const variable = variant.weight.includes( ' ' );
		const memory = lastWeight.get( variant.file ) || {};
		lastWeight.set( variant.file, memory );
		memory[ variable ? 'variable' : 'static' ] = variant.weight;
		// onchange re-renders, so focus goes back to the same control after.
		const set = ( key, value ) => {
			const active = document.activeElement;
			const label = active?.getAttribute( 'aria-label' );
			const again = label ? `[aria-label="${ CSS.escape( label ) }"]` : active?.type === 'radio' ? `input[value="${ active.value }"]` : null;
			variant[ key ] = value;
			onchange();
			if ( again ) panel.querySelector( `.etk-fonts__weight-fields ${ again }` )?.focus();
		};
		const guessed = state.files.find( ( f ) => f.name === variant.file )?.weight;
		const switchTo = ( type ) =>
			set( 'weight', type === 'variable' ? memory.variable || ( guessed?.includes( ' ' ) ? guessed : '100 900' ) : memory.static || String( Math.min( 900, Math.max( 100, Math.round( variantWeight( variant.weight ) / 100 ) * 100 ) ) ) );
		const row = ( label, control, labelId ) => h( 'div', { class: 'etk-fonts__weight-row' }, h( 'span', { class: 'etk-fonts__weight-label', id: labelId, 'aria-hidden': 'true', textContent: label } ), control );
		const of = ` of ${ variant.file }`;

		let weights;
		if ( variable ) {
			const [ min, max ] = variant.weight.split( ' ' );
			const id = uid();
			weights = row(
				'Weights',
				h(
					'div',
					{ class: 'etk-fonts__weight-range', role: 'group', 'aria-labelledby': id },
					select( withWeight( WEIGHTS, min ).filter( ( w ) => +w < +max ).map( ( w ) => [ w, w ] ), min, ( value ) => set( 'weight', `${ value } ${ max }` ), { 'aria-label': `Lightest weight${ of }` } ),
					h( 'span', { class: 'etk-fonts__weight-to', 'aria-hidden': 'true', textContent: 'to' } ),
					select( withWeight( WEIGHTS, max ).filter( ( w ) => +w > +min ).map( ( w ) => [ w, w ] ), max, ( value ) => set( 'weight', `${ min } ${ value }` ), { 'aria-label': `Heaviest weight${ of }` } )
				),
				id
			);
		} else {
			weights = row( 'Weight', select( withWeight( WEIGHTS, variant.weight ).map( ( w ) => [ w, weightLabel( w ) ] ), variant.weight, ( value ) => set( 'weight', value ), { 'aria-label': `Weight${ of }` } ) );
		}

		return h(
			'div',
			{ class: 'etk-fonts__weight-fields' },
			row(
				'Type',
				segmented( {
					name: uid(),
					legend: `Type${ of }`,
					fill: true,
					value: variable ? 'variable' : 'static',
					options: [
						{ value: 'variable', label: 'Variable' },
						{ value: 'static', label: 'Static' },
					],
					onchange: switchTo,
				} )
			),
			weights,
			row(
				'Style',
				select(
					[
						[ 'normal', 'Normal' ],
						[ 'italic', 'Italic' ],
					],
					variant.style,
					( value ) => set( 'style', value ),
					{ 'aria-label': `Style${ of }` }
				)
			)
		);
	};

	const discardDraft = () => {
		editingFile = null;
		edit( state.families.findIndex( ( f ) => f.name === draft.original ) );
	};

	const renderFamily = () => {
		const family = draft.family;
		const saved = state.families.find( ( f ) => f.name === draft.original );
		const update = ( changes ) => {
			Object.assign( family, changes );
			renderSavebar();
		};
		const unused = state.files.filter( ( f ) => ! f.family && ! f.unsafe && ! family.variants.some( ( v ) => v.file === f.name ) );
		const takenBy = ( role ) => state.families.find( ( f ) => f.name !== draft.original && f.roles.includes( role ) );
		const face = `"${ draft.original }", ${ family.fallback || 'sans-serif' }`;
		const script = scriptOf( family.google?.script, family.google?.subsets );

		const specimens = weightSpecimen( {
			stack: face,
			script,
			weights: familyWeights( family.variants ),
			has: ( weight, style ) => covers( family.variants, weight, style ),
		} );

		const roleBadges = ( saved?.roles || [] ).map( ( role ) => badge( ROLES[ role ], 'accent' ) );
		if ( saved && ! saved.enabled ) roleBadges.push( badge( 'Disabled' ) );

		const familySection = section(
			{ title: 'Family', variant: 'panel' },
			field(
				'Name',
				h( 'input', {
					class: 'etk-fonts__input',
					type: 'text',
					value: family.name,
					oninput: ( e ) => {
						update( { name: e.target.value } );
						main.querySelector( '.etk-fonts__var-name' )?.setAttribute( 'placeholder', defaultVar( family ) );
					},
				} ),
				null,
				{ row: true }
			),
			field( 'Variable', varField( family, update ), null, { row: true } ),
			field( 'Fallback', h( 'input', { class: 'etk-fonts__input etk-fonts__input--mono', type: 'text', value: family.fallback, placeholder: 'system-ui, sans-serif', oninput: ( e ) => update( { fallback: e.target.value } ) } ), null, { row: true } ),
			field(
				'Display',
				select(
					[ 'swap', 'fallback', 'optional', 'block', 'auto' ].map( ( value ) => [ value, value ] ),
					family.display,
					( value ) => update( { display: value } ),
					{ class: 'etk-fonts__input--mono', title: 'font-display. swap is the usual choice.' }
				),
				null,
				{ row: true }
			)
		);

		const loadingSection = section(
			{ title: 'Loading', variant: 'panel' },
			toggle( 'Enabled', family.enabled, ( value ) => update( { enabled: value } ), family.enabled ? null : 'Keeps its files, adds nothing to the stylesheet' ),
			toggle( 'Preload', family.preload, ( value ) => update( { preload: value } ), 'Load it early, for fonts above the fold' ),
			toggle(
				'Size-matched fallback',
				!! family.metrics,
				async ( value ) => {
					if ( ! value ) {
						delete family.metrics;
						return render();
					}
					try {
						update( { metrics: await measureMetrics( draft.original, family.fallback ) } );
						announce( `Measured ${ draft.original }. Save to add the fallback.` );
					} catch ( error ) {
						warn( errorText( error ) );
					}
					render();
				},
				family.metrics ? `${ LOCALS[ family.metrics.local ] } at ${ family.metrics.size }%` : 'Resizes a local font to match, so text doesn’t jump'
			)
		);

		// A switch per role. Under it, the family that has the role now, unless it's this one.
		const roleOwner = ( role ) => {
			const other = takenBy( role );
			if ( other ) return `Currently using: ${ other.name }`;
			return saved?.roles.includes( role ) ? null : 'Currently using: nothing';
		};
		const rolesSection = section(
			{ title: state.acss ? 'Automatic.css' : 'Typography tokens', variant: 'panel' },
			state.acss ? null : h( 'p', { class: 'etk-fonts__help', textContent: 'Adds --heading-font-family or --text-font-family and applies it to headings or the body.' } ),
			...Object.entries( ROLES ).map( ( [ role, label ] ) =>
				toggle( `Use for ${ label.toLowerCase() }`, family.roles.includes( role ), ( value ) => update( { roles: value ? [ ...family.roles, role ] : family.roles.filter( ( r ) => r !== role ) } ), roleOwner( role ) )
			)
		);
		rolesSection.classList.add( 'etk-fonts__section--roles' );

		const fileInput = h( 'input', { type: 'file', multiple: true, accept: '.woff2,.woff,.ttf,.otf', class: 'screen-reader-text', tabindex: '-1', 'aria-hidden': 'true', onchange: ( e ) => uploadInto( [ ...e.target.files ] ) } );
		const addMenu = menu(
			iconButton( 'Add files', 'plus', null ),
			() => [
				{ label: 'Upload files…', icon: 'upload', onselect: () => fileInput.click() },
				unused.length ? '-' : null,
				...unused.map( ( f ) => ( {
					label: f.name,
					onselect: () => {
						family.variants.push( { file: f.name, weight: f.weight, style: f.style } );
						render();
					},
				} ) ),
			],
			{ label: 'Add files' }
		);

		const fileRow = ( variant, i ) => {
			const file = state.files.find( ( f ) => f.name === variant.file );
			const title = variantLabel( variant );
			const open = editingFile === variant.file;
			return h(
				'li',
				{ class: `etk-fonts__file-row${ open ? ' is-open' : '' }`, title: variant.file },
				h(
					'div',
					{ class: 'etk-fonts__file-main' },
					h( 'div', { class: 'etk-fonts__file-text' }, h( 'span', { class: 'etk-fonts__file-title', textContent: title } ), h( 'span', { class: 'etk-fonts__file-name', textContent: variant.file } ) ),
					file ? h( 'span', { class: 'etk-fonts__file-size', textContent: size( file.size ) } ) : null,
					menu( iconButton( `Actions for ${ variant.file }`, 'more', null ), [
						{
							label: open ? 'Done editing' : 'Change weight and style',
							onselect: () => {
								editingFile = open ? null : variant.file;
								render();
								if ( editingFile ) main.querySelector( '.etk-fonts__file-row.is-open input:checked' )?.focus();
							},
						},
						'-',
						{ label: 'Remove from family', icon: 'close', danger: true, onselect: () => ( family.variants.splice( i, 1 ), render() ) },
					] )
				),
				open ? weightFields( variant, render ) : null
			);
		};

		const filesSection = section(
			{ title: `Files · ${ family.variants.length }`, variant: 'panel', action: addMenu },
			fileInput,
			family.variants.length ? h( 'ul', { class: 'etk-fonts__file-list' }, family.variants.map( fileRow ) ) : h( 'p', { class: 'etk-fonts__help', textContent: 'No files yet. Add some with the plus button.' } ),
			family.source === 'google' ? h( 'div', { class: 'etk-fonts__family-link-wrap' }, h( 'button', { type: 'button', class: 'etk-fonts__family-link', textContent: 'Change styles…', onclick: () => installDialog( family.name ) } ) ) : null
		);
		filesSection.classList.add( 'etk-fonts__section--files' );

		return [
			h(
				'div',
				{ class: 'etk-fonts__split etk-fonts__family-view' },
				h(
					'div',
					{ class: 'etk-fonts__pane' },
					pageHeader( { title: draft.original, hidden: false, bar: true, back: { label: 'Back to the library', crumb: 'Library', onclick: () => leaveFamily( 'library' ) }, meta: roleBadges.length ? h( 'span', { class: 'etk-fonts__family-badges' }, roleBadges ) : null } ),
					h( 'div', { class: 'etk-fonts__gdetail' }, detailToolbar(), family.variants.length ? specimens : h( 'p', { class: 'etk-fonts__help', textContent: 'Add files to see its weights.' } ) )
				),
				h(
					'aside',
					{ class: 'etk-fonts__inspector', 'aria-label': `${ draft.original } settings` },
					familySection,
					loadingSection,
					rolesSection,
					filesSection,
					h(
						'div',
						{ class: 'etk-fonts__inspector-footer' },
						iconButton( `Delete ${ draft.original }`, 'trash', deleteFamily, { variant: 'danger', title: 'Delete family' } ),
						h( 'div', { class: 'etk-fonts__family-actions' }, button( 'Discard', discardDraft, { variant: 'ghost' } ), button( 'Save family', saveDraft, { variant: 'primary' } ) )
					)
				)
			),
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
		editingFile = null;
		go( next );
		return true;
	};

	// Save and Discard sit in the inspector's footer, live only with changes to save.
	const renderSavebar = () => {
		const actions = view === 'family' ? main?.querySelector( '.etk-fonts__family-actions' ) : null;
		if ( ! actions ) return;
		const show = dirty();
		// Saving or discarding disables the button under focus, so focus goes to the page title.
		if ( ! show && actions.contains( document.activeElement ) ) panel.querySelector( '.etk-fonts__page-title' )?.focus();
		actions.querySelectorAll( 'button' ).forEach( ( b ) => ( b.disabled = ! show ) );
	};

	/* ------------------------------------------------------------------ */
	/* Upload                                                              */
	/* ------------------------------------------------------------------ */

	// One entry per file in the last upload: { name, size, stage, family, file, text, done, error }.
	let uploadLog = [];

	/**
	 * Convert and upload files one by one. Each lands in the named family, or
	 * a family named after the file. Anything that isn't a font is listed as an error.
	 */
	const uploadFiles = async ( files, family = '' ) => {
		const sources = new Map();
		uploadLog = files.map( ( f ) => {
			const entry = /\.(woff2?|ttf|otf)$/i.test( f.name ) ? { name: f.name, size: f.size, stage: 'waiting', family } : { name: f.name, size: f.size, stage: 'error', error: true, text: 'Not a font file' };
			if ( ! entry.error ) sources.set( entry, f );
			return entry;
		} );
		renderLog();
		if ( ! sources.size ) return warn( 'Choose WOFF2, WOFF, TTF or OTF files.' );

		let next = null;
		let added = 0;
		for ( const [ entry, original ] of sources ) {
			try {
				entry.stage = 'converting';
				renderLog();
				const { file, note } = await prepareUpload( original );
				entry.stage = 'uploading';
				renderLog();
				const body = new FormData();
				body.append( 'file', file );
				if ( family ) body.append( 'family', family );
				next = await api( 'fonts/upload', 'POST', body );
				Object.assign( entry, { stage: 'done', done: true, file: next.uploaded.file, family: next.uploaded.family, size: file.size, text: note ? `${ note } · added` : 'Added' } );
				added++;
			} catch ( error ) {
				Object.assign( entry, { stage: 'error', error: true, text: errorText( error ) } );
			}
			renderLog();
		}

		const failed = uploadLog.length - added;
		const message = [ `Uploaded ${ plural( added, 'file', 'files' ) }.`, failed ? `${ plural( failed, 'file', 'files' ) } didn’t upload.` : null ].filter( Boolean ).join( ' ' );
		if ( next ) await apply( next, message );
		else warn( 'Nothing was uploaded.' );
	};

	// Uploads show as rows in the Files tab's table, updated in place.
	const renderLog = () => {
		const body = panel?.querySelector( '.etk-fonts__files-body' );
		if ( ! body ) return;
		keepFocus( () => body.replaceChildren( ...fileRows() ) );
		syncPicks();
	};

	/**
	 * Take files out of whatever family has them, then put them in the named
	 * family, made if it's new. With no name they're only taken out. A file
	 * moving between families keeps its weight, style and subset.
	 */
	const moveFiles = async ( files, target ) => {
		if ( ! files.length ) return;
		const names = new Set( files.map( ( f ) => f.name ) );
		const kept = new Map();
		const families = clone( state.families );
		for ( const family of families ) {
			family.variants = family.variants.filter( ( v ) => ! ( names.has( v.file ) && kept.set( v.file, v ) ) );
		}
		let family = target && families.find( ( f ) => f.name.toLowerCase() === target.toLowerCase() );
		if ( target && ! family ) {
			family = { name: target, source: 'upload', variants: [], fallback: '', display: 'swap', preload: false, enabled: true, roles: [] };
			families.push( family );
		}
		family?.variants.push( ...files.map( ( f ) => kept.get( f.name ) || { file: f.name, weight: f.weight, style: f.style } ) );

		const what = files.length === 1 ? files[ 0 ].name : plural( files.length, 'file', 'files' );
		const message = family ? `${ kept.size ? 'Moved' : 'Added' } ${ what } to ${ family.name }.` : `Removed ${ what } from ${ files.length === 1 ? files[ 0 ].family : 'their families' }.`;
		try {
			await saveFamilies( families, message );
			files.forEach( ( f ) => picked.delete( f.name ) );
			syncPicks();
		} catch ( error ) {
			warn( errorText( error ) );
		}
	};

	// Delete files from the fonts folder, taking them out of their families first.
	// A family left with no files goes too.
	const deleteFiles = async ( files ) => {
		if ( ! files.length ) return;
		const one = files.length === 1;
		const names = new Set( files.map( ( f ) => f.name ) );
		const inUse = files.filter( ( f ) => f.family );
		const emptied = state.families.filter( ( f ) => f.variants.length && f.variants.every( ( v ) => names.has( v.file ) ) );
		const taken = inUse.filter( ( f ) => ! emptied.some( ( e ) => e.name === f.family ) );
		const emptiedNames = new Intl.ListFormat( 'en' ).format( emptied.map( ( f ) => f.name ) );
		const [ has, it ] = emptied.length === 1 ? [ 'has', 'it' ] : [ 'have', 'them' ];
		const dialog = confirmDialog( {
			title: one ? `Delete ${ files[ 0 ].name }?` : `Delete ${ files.length } files?`,
			message: [
				h( 'p', { textContent: `${ one ? 'The file is' : 'They’re' } removed from the fonts folder. This can’t be undone.` } ),
				taken.length ? h( 'p', { textContent: one ? `It’s taken out of ${ taken[ 0 ].family } too.` : 'Files in a family are taken out of it too.' } ) : null,
				emptied.length ? h( 'p', { textContent: `${ emptiedNames } ${ has } no files left, so ${ emptied.length === 1 ? 'it’s' : 'they’re' } deleted too. Anything using ${ it } falls back to the next font in the stack.` } ) : null,
			].filter( Boolean ),
			confirmLabel: 'Delete',
		} );
		if ( ! ( await dialog.result ) ) return;

		let next = null;
		try {
			if ( inUse.length ) next = await api( 'fonts/families', 'POST', { families: state.families.filter( ( f ) => ! emptied.some( ( e ) => e.name === f.name ) ).map( ( f ) => ( { ...f, variants: f.variants.filter( ( v ) => ! names.has( v.file ) ) } ) ) } );
			next = await api( 'fonts/files/delete', 'POST', { names: [ ...names ] } );
			// Closed before the list re-renders, so focus is back in the list to be kept.
			dialog.close();
			const deleted = one ? files[ 0 ].name : plural( files.length, 'file', 'files' );
			await apply( next, emptied.length ? `Deleted ${ deleted } and the ${ emptiedNames } ${ emptied.length === 1 ? 'family' : 'families' }.` : `Deleted ${ deleted }.` );
		} catch ( error ) {
			if ( next ) await apply( next );
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
			Object.assign( google, { results: [ ...google.results, ...data.results ], total: data.total, categories: data.categories, subsets: data.subsets, counts: data.counts || {}, catalogue: data.catalogue || google.catalogue } );
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
	 * A native range input of nine steps from min, styled, in a bordered value
	 * box: the label first and the value last, as in the Google toolbar. CSS
	 * reads --v (1-9) for the fill.
	 */
	const valueSlider = ( { name, label, min, step, value, text, spoken, onchange } ) => {
		const output = h( 'output', { class: 'etk-fonts__valuebox-value', textContent: text( value ) } );
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
			} )
		);
		return h( 'div', { class: 'etk-fonts__inputbox etk-fonts__valuebox' }, h( 'span', { class: 'etk-fonts__inputbox-label', 'aria-hidden': 'true', textContent: name } ), range, output );
	};

	const weightSlider = () =>
		valueSlider( {
			name: 'Weight',
			label: 'Preview weight',
			min: 100,
			step: 100,
			value: google.weight,
			text: String,
			spoken: ( value ) => weightLabel( String( value ) ),
			onchange: ( value ) => {
				google.weight = value;
				main.querySelectorAll( '.etk-fonts__google-results .etk-fonts__tile-specimen' ).forEach( ( node ) => ( node.style.fontWeight = value ) );
				reloadGooglePreviews();
			},
		} );

	// The Google results preview size, remembered once you pick one.
	const sizeSlider = () =>
		valueSlider( {
			name: 'Size',
			label: 'Preview size',
			min: 16,
			step: 8,
			value: prefs.size ?? 40,
			text: String,
			spoken: ( value ) => `${ value } pixels`,
			onchange: ( value ) => {
				prefs.size = value;
				savePrefs();
				main.style.setProperty( '--etk-fonts-size', `${ value }px` );
			},
		} );

	// A single font's size, remembered once you pick one.
	const detailSizeSlider = () =>
		valueSlider( {
			name: 'Size',
			label: 'Preview size',
			min: 16,
			step: 8,
			value: prefs.detailSize ?? 32,
			text: String,
			spoken: ( value ) => `${ value } pixels`,
			onchange: ( value ) => {
				prefs.detailSize = value;
				savePrefs();
				main.style.setProperty( '--etk-fonts-detail-size', `${ value }px` );
			},
		} );

	// Preview text with a reset, then the size, over a single font's weights.
	const detailToolbar = ( onchange ) => {
		const preview = previewInput( onchange );
		const box = inputBox(
			'Preview',
			preview,
			button(
				'Reset',
				() => {
					preview.value = '';
					preview.dispatchEvent( new Event( 'input' ) );
					preview.focus();
				},
				{ variant: 'ghost', attrs: { class: 'etk-fonts__reset', 'aria-label': 'Reset preview text' } }
			)
		);
		box.classList.add( 'etk-fonts__inputbox--lg' );
		return h( 'div', { class: 'etk-fonts__gtoolbar' }, box, detailSizeSlider() );
	};

	/**
	 * A font's weights, lightest first: roman, and italic beside it if it has
	 * any. has( weight, style ) says whether a file covers that one.
	 */
	const weightSpecimen = ( { stack, script, weights, has } ) => {
		const italic = weights.some( ( w ) => has( w, 'italic' ) );
		const cell = ( weight, style ) => ( has( weight, style ) ? specimen( 'etk-fonts__gspec-cell', script, `font-family: ${ stack }; font-weight: ${ weight }; font-style: ${ style }` ) : h( 'span', { class: 'etk-fonts__gspec-cell' } ) );
		return h(
			'div',
			{ class: 'etk-fonts__gspec' },
			h( 'div', { class: 'etk-fonts__gspec-row etk-fonts__gspec-head', 'aria-hidden': 'true' }, h( 'span', { textContent: 'Weight' } ), h( 'span', { textContent: 'Roman' } ), italic ? h( 'span', { textContent: 'Italic' } ) : null ),
			h(
				'ul',
				{ class: 'etk-fonts__gspec-list', role: 'list', 'aria-label': 'Weights' },
				weights.map( ( weight ) => {
					const styles = [ has( weight, 'normal' ) ? 'roman' : null, has( weight, 'italic' ) ? 'italic' : null ].filter( Boolean ).join( ' and ' );
					return h(
						'li',
						{ class: 'etk-fonts__gspec-row' },
						h( 'span', { class: 'etk-fonts__gspec-weight' }, weightLabel( String( weight ) ), h( 'span', { class: 'screen-reader-text', textContent: `, ${ styles }` } ) ),
						cell( weight, 'normal' ),
						italic ? cell( weight, 'italic' ) : null
					);
				} )
			)
		);
	};

	const openGoogleFont = ( font ) => {
		google.font = font;
		google.pick = null;
		google.scroll = panel.querySelector( '.etk-fonts__gresults' )?.scrollTop || 0;
		loadGoogleFont();
		go( 'google-font' );
	};

	// Back to the results where you left them, focus on the family you opened.
	const closeGoogleFont = () => {
		const family = google.font.family;
		view = 'google';
		render();
		const pane = panel.querySelector( '.etk-fonts__gresults' );
		if ( pane ) pane.scrollTop = google.scroll;
		[ ...panel.querySelectorAll( '.etk-fonts__card-view' ) ].find( ( b ) => b.dataset.family === family )?.focus( { preventScroll: true } );
	};

	const addButton = ( font ) => {
		const have = installed( font.family );
		return have
			? button( 'Added', () => edit( state.families.indexOf( have ) ), { variant: 'ghost', iconName: 'check', attrs: { class: 'etk-fonts__gadd is-added', 'aria-label': `${ font.family } is added. Edit it` } } )
			: button( 'Add', () => installDialog( font.family, font ), { attrs: { class: 'etk-fonts__gadd', 'aria-label': `Add ${ font.family }` } } );
	};

	// Google's categories, in the order of the filter list: "sans serif" reads "Sans serif".
	const CATEGORIES = [ 'sans serif', 'serif', 'display', 'handwriting', 'monospace' ];
	const categoryLabel = ( category ) => ( category ? category.charAt( 0 ).toUpperCase() + category.slice( 1 ).replace( /-/g, ' ' ) : 'All' );
	const subsetLabel = ( subset ) => subset.replace( /-/g, ' ' ).replace( /\b\w/g, ( c ) => c.toUpperCase() );
	const weightsOf = ( font ) => [ ...new Set( font.cuts.map( ( c ) => parseInt( c, 10 ) ) ) ].sort( ( a, b ) => a - b );
	const hasItalics = ( font ) => font.cuts.some( ( c ) => c.endsWith( 'i' ) );

	// "100–900 · Italic": the weight range, and whether it has italics.
	const styleNote = ( font ) => {
		const weights = weightsOf( font );
		const range = font.wght?.min ? `${ font.wght.min }–${ font.wght.max }` : weights.length > 1 ? `${ weights[ 0 ] }–${ weights.at( -1 ) }` : String( weights[ 0 ] ?? '' );
		return [ range, hasItalics( font ) ? 'Italic' : null ].filter( Boolean ).join( ' · ' );
	};

	const installed = ( name ) => state.families.find( ( f ) => f.name.toLowerCase() === name.toLowerCase() );

	// The CSS variable a family has, or will have once added.
	const googleVar = ( name ) => state.vars[ installed( name )?.name ] || `--font-${ slugOf( name ) }`;

	const renderGoogleResults = () => {
		const list = panel?.querySelector( '.etk-fonts__google-results' );
		if ( ! list ) return;
		const summary = panel.querySelector( '.etk-fonts__google-summary' );
		const empty = ! google.loading && ! google.results.length;
		summary.textContent = google.error || ( google.loading && ! google.results.length ? 'Loading…' : google.total ? `${ google.total.toLocaleString() } families` : 'No families match. Try another search or filter.' );
		// Shown for errors and no results. Otherwise it's for screen readers, the counts beside the categories say the same.
		summary.classList.toggle( 'is-shown', !! google.error || empty );

		panel.querySelectorAll( '[data-count]' ).forEach( ( node ) => ( node.textContent = ( google.counts[ node.dataset.count ] ?? 0 ).toLocaleString() ) );
		const search = panel.querySelector( '.etk-fonts__gsearch input' );
		if ( search && google.catalogue ) search.placeholder = `Search ${ google.catalogue.toLocaleString() } families`;

		list.replaceChildren(
			...google.results.map( ( font ) => {
				const open = () => openGoogleFont( font );
				return h(
					'li',
					{ class: 'etk-fonts__card etk-fonts__tile etk-fonts__gtile' },
					h(
						'div',
						{ class: 'etk-fonts__tile-canvas' },
						h( 'div', { class: 'etk-fonts__tile-top' }, badge( categoryLabel( font.category ), 'tag' ), h( 'span', { class: 'etk-fonts__tile-note', textContent: styleNote( font ) } ) ),
						specimen( 'etk-fonts__tile-specimen', scriptOf( font.script, font.subsets ), `font-family: "${ font.family }", ${ font.category === 'serif' ? 'serif' : 'sans-serif' }; font-weight: ${ google.weight }` )
					),
					h(
						'div',
						{ class: 'etk-fonts__tile-meta' },
						h(
							'div',
							{ class: 'etk-fonts__tile-title' },
							h( 'h3', { class: 'etk-fonts__tile-name', textContent: font.family } ),
							h( 'span', { class: 'etk-fonts__tile-sub etk-fonts__tile-kind', textContent: font.wght?.min ? 'Variable' : 'Static only' } )
						),
						h( 'div', { class: 'etk-fonts__tile-actions' }, addButton( font ), iconButton( `View ${ font.family }`, 'chevron-right', open, { title: 'View', attrs: { class: 'etk-fonts__card-view etk-fonts__card-link', 'data-family': font.family } } ) )
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
	 * What to download of a Google family: subsets, variable or static, and
	 * styles. Starts from what's installed, if it is.
	 */
	const installChoice = ( meta ) => {
		const current = installed( meta.family );
		const hasItalic = hasItalics( meta );
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
		const slicedNote = sliced.length
			? `${ addable ? `${ sliced.join( ' and ' ) } ${ sliced.length > 1 ? 'aren’t' : 'isn’t' } offered` : `${ meta.family } can’t be added` }. Google serves ${ sliced.join( ' and ' ) } in many small files per style, which aren’t downloaded here.`
			: '';
		return { meta, current, hasItalic, canVary, offered, sliced, addable, choice, ready, slicedNote };
	};

	// Download the chosen files. Resolves with the new state, for apply().
	const installGoogle = async ( { meta, choice } ) => {
		const cuts = choice.variable ? ( choice.italic ? meta.cuts : meta.cuts.filter( ( c ) => ! c.endsWith( 'i' ) ) ) : [ ...choice.cuts ];
		const next = await api( 'fonts/google/install', 'POST', { family: meta.family, subsets: [ ...choice.subsets ], variable: choice.variable, cuts } );
		if ( draft?.original === meta.family ) {
			draft.family.variants = clone( next.families.find( ( f ) => f.name === meta.family ).variants );
		}
		return next;
	};

	const cutLabel = ( cut ) => `${ weightLabel( cut.replace( 'i', '' ) ) }${ cut.endsWith( 'i' ) ? ' Italic' : '' }`;

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

		const pick = installChoice( meta );
		const { current, hasItalic, canVary, offered, choice, ready } = pick;

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
								check( cutLabel( cut ), choice.cuts.has( cut ), ( value ) => {
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
				pick.slicedNote ? h( 'p', { class: 'etk-fonts__help', textContent: pick.slicedNote } ) : null,
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

		try {
			const next = await installGoogle( pick );
			dialog.close();
			await apply( next, `${ current ? 'Updated' : 'Added' } ${ meta.family }.` );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
		}
	};

	// Filters that need the first response: the category list and the language select.
	const googleFilter = ( key ) => {
		if ( key === 'subset' ) {
			return select( [ [ '', 'All languages' ], ...google.subsets.map( ( o ) => [ o, subsetLabel( o ) ] ) ], google.subset, ( value ) => ( ( google.subset = value ), searchGoogle() ), { id: 'etk-fonts-google-subset', class: 'etk-fonts__input--md', 'data-filter': key } );
		}
		const rank = ( c ) => ( CATEGORIES.includes( c ) ? CATEGORIES.indexOf( c ) : CATEGORIES.length );
		const categories = [ '', ...[ ...google.categories ].sort( ( a, b ) => rank( a ) - rank( b ) ) ];
		return h(
			'fieldset',
			{ class: 'etk-fonts__gcategories', 'data-filter': key },
			h( 'legend', { class: 'etk-fonts__label', textContent: 'Category' } ),
			categories.map( ( category ) =>
				h(
					'label',
					{ class: 'etk-fonts__gcategory' },
					h( 'input', { type: 'radio', name: 'etk-fonts-google-category', value: category, checked: category === google.category, onchange: () => ( ( google.category = category ), searchGoogle() ) } ),
					h( 'span', { textContent: categoryLabel( category ) } ),
					h( 'span', { class: 'etk-fonts__count', 'data-count': category, textContent: google.counts[ category ]?.toLocaleString() ?? '' } )
				)
			)
		);
	};

	const renderGoogle = () => {
		const search = h( 'input', {
			class: 'etk-fonts__input etk-fonts__input--md',
			type: 'search',
			value: google.search,
			placeholder: google.catalogue ? `Search ${ google.catalogue.toLocaleString() } families` : 'Search Google Fonts',
			'aria-label': 'Search Google Fonts',
			oninput: ( e ) => {
				google.search = e.target.value;
				window.clearTimeout( searchTimer );
				searchTimer = window.setTimeout( () => searchGoogle(), 300 );
			},
		} );

		if ( ! google.loaded && ! google.loading ) window.setTimeout( () => searchGoogle() );

		return [
			h(
				'div',
				{ class: 'etk-fonts__split' },
				h(
					'div',
					{ class: 'etk-fonts__gfilters', role: 'search', 'aria-label': 'Google Fonts' },
					h( 'div', { class: 'etk-fonts__gsearch' }, h( 'span', { class: 'etk-fonts__gsearch-icon', html: icon( 'search', 14 ) } ), search ),
					googleFilter( 'category' ),
					field( 'Language', googleFilter( 'subset' ) ),
					h(
						'div',
						{ class: 'etk-fonts__field' },
						h( 'span', { class: 'etk-fonts__label', 'aria-hidden': 'true', textContent: 'Sort' } ),
						segmented( {
							name: 'google-sort',
							legend: 'Sort',
							fill: true,
							value: google.sort,
							options: [
								{ value: 'popularity', label: 'Popular' },
								{ value: 'newest', label: 'New' },
								{ value: 'alphabetical', label: 'A–Z' },
							],
							onchange: ( value ) => ( ( google.sort = value ), searchGoogle() ),
						} )
					),
					toggle( 'Variable only', google.variable, ( value ) => ( ( google.variable = value ), searchGoogle() ) ),
					h( 'p', { class: 'etk-fonts__help etk-fonts__gfilters-note', textContent: 'Fonts are downloaded to your site, so pages make no requests to Google.' } )
				),
				h(
					'div',
					{ class: 'etk-fonts__pane etk-fonts__gresults' },
					pageHeader( 'Google Fonts' ),
					h( 'div', { class: 'etk-fonts__gtoolbar' }, inputBox( 'Preview', previewInput( reloadGooglePreviews ) ), weightSlider(), sizeSlider(), layoutToggle( 'google' ) ),
					h( 'p', { class: 'etk-fonts__help etk-fonts__google-summary', role: 'status' } ),
					h( 'ul', { class: 'etk-fonts__tiles etk-fonts__google-results', role: 'list', 'data-layout': prefs.google } ),
					h( 'div', { class: 'etk-fonts__actions etk-fonts__actions--center' }, button( 'Load more', () => google.loading || searchGoogle( true ), { variant: 'ghost', attrs: { class: 'etk-fonts__more', hidden: true } } ) )
				)
			),
		];
	};

	// Download it in the detail view's inspector. Its choices live in google.pick until you leave.
	const addGoogleFont = async () => {
		const pick = google.pick;
		if ( google.installing || ! pick?.ready() ) return;
		google.installing = true;
		render();
		try {
			const next = await installGoogle( pick );
			google.pick = null;
			await apply( next, `${ pick.current ? 'Updated' : 'Added' } ${ pick.meta.family }.` );
		} catch ( error ) {
			warn( errorText( error ) );
		}
		google.installing = false;
		render();
	};

	const renderGoogleFont = () => {
		const font = google.font;
		const pick = ( google.pick ||= installChoice( font ) );
		const { choice } = pick;
		const stack = `"${ font.family }", ${ font.category === 'serif' ? 'serif' : 'sans-serif' }`;
		const script = scriptOf( font.script, font.subsets );
		const update = ( change ) => ( value ) => {
			change( value );
			render();
		};

		const files = ( pick.offered.length ? choice.subsets.size : 1 ) * ( choice.variable ? ( choice.italic && pick.hasItalic ? 2 : 1 ) : choice.cuts.size );
		// Roman and italic side by side, lightest first.
		const cuts = [ ...font.cuts ].sort( ( a, b ) => parseInt( a, 10 ) - parseInt( b, 10 ) || a.endsWith( 'i' ) - b.endsWith( 'i' ) );
		// Latin first, the rest as Google lists them.
		const rank = ( subset ) => ( [ 'latin', 'latin-ext' ].indexOf( subset ) + 3 ) % 3;
		const subsets = [ ...pick.offered ].sort( ( a, b ) => rank( a ) - rank( b ) );

		return [
			h(
				'div',
				{ class: 'etk-fonts__split' },
				h(
					'div',
					{ class: 'etk-fonts__pane' },
					pageHeader( {
						title: font.family,
						bar: true,
						back: { label: 'Back to Google Fonts', crumb: 'Google Fonts', onclick: closeGoogleFont },
						meta: `${ categoryLabel( font.category ) } · ${ font.wght?.min ? 'Variable' : 'Static' }`,
						actions: [
							h(
								'a',
								{ class: btnClass( 'secondary' ), href: `https://fonts.google.com/specimen/${ font.family.replace( / /g, '+' ) }`, target: '_blank', rel: 'noopener' },
								'View on Google Fonts',
								h( 'span', { class: 'screen-reader-text', textContent: ' (opens in a new tab)' } ),
								btnIcon( 'external' )
							),
						],
					} ),
					h(
						'div',
						{ class: 'etk-fonts__gdetail' },
						detailToolbar( reloadGooglePreviews ),
						weightSpecimen( { stack, script, weights: weightsOf( font ), has: ( weight, style ) => font.cuts.includes( `${ weight }${ style === 'italic' ? 'i' : '' }` ) } )
					)
				),
				h(
					'aside',
					{ class: 'etk-fonts__inspector', 'aria-label': `${ pick.current ? 'Update' : 'Add' } ${ font.family }` },
					section(
						{ title: 'Files', variant: 'panel' },
						pick.canVary
							? segmented( {
									name: 'google-files',
									legend: 'Files',
									fill: true,
									value: choice.variable ? 'variable' : 'static',
									options: [
										{ value: 'variable', label: 'Variable' },
										{ value: 'static', label: 'Static' },
									],
									onchange: update( ( value ) => ( choice.variable = value === 'variable' ) ),
							  } )
							: null,
						choice.variable ? h( 'p', { class: 'etk-fonts__help', textContent: `One file per style covers weights ${ font.wght.min }–${ font.wght.max }.` } ) : null,
						choice.variable && pick.hasItalic ? toggle( 'Include italic', choice.italic, update( ( value ) => ( choice.italic = value ) ) ) : null,
						choice.variable
							? null
							: h(
									'fieldset',
									{ class: 'etk-fonts__fieldset' },
									h( 'legend', { class: 'screen-reader-text', textContent: 'Styles' } ),
									h(
										'div',
										{ class: 'etk-fonts__cuts etk-fonts__gcuts' },
										cuts.map( ( cut ) => check( cutLabel( cut ), choice.cuts.has( cut ), update( ( value ) => ( value ? choice.cuts.add( cut ) : choice.cuts.delete( cut ) ) ) ) )
									)
							  )
					),
					pick.offered.length || pick.slicedNote
						? section(
								{ title: 'Languages', variant: 'panel', action: pick.offered.length ? h( 'span', { class: 'etk-fonts__muted etk-fonts__gcount', textContent: `${ choice.subsets.size } of ${ pick.offered.length }` } ) : null },
								pick.offered.length
									? h(
											'div',
											{ class: 'etk-fonts__chips', role: 'group', 'aria-label': 'Languages' },
											subsets.map( ( subset ) => chip( subsetLabel( subset ), choice.subsets.has( subset ), update( ( value ) => ( value ? choice.subsets.add( subset ) : choice.subsets.delete( subset ) ) ) ) )
									  )
									: null,
								pick.slicedNote ? h( 'p', { class: 'etk-fonts__help', textContent: pick.slicedNote } ) : null
						  )
						: null,
					section(
						{ title: 'Summary', variant: 'panel' },
						h(
							'dl',
							{ class: 'etk-fonts__summary' },
							h( 'div', {}, h( 'dt', { textContent: 'Files' } ), h( 'dd', { textContent: String( files ) } ) ),
							h( 'div', {}, h( 'dt', { textContent: 'CSS variable' } ), h( 'dd', {}, h( 'code', { class: 'etk-fonts__code', textContent: googleVar( font.family ) } ) ) )
						),
						pick.current ? h( 'p', { class: 'etk-fonts__help', textContent: 'This replaces the family’s current files. Settings like fallback and tokens are kept.' } ) : null
					),
					h(
						'div',
						{ class: 'etk-fonts__inspector-footer' },
						button( google.installing ? 'Downloading…' : `${ pick.current ? 'Update' : 'Add' } ${ font.family }`, addGoogleFont, {
							variant: 'primary',
							iconName: google.installing || pick.current ? null : 'plus',
							attrs: { class: 'etk-fonts__btn--block', disabled: ! pick.ready(), 'aria-disabled': google.installing ? 'true' : null },
						} )
					)
				)
			),
		];
	};

	/* ------------------------------------------------------------------ */
	/* Settings                                                            */
	/* ------------------------------------------------------------------ */

	// Families left out of the export. New families start in it.
	const exportSkip = new Set();
	let exporting = false;

	// Download the chosen families with their files as one JSON file.
	const exportFonts = async ( names ) => {
		if ( exporting || ! names.length ) return;
		exporting = true;
		render();
		try {
			const params = new URLSearchParams();
			names.forEach( ( name ) => params.append( 'families[]', name ) );
			const data = await api( `fonts/export?${ params }` );
			const url = URL.createObjectURL( new Blob( [ JSON.stringify( data ) ], { type: 'application/json' } ) );
			h( 'a', { href: url, download: `fonts-${ location.hostname }.json` } ).click();
			// Revoking straight away can cancel the download in some browsers.
			window.setTimeout( () => URL.revokeObjectURL( url ), 60000 );
			announce( `Exported ${ plural( data.families.length, 'family', 'families' ) }.` );
		} catch ( error ) {
			warn( errorText( error ) );
		}
		exporting = false;
		render();
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
		const families = state.families;
		const chosen = families.filter( ( f ) => ! exportSkip.has( f.name ) );
		const bytesOf = ( family ) => family.variants.reduce( ( sum, v ) => sum + ( state.files.find( ( f ) => f.name === v.file )?.size || 0 ), 0 );
		const total = chosen.reduce( ( sum, f ) => sum + bytesOf( f ), 0 );
		const enabled = families.filter( ( f ) => f.enabled ).length;

		const all = h( 'input', {
			type: 'checkbox',
			checked: chosen.length === families.length,
			indeterminate: chosen.length > 0 && chosen.length < families.length,
			onchange: ( e ) => {
				families.forEach( ( f ) => ( e.target.checked ? exportSkip.delete( f.name ) : exportSkip.add( f.name ) ) );
				render();
			},
		} );

		const importInput = h( 'input', { type: 'file', accept: '.json,application/json', class: 'screen-reader-text', onchange: ( e ) => importFonts( e.target.files[ 0 ] ) } );
		const drop = h(
			'div',
			{
				class: 'etk-fonts__dropzone',
				ondragover: ( e ) => {
					e.preventDefault();
					drop.classList.add( 'is-over' );
				},
				ondragleave: () => drop.classList.remove( 'is-over' ),
				ondrop: ( e ) => {
					e.preventDefault();
					drop.classList.remove( 'is-over' );
					importFonts( e.dataTransfer.files[ 0 ] );
				},
			},
			h( 'span', { class: 'etk-fonts__dropzone-icon', html: icon( 'upload' ) } ),
			h( 'p', { class: 'etk-fonts__dropzone-text', textContent: 'Drop a fonts .json export, or choose a file. You’ll see what changes first.' } ),
			h( 'label', { class: btnClass( 'secondary', 'etk-fonts__file-btn' ) }, importInput, 'Choose file' )
		);

		return [
			h(
				'div',
				{ class: 'etk-fonts__settings' },
				pageHeader( 'Settings' ),
				h(
					'div',
					{ class: 'etk-fonts__settings-group' },
					section(
						{ title: 'Output', variant: 'rows' },
						h( 'div', { class: 'etk-fonts__card-row etk-fonts__setting' }, h( 'span', { class: 'etk-fonts__setting-title', textContent: 'Stylesheet' } ), h( 'span', { class: 'etk-fonts__setting-value', textContent: config.stylesheetName } ) ),
						h(
							'div',
							{ class: 'etk-fonts__card-row etk-fonts__setting' },
							h( 'span', { class: 'etk-fonts__setting-title', textContent: 'Status' } ),
							h( 'span', { class: 'etk-fonts__setting-status' }, h( 'span', { class: 'etk-fonts__dot', 'aria-hidden': 'true' } ), enabled ? `${ plural( enabled, 'family', 'families' ) }, loaded by Etch` : 'No families loaded' )
						)
					),
					h( 'p', { class: 'etk-fonts__help etk-fonts__settings-note', textContent: 'Fonts keep working without Etch Toolkit. Direct edits are overwritten when fonts change.' } )
				),
				section(
					{ title: 'Privacy', variant: 'rows' },
					h(
						'div',
						{ class: 'etk-fonts__card-row' },
						toggle(
							'Block Google Fonts from other plugins',
							state.settings.blockGoogle,
							async ( value ) => {
								try {
									await apply( await api( 'fonts/settings', 'POST', { blockGoogle: value } ), value ? 'Google Fonts from other plugins are now blocked.' : 'Google Fonts are no longer blocked.' );
								} catch ( error ) {
									warn( errorText( error ) );
								}
							},
							'Removes fonts.googleapis.com requests on the front end.'
						)
					)
				),
				families.length
					? section(
							{ title: 'Export', variant: 'rows' },
							h(
								'fieldset',
								{ class: 'etk-fonts__export' },
								h( 'legend', { class: 'screen-reader-text', textContent: 'Families to export' } ),
								h(
									'div',
									{ class: 'etk-fonts__card-row etk-fonts__export-head' },
									h( 'label', { class: 'etk-fonts__check' }, all, h( 'span', { textContent: `${ chosen.length } of ${ plural( families.length, 'family', 'families' ) }` } ) ),
									h( 'span', { class: 'etk-fonts__help', textContent: chosen.length ? `About ${ size( total ) }` : '' } )
								),
								h(
									'div',
									{ class: 'etk-fonts__export-list' },
									families.map( ( family ) =>
										h(
											'div',
											{ class: 'etk-fonts__export-row' },
											check( h( 'span', { class: 'etk-fonts__export-name', style: `font-family: "${ family.name }", var(--e-font-interface)`, textContent: family.name } ), ! exportSkip.has( family.name ), ( value ) => {
												value ? exportSkip.delete( family.name ) : exportSkip.add( family.name );
												render();
											} ),
											h( 'span', { class: 'etk-fonts__help', textContent: plural( family.variants.length, 'file', 'files' ) } )
										)
									)
								)
							),
							h(
								'div',
								{ class: 'etk-fonts__card-row etk-fonts__export-foot' },
								button( exporting ? 'Exporting…' : chosen.length ? `Export ${ plural( chosen.length, 'family', 'families' ) }` : 'Export', () => exportFonts( chosen.map( ( f ) => f.name ) ), {
									attrs: { disabled: ! chosen.length, 'aria-disabled': exporting ? 'true' : null },
								} )
							)
					  )
					: section( { title: 'Export', variant: 'rows' }, h( 'p', { class: 'etk-fonts__card-row etk-fonts__help', textContent: 'Add a family to export it.' } ) ),
				h( 'section', { class: 'etk-fonts__section etk-fonts__section--card' }, h( 'div', { class: 'etk-fonts__section-head' }, h( 'h3', { class: 'etk-fonts__label', textContent: 'Import' } ) ), drop )
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
		const views = { library: renderLibrary, family: renderFamily, google: renderGoogle, 'google-font': renderGoogleFont, settings: renderSettings };
		if ( view === 'family' && ! draft ) view = 'library';
		// Its button may be about to go.
		closeMenu();

		panel.querySelectorAll( '.etk-fonts__nav button' ).forEach( ( b ) => {
			const current = b.dataset.view === ( PARENTS[ view ] || view );
			current ? b.setAttribute( 'aria-current', 'page' ) : b.removeAttribute( 'aria-current' );
		} );
		// The same view rebuilt keeps focus. A new one gives it to its title, in go().
		const inPlace = main.dataset.view === view;
		main.dataset.view = view;
		prefs.size ? main.style.setProperty( '--etk-fonts-size', `${ prefs.size }px` ) : main.style.removeProperty( '--etk-fonts-size' );
		prefs.detailSize ? main.style.setProperty( '--etk-fonts-detail-size', `${ prefs.detailSize }px` ) : main.style.removeProperty( '--etk-fonts-detail-size' );
		const update = () => {
			main.replaceChildren( ...views[ view ]() );
			renderGoogleResults();
		};
		inPlace ? keepFocus( update ) : update();
		renderSavebar();
		syncPicks();
	};

	const build = () => {
		status = h( 'div', { class: 'etk-fonts__status', role: 'status', 'aria-live': 'polite' } );
		main = h( 'div', { class: 'etk-fonts__main' } );
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
					if ( e.key === 'Escape' && ! e.target.closest( 'dialog' ) ) {
						// Or the Escape would also cancel the unsaved-changes dialog close() may open.
						e.preventDefault();
						picked.size ? clearPicks() : close();
					}
					// Except Cmd/Ctrl+S, which saves instead of opening the browser's Save Page. Etch only
					// matches a shortcut when it saw the Cmd or Ctrl press too, so this calls its save directly.
					if ( ( e.metaKey || e.ctrlKey ) && ( e.code === 'KeyS' || e.key.toLowerCase() === 's' ) ) {
						e.preventDefault();
						window.etch?.saveAsync?.();
					}
				},
				onkeyup: ( e ) => e.stopPropagation(),
			},
			// Laid out like Etch's Content Hub: a sidebar with the back button, title and views, then the view.
			h(
				'div',
				{ class: 'etk-fonts__sidebar' },
				h( 'header', { class: 'etk-fonts__header' }, iconButton( 'Back to the builder', 'exit', () => close(), { variant: 'secondary' } ), h( 'h1', { id: 'etk-fonts-title', class: 'etk-fonts__title', textContent: 'Fonts' } ) ),
				h(
					'nav',
					{ class: 'etk-fonts__nav', 'aria-label': 'Fonts' },
					NAV.map( ( key ) => h( 'button', { type: 'button', class: 'etk-fonts__nav-item', 'data-view': key, textContent: VIEWS[ key ], onclick: () => ( view === 'family' ? leaveFamily( key ) : go( key ) ) } ) )
				)
			),
			h( 'div', { class: 'etk-fonts__body' }, status, h( 'div', { class: 'etk-fonts__content' }, main ), buildBulkBar() )
		);
		document.body.append( panel );
	};

	const open = async () => {
		if ( ! panel ) build();
		// One manager at a time, like Etch's own, so Back goes straight to the canvas.
		try {
			if ( window.etch.navigation.getCurrentPlace() !== 'builder' ) window.etch.navigation.goTo( 'builder' );
		} catch {}
		// Pinning Automatic.css's dashboard writes left and max-width onto every fixed element
		// on the page, which squeezes this one. Its place comes from fonts.css.
		panel.removeAttribute( 'style' );
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

	// focus: false when another Settings Bar button closed it, so focus stays on that one.
	const close = async ( { focus = true } = {} ) => {
		if ( ! panel || panel.hidden ) return;
		closeMenu();
		if ( view === 'family' && ! ( await leaveFamily( 'library' ) ) ) return;
		panel.hidden = true;
		document.body.classList.remove( 'etk-fonts-open' );
		controlButton?.setAttribute( 'aria-expanded', 'false' );
		controlButton?.removeAttribute( 'selected' );
		if ( focus ) controlButton?.focus();
	};

	const togglePanel = () => ( panel && ! panel.hidden ? close() : open() );

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
		bar.addAfter( { id: CONTROL_ID, icon: 'hugeicons:text-font', tooltip: 'Fonts', callback: togglePanel } );

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
			if ( clicked && clicked !== controlButton ) close( { focus: false } );
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
