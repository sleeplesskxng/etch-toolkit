/**
 * Etch Toolkit: the Recipes section of the toolkit's settings.
 *
 * Export your saved recipes, or import a file of them. An import is saved at
 * once. In the builder, the Recipes tab then takes it, with your unsaved
 * changes on top.
 */
( () => {
	const { settings, api } = window.etchToolkit || {};
	if ( ! settings ) return;

	const { h, button, group, row, dropzone, download, announce, warn, refresh, confirmDialog, errorText, builder } = settings.ui;
	const EXPORT_TYPE = 'etch-toolkit-recipes';
	const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // Mirrors ETCH_TOOLKIT_RECIPES_NAME.
	const plural = ( n ) => `${ n } ${ n === 1 ? 'recipe' : 'recipes' }`;

	let recipes = null; // As saved.

	// Etch's own recipe names, which only the builder knows.
	const etchNames = () => window.etchToolkit.recipes?.etchNames?.() ?? new Set();

	const exportRecipes = () => {
		download( JSON.stringify( { type: EXPORT_TYPE, version: 1, recipes: recipes.map( ( { name, css } ) => ( { name, css } ) ) }, null, '\t' ), 'etch-recipes.json' );
		announce( `Exported ${ plural( recipes.length ) }.` );
	};

	// What importing a file's recipes would do, sorted by outcome. A name Etch has is skipped,
	// since Etch's own would win after "?". Unusable entries, and repeats of a name, are counted.
	const planImport = ( incoming ) => {
		const plan = { added: [], replaced: [], same: [], etch: [], unusable: 0 };
		const etch = etchNames();
		const seen = new Set();
		for ( const recipe of incoming ) {
			const name = typeof recipe?.name === 'string' ? recipe.name.trim() : '';
			const css = typeof recipe?.css === 'string' ? recipe.css.trim() : '';
			if ( ! NAME.test( name ) || ! css || seen.has( name ) ) {
				plan.unusable++;
				continue;
			}
			seen.add( name );
			const existing = recipes.find( ( r ) => r.name === name );
			if ( etch.has( name ) ) plan.etch.push( { name, css } );
			else if ( ! existing ) plan.added.push( { name, css } );
			else if ( existing.css === css ) plan.same.push( { name, css } );
			else plan.replaced.push( { name, css } );
		}
		return plan;
	};

	const nameList = ( title, list ) =>
		list.length
			? h(
					'div',
					{ class: 'etk-settings-import' },
					h( 'p', { class: 'etk-settings-import__title', textContent: title } ),
					h( 'ul', { class: 'etk-settings-import__list' }, list.map( ( r ) => h( 'li', {}, h( 'code', { textContent: `?${ r.name }` } ) ) ) )
			  )
			: null;

	// Preview what a file would change. Nothing changes until Import.
	const importRecipes = async ( file ) => {
		if ( ! recipes ) return;
		let data = null;
		try {
			data = JSON.parse( await file.text() );
		} catch {}
		if ( data?.type !== EXPORT_TYPE || ! Array.isArray( data.recipes ) ) return warn( 'That file isn’t a recipes export.' );
		try {
			// Saved since this opened, like with Etch's Save, counts too.
			recipes = ( await api( 'recipes' ) ).recipes;
		} catch ( error ) {
			return warn( errorText( error ) );
		}

		const plan = planImport( data.recipes );
		const count = plan.added.length + plan.replaced.length;
		const dialog = confirmDialog( {
			title: count ? `Import ${ plural( count ) }?` : 'Nothing to import',
			message: [
				nameList( 'New', plan.added ),
				nameList( 'Replaces yours', plan.replaced ),
				nameList( 'Skipped, you already have these', plan.same ),
				nameList( 'Skipped, Etch has recipes with these names', plan.etch ),
				plan.unusable ? h( 'p', { textContent: `${ plural( plan.unusable ) } in the file couldn’t be used.` } ) : null,
			].filter( Boolean ),
			confirmLabel: 'Import',
			busyLabel: 'Importing…',
			variant: 'primary',
			form: true,
		} );
		if ( ! count ) dialog.setConfirmEnabled( false );
		if ( ! ( await dialog.result ) ) return;

		const incoming = new Map( plan.replaced.map( ( r ) => [ r.name, r ] ) );
		try {
			recipes = ( await api( 'recipes', 'PUT', { recipes: [ ...recipes.map( ( r ) => incoming.get( r.name ) ?? r ), ...plan.added ] } ) ).recipes;
			if ( builder ) window.dispatchEvent( new CustomEvent( 'etk:recipes-saved', { detail: recipes } ) );
			dialog.close();
			refresh();
			announce( `Imported ${ plural( count ) }.` );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
		}
	};

	settings.section( {
		id: 'recipes',
		title: 'Recipes',
		order: 20,
		open: async () => {
			recipes = ( await api( 'recipes' ) ).recipes;
		},
		render: () => {
			if ( ! recipes ) return h( 'p', { class: 'etk-settings__muted', textContent: 'Loading recipes…' } );
			return [
				group(
					{ title: 'Export', note: builder ? 'Exports your saved recipes. Save first to include changes made in the Recipes tab.' : null },
					row(
						h( 'span', { class: 'etk-settings__row-title', textContent: recipes.length ? `${ plural( recipes.length ) } of yours` : 'You haven’t added any recipes.' } ),
						button( 'Export recipes', exportRecipes, { attrs: { disabled: ! recipes.length } } )
					)
				),
				group( { title: 'Import', bare: true }, dropzone( 'Drop a recipes .json export, or choose a file. You’ll see what changes first.', importRecipes ) ),
			];
		},
	} );
} )();
