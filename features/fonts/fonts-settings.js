/**
 * Etch Toolkit: the Fonts section of the toolkit's settings.
 *
 * The stylesheet's status, blocking Google Fonts from other plugins, and
 * exporting and importing families with their files. Changes apply at once.
 * In the builder, the Fonts manager then takes them, with your unsaved
 * changes on top, and writes the stylesheet. In WordPress, the server writes it.
 */
( () => {
	const { settings, api } = window.etchToolkit || {};
	const config = window.etchToolkitFontsSettings || {};
	if ( ! settings ) return;

	const { h, button, group, row, value, toggle, check, dropzone, download, announce, warn, refresh, confirmDialog, plural, size, errorText, builder } = settings.ui;
	const ROLES = { heading: 'Headings', text: 'Body text' };

	let state = null; // As the server has it: { families, files, settings, … }
	const skip = new Set(); // Families left out of the export. New families start in it.
	let exporting = false;

	// New fonts from the server. In the builder, the Fonts manager takes them too.
	const take = ( next ) => {
		state = next;
		if ( builder ) window.dispatchEvent( new CustomEvent( 'etk:fonts-state', { detail: next } ) );
	};

	const installed = ( name ) => state.families.find( ( f ) => f.name.toLowerCase() === name.toLowerCase() );

	const exportFonts = async ( names ) => {
		if ( exporting || ! names.length ) return;
		exporting = true;
		refresh();
		try {
			const params = new URLSearchParams();
			names.forEach( ( name ) => params.append( 'families[]', name ) );
			const data = await api( `fonts/export?${ params }` );
			download( data, `fonts-${ location.hostname }.json` );
			announce( `Exported ${ plural( data.families.length, 'family', 'families' ) }.` );
		} catch ( error ) {
			warn( errorText( error ) );
		}
		exporting = false;
		refresh();
	};

	/**
	 * Preview what an import changes, from the file alone, before anything is
	 * sent. Families are added or replaced by name, never removed. A family
	 * already here keeps its typography token, as the server decides it.
	 */
	const importFonts = async ( file ) => {
		if ( ! state ) return;
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
		const list = ( title, items, help ) =>
			items.length
				? h(
						'div',
						{ class: 'etk-settings-import' },
						h( 'p', { class: 'etk-settings-import__title', textContent: title } ),
						h( 'ul', { class: 'etk-settings-import__list' }, items.map( ( text ) => h( 'li', { textContent: text } ) ) ),
						help ? h( 'p', { textContent: help } ) : null
				  )
				: null;

		const dialog = confirmDialog( {
			title: `Import ${ plural( families.length, 'family', 'families' ) }?`,
			message: [
				list( 'Adds', added.map( summary ) ),
				list( 'Replaces', replaced.map( summary ), 'Their current files stay in the fonts folder, unused.' ),
				list( 'Typography tokens', tokens ),
				h( 'p', { textContent: `${ size( bytes ) } of font files. Nothing changes until you import.` } ),
			].filter( Boolean ),
			confirmLabel: 'Import',
			busyLabel: 'Importing…',
			variant: 'primary',
		} );
		if ( ! ( await dialog.result ) ) return;
		try {
			take( await api( builder ? 'fonts/import' : 'fonts/import?stylesheet=1', 'POST', data ) );
			dialog.close();
			refresh();
			announce( `Imported ${ plural( families.length, 'family', 'families' ) }.` );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
		}
	};

	const setBlockGoogle = async ( on ) => {
		try {
			take( await api( 'fonts/settings', 'POST', { blockGoogle: on } ) );
			announce( on ? 'Google Fonts from other plugins are now blocked.' : 'Google Fonts are no longer blocked.' );
		} catch ( error ) {
			warn( errorText( error ) );
		}
		refresh();
	};

	const exportGroup = () => {
		const families = state.families;
		if ( ! families.length ) return group( 'Export', row( h( 'p', { class: 'etk-settings__help', textContent: 'Add a family in the Fonts manager to export it.' } ) ) );

		const chosen = families.filter( ( f ) => ! skip.has( f.name ) );
		const bytesOf = ( family ) => family.variants.reduce( ( sum, v ) => sum + ( state.files.find( ( f ) => f.name === v.file )?.size || 0 ), 0 );
		const total = chosen.reduce( ( sum, f ) => sum + bytesOf( f ), 0 );
		const all = check(
			`${ chosen.length } of ${ plural( families.length, 'family', 'families' ) }`,
			chosen.length === families.length,
			( on ) => {
				families.forEach( ( f ) => ( on ? skip.delete( f.name ) : skip.add( f.name ) ) );
				refresh();
			}
		);
		const box = all.querySelector( 'input' );
		box.indeterminate = chosen.length > 0 && chosen.length < families.length;

		return group(
			'Export',
			h(
				'fieldset',
				{ class: 'etk-settings__fieldset' },
				h( 'legend', { class: 'screen-reader-text', textContent: 'Families to export' } ),
				row( all, h( 'span', { class: 'etk-settings__help', textContent: chosen.length ? `About ${ size( total ) }` : '' } ) ),
				...families.map( ( family ) =>
					row(
						check(
							family.name,
							! skip.has( family.name ),
							( on ) => {
								on ? skip.delete( family.name ) : skip.add( family.name );
								refresh();
							}
						),
						h( 'span', { class: 'etk-settings__help', textContent: plural( family.variants.length, 'file', 'files' ) } )
					)
				)
			),
			row(
				h( 'span', { class: 'etk-settings__row-title' } ),
				button( exporting ? 'Exporting…' : chosen.length ? `Export ${ plural( chosen.length, 'family', 'families' ) }` : 'Export', () => exportFonts( chosen.map( ( f ) => f.name ) ), {
					attrs: { disabled: ! chosen.length, 'aria-disabled': exporting ? 'true' : null },
				} )
			)
		);
	};

	settings.section( {
		id: 'fonts',
		title: 'Fonts',
		order: 10,
		open: async () => {
			state = await api( 'fonts' );
		},
		render: () => {
			if ( ! state ) return h( 'p', { class: 'etk-settings__muted', textContent: 'Loading fonts…' } );
			const enabled = state.families.filter( ( f ) => f.enabled ).length;
			return [
				group(
					{ title: 'Output', note: 'Fonts keep working without Etch Toolkit. Direct edits to the stylesheet are overwritten when fonts change.' },
					value( 'Stylesheet', config.stylesheetName || '' ),
					value( 'Status', h( 'span', { class: 'etk-settings__status-value' }, h( 'span', { class: 'etk-settings__dot', 'aria-hidden': 'true' } ), enabled ? `${ plural( enabled, 'family', 'families' ) }, loaded by Etch` : 'No families loaded' ) )
				),
				group( 'Privacy', toggle( 'Block Google Fonts from other plugins', state.settings.blockGoogle, setBlockGoogle, 'Removes fonts.googleapis.com requests on the front end.' ) ),
				exportGroup(),
				group( { title: 'Import', bare: true }, dropzone( 'Drop a fonts .json export, or choose a file. You’ll see what changes first.', importFonts ) ),
			];
		},
	} );
} )();
