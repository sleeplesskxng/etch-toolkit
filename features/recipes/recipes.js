/**
 * Etch Toolkit: recipes.
 *
 * Etch's CSS editors offer "recipes" after a "?", from a list built into its
 * builder script, with nowhere to see them all or add to them. This adds a
 * Recipes tab to the Style Manager that lists them and lets you add your own,
 * which Etch then offers after "?" like its own.
 *
 * Yours change as you edit them, like Etch's styles, and are saved with
 * Etch's Save. Import and export are in the toolkit's settings, in
 * recipes-settings.js, which saves an import at once.
 */
( () => {
	const { api, el, confirmDialog, afterSave, unsaved } = window.etchToolkit || {};
	if ( ! api ) return;

	// The real Object.entries, kept before the hook below replaces it. Reading recipes
	// here goes through this, so it can't trip the hook.
	const entries = Object.entries;
	const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // Mirrors ETCH_TOOLKIT_RECIPES_NAME.

	// Your recipes as edited, and as last saved. Every edit makes a new list.
	let mine = window.etchToolkitRecipes?.recipes ?? [];
	let saved = mine;
	const same = ( a, b ) => JSON.stringify( a ) === JSON.stringify( b );

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

	/* ---- Saving, with Etch's Save ---- */

	unsaved( () => ! same( mine, saved ) );
	afterSave( async () => {
		if ( same( mine, saved ) ) return;
		const sent = mine;
		try {
			saved = ( await api( 'recipes', 'PUT', { recipes: sent } ) ).recipes;
		} catch ( err ) {
			throw new Error( `Your recipes weren’t saved. ${ err.message }` );
		}
		// The server tidies them, like trimming the CSS. Unless you've edited since, use its copy.
		if ( mine === sent && ! same( mine, saved ) ) {
			mine = saved;
			addToEtch();
			renderList();
		}
	} );

	// An import from the toolkit's settings, saved. Recipes you haven't changed take the
	// saved copy, and new ones are added. Your unsaved changes stay on top.
	window.addEventListener( 'etk:recipes-saved', ( e ) => {
		const was = new Map( saved.map( ( recipe ) => [ recipe.name, recipe ] ) );
		const now = new Map( e.detail.map( ( recipe ) => [ recipe.name, recipe ] ) );
		const refresh = selected?.kind === 'mine' && ! isDirty();
		saved = e.detail;
		mine = [
			...mine.map( ( recipe ) => ( was.has( recipe.name ) && now.has( recipe.name ) && same( recipe, was.get( recipe.name ) ) ? now.get( recipe.name ) : recipe ) ),
			...e.detail.filter( ( recipe ) => ! was.has( recipe.name ) && ! mine.some( ( m ) => m.name === recipe.name ) ),
		];
		addToEtch();
		// A recipe open with nothing pending shows what was imported over it.
		if ( refresh && ownRecipe() ) {
			draft = { ...ownRecipe() };
			renderDetail();
		}
		renderList();
	} );

	// For the settings' import preview: a name Etch has is skipped.
	window.etchToolkit.recipes = { etchNames };

	/* ---- Recipes tab ---- */

	const INNER = '.style-overview-modal__inner'; // Where every Style Manager tab renders.
	const SWITCH = '.etch-advanced-switch--tabs';
	const ETCH_TAB = '.etch-advanced-switch__button';

	let on = false;
	let selected = null; // { kind: 'etch' | 'mine', name } | { kind: 'new' } | null
	let draft = null; // { name, css } as typed, for a recipe of yours or a new one.
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

	const panel = attrs(
		el(
			'section',
			{
				className: 'etk-recipes',
				// Keep typing in the panel away from Etch's keyboard shortcuts.
				onkeydown: ( e ) => {
					e.stopPropagation();
					// Cmd/Ctrl+S takes what's typed in the form, then saves, as it would in Etch.
					if ( ( e.metaKey || e.ctrlKey ) && ( e.code === 'KeyS' || e.key.toLowerCase() === 's' ) ) {
						e.preventDefault();
						e.target.closest( 'form' )?.requestSubmit();
						window.etch?.saveAsync?.();
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
			[ el( 'div', { className: 'etk-recipes__side' }, [ searchBox, list, addButton ] ), detail ]
		),
		{ 'aria-label': 'Recipes' }
	);

	const ownRecipe = () => ( selected?.kind === 'mine' ? mine.find( ( recipe ) => recipe.name === selected.name ) : null );
	// A new recipe not added yet, or a new name that can't be used.
	const isDirty = () => !! draft && ( ownRecipe() ? draft.name !== ownRecipe().name : !! ( draft.name || draft.css ) );

	// Selecting something else drops what's pending, so ask first.
	const select = async ( next ) => {
		if ( isDirty() ) {
			const dialog = confirmDialog( {
				title: 'Discard your changes?',
				message: [ el( 'p', { textContent: ownRecipe() ? 'Its new name hasn’t been used.' : 'This recipe hasn’t been added.' } ) ],
				confirmLabel: 'Discard',
				busyLabel: 'Discard',
				variant: 'primary',
			} );
			if ( ! ( await dialog.result ) ) return;
			dialog.close();
		}
		selected = next;
		const recipe = ownRecipe();
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
		if ( mine.some( ( recipe ) => recipe.name === name && recipe.name !== ownRecipe()?.name ) ) return 'You already have a recipe with this name.';
		if ( etchNames().has( name ) ) return 'Etch has a recipe with this name.';
		return '';
	};

	/*
	 * A recipe of yours changes as you edit it, like a style's CSS in Etch: its
	 * CSS as you type, its name on Enter or when you leave the field. A new one
	 * is added with its button.
	 */
	const renderForm = () => {
		const existing = ownRecipe();
		const nameInput = attrs(
			el( 'input', {
				type: 'text',
				className: 'etk-recipes__name-input',
				value: draft.name,
				placeholder: 'recipe-name',
				spellcheck: false,
				autocomplete: 'off',
				oninput: () => ( ( draft.name = nameInput.value.trim() ), nameProblem.set( '' ) ),
				onchange: () => existing && useName(),
			} ),
			{ 'aria-label': 'Name' }
		);
		const cssInput = attrs(
			el( 'textarea', {
				value: draft.css,
				spellcheck: false,
				className: 'etk-recipes__textarea',
				oninput: () => {
					draft.css = cssInput.value;
					const css = draft.css.trim();
					cssProblem.set( css || ! existing ? '' : 'Add some CSS.' );
					if ( existing && css ) {
						mine = mine.map( ( recipe ) => ( recipe.name === selected.name ? { ...recipe, css } : recipe ) );
						addToEtch();
					}
				},
			} ),
			{ 'aria-label': 'CSS' }
		);
		const nameProblem = errorFor( nameInput );
		const cssProblem = errorFor( cssInput );
		const status = attrs( el( 'p', { className: 'etk-recipes__status' } ), { role: 'status' } );

		// Etch's own recipe with this name wins, so this one never shows after "?".
		const shadowed = el( 'p', { className: 'etk-recipes__meta', hidden: true } );
		const showShadowed = () => {
			const name = ownRecipe()?.name;
			shadowed.hidden = ! name || ! etchNames().has( name );
			shadowed.textContent = shadowed.hidden ? '' : `Etch now has its own recipe with this name, so “?${ name }” adds Etch’s. Rename this one to use it.`;
		};

		// A new name for this recipe, if it can have it.
		const useName = () => {
			const recipe = ownRecipe();
			if ( draft.name === recipe.name ) return;
			const message = nameError( draft.name );
			nameProblem.set( message );
			if ( message ) return;
			mine = mine.map( ( r ) => ( r === recipe ? { ...r, name: draft.name } : r ) );
			selected = { kind: 'mine', name: draft.name };
			addToEtch();
			renderList();
			showShadowed();
		};

		const remove = async () => {
			const dialog = confirmDialog( {
				title: `Delete ?${ existing.name }?`,
				message: [ el( 'p', { textContent: 'It won’t be offered after “?” any more. CSS already added with it stays as it is.' } ) ],
				confirmLabel: 'Delete',
			} );
			if ( ! ( await dialog.result ) ) return;
			mine = mine.filter( ( recipe ) => recipe.name !== selected.name );
			addToEtch();
			dialog.close();
			selected = null;
			draft = null;
			renderList();
			renderDetail();
			addButton.focus();
		};

		const add = () => {
			const next = { name: draft.name, css: draft.css.trim() };
			const errors = [ [ nameProblem, nameInput, nameError( next.name ) ], [ cssProblem, cssInput, next.css ? '' : 'Add some CSS.' ] ];
			errors.forEach( ( [ problem, , message ] ) => problem.set( message ) );
			const invalid = errors.find( ( [ , , message ] ) => message );
			if ( invalid ) {
				invalid[ 1 ].focus();
				return;
			}

			mine = [ ...mine, next ];
			addToEtch();
			selected = { kind: 'mine', name: next.name };
			draft = { ...next };
			renderList();
			renderDetail();
			// The form is new, so focus goes to its CSS. The message waits a moment, or a
			// screen reader can miss it in a status region that just appeared.
			detail.querySelector( 'textarea' )?.focus();
			const added = detail.querySelector( '.etk-recipes__status' );
			setTimeout( () => added?.replaceChildren( 'Added. ', ...hint( next.name ), ' Save to keep it.' ), 100 );
		};

		const form = el(
			'form',
			{
				className: 'etk-recipes__form',
				noValidate: true,
				onsubmit: ( e ) => {
					e.preventDefault();
					if ( existing ) useName();
					else add();
				},
			},
			[
				// Laid out like the Selectors tab's editor: the name and its action, then the CSS.
				el( 'div', { className: 'etk-recipes__bar' }, [
					el( 'div', { className: 'etk-recipes__name' }, [ el( 'span', { className: 'etk-recipes__q', textContent: '?' } ), nameInput ] ),
					existing
						? button( 'Delete', 'etch-builder-button--variant-outline etk-recipes__btn etk-recipes__btn--danger', remove )
						: el( 'button', { type: 'submit', className: 'etch-builder-button etch-builder-button--variant-default etk-recipes__btn', textContent: 'Add recipe' } ),
				] ),
				nameProblem.node,
				shadowed,
				cssInput,
				cssProblem.node,
				status,
			]
		);
		showShadowed();
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
			panel.remove();
			return;
		}

		if ( tab.parentElement !== tabs ) tabs.append( tab );
		tab.classList.toggle( 'etch-advanced-switch__button--active', on );
		tab.setAttribute( 'aria-pressed', String( on ) );
		body.classList.toggle( 'etk-recipes-on', on );
		if ( on && panel.parentElement !== body ) body.append( panel );
		if ( ! on ) {
			panel.remove();
		}
	};

	const schedule = () => {
		if ( ! frame ) frame = requestAnimationFrame( update );
	};

	new MutationObserver( schedule ).observe( document.body, { childList: true, subtree: true } );
} )();
