/**
 * Etch Toolkit: prop keys.
 *
 * In Etch's component editor, changing a prop's key, or its name while the
 * key follows the name, leaves every {props.oldKey} in the component's
 * layers reading nothing. Once you leave the field, they're renamed to the
 * new key: in text, attributes, loops, conditions, raw HTML and the props
 * given to nested components, and in the expressions of condition props.
 * A group's children go along with it, so props.meta.label becomes
 * props.info.label.
 *
 * Only whole keys: renaming title leaves props.titleColor alone. Not while
 * the new key belongs to another prop too, and not in scripts, where Etch
 * doesn't fill in props.
 *
 * The change is held in the builder like any other: Etch's Save writes it
 * and Cmd+Z undoes it, in a step of its own after the key's.
 *
 * Instances keep their values under the old key, where Etch no longer reads
 * them. If any on the site set one, you're asked whether to rename it there
 * too. That happens on the server once Etch's Save has written the
 * component with the new key, so a rename undone first changes nothing.
 * Etch writes back every page it has open on each Save, so if it has one
 * of those, you're asked to reload before saving again.
 */
( () => {
	// Etch's API, which shows up after this loads.
	const blocks = () => window.etch.blocks;

	const PANEL = '.component-editor-properties';
	const ROW = '[data-etch-property-key]'; // A prop's path: title, meta.label.
	const CONDITION = 'input.condition-property-content__input';

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

	// Condition props hold an expression, like props.show === true, that Etch
	// only keeps in the editor. It's set through the field, as typing would.
	const renameConditions = ( panel, from, to ) => {
		const rename = renamer( from, to );
		let count = 0;
		panel.querySelectorAll( CONDITION ).forEach( ( input ) => {
			const value = rename( input.value );
			if ( value === input.value ) return;
			input.value = value;
			input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
			count++;
		} );
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

	/* ---- Instances ---- */

	// Renames to make in instances once Etch saves: component ID => [ { from, to } ].
	const pending = new Map();
	// Posts opened in the builder this time. Etch keeps them, and every Save
	// writes them back as it has them.
	const visited = new Set();
	window.etchToolkit.onPageChange( () => {
		const id = window.etch?.navigation?.getActivePostId();
		if ( id ) visited.add( Number( id ) );
	} );

	// A path in steps, as the server reads it: items[0].label is items, [], label.
	const steps = ( path ) => path.replace( /\[\d+\]/g, '.[]' ).split( '.' );
	// Whether props have one at the path. A condition prop's props sit beside it.
	const has = ( props, path ) => {
		const [ step, ...rest ] = path;
		if ( step === '[]' ) return has( props, rest );
		return ( props || [] ).some( ( prop ) => ( prop.key === step ? ! rest.length || has( prop.properties, rest ) : prop.type?.specialized === 'condition' && has( prop.properties, path ) ) );
	};

	// The component being edited: the one on the page with a prop at this path.
	// Etch doesn't say which one its editor has open, and its list follows the
	// editor, so this is read before the key changes.
	const editedComponent = ( from ) => {
		const ids = new Set();
		const walk = ( block ) => {
			if ( block.type === 'etch/component' && block.componentId ) ids.add( Number( block.componentId ) );
			( block.children || [] ).forEach( walk );
		};
		blocks().getTree().forEach( walk );
		let found = window.etch.components.list().filter( ( component ) => ids.has( Number( component.id ) ) && has( component.properties, steps( from ) ) );
		if ( found.length > 1 ) {
			const name = document.querySelector( '.component-editor-header__name' )?.textContent.trim();
			found = found.filter( ( component ) => component.name === name );
		}
		return found.length === 1 ? Number( found[ 0 ].id ) : null;
	};

	const pageList = ( posts ) => {
		const { el } = window.etchToolkit;
		return el(
			'ul',
			{ className: 'etk-prop-keys__pages' },
			// WordPress calls components patterns.
			posts.map( ( post ) => el( 'li', { textContent: `${ post.title || '(no title)' } (${ post.postType === 'wp_block' ? 'Component' : post.type })` } ) )
		);
	};

	// A dialog with its Cancel button relabeled, giving focus back when it closes.
	const ask = ( options, cancelLabel ) => {
		const back = document.activeElement;
		const dialog = window.etchToolkit.confirmDialog( { variant: 'primary', ...options } );
		dialog.element.querySelector( '.etk-confirm__btn--cancel' ).textContent = cancelLabel;
		return dialog.result.then( ( yes ) => {
			if ( yes && ! options.keepOpen ) dialog.close();
			if ( back?.isConnected ) back.focus();
			return yes;
		} );
	};

	// Instances keep their values under the old key, where Etch no longer
	// reads them. If any set one, ask whether to rename it there on Save.
	const askAboutInstances = async ( component, from, to ) => {
		// Renamed again before saving: the instances still have the first key.
		for ( const list of pending.values() ) {
			const earlier = list.find( ( rename ) => rename.to === from );
			if ( earlier ) {
				earlier.to = to;
				if ( earlier.from === to ) list.splice( list.indexOf( earlier ), 1 );
				return;
			}
		}

		if ( ! component ) return;
		const { api, plural } = window.etchToolkit;
		const { posts } = await api( `prop-keys/instances?${ new URLSearchParams( { component, from, to } ) }` );
		if ( ! posts.length ) return;

		const instances = posts.reduce( ( sum, post ) => sum + post.elements, 0 );
		const { el } = window.etchToolkit;
		const yes = await ask(
			{
				title: 'Rename it in instances too?',
				message: [
					el( 'p', { textContent: `${ plural( instances, 'instance' ) } of this component set a value for ${ from }. Etch leaves those values under the old key, so they'd show the default instead.` } ),
					pageList( posts ),
					el( 'p', { textContent: `Rename ${ from } to ${ to } in them when you save? Each one keeps a revision.` } ),
				],
				confirmLabel: 'Rename on save',
			},
			'Leave them'
		);
		if ( yes ) pending.set( component, [ ...( pending.get( component ) || [] ), { from, to } ] );
	};

	// Once Etch has saved the component, rename in its instances. The server
	// only makes the renames the saved component agrees with.
	window.etchToolkit.afterSave( async () => {
		if ( ! pending.size ) return;
		const jobs = [ ...pending ].filter( ( [ , renames ] ) => renames.length );
		pending.clear();

		const { api, errorDialog, errorText, plural, el, reload } = window.etchToolkit;
		const posts = [];
		for ( const [ component, renames ] of jobs ) {
			try {
				posts.push( ...( await api( 'prop-keys/rename', 'POST', { component, renames } ) ).posts );
			} catch ( error ) {
				errorDialog( "Couldn't rename props in instances", errorText( error ) );
			}
		}
		if ( ! posts.length ) return;

		const done = `Renamed in ${ plural( posts.reduce( ( sum, post ) => sum + post.elements, 0 ), 'instance' ) } on ${ plural( posts.length, 'page' ) }.`;
		// Components are all loaded with the builder, and Etch keeps every post it opened.
		const stale = posts.filter( ( post ) => post.postType === 'wp_block' || visited.has( post.id ) );
		if ( ! stale.length ) {
			announce( done );
			return;
		}
		const yes = await ask(
			{
				title: 'Reload the builder',
				message: [
					el( 'p', { textContent: `${ done } The builder still has these as they were before:` } ),
					pageList( stale ),
					el( 'p', { textContent: 'Reload before you save again. Saving them as they are would put the old keys back.' } ),
				],
				confirmLabel: 'Reload now',
				busyLabel: 'Reloading…',
				keepOpen: true,
			},
			'Later'
		);
		if ( yes ) reload();
	} );

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
			// Only while it's on in the toolkit's settings.
			editing = panel && window.etchToolkit.featureOn( 'propKeys' ) && window.etch?.blocks?.isInComponentEditMode() ? { row, panel, from: row.dataset.etchPropertyKey, component: editedComponent( row.dataset.etchPropertyKey ) } : null;
		},
		true
	);

	document.addEventListener(
		'focusout',
		( event ) => {
			if ( ! editing?.row.contains( event.target ) ) return;
			const { row, panel, from, component } = editing;
			editing = null;
			const to = row.dataset.etchPropertyKey;
			if ( ! from || ! to || to === from ) return;
			// Another prop has the key too: which one props.to means is up to you.
			if ( [ ...panel.querySelectorAll( ROW ) ].filter( ( other ) => other.dataset.etchPropertyKey === to ).length > 1 ) return;
			if ( ! window.etch?.blocks?.isInComponentEditMode() ) return;
			const { plural } = window.etchToolkit;
			const layers = renameLayers( from, to );
			const conditions = renameConditions( panel, from, to );
			const places = [ layers && plural( layers, 'layer' ), conditions && plural( conditions, 'condition' ) ].filter( Boolean );
			if ( places.length ) announce( `props.${ from } renamed to props.${ to } in ${ places.join( ' and ' ) }.` );
			askAboutInstances( component, from, to ).catch( ( error ) => window.etchToolkit.errorDialog( "Couldn't check the component's instances", window.etchToolkit.errorText( error ) ) );
		},
		true
	);
} )();
