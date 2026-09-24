/**
 * Etch Toolkit: recipes.
 *
 * Etch's CSS editors offer "recipes" after a "?", from a list built into its
 * builder script, with nowhere to see them all or add to them. This adds a
 * Recipes tab to the Style Manager that lists them and lets you add your own,
 * which Etch then offers after "?" like its own.
 */
( () => {
	const { api, el, confirmDialog } = window.etchToolkit || {};
	if ( ! api ) return;

	// The real Object.entries, kept before the hook below replaces it. Reading recipes
	// here goes through this, so it can't trip the hook.
	const entries = Object.entries;
	const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // Mirrors ETCH_TOOLKIT_RECIPES_NAME.

	let mine = window.etchToolkitRecipes?.recipes ?? [];

	/* ---- Your recipes in Etch's "?" list ---- */

	// Etch keeps its recipes in one object, name => { expandTo }, that it doesn't expose.
	// It lists that object with Object.entries() each time its "?" completions open, so
	// this catches it there, the first time, and adds your recipes to it.
	let expansions = null;
	const added = new Set(); // Names put in here, so Etch's own are never replaced or removed.

	const addToEtch = () => {
		if ( ! expansions ) return;
		for ( const name of added ) delete expansions[ name ];
		added.clear();
		for ( const { name, css } of mine ) {
			if ( Object.hasOwn( expansions, name ) ) continue;
			expansions[ name ] = { expandTo: css };
			added.add( name );
		}
	};

	const BUILDER_SCRIPT = /\/apps\/dist\/builder\/builder\.js\b/;

	// A recipe list has { expandTo } values, and the first one is enough to tell. Automatic.css
	// keeps lists like it too, so only one listed from Etch's builder script counts.
	const isEtchRecipeList = ( object ) => {
		if ( ! object || typeof object !== 'object' || Array.isArray( object ) ) return false;
		for ( const key in object ) {
			if ( ! Object.hasOwn( object, key ) || typeof object[ key ]?.expandTo !== 'string' ) return false;
			return BUILDER_SCRIPT.test( new Error().stack ?? '' );
		}
		return false;
	};

	const hook = ( object ) => {
		if ( ! expansions && isEtchRecipeList( object ) ) {
			expansions = object;
			addToEtch();
			// Put the original back, unless something else has wrapped it since.
			if ( Object.entries === hook ) Object.entries = entries;
		}
		return entries( object );
	};
	Object.entries = hook;

	/* ---- Etch's recipes ---- */

	// The index of the bracket that closes the one at start. Brackets in strings don't count.
	const closingBracket = ( source, start ) => {
		let depth = 0;
		for ( let i = start; i < source.length; i++ ) {
			const char = source[ i ];
			if ( char === '"' || char === "'" || char === '`' ) {
				for ( i++; source[ i ] !== char; i++ ) {
					if ( i >= source.length ) break;
					if ( source[ i ] === '\\' ) i++;
					// A ${} in a template string would be code, not a recipe.
					else if ( char === '`' && source.startsWith( '${', i ) ) throw new Error( 'Unexpected code in the recipe list.' );
				}
			} else if ( '[{('.includes( char ) ) {
				depth++;
			} else if ( ']})'.includes( char ) && --depth === 0 ) {
				return i;
			}
		}
		throw new Error( 'The recipe list never ends.' );
	};

	/**
	 * Etch's recipes, in its groups: [{ label, recipes: [{ name, css }] }]. Its builder
	 * script has them as an array of { $schema, label, expansions, wrappers } literals,
	 * which this finds and evaluates on its own. A recipe with wrapIn is wrapped the
	 * way Etch inserts it. Ones that expand from a stylesheet aren't offered by Etch.
	 */
	const readEtchRecipes = async () => {
		const script = [ ...document.scripts ].find( ( s ) => BUILDER_SCRIPT.test( s.src ) );
		if ( ! script ) throw new Error( 'Etch’s builder script isn’t on the page.' );
		const source = await ( await fetch( script.src ) ).text();
		const start = source.search( /\[\s*\{\s*\$schema\s*:\s*[`'"]expansions\.schema\.json/ );
		if ( start === -1 ) throw new Error( 'Etch’s recipe list isn’t in its builder script.' );

		// eslint-disable-next-line no-new-func -- A literal from Etch's own script, run on its own.
		const groups = new Function( `return ${ source.slice( start, closingBracket( source, start ) + 1 ) };` )();
		const wrappers = Object.assign( {}, ...groups.map( ( group ) => group.wrappers ) );
		return groups
			.map( ( group ) => ( {
				label: String( group.label ?? 'Etch' ),
				recipes: entries( group.expansions ?? {} )
					.filter( ( [ , recipe ] ) => typeof recipe?.expandTo === 'string' && ! recipe.expandFromStylesheet )
					.map( ( [ name, { expandTo, wrapIn } ] ) => ( {
						name,
						css: typeof wrappers[ wrapIn ] === 'string' ? wrappers[ wrapIn ].replace( '@slot@', () => expandTo ) : expandTo,
					} ) ),
			} ) )
			.filter( ( group ) => group.recipes.length );
	};

	let etchGroups = null; // From readEtchRecipes(), once read.
	let etchState = 'idle'; // 'idle' | 'loading' | 'done' | 'failed'

	const loadEtchRecipes = () => {
		if ( etchState !== 'idle' ) return;
		etchState = 'loading';
		readEtchRecipes()
			.then( ( groups ) => {
				etchGroups = groups;
				etchState = 'done';
			} )
			.catch( ( err ) => {
				etchState = 'failed';
				console.warn( '[Etch Toolkit] Could not read Etch’s recipes:', err );
			} )
			.finally( renderList );
	};

	// Etch's groups, or if they couldn't be read, its live list in one group once a "?" has opened it.
	const etchList = () => {
		if ( etchGroups ) return etchGroups;
		if ( ! expansions ) return [];
		const recipes = entries( expansions )
			.filter( ( [ name, recipe ] ) => ! added.has( name ) && typeof recipe?.expandTo === 'string' && ! recipe.expandFromStylesheet )
			.map( ( [ name, { expandTo } ] ) => ( { name, css: expandTo } ) );
		return recipes.length ? [ { label: 'Etch', recipes } ] : [];
	};

	const etchNames = () => {
		const names = new Set( etchList().flatMap( ( group ) => group.recipes.map( ( recipe ) => recipe.name ) ) );
		if ( expansions ) Object.keys( expansions ).forEach( ( name ) => added.has( name ) || names.add( name ) );
		return names;
	};

	/* ---- Recipes tab ---- */

	const INNER = '.style-overview-modal__inner'; // Where every Style Manager tab renders.
	const SWITCH = '.etch-advanced-switch--tabs';
	const ETCH_TAB = '.etch-advanced-switch__button';

	let on = false;
	let selected = null; // { kind: 'etch' | 'mine', name } | { kind: 'new' } | null
	let draft = null; // { name, css } as edited, for a recipe of yours or a new one.
	let saving = false;
	let query = '';
	let frame = 0;
	let ids = 0;

	const attrs = ( node, values ) => {
		for ( const [ key, value ] of entries( values ) ) {
			if ( value === false || value == null ) node.removeAttribute( key );
			else node.setAttribute( key, value === true ? '' : String( value ) );
		}
		return node;
	};

	const button = ( label, className, onclick ) => el( 'button', { type: 'button', className: `etch-builder-button ${ className }`, textContent: label, onclick } );

	const tab = attrs( el( 'button', { type: 'button', className: 'etch-advanced-switch__button etk-recipes-tab', textContent: 'Recipes', onclick: () => setOn( true ) } ), { 'aria-pressed': 'false' } );

	const search = attrs(
		el( 'input', {
			type: 'text',
			className: 'etk-recipes__search-input',
			placeholder: 'Search recipes',
			spellcheck: false,
			autocomplete: 'off',
			oninput: () => {
				query = search.value.trim().replace( /^\?/, '' ).toLowerCase();
				renderList();
			},
		} ),
		{ 'aria-label': 'Search recipes' }
	);
	// Built like the Selectors tab's search: Etch's magnifier (hugeicons "search-01") and a bare input.
	const searchBox = el( 'div', { className: 'etk-recipes__search' }, [ search ] );
	searchBox.insertAdjacentHTML(
		'afterbegin',
		'<svg class="etk-recipes__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17.5 17.5L22 22"/><path d="M20 11C20 6.02944 15.9706 2 11 2C6.02944 2 2 6.02944 2 11C2 15.9706 6.02944 20 11 20C15.9706 20 20 15.9706 20 11Z"/></svg>'
	);
	const list = el( 'div', { className: 'etk-recipes__list' } );
	const addButton = button( 'Add recipe', 'etch-builder-button--variant-default etk-recipes__add', () => select( { kind: 'new' } ) );
	const detail = el( 'div', { className: 'etk-recipes__detail' } );

	/* ---- Import and export ---- */

	const EXPORT_TYPE = 'etch-toolkit-recipes';
	const plural = ( n ) => `${ n } ${ n === 1 ? 'recipe' : 'recipes' }`;

	// For news that doesn't move focus, like an export. Emptied first so a repeat is read again.
	const announcer = attrs( el( 'p', { className: 'etk-recipes__sr' } ), { role: 'status' } );
	const announce = ( text ) => {
		announcer.textContent = '';
		setTimeout( () => ( announcer.textContent = text ), 100 );
	};

	const exportRecipes = () => {
		const json = JSON.stringify( { type: EXPORT_TYPE, version: 1, recipes: mine.map( ( { name, css } ) => ( { name, css } ) ) }, null, '\t' );
		const link = el( 'a', { href: URL.createObjectURL( new Blob( [ json ], { type: 'application/json' } ) ), download: 'etch-recipes.json' } );
		link.click();
		setTimeout( () => URL.revokeObjectURL( link.href ), 1000 );
		announce( `Exported ${ plural( mine.length ) }.` );
	};

	// What importing a file's recipes would do, sorted by outcome. A name Etch has is skipped,
	// since Etch's own would win after "?". Unusable entries, and repeats of a name, are counted.
	const planImport = ( recipes ) => {
		const plan = { added: [], replaced: [], same: [], etch: [], unusable: 0 };
		const etch = etchNames();
		const seen = new Set();
		for ( const recipe of recipes ) {
			const name = typeof recipe?.name === 'string' ? recipe.name.trim() : '';
			const css = typeof recipe?.css === 'string' ? recipe.css.trim() : '';
			if ( ! NAME.test( name ) || ! css || seen.has( name ) ) {
				plan.unusable++;
				continue;
			}
			seen.add( name );
			const existing = mine.find( ( r ) => r.name === name );
			if ( etch.has( name ) ) plan.etch.push( { name, css } );
			else if ( ! existing ) plan.added.push( { name, css } );
			else if ( existing.css === css ) plan.same.push( { name, css } );
			else plan.replaced.push( { name, css } );
		}
		return plan;
	};

	const nameList = ( title, recipes ) =>
		recipes.length ? [ el( 'p', { textContent: title } ), el( 'ul', { className: 'etk-confirm__list' }, recipes.map( ( r ) => el( 'li', {}, [ el( 'code', { textContent: `?${ r.name }` } ) ] ) ) ) ] : [];

	// Preview what a file would change, then save it. Nothing changes until Import.
	const importRecipes = async ( file ) => {
		let data = null;
		try {
			data = JSON.parse( await file.text() );
		} catch {}
		if ( data?.type !== EXPORT_TYPE || ! Array.isArray( data.recipes ) ) {
			confirmDialog( { title: '', failTitle: 'Can’t import that file', message: [], confirmLabel: 'Import' } ).fail( 'That file isn’t a recipes export.' );
			return;
		}

		const plan = planImport( data.recipes );
		const count = plan.added.length + plan.replaced.length;
		const dialog = confirmDialog( {
			title: count ? `Import ${ plural( count ) }?` : 'Nothing to import',
			message: [
				...nameList( 'New', plan.added ),
				...nameList( 'Replaces yours', plan.replaced ),
				...nameList( 'Skipped, you already have these', plan.same ),
				...nameList( 'Skipped, Etch has recipes with these names', plan.etch ),
				...( plan.unusable ? [ el( 'p', { textContent: `${ plural( plan.unusable ) } in the file couldn’t be used.` } ) ] : [] ),
			],
			confirmLabel: 'Import',
			busyLabel: 'Importing…',
			variant: 'primary',
			form: true,
		} );
		if ( ! count ) dialog.setConfirmEnabled( false );
		if ( ! ( await dialog.result ) ) return;

		const incoming = new Map( plan.replaced.map( ( r ) => [ r.name, r ] ) );
		try {
			const saved = await api( 'recipes', 'PUT', { recipes: [ ...mine.map( ( r ) => incoming.get( r.name ) ?? r ), ...plan.added ] } );
			// A recipe open with no unsaved changes shows what was imported over it.
			const refresh = selected?.kind === 'mine' && ! isDirty();
			mine = saved.recipes;
			addToEtch();
			dialog.close();
			if ( refresh && savedRecipe() ) {
				draft = { ...savedRecipe() };
				renderDetail();
			}
			renderList();
			moreButton.focus();
			announce( `Imported ${ plural( count ) }.` );
		} catch ( err ) {
			dialog.fail( err.message );
		}
	};

	const fileInput = el( 'input', {
		type: 'file',
		accept: '.json,application/json',
		hidden: true,
		onchange: () => {
			const [ file ] = fileInput.files;
			fileInput.value = '';
			if ( file ) importRecipes( file );
		},
	} );

	/* ---- Import and export menu ---- */

	const moreButton = attrs( el( 'button', { type: 'button', className: 'etch-builder-button etch-builder-button--variant-outline etk-recipes__more' } ), {
		'aria-label': 'Import and export',
		'aria-haspopup': 'menu',
		'aria-expanded': 'false',
		'aria-controls': 'etk-recipes-menu',
	} );
	moreButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

	const menuItem = ( label, onselect ) => {
		const node = attrs( el( 'button', { type: 'button', className: 'etk-recipes__menu-item', textContent: label, tabIndex: -1 } ), { role: 'menuitem' } );
		node.addEventListener( 'click', () => {
			if ( node.getAttribute( 'aria-disabled' ) === 'true' ) return;
			closeMenu( true );
			onselect();
		} );
		return node;
	};
	const choices = [ menuItem( 'Import recipes…', () => fileInput.click() ), menuItem( 'Export my recipes', exportRecipes ) ];

	const menu = attrs(
		el(
			'div',
			{
				className: 'etk-recipes__menu',
				id: 'etk-recipes-menu',
				hidden: true,
				onkeydown: ( e ) => {
					const i = choices.indexOf( document.activeElement );
					const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: -1 }[ e.key ];
					if ( next !== undefined ) {
						e.preventDefault();
						choices.at( next % choices.length ).focus();
					} else if ( e.key === 'Escape' ) {
						e.preventDefault();
						closeMenu( true );
					} else if ( e.key === 'Tab' ) {
						// Back on the button first, so Tab moves on from there.
						closeMenu( true );
					}
				},
			},
			choices
		),
		{ role: 'menu', 'aria-label': 'Import and export' }
	);

	const onOutside = ( e ) => {
		if ( ! menu.contains( e.target ) && ! moreButton.contains( e.target ) ) closeMenu();
	};

	const openMenu = ( first ) => {
		attrs( choices[ 1 ], { 'aria-disabled': ! mine.length && 'true' } );
		menu.hidden = false;
		moreButton.setAttribute( 'aria-expanded', 'true' );
		choices.at( first ).focus();
		document.addEventListener( 'pointerdown', onOutside, true );
	};

	function closeMenu( focus = false ) {
		if ( menu.hidden ) return;
		menu.hidden = true;
		moreButton.setAttribute( 'aria-expanded', 'false' );
		document.removeEventListener( 'pointerdown', onOutside, true );
		if ( focus ) moreButton.focus();
	}

	moreButton.addEventListener( 'click', () => ( menu.hidden ? openMenu( 0 ) : closeMenu() ) );
	moreButton.addEventListener( 'keydown', ( e ) => {
		if ( e.key !== 'ArrowDown' && e.key !== 'ArrowUp' ) return;
		e.preventDefault();
		openMenu( e.key === 'ArrowUp' ? -1 : 0 );
	} );

	const panel = attrs(
		el(
			'section',
			{
				className: 'etk-recipes',
				// Keep typing in the panel away from Etch's keyboard shortcuts.
				onkeydown: ( e ) => {
					e.stopPropagation();
					// Cmd/Ctrl+S saves the recipe being edited, or else the page, as it would in Etch.
					if ( ( e.metaKey || e.ctrlKey ) && ( e.code === 'KeyS' || e.key.toLowerCase() === 's' ) ) {
						e.preventDefault();
						const form = e.target.closest( 'form' );
						if ( form ) form.requestSubmit();
						else window.etch?.saveAsync?.();
					}
					// Up and down through the list.
					if ( ( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) && e.target.closest( '.etk-recipes__item' ) ) {
						e.preventDefault();
						const items = [ ...list.querySelectorAll( '.etk-recipes__item' ) ];
						items[ items.indexOf( e.target ) + ( e.key === 'ArrowDown' ? 1 : -1 ) ]?.focus();
					}
				},
				onkeyup: ( e ) => e.stopPropagation(),
			},
			[ el( 'div', { className: 'etk-recipes__side' }, [ el( 'div', { className: 'etk-recipes__search-row' }, [ searchBox, moreButton, menu ] ), list, addButton ] ), detail, fileInput, announcer ]
		),
		{ 'aria-label': 'Recipes' }
	);

	const savedRecipe = () => ( selected?.kind === 'mine' ? mine.find( ( recipe ) => recipe.name === selected.name ) : null );
	const isDirty = () => !! draft && ( savedRecipe() ? draft.name !== savedRecipe().name || draft.css !== savedRecipe().css : !! ( draft.name || draft.css ) );

	// Selecting something else drops unsaved changes, so ask first.
	const select = async ( next ) => {
		if ( isDirty() ) {
			const dialog = confirmDialog( {
				title: 'Discard your changes?',
				message: [ el( 'p', { textContent: 'Your changes to this recipe haven’t been saved.' } ) ],
				confirmLabel: 'Discard',
				busyLabel: 'Discard',
				variant: 'primary',
			} );
			if ( ! ( await dialog.result ) ) return;
			dialog.close();
		}
		selected = next;
		const recipe = savedRecipe();
		draft = next.kind === 'new' ? { name: '', css: '' } : recipe ? { ...recipe } : null;
		renderList();
		renderDetail();
		if ( next.kind === 'new' ) detail.querySelector( 'input' )?.focus();
	};

	const item = ( recipe, kind ) => {
		const current = selected?.kind === kind && selected.name === recipe.name;
		return el( 'li', {}, [
			attrs( el( 'button', { type: 'button', className: 'etk-recipes__item', onclick: () => current || select( { kind, name: recipe.name } ) }, [ el( 'span', { className: 'etk-recipes__q', textContent: '?' } ), recipe.name ] ), {
				'aria-current': current && 'true',
			} ),
		] );
	};

	// A heading and its recipes, or a note when there are none.
	const group = ( label, recipes, kind, empty ) => {
		const id = `etk-recipes-group-${ ++ids }`;
		return el( 'section', { className: 'etk-recipes__group' }, [
			el( 'h3', { className: 'etk-recipes__group-title', id, textContent: label } ),
			recipes.length ? attrs( el( 'ul', {}, recipes.map( ( recipe ) => item( recipe, kind ) ) ), { 'aria-labelledby': id } ) : el( 'p', { className: 'etk-recipes__note', textContent: empty } ),
		] );
	};

	const matches = ( recipe ) => ! query || recipe.name.includes( query );

	function renderList() {
		const sections = [];

		const own = [ ...mine ].sort( ( a, b ) => a.name.localeCompare( b.name ) ).filter( matches );
		if ( own.length || ! query ) sections.push( group( 'My recipes', own, 'mine', 'None yet. Add one below.' ) );

		for ( const { label, recipes } of etchList() ) {
			const found = recipes.filter( matches );
			if ( found.length ) sections.push( group( label, found, 'etch' ) );
		}

		if ( etchState === 'loading' && ! etchList().length ) sections.push( el( 'p', { className: 'etk-recipes__note', textContent: 'Loading Etch’s recipes…' } ) );
		if ( etchState === 'failed' && ! etchList().length ) sections.push( el( 'p', { className: 'etk-recipes__note', textContent: 'Couldn’t read Etch’s recipes. Yours still work.' } ) );
		if ( query && ! sections.length ) sections.push( el( 'p', { className: 'etk-recipes__note', textContent: 'No recipes match.' } ) );

		// Keep focus on the list item it was on, which is rebuilt.
		const focused = list.contains( document.activeElement ) ? document.activeElement.textContent : null;
		list.replaceChildren( ...sections );
		if ( focused ) [ ...list.querySelectorAll( '.etk-recipes__item' ) ].find( ( b ) => b.textContent === focused )?.focus();
	}

	const hint = ( name ) => [ 'Type ', el( 'code', { textContent: `?${ name }` } ), ' in any CSS editor to add it.' ];

	const renderEtch = ( recipe ) => {
		const copy = button( 'Copy CSS', 'etch-builder-button--variant-outline etk-recipes__btn', async () => {
			try {
				await navigator.clipboard.writeText( recipe.css );
				copy.textContent = 'Copied';
			} catch {
				copy.textContent = 'Couldn’t copy';
			}
			setTimeout( () => ( copy.textContent = 'Copy CSS' ), 1500 );
		} );
		// Laid out like the Selectors tab's editor: the name and its action, then the CSS.
		detail.replaceChildren(
			el( 'div', { className: 'etk-recipes__bar' }, [ el( 'h2', { className: 'etk-recipes__title', textContent: `?${ recipe.name }` } ), copy ] ),
			attrs( el( 'pre', { className: 'etk-recipes__code', tabIndex: 0 }, [ el( 'code', { textContent: recipe.css } ) ] ), { 'aria-label': `CSS for ?${ recipe.name }` } )
		);
	};

	// An error line for an input, tied to it for screen readers while it shows.
	const errorFor = ( input ) => {
		const error = el( 'p', { className: 'etk-recipes__error', id: `etk-recipes-error-${ ++ids }`, hidden: true } );
		return {
			node: error,
			set( message ) {
				error.textContent = message;
				error.hidden = ! message;
				attrs( input, { 'aria-invalid': !! message && 'true', 'aria-describedby': message ? error.id : false } );
			},
		};
	};

	const nameError = ( name ) => {
		if ( ! name ) return 'Give it a name.';
		if ( ! NAME.test( name ) ) return 'Use lowercase letters, numbers and hyphens.';
		if ( mine.some( ( recipe ) => recipe.name === name && recipe.name !== savedRecipe()?.name ) ) return 'You already have a recipe with this name.';
		if ( etchNames().has( name ) ) return 'Etch has a recipe with this name.';
		return '';
	};

	const renderForm = () => {
		const existing = savedRecipe();
		const nameInput = attrs( el( 'input', { type: 'text', className: 'etk-recipes__name-input', value: draft.name, placeholder: 'recipe-name', spellcheck: false, autocomplete: 'off', oninput: () => ( ( draft.name = nameInput.value.trim() ), changed() ) } ), {
			'aria-label': 'Name',
		} );
		const cssInput = attrs( el( 'textarea', { value: draft.css, spellcheck: false, className: 'etk-recipes__textarea', oninput: () => ( ( draft.css = cssInput.value ), changed() ) } ), { 'aria-label': 'CSS' } );
		const nameProblem = errorFor( nameInput );
		const cssProblem = errorFor( cssInput );
		const status = attrs( el( 'p', { className: 'etk-recipes__status' } ), { role: 'status' } );
		const saveButton = el( 'button', { type: 'submit', className: 'etch-builder-button etch-builder-button--variant-default etk-recipes__btn', textContent: existing ? 'Save' : 'Add recipe' } );

		// Etch's own recipe with this name wins, so this one never shows after "?".
		const shadowed = existing && etchNames().has( existing.name ) ? el( 'p', { className: 'etk-recipes__meta', textContent: 'Etch now has its own recipe with this name, so “?' + existing.name + '” adds Etch’s. Rename this one to use it.' } ) : null;

		function changed() {
			status.textContent = '';
			status.classList.remove( 'is-error' );
			nameProblem.set( '' );
			cssProblem.set( '' );
		}

		const remove = async () => {
			const dialog = confirmDialog( {
				title: `Delete ?${ existing.name }?`,
				message: [ el( 'p', { textContent: 'It won’t be offered after “?” any more. CSS already added with it stays as it is.' } ) ],
				confirmLabel: 'Delete',
			} );
			if ( ! ( await dialog.result ) ) return;
			try {
				const data = await api( 'recipes', 'PUT', { recipes: mine.filter( ( recipe ) => recipe.name !== existing.name ) } );
				mine = data.recipes;
				addToEtch();
				dialog.close();
				selected = null;
				draft = null;
				renderList();
				renderDetail();
				addButton.focus();
			} catch ( err ) {
				dialog.fail( err.message );
			}
		};

		const form = el(
			'form',
			{
				className: 'etk-recipes__form',
				noValidate: true,
				onsubmit: async ( e ) => {
					e.preventDefault();
					if ( saving ) return;
					const next = { name: draft.name, css: draft.css.trim() };
					const errors = [ [ nameProblem, nameInput, nameError( next.name ) ], [ cssProblem, cssInput, next.css ? '' : 'Add some CSS.' ] ];
					errors.forEach( ( [ problem, , message ] ) => problem.set( message ) );
					const invalid = errors.find( ( [ , , message ] ) => message );
					if ( invalid ) {
						invalid[ 1 ].focus();
						return;
					}

					saving = true;
					saveButton.setAttribute( 'aria-disabled', 'true' );
					status.textContent = 'Saving…';
					try {
						const data = await api( 'recipes', 'PUT', { recipes: existing ? mine.map( ( recipe ) => ( recipe.name === existing.name ? next : recipe ) ) : [ ...mine, next ] } );
						mine = data.recipes;
						addToEtch();
						selected = { kind: 'mine', name: next.name };
						draft = { ...next };
						renderList();
						renderDetail();
						// The form is new, so focus goes back to its Save button. The message waits a
						// moment, or a screen reader can miss it in a status region that just appeared.
						detail.querySelector( 'button[type="submit"]' )?.focus();
						const saved = detail.querySelector( '.etk-recipes__status' );
						setTimeout( () => saved?.replaceChildren( 'Saved. ', ...hint( next.name ) ), 100 );
					} catch ( err ) {
						status.textContent = err.message;
						status.classList.add( 'is-error' );
					} finally {
						saving = false;
						saveButton.removeAttribute( 'aria-disabled' );
					}
				},
			},
			[
				// Laid out like the Selectors tab's editor: the name and its actions, then the CSS.
				el( 'div', { className: 'etk-recipes__bar' }, [
					el( 'div', { className: 'etk-recipes__name' }, [ el( 'span', { className: 'etk-recipes__q', textContent: '?' } ), nameInput ] ),
					...( existing ? [ button( 'Delete', 'etch-builder-button--variant-outline etk-recipes__btn etk-recipes__btn--danger', remove ) ] : [] ),
					saveButton,
				] ),
				nameProblem.node,
				...( shadowed ? [ shadowed ] : [] ),
				cssInput,
				cssProblem.node,
				status,
			]
		);
		detail.replaceChildren( form );
	};

	function renderDetail() {
		if ( selected?.kind === 'etch' ) {
			for ( const { recipes } of etchList() ) {
				const recipe = recipes.find( ( r ) => r.name === selected.name );
				if ( recipe ) return renderEtch( recipe );
			}
		}
		if ( draft ) return renderForm();
		detail.replaceChildren(
			el( 'div', { className: 'etk-recipes__empty' }, [
				el( 'p', { textContent: 'Recipes are snippets you add by typing “?” and a name in any CSS editor.' } ),
				el( 'p', { textContent: 'Pick one to see its CSS, or add your own.' } ),
			] )
		);
	}

	const setOn = ( value ) => {
		if ( value === on ) return;
		on = value;
		if ( on ) {
			loadEtchRecipes();
			renderList();
			renderDetail();
		}
		schedule();
	};

	// Clicking one of Etch's tabs leaves Recipes.
	document.addEventListener(
		'click',
		( event ) => {
			if ( on && event.target.closest?.( `${ SWITCH } > ${ ETCH_TAB }:not(.etk-recipes-tab)` ) ) setOn( false );
		},
		true
	);

	/* ---- Render ---- */

	const update = () => {
		frame = 0;
		const body = document.querySelector( INNER )?.parentElement;
		const tabs = body?.querySelector( `:scope > ${ SWITCH }` );

		// Style Manager closed. Your draft stays for next time.
		if ( ! tabs ) {
			on = false;
			closeMenu();
			panel.remove();
			return;
		}

		if ( tab.parentElement !== tabs ) tabs.append( tab );
		tab.classList.toggle( 'etch-advanced-switch__button--active', on );
		tab.setAttribute( 'aria-pressed', String( on ) );
		body.classList.toggle( 'etk-recipes-on', on );
		if ( on && panel.parentElement !== body ) body.append( panel );
		if ( ! on ) {
			closeMenu();
			panel.remove();
		}
	};

	const schedule = () => {
		if ( ! frame ) frame = requestAnimationFrame( update );
	};

	new MutationObserver( schedule ).observe( document.body, { childList: true, subtree: true } );
} )();
