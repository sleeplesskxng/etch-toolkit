/**
 * Etch Toolkit: prop keys.
 *
 * In Etch's component editor, changing a prop's key, or its name while the
 * key follows the name, leaves every {props.oldKey} in the component's
 * layers reading nothing. Once you leave the field, they're renamed to the
 * new key: in text, attributes, loops, conditions, raw HTML and the props
 * given to nested components. A group's children go along with it, so
 * props.meta.label becomes props.info.label.
 *
 * Only whole keys: renaming title leaves props.titleColor alone. Not while
 * the new key belongs to another prop too, and not in scripts, where Etch
 * doesn't fill in props.
 *
 * Like Etch, it doesn't touch the component's instances, which keep their
 * values under the old key. The change is held in the builder like any
 * other: Etch's Save writes it and Cmd+Z undoes it, in a step of its own
 * after the key's.
 */
( () => {
	// Etch's API, which shows up after this loads.
	const blocks = () => window.etch.blocks;

	const PANEL = '.component-editor-properties';
	const ROW = '[data-etch-property-key]'; // A prop's path: title, meta.label.

	// Etch updates layers through update() for these. Anything else, like a
	// condition, takes replacing the layer.
	const UPDATABLE = new Set( [ 'text', 'target', 'attributes' ] );
	// What a layer holds besides its props: its place, its look, its script.
	const SKIP = new Set( [ 'id', 'parentId', 'children', 'type', 'version', 'context', 'options', 'styles', 'script', 'componentId' ] );

	const escape = ( text ) => text.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );

	// props.from as a whole key, also written props['from'] at the top level.
	const renamer = ( from, to ) => {
		const dot = new RegExp( `(^|[^\\w$.])props\\.${ escape( from ) }(?![\\w$])`, 'g' );
		const bracket = from.includes( '.' ) ? null : new RegExp( `(^|[^\\w$.])props\\[(['"])${ escape( from ) }\\2\\]`, 'g' );
		return ( text ) => {
			let out = text.replace( dot, ( match, before ) => `${ before }props.${ to }` );
			if ( bracket ) out = out.replace( bracket, ( match, before, quote ) => `${ before }props[${ quote }${ to }${ quote }]` );
			return out;
		};
	};

	// Every string in a value, renamed. Attribute names stay: on a nested
	// component they're its own keys.
	const renameIn = ( value, rename ) => {
		if ( typeof value === 'string' ) return rename( value );
		if ( Array.isArray( value ) ) return value.map( ( item ) => renameIn( item, rename ) );
		if ( value && typeof value === 'object' ) return Object.fromEntries( Object.entries( value ).map( ( [ key, item ] ) => [ key, renameIn( item, rename ) ] ) );
		return value;
	};

	// A layer's own fields that change.
	const changesIn = ( layer, rename ) => {
		const changes = {};
		for ( const [ key, value ] of Object.entries( layer ) ) {
			if ( SKIP.has( key ) ) continue;
			const renamed = renameIn( value, rename );
			if ( JSON.stringify( renamed ) !== JSON.stringify( value ) ) changes[ key ] = renamed;
		}
		return changes;
	};

	// A layer and everything in it, renamed, as JSON for replace(). renamed()
	// is called for each layer that changes.
	const renamedJson = ( layer, rename, renamed ) => {
		const { id, parentId, children = [], ...rest } = layer;
		const changes = changesIn( rest, rename );
		if ( Object.keys( changes ).length ) renamed();
		return { ...rest, ...changes, children: children.map( ( child ) => renamedJson( child, rename, renamed ) ) };
	};

	// Rename through the whole tree. Etch keeps everything outside the
	// component read-only while it's open, so those layers are left as they are.
	const renameLayers = ( from, to ) => {
		const rename = renamer( from, to );
		let count = 0;
		const visit = ( layer ) => {
			const changes = changesIn( layer, rename );
			const keys = Object.keys( changes );
			if ( keys.length ) {
				try {
					if ( keys.every( ( key ) => UPDATABLE.has( key ) ) ) {
						blocks().update( layer.id, changes );
						count++;
					} else {
						// Replacing takes the layers inside along, so they're renamed here too.
						let renamed = 0;
						blocks().replace( layer.id, renamedJson( blocks().getJson( layer.id ), rename, () => renamed++ ) );
						count += renamed;
						return;
					}
				} catch ( error ) {
					if ( error?.code !== 'READONLY' ) throw error;
				}
			}
			( layer.children || [] ).forEach( visit );
		};
		blocks().getTree().forEach( visit );
		return count;
	};

	let status = null;
	const announce = ( message ) => {
		if ( ! status ) {
			status = Object.assign( document.createElement( 'div' ), { className: 'etk-sr' } );
			status.setAttribute( 'role', 'status' );
			document.body.append( status );
		}
		status.textContent = '';
		// Cleared first so the same message is read again.
		window.setTimeout( () => ( status.textContent = message ), 50 );
	};

	/* ---- Watching the props panel ---- */

	// The prop being edited: its row and its key when the field took focus.
	// Etch changes the row's key as you type, so the change is read on the
	// way out, never mid-word, where title could pass through another key.
	let editing = null;

	document.addEventListener(
		'focusin',
		( event ) => {
			const row = event.target.closest?.( ROW );
			const panel = row?.closest( PANEL );
			editing = panel && window.etch?.blocks?.isInComponentEditMode() ? { row, panel, from: row.dataset.etchPropertyKey } : null;
		},
		true
	);

	document.addEventListener(
		'focusout',
		( event ) => {
			if ( ! editing?.row.contains( event.target ) ) return;
			const { row, panel, from } = editing;
			editing = null;
			const to = row.dataset.etchPropertyKey;
			if ( ! from || ! to || to === from ) return;
			// Another prop has the key too: which one props.to means is up to you.
			if ( [ ...panel.querySelectorAll( ROW ) ].filter( ( other ) => other.dataset.etchPropertyKey === to ).length > 1 ) return;
			if ( ! window.etch?.blocks?.isInComponentEditMode() ) return;
			const count = renameLayers( from, to );
			if ( count ) announce( `props.${ from } renamed to props.${ to } in ${ count === 1 ? '1 layer' : `${ count } layers` }.` );
		},
		true
	);
} )();
