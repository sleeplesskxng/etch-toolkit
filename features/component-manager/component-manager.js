/**
 * Etch Toolkit: component manager.
 *
 * A Settings Bar control opens a manager beside the bar, headed like Etch's
 * Style Manager. It lists the site's components and where they're used, in
 * a table like the Fonts manager's files. Each row's buttons edit one in
 * Etch's component editor, update it from a JSON file or pasted JSON after
 * reviewing the changes, or delete it. Its More menu copies or downloads it
 * as Etch's copy JSON, to paste into Etch on any site. Checkboxes pick
 * several for the bulk bar, to download (a file each) or delete.
 *
 * It reads three shapes:
 * - Etch's copy (Cmd+C on a layer): { version, gutenbergBlock, styles,
 *   components }, where components holds each component's Gutenberg blocks.
 * - One component, or a list of them: { name, key, blocks, properties }, with
 *   blocks as Etch's layer JSON (window.etch.components.getJson()) or as
 *   Gutenberg blocks (Etch's REST API).
 *
 * Every component's blocks become Etch's layer JSON, the shape
 * window.etch.components.getJson() gives and updateAsync() takes.
 *
 * Shown while the toolkit's Component manager setting (General) is on.
 */
( () => {
	const toolkit = window.etchToolkit || {};
	if ( ! toolkit.api ) return;

	const CONTROL_ID = 'etch-toolkit-component-manager';
	const { el, plural, errorText, settingsBarButton, managerKeys, openManager, downloadJson, jsonDropzone, searchBox, menu, barButton, bulkBar } = toolkit;
	const icon = ( name, size ) => toolkit.icon( name, { size, className: 'etk-components__icon' } );

	const enabled = () => window.etchToolkitSettings?.settings?.componentManager === true && typeof window.etch?.components?.updateAsync === 'function';

	const isObject = ( value ) => !! value && typeof value === 'object' && ! Array.isArray( value );

	/* ------------------------------------------------------------------ */
	/* Reading JSON                                                        */
	/* ------------------------------------------------------------------ */

	// Etch saves a layer's script as base64 of its UTF-8.
	const fromBase64 = ( text ) => new TextDecoder().decode( Uint8Array.from( atob( text ), ( c ) => c.charCodeAt( 0 ) ) );
	const stringValues = ( attributes ) => ( isObject( attributes ) ? Object.fromEntries( Object.entries( attributes ).map( ( [ k, v ] ) => [ k, String( v ) ] ) ) : {} );

	/**
	 * A Gutenberg block as Etch's layer JSON, the way Etch's builder reads a
	 * saved block. Blocks Etch doesn't draw as its own pass through whole, and
	 * an empty paragraph is dropped, as Etch drops it.
	 */
	const fromGutenberg = ( block ) => {
		const attrs = isObject( block.attrs ) ? block.attrs : {};
		const context = {};
		if ( attrs.hidden ) context.hidden = true;
		if ( attrs.metadata?.name ) context.name = attrs.metadata.name;
		const base = { type: block.blockName, version: 1, context, options: isObject( attrs.options ) ? { ...attrs.options } : {}, children: [] };
		if ( typeof attrs.script?.code === 'string' ) base.script = { code: fromBase64( attrs.script.code ) };
		const children = () => fromGutenbergList( block.innerBlocks || [] );

		switch ( block.blockName ) {
			case 'etch/text':
				return { ...base, text: attrs.content || '' };
			case 'etch/element':
				return { ...base, tag: attrs.tag || 'div', attributes: stringValues( attrs.attributes ), styles: attrs.styles || [], children: children() };
			case 'etch/svg':
			case 'etch/dynamic-image':
				return { ...base, attributes: stringValues( attrs.attributes ), styles: attrs.styles || [] };
			case 'etch/dynamic-element': {
				const attributes = stringValues( attrs.attributes );
				if ( attrs.tag && ( attributes.tag ? attributes.tag !== attrs.tag : attrs.tag !== 'div' ) ) attributes.tag = attrs.tag;
				return { ...base, attributes, styles: attrs.styles || [], children: children() };
			}
			case 'etch/loop':
				return { ...base, target: attrs.target, loopId: attrs.loopId, loopParams: attrs.loopParams, itemId: attrs.itemId ?? 'item', indexId: attrs.indexId, children: children() };
			case 'etch/component':
				return { ...base, componentId: attrs.ref, attributes: isObject( attrs.attributes ) ? attrs.attributes : {}, children: children() };
			case 'etch/condition':
				return { ...base, conditionString: attrs.conditionString, children: children() };
			case 'etch/slot-content':
				return { ...base, slotName: attrs.name, children: children() };
			case 'etch/slot-placeholder':
				return { ...base, slotName: attrs.name };
			case 'etch/raw-html':
				return { ...base, content: attrs.content || '', unsafe: attrs.unsafe || '' };
		}
		if ( block.blockName === 'core/paragraph' && ! block.innerBlocks?.length && block.innerHTML?.trim() === '<p></p>' ) return null;
		return { ...base, type: 'etch/passthrough', gutenbergBlock: block };
	};
	const fromGutenbergList = ( blocks ) => blocks.filter( ( block ) => block?.blockName ).map( fromGutenberg ).filter( Boolean );

	// Blocks in either shape, as layer JSON. Etch's layer JSON has a type, Gutenberg's a blockName.
	const layerJson = ( blocks ) => {
		if ( ! Array.isArray( blocks ) ) throw new Error( 'A component’s blocks should be a list.' );
		return blocks.some( ( block ) => block?.blockName ) ? fromGutenbergList( blocks ) : blocks.filter( ( block ) => block?.type );
	};

	const readComponent = ( source, extra = {} ) => {
		if ( ! isObject( source ) || ! Array.isArray( source.blocks ) || ! ( source.key || source.name ) ) return null;
		return {
			sourceId: source.id ?? null,
			name: String( source.name || source.key ),
			key: String( source.key || '' ),
			description: String( source.description || '' ),
			properties: Array.isArray( source.properties ) ? source.properties : [],
			blocks: layerJson( source.blocks ),
			// The source site's styles and components, by their IDs there, which the blocks refer to.
			styles: isObject( extra.styles ) ? extra.styles : isObject( source.styles ) ? source.styles : {},
			components: extra.components || {},
		};
	};

	/**
	 * The components in some JSON text. Throws with a message for the manager
	 * to show when it isn't JSON or has none.
	 */
	const parse = ( text ) => {
		let data;
		try {
			data = JSON.parse( text );
		} catch {
			throw new Error( 'That isn’t valid JSON. Check it was copied whole.' );
		}

		let found = [];
		if ( isObject( data ) && ( data.gutenbergBlock || isObject( data.components ) ) ) {
			// Etch's copy. Nested components refer to each other by their IDs on the source site.
			const sources = Object.values( data.components || {} );
			const components = Object.fromEntries( sources.filter( isObject ).map( ( c ) => [ c.id, { key: c.key, name: c.name } ] ) );
			found = sources.map( ( source ) => readComponent( source, { styles: data.styles, components } ) );
			if ( ! found.length ) throw new Error( 'No component in this JSON. In Etch, select one, press Cmd+C and paste it here.' );
		} else {
			found = ( Array.isArray( data ) ? data : [ data ] ).map( ( source ) => readComponent( source ) );
		}

		found = found.filter( Boolean );
		if ( ! found.length ) throw new Error( 'No components found. In Etch, select one, press Cmd+C and paste it here.' );
		return found;
	};

	/* ------------------------------------------------------------------ */
	/* Comparing                                                           */
	/* ------------------------------------------------------------------ */

	// A value as text to compare and show. Objects as indented JSON.
	const asText = ( value ) => ( typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify( value, null, 2 ) );

	// A class attribute's names. Dynamic parts like {props.extra} aren't names, so they're left out.
	const classNames = ( value ) => toolkit.classNames( value ).filter( ( name ) => ! name.includes( '{' ) );

	const TYPE_NAMES = {
		'etch/text': 'Text',
		'etch/slot-placeholder': 'Slot',
		'etch/slot-content': 'Slot content',
		'etch/loop': 'Loop',
		'etch/condition': 'Condition',
		'etch/component': 'Component',
		'etch/raw-html': 'Raw HTML',
		'etch/dynamic-image': 'Image',
		'etch/passthrough': 'Block',
	};

	/**
	 * What the review compares on a layer, by category. html is a map of
	 * field => { label, value }: its tag, name and attributes, and whatever
	 * else its type has, like a text's text or a loop's target. styles are
	 * the class styles it links to, as { selector, css }. script is its JS.
	 */
	const describe = ( block, side ) => {
		const html = new Map();
		const set = ( key, label, value ) => html.set( key, { label, value: asText( value ) } );
		const tag = block.tag ?? block.attributes?.tag ?? ( block.type === 'etch/svg' ? 'svg' : undefined );
		if ( block.tag !== undefined ) set( 'tag', 'Tag', block.tag );
		set( 'name', 'Name', block.context?.name || '' );
		if ( block.context?.hidden ) set( 'hidden', 'Hidden', 'Yes' );
		if ( block.type === 'etch/component' ) {
			set( 'component', 'Component', side.componentName( block.componentId ) );
			for ( const [ key, value ] of Object.entries( block.attributes || {} ) ) set( `prop:${ key }`, `Prop ${ key }`, value );
		} else {
			for ( const [ key, value ] of Object.entries( block.attributes || {} ) ) set( `attr:${ key }`, key, value );
		}
		if ( 'text' in block ) set( 'text', 'Text', block.text );
		if ( 'slotName' in block ) set( 'slot', 'Slot', block.slotName );
		if ( 'conditionString' in block ) set( 'condition', 'Condition', block.conditionString );
		for ( const key of [ 'target', 'loopId', 'loopParams', 'itemId', 'indexId' ] ) if ( key in block ) set( `loop:${ key }`, key, block[ key ] );
		if ( 'content' in block ) set( 'content', 'HTML', block.content );
		if ( block.unsafe ) set( 'unsafe', 'Unsafe', block.unsafe );
		if ( block.gutenbergBlock ) set( 'block', 'Block', block.gutenbergBlock );
		if ( block.options && Object.keys( block.options ).length ) set( 'options', 'Options', block.options );

		return {
			block,
			name: block.context?.name || '',
			label: block.context?.name || TYPE_NAMES[ block.type ] || tag || block.type,
			tag: block.type === 'etch/element' || block.type === 'etch/dynamic-element' || block.type === 'etch/svg' ? tag : '',
			classes: classNames( block.attributes?.class ),
			html,
			styles: ( block.styles || [] ).map( side.style ).filter( Boolean ),
			script: block.script?.code ?? '',
		};
	};

	// How much two lists share, 0 to 1. Two empty lists count as half alike.
	const overlap = ( a, b ) => {
		const ours = new Set( a );
		const all = new Set( [ ...a, ...b ] );
		return all.size ? b.filter( ( item ) => ours.has( item ) ).length / all.size : 0.5;
	};

	// Attributes other than class, as name=value.
	const attributePairs = ( layer ) => Object.entries( layer.block.attributes || {} ).filter( ( [ key ] ) => key !== 'class' ).map( ( [ key, value ] ) => `${ key }=${ asText( value ) }` );

	/**
	 * How alike two layers are, 0 to 1. Layers of different types never pair.
	 * Name, tag, classes and other attributes each count, so a layer that was
	 * renamed and given a class still pairs when the rest of it is the same.
	 */
	const similarity = ( a, b ) => {
		if ( a.block.type !== b.block.type ) return 0;
		let score = 0.1;
		if ( a.name && a.name === b.name ) score += 0.35;
		if ( a.tag === b.tag ) score += 0.15;
		score += 0.2 * overlap( a.classes, b.classes );
		score += 0.2 * overlap( attributePairs( a ), attributePairs( b ) );
		if ( a.html.get( 'text' )?.value && a.html.get( 'text' )?.value === b.html.get( 'text' )?.value ) score += 0.05;
		return score;
	};
	// Pairs below this are a layer removed and another added.
	const SAME_LAYER = 0.4;

	/**
	 * Pair two lists of sibling layers, keeping their order: the pairing with
	 * the most similarity in total. What doesn't pair was removed or added.
	 * Returns [ current, incoming ] pairs in order, with null for the missing side.
	 */
	const align = ( ours, theirs ) => {
		const score = ours.map( ( a ) => theirs.map( ( b ) => similarity( a, b ) ) );
		const best = Array.from( { length: ours.length + 1 }, () => new Float64Array( theirs.length + 1 ) );
		for ( let i = ours.length - 1; i >= 0; i-- ) {
			for ( let j = theirs.length - 1; j >= 0; j-- ) {
				best[ i ][ j ] = Math.max( best[ i + 1 ][ j ], best[ i ][ j + 1 ], score[ i ][ j ] >= SAME_LAYER ? score[ i ][ j ] + best[ i + 1 ][ j + 1 ] : 0 );
			}
		}
		const pairs = [];
		let i = 0;
		let j = 0;
		while ( i < ours.length || j < theirs.length ) {
			if ( i < ours.length && j < theirs.length && score[ i ][ j ] >= SAME_LAYER && best[ i ][ j ] === score[ i ][ j ] + best[ i + 1 ][ j + 1 ] ) pairs.push( [ ours[ i++ ], theirs[ j++ ] ] );
			else if ( j >= theirs.length || ( i < ours.length && best[ i + 1 ][ j ] >= best[ i ][ j + 1 ] ) ) pairs.push( [ ours[ i++ ], null ] );
			else pairs.push( [ null, theirs[ j++ ] ] );
		}
		return pairs;
	};

	// CSS compared the way it reads, not how it's spaced.
	const sameCss = ( a, b ) => ( a || '' ).replace( /\s+/g, ' ' ).trim() === ( b || '' ).replace( /\s+/g, ' ' ).trim();

	/**
	 * Compare a current component with an incoming one. Returns the layers as
	 * one tree, each node { id, status, current, incoming, html, css, js,
	 * children, inside }:
	 * - status: 'same', 'changed', 'added' or 'removed'.
	 * - html: the fields that differ, { key, label, from, to }.
	 * - css: the class styles whose CSS would change on this site, { selector,
	 *   from, to }, from null for a class this site doesn't have yet. Classes
	 *   are site-wide, so an added layer can change CSS too.
	 * - js: { from, to } when the script differs.
	 * - inside: how many layers inside changed, were added or removed.
	 */
	/**
	 * How each side names what its layers point to: styles and components by
	 * ID. This site's for the current component. For the incoming one, the
	 * JSON's, by their IDs on its site, or this site's if it came from here.
	 */
	const makeSides = ( incoming ) => {
		const local = window.etch.styles.list();
		const byId = new Map( local.map( ( style ) => [ style.id, style ] ) );
		const components = window.etch.components.list();
		const nameOfLocal = ( id ) => components.find( ( c ) => c.id === id )?.name ?? `#${ id }`;
		const current = {
			style: ( id ) => byId.get( id ) && { selector: byId.get( id ).selector, css: byId.get( id ).css ?? '' },
			componentName: nameOfLocal,
		};
		return {
			current,
			incoming: {
				style: ( id ) => ( incoming.styles[ id ] ? { selector: incoming.styles[ id ].selector, css: incoming.styles[ id ].css ?? '' } : current.style( id ) ),
				componentName: ( id ) => incoming.components[ id ]?.name ?? nameOfLocal( id ),
				// This site's component with the same key, or the same ID if the JSON came from here.
				componentId: ( id ) => ( incoming.components[ id ] ? components.find( ( c ) => c.key === incoming.components[ id ].key )?.id ?? null : components.some( ( c ) => c.id === id ) ? id : null ),
			},
		};
	};

	const compare = ( now, incoming ) => {
		const bySelector = new Map( window.etch.styles.list().map( ( style ) => [ style.selector, style ] ) );
		const { current: currentSide, incoming: incomingSide } = makeSides( incoming );

		let ids = 0;
		const cssChanges = ( layer ) =>
			layer.styles
				.filter( ( style ) => ! sameCss( bySelector.get( style.selector )?.css, style.css ) )
				.map( ( style ) => ( { selector: style.selector, from: bySelector.has( style.selector ) ? bySelector.get( style.selector ).css ?? '' : null, to: style.css } ) );

		const node = ( ours, theirs ) => {
			const status = ! ours ? 'added' : ! theirs ? 'removed' : 'same';
			const result = { id: `etk-layer-${ ++ids }`, status, current: ours, incoming: theirs, html: [], css: [], js: null, children: [], inside: 0 };

			if ( ours && theirs ) {
				for ( const key of new Set( [ ...ours.html.keys(), ...theirs.html.keys() ] ) ) {
					const from = ours.html.get( key )?.value ?? '';
					const to = theirs.html.get( key )?.value ?? '';
					if ( from !== to ) result.html.push( { key, label: ( ours.html.get( key ) || theirs.html.get( key ) ).label, from, to } );
				}
				if ( ours.script !== theirs.script ) result.js = { from: ours.script, to: theirs.script };
			}
			if ( theirs ) result.css = cssChanges( theirs );
			if ( status === 'same' && ( result.html.length || result.css.length || result.js ) ) result.status = 'changed';

			const kids = ( layer, side ) => ( layer?.block.children || [] ).map( ( block ) => describe( block, side ) );
			const pairs = ours && theirs ? align( kids( ours, currentSide ), kids( theirs, incomingSide ) ) : ours ? kids( ours, currentSide ).map( ( a ) => [ a, null ] ) : kids( theirs, incomingSide ).map( ( b ) => [ null, b ] );
			result.children = pairs.map( ( [ a, b ] ) => Object.assign( node( a, b ), { parent: result } ) );
			result.inside = result.children.reduce( ( n, child ) => n + ( child.status === 'same' ? 0 : 1 ) + child.inside, 0 );
			return result;
		};

		const top = align(
			now.blocks.map( ( block ) => describe( block, currentSide ) ),
			incoming.blocks.map( ( block ) => describe( block, incomingSide ) )
		);
		return top.map( ( [ a, b ] ) => node( a, b ) );
	};

	// Every node in a compared tree, depth first.
	const walk = function* ( nodes ) {
		for ( const node of nodes ) {
			yield node;
			yield* walk( node.children );
		}
	};

	const PROP_FIELDS = { name: 'Name', type: 'Type', default: 'Default', description: 'Description', selectOptionsString: 'Options' };

	// A class prop's default is style IDs, which differ between sites. Their selectors don't.
	const readableProp = ( prop, side ) =>
		prop && {
			...prop,
			...( prop.type?.specialized === 'class' && Array.isArray( prop.default ) ? { default: prop.default.map( ( id ) => side.style( id )?.selector ?? id ) } : {} ),
			...( Array.isArray( prop.properties ) ? { properties: prop.properties.map( ( inner ) => readableProp( inner, side ) ) } : {} ),
		};

	// A prop's fields as text, key and props inside aside. Its type reads like Etch's picker: "string, select".
	const propFields = ( prop, side ) => {
		const fields = new Map();
		for ( const [ key, value ] of Object.entries( ( side ? readableProp( prop, side ) : prop ) || {} ) ) {
			if ( key === 'key' || key === 'properties' ) continue;
			const text = key === 'type' && value && typeof value === 'object' && ! Array.isArray( value ) ? Object.values( value ).join( ', ' ) : asText( value );
			fields.set( key, { label: PROP_FIELDS[ key ] || key, value: text } );
		}
		return fields;
	};

	/**
	 * Compare two components' props, matched by key. Returns them in the
	 * incoming order, with removed ones where they were: { key, status,
	 * current, incoming, fields, inner, path, root, inside }, fields the ones
	 * that differ and inner the props inside a group or condition, compared
	 * the same way. path is its keys from the top, root the top one's key,
	 * inside how many props inside it changed, were added or removed.
	 */
	const compareProps = ( ours, theirs, sides, parent = null ) => {
		const byKey = ( list ) => new Map( list.filter( ( prop ) => prop?.key ).map( ( prop ) => [ prop.key, prop ] ) );
		const now = byKey( ours );
		const next = byKey( theirs );
		const result = [];
		for ( const { op, text: key } of diffLines( [ ...now.keys() ].join( '\n' ), [ ...next.keys() ].join( '\n' ) ) ) {
			// A prop that moved shows once, where it's going.
			if ( op === '-' && next.has( key ) ) continue;
			const current = now.get( key ) ?? null;
			const incoming = next.get( key ) ?? null;
			const a = propFields( current, sides.current );
			const b = propFields( incoming, sides.incoming );
			const fields = [];
			for ( const field of new Set( [ ...a.keys(), ...b.keys() ] ) ) {
				const from = a.get( field )?.value ?? '';
				const to = b.get( field )?.value ?? '';
				if ( from !== to ) fields.push( { key: field, label: ( a.get( field ) || b.get( field ) ).label, from, to } );
			}
			const path = parent ? `${ parent.path }/${ key }` : key;
			const inner = compareProps( current?.properties || [], incoming?.properties || [], sides, { path, root: parent?.root ?? key } );
			const inside = inner.reduce( ( n, prop ) => n + ( prop.status === 'same' ? 0 : 1 ) + prop.inside, 0 );
			const status = ! current ? 'added' : ! incoming ? 'removed' : fields.length || inside ? 'changed' : 'same';
			result.push( { key, status, current, incoming, fields, inner, path, root: parent?.root ?? key, inside } );
		}
		return result;
	};

	/**
	 * A line diff by longest common subsequence: [ { op, text } ], op ' ' for
	 * a line both have, '-' for one only from has, '+' for one only to has.
	 * Lines the two start and end with are matched first, so a long script
	 * with one change is quick.
	 */
	const diffLines = ( from, to ) => {
		const a = from === '' ? [] : from.split( '\n' );
		const b = to === '' ? [] : to.split( '\n' );
		let start = 0;
		while ( start < a.length && start < b.length && a[ start ] === b[ start ] ) start++;
		let endA = a.length;
		let endB = b.length;
		while ( endA > start && endB > start && a[ endA - 1 ] === b[ endB - 1 ] ) {
			endA--;
			endB--;
		}
		const same = ( lines ) => lines.map( ( text ) => ( { op: ' ', text } ) );
		const x = a.slice( start, endA );
		const y = b.slice( start, endB );
		const middle = [];
		// Past a few million cells the table costs more than it's worth: all out, all in.
		if ( x.length * y.length > 4e6 ) {
			middle.push( ...x.map( ( text ) => ( { op: '-', text } ) ), ...y.map( ( text ) => ( { op: '+', text } ) ) );
		} else {
			const width = y.length + 1;
			const lcs = new Uint32Array( ( x.length + 1 ) * width );
			for ( let i = x.length - 1; i >= 0; i-- ) {
				for ( let j = y.length - 1; j >= 0; j-- ) {
					lcs[ i * width + j ] = x[ i ] === y[ j ] ? lcs[ ( i + 1 ) * width + j + 1 ] + 1 : Math.max( lcs[ ( i + 1 ) * width + j ], lcs[ i * width + j + 1 ] );
				}
			}
			let i = 0;
			let j = 0;
			while ( i < x.length || j < y.length ) {
				if ( i < x.length && j < y.length && x[ i ] === y[ j ] ) {
					middle.push( { op: ' ', text: x[ i++ ] } );
					j++;
				} else if ( j >= y.length || ( i < x.length && lcs[ ( i + 1 ) * width + j ] >= lcs[ i * width + j + 1 ] ) ) {
					middle.push( { op: '-', text: x[ i++ ] } );
				} else {
					middle.push( { op: '+', text: y[ j++ ] } );
				}
			}
		}
		return [ ...same( a.slice( 0, start ) ), ...middle, ...same( a.slice( endA ) ) ];
	};

	/* ------------------------------------------------------------------ */
	/* Views                                                               */
	/* ------------------------------------------------------------------ */

	let panel = null;
	let main = null;
	let status = null;
	let view = 'list';
	let pasted = '';
	let search = '';
	let filter = 'all'; // 'all', 'used' or 'unused'.
	let expanded = new Set(); // Components whose every use shows.
	let target = null; // The component being updated.
	let usedOn = null; // Component ID => the posts using it, from the server. Null while it loads.
	let reviewing = null;

	// Tell screen readers what happened. Errors also show above the view.
	const announce = ( message, options ) => toolkit.announce( status, message, options );
	const warn = ( message ) => announce( message, { error: true } );

	const button = ( label, onclick, { variant = 'secondary', ...attrs } = {} ) => el( 'button', { type: 'button', class: `etk-btn etk-btn--${ variant }`, onclick, ...attrs }, label );

	const read = ( text ) => {
		try {
			const found = parse( text );
			// The one with its key, or the only one there is.
			const incoming = found.find( ( c ) => c.key === target.key ) || ( found.length === 1 ? found[ 0 ] : null );
			if ( ! incoming ) throw new Error( `None of the ${ found.length } components in this JSON is ${ target.name } (key ${ target.key }).` );
			status.textContent = '';
			status.classList.remove( 'is-error' );
			review( { incoming, current: target } );
			if ( incoming.key && incoming.key !== target.key ) announce( `This JSON is for ${ incoming.name }. ${ target.name } keeps its own key.` );
		} catch ( error ) {
			warn( errorText( error ) );
		}
	};

	const readFile = async ( file ) => read( await file.text() );

	const dropzone = () => jsonDropzone( 'Drop a .json file here', readFile );

	/* ---- Components ---- */

	// Where a component is used: pages and templates, then components it's inside.
	const usedTitles = ( component ) => ( usedOn?.[ component.id ] || [] ).map( ( post ) => ( post.postType === 'wp_block' ? `${ post.title } (component)` : post.title ) );

	/**
	 * Open where a component is used in Etch: a page or template, or another
	 * component it's inside, in Etch's component editor.
	 */
	const openUse = async ( post ) => {
		try {
			if ( post.postType === 'wp_block' ) {
				const parent = window.etch.components.list().find( ( c ) => c.id === post.id );
				if ( parent ) editInEtch( parent );
				return;
			}
			post.postType === 'wp_template' ? await window.etch.navigation.openTemplateAsync( post.id ) : await window.etch.navigation.openPostAsync( post.id );
			close( { focus: false } );
		} catch ( error ) {
			warn( `Couldn’t open ${ post.title }: ${ errorText( error ) }` );
		}
	};

	// Uses shown before "N more".
	const USES = 2;

	// Where a component is used, each opening in Etch.
	const usesCell = ( component ) => {
		const posts = usedOn[ component.id ] || [];
		const open = expanded.has( component.id );
		const shown = open ? posts : posts.slice( 0, USES );
		return el(
			'div',
			{ class: 'etk-components__uses' },
			shown.map( ( post ) =>
				el(
					'button',
					{ type: 'button', class: 'etk-components__use', title: 'Open in Etch', 'data-focus': `use:${ component.id }:${ post.id }`, onclick: () => openUse( post ) },
					post.postType === 'wp_block' ? `${ post.title } (component)` : post.title,
					el( 'span', { class: 'etk-sr', textContent: ', open in Etch' } ),
					el( 'span', { class: 'etk-components__use-icon', html: icon( 'external', 12 ) } )
				)
			),
			posts.length > USES
				? el(
						'button',
						{
							type: 'button',
							class: 'etk-components__use-more',
							'aria-expanded': String( open ),
							'aria-label': open ? `Show fewer pages for ${ component.name }` : `Show ${ posts.length - USES } more pages for ${ component.name }`,
							'data-focus': `more:${ component.id }`,
							onclick: () => {
								open ? expanded.delete( component.id ) : expanded.add( component.id );
								render();
							},
						},
						open ? 'Fewer' : `${ posts.length - USES } more`
				  )
				: null
		);
	};

	/**
	 * Delete a component, once confirmed. Etch deletes it for good, and its
	 * instances render nothing, so the dialog says where it's used. Instances
	 * on the open page go too, as when Etch's component editor deletes one.
	 */
	const remove = async ( component ) => {
		const titles = usedTitles( component );
		const here = window.etch.blocks.find( { type: 'etch/component' } ).filter( ( id ) => window.etch.blocks.getJson( id ).componentId === component.id );
		const dialog = toolkit.confirmDialog( {
			title: `Delete ${ component.name }?`,
			message: [
				titles.length
					? el( 'p', { textContent: `It’s used on ${ titles.length <= 3 ? listOf( titles ) : `${ titles.slice( 0, 2 ).join( ', ' ) } and ${ titles.length - 2 } more` }. It will disappear from ${ titles.length === 1 ? 'there' : 'all of them' }.` } )
					: here.length
						? null
						: el( 'p', { textContent: 'No page uses it.' } ),
				here.length ? el( 'p', { textContent: `It’s removed from the page you have open. Save to keep that.` } ) : null,
				el( 'p', { textContent: 'This can’t be undone.' } ),
			].filter( Boolean ),
			confirmLabel: 'Delete component',
			failTitle: 'The component wasn’t deleted',
		} );
		if ( ! ( await dialog.result ) ) return;
		try {
			await window.etch.components.deleteAsync( component.id );
		} catch ( error ) {
			dialog.fail( errorText( error ) );
			return;
		}
		here.forEach( ( id ) => window.etch.blocks.delete( id ) );
		dialog.close();
		// Focus moves to the next row's Delete, or the one before, or the search.
		const rows = [ ...main.querySelectorAll( '.etk-components__row-delete' ) ];
		const at = rows.findIndex( ( row ) => row.dataset.focus === `delete:${ component.id }` );
		const next = rows[ at + 1 ] || rows[ at - 1 ];
		render();
		main.querySelector( `[data-focus="${ next ? CSS.escape( next.dataset.focus ) : 'search' }"]` )?.focus();
		announce( `Deleted ${ component.name }.` );
		loadUsedOn();
	};

	const isUsed = ( component ) => ( usedOn?.[ component.id ] || [] ).length > 0;

	// All, In use or Unused, like the Fonts manager's file filter. Unused counts once usage loads.
	const filters = ( fill ) => {
		const unused = usedOn ? window.etch.components.list().filter( ( c ) => ! isUsed( c ) ).length : 0;
		return el(
			'fieldset',
			{ class: 'etk-seg etk-track etk-components__seg' },
			el( 'legend', { class: 'etk-sr', textContent: 'Show' } ),
			[
				[ 'all', 'All' ],
				[ 'used', 'In use' ],
				[ 'unused', 'Unused' ],
			].map( ( [ value, label ] ) =>
				el(
					'label',
					{},
					el( 'input', {
						type: 'radio',
						name: 'etk-components-filter',
						value,
						checked: filter === value,
						'data-focus': `filter:${ value }`,
						onchange: () => {
							filter = value;
							fill();
						},
					} ),
					label,
					value === 'unused' && unused ? el( 'span', { class: 'etk-components__count etk-components__count--unused', textContent: String( unused ) } ) : null
				)
			)
		);
	};

	// Copy JSON and Download JSON, on a More button that shows a tick for a moment after a copy.
	const moreMenu = ( component, action ) => {
		const trigger = action( 'more', `More actions for ${ component.name }`, 'More', icon( 'more', 14 ) );
		const copy = async () => {
			try {
				await navigator.clipboard.writeText( JSON.stringify( copyOf( component ) ) );
			} catch ( error ) {
				warn( `Couldn’t copy ${ component.name }: ${ errorText( error ) }` );
				return;
			}
			trigger.innerHTML = icon( 'tick', 14 );
			trigger.dataset.etkTooltip = 'Copied';
			announce( `Copied ${ component.name }. Paste it into Etch on any site.` );
			window.setTimeout( () => {
				trigger.innerHTML = icon( 'more', 14 );
				trigger.dataset.etkTooltip = 'More';
			}, 1500 );
		};
		const download = () => {
			try {
				downloadJson( JSON.stringify( copyOf( component ), null, 2 ), `${ component.key || 'component' }.json` );
			} catch ( error ) {
				warn( `Couldn’t download ${ component.name }: ${ errorText( error ) }` );
			}
		};
		return menu(
			trigger,
			[
				{ label: 'Copy JSON', icon: 'copy', onselect: copy },
				{ label: 'Download JSON', icon: 'download', onselect: download },
			],
			{ label: `More actions for ${ component.name }` }
		);
	};

	/* ---- Picking several, for the bulk bar ---- */

	// Components picked for the bulk bar, by ID. Only the ones the list shows stay picked.
	const picked = new Set();
	let pickAnchor = null;
	let shownIds = []; // The list's components, in its order.
	let bulk = null;

	const pickedComponents = () => window.etch.components.list().filter( ( c ) => picked.has( c.id ) );

	const pickBox = ( component ) =>
		el( 'input', {
			type: 'checkbox',
			class: 'etk-components__pick etk-checkbox',
			'data-id': String( component.id ),
			'data-focus': `pick:${ component.id }`,
			checked: picked.has( component.id ),
			'aria-label': `Select ${ component.name }`,
			// Shift-click sets everything from the last one clicked to this one.
			onclick: ( e ) => {
				const on = e.target.checked;
				const from = shownIds.indexOf( pickAnchor );
				const to = shownIds.indexOf( component.id );
				const range = e.shiftKey && from >= 0 ? shownIds.slice( Math.min( from, to ), Math.max( from, to ) + 1 ) : [ component.id ];
				range.forEach( ( id ) => ( on ? picked.add( id ) : picked.delete( id ) ) );
				pickAnchor = component.id;
				syncPicks();
			},
		} );

	// Checkboxes, rows and the bulk bar, after the selection or the list changes.
	const syncPicks = () => {
		const shown = view === 'list' ? shownIds : [];
		[ ...picked ].forEach( ( id ) => shown.includes( id ) || picked.delete( id ) );
		main?.querySelectorAll( '.etk-components__pick[data-id]' ).forEach( ( box ) => {
			box.checked = picked.has( Number( box.dataset.id ) );
			box.closest( 'tr' ).classList.toggle( 'is-picked', box.checked );
		} );
		const all = main?.querySelector( '.etk-components__pick-all' );
		if ( all ) {
			all.checked = shown.length > 0 && picked.size === shown.length;
			all.indeterminate = picked.size > 0 && picked.size < shown.length;
			all.disabled = ! shown.length;
		}
		bulk?.update( picked.size, picked.size >= shown.length );
	};

	const clearPicks = () => {
		picked.clear();
		syncPicks();
	};

	// One file each, the same as each row's Download JSON gives.
	const downloadPicked = () => {
		const components = pickedComponents();
		let copies;
		try {
			copies = components.map( ( component ) => [ component, copyOf( component ) ] );
		} catch ( error ) {
			warn( `Couldn’t download the components: ${ errorText( error ) }` );
			return;
		}
		// Spaced out, or the browser can drop all but the first.
		copies.forEach( ( [ component, copy ], i ) => window.setTimeout( () => downloadJson( JSON.stringify( copy, null, 2 ), `${ component.key || 'component' }.json` ), i * 200 ) );
		announce( `Downloading ${ plural( copies.length, 'component', 'components' ) }.` );
	};

	/**
	 * Delete the picked components, once confirmed, one after another. Like
	 * Delete on a row, instances on the open page go too. If one fails, the
	 * ones before it stay deleted and the dialog says so.
	 */
	const removePicked = async () => {
		const components = pickedComponents();
		if ( components.length === 1 ) return remove( components[ 0 ] );
		const ids = new Set( components.map( ( c ) => c.id ) );
		const used = components.filter( isUsed ).map( ( c ) => c.name );
		const here = window.etch.blocks.find( { type: 'etch/component' } ).filter( ( id ) => ids.has( window.etch.blocks.getJson( id ).componentId ) );
		const dialog = toolkit.confirmDialog( {
			title: `Delete ${ components.length } components?`,
			message: [
				used.length
					? el( 'p', { textContent: `${ used.length <= 3 ? listOf( used ) : `${ used.slice( 0, 2 ).join( ', ' ) } and ${ used.length - 2 } more` } ${ used.length === 1 ? 'is' : 'are' } in use. ${ used.length === 1 ? 'It' : 'They' } will disappear from every page using ${ used.length === 1 ? 'it' : 'them' }.` } )
					: here.length
						? null
						: el( 'p', { textContent: 'No page uses them.' } ),
				here.length ? el( 'p', { textContent: 'They’re removed from the page you have open. Save to keep that.' } ) : null,
				el( 'p', { textContent: 'This can’t be undone.' } ),
			].filter( Boolean ),
			confirmLabel: `Delete ${ components.length } components`,
			failTitle: 'Not every component was deleted',
		} );
		if ( ! ( await dialog.result ) ) return;
		const deleted = new Set();
		let failed = null;
		for ( const component of components ) {
			try {
				await window.etch.components.deleteAsync( component.id );
				deleted.add( component.id );
				picked.delete( component.id );
			} catch ( error ) {
				failed = `${ component.name }: ${ errorText( error ) }`;
				break;
			}
		}
		here.filter( ( id ) => deleted.has( window.etch.blocks.getJson( id ).componentId ) ).forEach( ( id ) => window.etch.blocks.delete( id ) );
		if ( failed ) {
			dialog.fail( deleted.size ? `Deleted ${ deleted.size } of ${ components.length }. ${ failed }` : failed );
		} else {
			dialog.close();
		}
		if ( deleted.size ) {
			render();
			if ( ! failed ) main.querySelector( '[data-focus="search"]' )?.focus();
			announce( `Deleted ${ plural( deleted.size, 'component', 'components' ) }.` );
			loadUsedOn();
		}
	};

	// The Style Manager's bulk bar. Built once, then shown and hidden.
	const buildBulkBar = () => {
		bulk = bulkBar( {
			label: 'Bulk component actions',
			className: 'etk-components__bulk',
			actions: [ barButton( 'Download JSON', 'download', downloadPicked ), barButton( el( 'span', { textContent: 'Delete' } ), 'delete', removePicked, { className: 'etk-bulk-bar__delete' } ) ],
			onClear: clearPicks,
			onSelectAll: () => {
				shownIds.forEach( ( id ) => picked.add( id ) );
				syncPicks();
			},
			// Don't strand focus on a bar that's going away.
			refocus: () => main.querySelector( '.etk-components__pick-all:not(:disabled), [data-focus="search"]' ),
		} );
		return [ bulk.scrim, bulk.bar ];
	};

	const componentRow = ( component ) => {
		const used = usedOn ? isUsed( component ) : null;
		const action = ( key, label, title, icon, onclick, extra = '' ) =>
			button( '', onclick, { class: `etk-btn etk-btn--secondary etk-components__row-action${ extra }`, 'aria-label': label, 'data-etk-tooltip': title, html: icon, 'data-focus': `${ key }:${ component.id }` } );
		return el(
			'tr',
			{ class: [ used === false ? 'is-unused' : '', picked.has( component.id ) ? 'is-picked' : '' ].join( ' ' ).trim() || null },
			el( 'td', { class: 'etk-table__pick' }, pickBox( component ) ),
			el( 'th', { scope: 'row' }, el( 'span', { class: 'etk-components__cell-name', textContent: component.name } ) ),
			el( 'td', {}, el( 'code', { class: 'etk-components__key', textContent: component.key } ) ),
			el( 'td', {}, used === null ? null : el( 'span', { class: `etk-badge etk-badge--${ used ? 'success' : 'warning' }`, textContent: used ? 'In use' : 'Unused' } ) ),
			used ? el( 'td', { class: 'etk-components__uses-cell' }, usesCell( component ) ) : el( 'td', { class: 'etk-table__none', textContent: used === null ? 'Checking…' : '—' } ),
			el(
				'td',
				{},
				el(
					'div',
					{ class: 'etk-components__row-actions' },
					action( 'edit', `Edit ${ component.name } in Etch`, 'Edit in Etch', icon( 'edit', 14 ), () => editInEtch( component ) ),
					action( 'update', `Update ${ component.name } from JSON`, 'Update from JSON', icon( 'upload', 14 ), () => updateOne( component ) ),
					action( 'delete', `Delete ${ component.name }`, 'Delete', icon( 'delete', 14 ), () => remove( component ), ' etk-components__row-delete' ),
					moreMenu( component, action )
				)
			)
		);
	};

	const views = {
		list: () => {
			const count = el( 'span', { class: 'etk-manager__muted', role: 'status' } );
			const body = el( 'tbody' );
			// Only the rows change as you type, so the field keeps its caret.
			const fill = () => {
				const all = window.etch.components.list().sort( ( a, b ) => a.name.localeCompare( b.name ) );
				const term = search.trim().toLowerCase();
				// Until usage loads, every component shows.
				const inFilter = ( c ) => filter === 'all' || ! usedOn || ( filter === 'used' ) === isUsed( c );
				const shown = all.filter( ( c ) => inFilter( c ) && ( ! term || `${ c.name } ${ c.key }`.toLowerCase().includes( term ) ) );
				count.textContent = shown.length === all.length ? plural( all.length, 'component', 'components' ) : `${ shown.length } of ${ plural( all.length, 'component', 'components' ) }`;
				const empty = ! all.length ? 'This site has no components yet.' : term ? 'No components match.' : filter === 'used' ? 'No component is in use.' : 'Every component is in use.';
				shownIds = shown.map( ( c ) => c.id );
				body.replaceChildren( ...( shown.length ? shown.map( componentRow ) : [ el( 'tr', {}, el( 'td', { colspan: '6', class: 'etk-components__empty-row', textContent: empty } ) ) ] ) );
				syncPicks();
			};
			const th = ( text ) => el( 'th', { scope: 'col', textContent: text } );
			const pickAll = el( 'input', {
				type: 'checkbox',
				class: 'etk-components__pick-all etk-checkbox',
				'aria-label': 'Select all components',
				'data-focus': 'pick-all',
				onclick: ( e ) => {
					const on = e.target.checked;
					shownIds.forEach( ( id ) => ( on ? picked.add( id ) : picked.delete( id ) ) );
					syncPicks();
				},
			} );
			fill();
			return [
				el(
					'div',
					{ class: 'etk-components__toolbar' },
					filters( fill ),
					searchBox(
						el( 'input', {
							type: 'text',
							placeholder: 'Search components',
							'aria-label': 'Search components',
							spellcheck: 'false',
							autocomplete: 'off',
							value: search,
							'data-focus': 'search',
							oninput: ( e ) => {
								search = e.target.value;
								fill();
							},
						} ),
						{ class: 'etk-components__search' }
					),
					count
				),
				el(
					'table',
					{ class: 'etk-table etk-table--pick etk-components__table', 'aria-label': 'Components' },
					el( 'thead', {}, el( 'tr', {}, el( 'td', { class: 'etk-table__pick' }, pickAll ), th( 'Component' ), th( 'Key' ), th( 'Status' ), th( 'Used on' ), el( 'th', { scope: 'col' }, el( 'span', { class: 'etk-sr', textContent: 'Actions' } ) ) ) ),
					body
				),
			];
		},

		import: () => [
			el(
				'div',
				{ class: 'etk-components__review-head' },
				button( '', () => showList(), { class: 'etk-btn etk-btn--secondary etk-btn--icon', 'aria-label': 'Back to components', 'data-etk-tooltip': 'Back to components', html: icon( 'arrow-left' ), 'data-focus': 'back' } ),
				el( 'h2', { class: 'etk-manager__page-title', tabindex: '-1', textContent: `Update ${ target.name }` } )
			),
			el( 'p', { class: 'etk-components__help', textContent: `Drop or paste JSON for ${ target.name }. In Etch, select it and press Cmd+C. You’ll review changes before saving.` } ),
			dropzone(),
			el(
				'div',
				{ class: 'etk-components__paste' },
				el( 'label', { class: 'etk-manager__label', htmlFor: 'etk-components-json', textContent: 'Or paste JSON' } ),
				el( 'textarea', {
					id: 'etk-components-json',
					class: 'etk-components__textarea',
					spellcheck: 'false',
					rows: '6',
					value: pasted,
					oninput: ( e ) => ( pasted = e.target.value ),
				} ),
				el( 'div', { class: 'etk-components__actions' }, button( 'Review changes', () => ( pasted.trim() ? read( pasted ) : warn( 'Paste some JSON first.' ) ), { variant: 'primary' } ) )
			),
		],

		done: () =>
			previous
				? [
						el( 'h2', { class: 'etk-manager__page-title', tabindex: '-1', textContent: `${ previous.name } is updated` } ),
						el( 'p', { class: 'etk-components__help', textContent: previous.update.length || previous.made.length ? 'The component is saved. Save in Etch to keep the class changes too.' : 'The component is saved.' } ),
						el(
							'div',
							{ class: 'etk-components__done-actions' },
							button( 'Put back the previous version', ( e ) => restore( e.currentTarget ), { 'data-focus': 'restore' } ),
							button( 'Download the previous version', download, { 'data-focus': 'download' } ),
							button( 'Back to components', showList, { 'data-focus': 'another' } )
						),
				  ]
				: [
						el( 'h2', { class: 'etk-manager__page-title', tabindex: '-1', textContent: 'The previous version is back' } ),
						el( 'div', { class: 'etk-components__done-actions' }, button( 'Back to components', showList, { 'data-focus': 'another' } ) ),
				  ],

		// Layers and props on the left, the picked one's code on the right.
		review: () => {
			const { current } = reviewing;
			const { approved, total } = tally();
			const lines = lineTotals();
			return [
				el(
					'div',
					{ class: 'etk-components__review-head' },
					button( '', () => go( 'import' ), { class: 'etk-btn etk-btn--secondary etk-btn--icon', 'aria-label': 'Back to the JSON', 'data-etk-tooltip': 'Back to the JSON', html: icon( 'arrow-left' ), 'data-focus': 'back' } ),
					el(
						'div',
						{ class: 'etk-components__review-title' },
						el( 'h2', { class: 'etk-manager__page-title', tabindex: '-1', textContent: `Update ${ current.name }` } ),
						el( 'p', { class: 'etk-manager__muted', textContent: total ? 'Pick a layer to see its code.' : 'No changes. This matches the site’s version.' } )
					),
					total
						? el(
								'div',
								{ class: 'etk-components__review-actions' },
								approved < total ? el( 'span', { class: 'etk-manager__muted', textContent: `${ plural( total - approved, 'change', 'changes' ) } left out` } ) : null,
								el(
									'span',
									{ class: 'etk-components__lines' },
									el( 'span', { class: 'etk-components__lines-added', 'aria-hidden': 'true', textContent: `+${ lines.added }` } ),
									el( 'span', { class: 'etk-components__lines-removed', 'aria-hidden': 'true', textContent: `−${ lines.removed }` } ),
									el( 'span', { class: 'etk-sr', textContent: `${ plural( lines.added, 'line', 'lines' ) } added, ${ lines.removed } removed` } )
								),
								button( 'Update component', apply, { variant: 'primary', disabled: ! approved, 'data-focus': 'apply' } )
						  )
						: null
				),
				el(
					'div',
					{ class: 'etk-components__workspace' },
					el( 'div', { class: 'etk-components__side', 'data-scroll': 'side' }, layersView(), propsView(), metaView() ),
					el( 'section', { id: CODE_PANE, class: 'etk-components__code', 'aria-label': 'Changes', 'data-scroll': 'code' }, codePane() )
				),
			];
		},
	};

	/* ---- Decisions ---- */

	/*
	 * Everything starts ticked: ticked takes the incoming version, unticked
	 * keeps this site's. A changed layer decides its HTML and JS; an added or
	 * removed one decides whether it's added or removed, and the layers
	 * inside it go with it. CSS is decided per class, since a class is the
	 * same everywhere it's used.
	 */
	let decisions = { layers: new Map(), css: new Map(), props: new Map(), meta: new Map() };

	const resetDecisions = ( { tree, props, meta } ) => {
		decisions = { layers: new Map(), css: new Map(), props: new Map( props.filter( ( prop ) => prop.status !== 'same' ).map( ( prop ) => [ prop.key, true ] ) ), meta: new Map( meta.map( ( field ) => [ field.key, true ] ) ) };
		for ( const node of walk( tree ) ) {
			decisions.layers.set( node.id, { html: true, js: true, layer: true } );
			for ( const change of node.css ) decisions.css.set( change.selector, true );
		}
	};

	// An added or removed layer inside another added or removed one goes with it.
	const follows = ( node ) => ( node.status === 'added' || node.status === 'removed' ) && node.parent?.status === node.status;
	const deciderOf = ( node ) => ( follows( node ) ? deciderOf( node.parent ) : node );
	const layerApproved = ( node ) => decisions.layers.get( deciderOf( node ).id ).layer;

	// The changes a layer decides: its categories, or the layer itself.
	const decide = ( node, key, value ) => {
		if ( key === 'css' ) node.css.forEach( ( change ) => decisions.css.set( change.selector, value ) );
		else decisions.layers.get( node.id )[ key ] = value;
	};
	// After a tick or untick: draw it again, and say how many changes are left out.
	const decided = ( change ) => {
		change();
		render();
		const { approved, total } = tally();
		announce( approved === total ? 'Every change is ticked.' : `${ plural( total - approved, 'change', 'changes' ) } left out.` );
	};
	const decideLayer = ( node, value ) =>
		decided( () => {
			if ( node.status === 'added' || node.status === 'removed' ) decide( node, 'layer', value );
			for ( const key of changedCategories( node ) ) decide( node, key, value );
		} );

	// What a layer's own tickbox covers: the layer, when it's added or removed, or each part that changed.
	const layerParts = ( node ) => {
		const choice = decisions.layers.get( node.id );
		if ( node.status === 'added' || node.status === 'removed' ) return [ choice.layer ];
		return [ ...( node.html.length ? [ choice.html ] : [] ), ...( node.js ? [ choice.js ] : [] ), ...node.css.map( ( change ) => decisions.css.get( change.selector ) ) ];
	};
	// Ticked, unticked, or 'some' for a tickbox over several.
	const stateOf = ( values ) => ( values.every( Boolean ) ? true : values.some( Boolean ) ? 'some' : false );

	// Ticked of all the changes: each changed layer's HTML and JS, each layer added
	// or removed (not the ones inside it), and each class's CSS.
	const tally = () => {
		let approved = 0;
		let total = 0;
		const count = ( yes ) => {
			total++;
			if ( yes ) approved++;
		};
		for ( const node of walk( reviewing.tree ) ) {
			const choice = decisions.layers.get( node.id );
			if ( node.status === 'changed' ) {
				if ( node.html.length ) count( choice.html );
				if ( node.js ) count( choice.js );
			} else if ( node.status !== 'same' && ! follows( node ) ) {
				count( choice.layer );
			}
		}
		for ( const map of [ decisions.css, decisions.props, decisions.meta ] ) for ( const yes of map.values() ) count( yes );
		return { approved, total };
	};

	// A diff, worked out once per review.
	let diffs = new Map();
	const diffOf = ( from, to ) => {
		const key = `${ from }\u0000${ to }`;
		if ( ! diffs.has( key ) ) diffs.set( key, diffLines( from, to ) );
		return diffs.get( key );
	};

	// Lines added and removed by what's ticked: markup, scripts and class CSS.
	const lineTotals = () => {
		let added = 0;
		let removed = 0;
		const count = ( from, to ) => diffOf( from, to ).forEach( ( { op } ) => ( op === '+' ? added++ : op === '-' ? removed++ : null ) );
		const classes = new Map();
		for ( const node of walk( reviewing.tree ) ) {
			for ( const change of node.css ) classes.set( change.selector, change );
			if ( node.status === 'changed' ) {
				const choice = decisions.layers.get( node.id );
				if ( node.html.length && choice.html ) count( markup( node.current ), markup( node.incoming ) );
				if ( node.js && choice.js ) count( node.js.from, node.js.to );
			} else if ( node.status !== 'same' && layerApproved( node ) ) {
				count( node.current ? markup( node.current ) : '', node.incoming ? markup( node.incoming ) : '' );
				count( node.current?.script ?? '', node.incoming?.script ?? '' );
			}
		}
		for ( const [ selector, change ] of classes ) if ( decisions.css.get( selector ) ) count( change.from ?? '', change.to );
		return { added, removed };
	};

	/* ---- Applying ---- */

	// Layer JSON as Etch takes it back, without the IDs it hands out with it.
	const bare = ( { id, parentId, children, ...rest } ) => ( { ...rest, children: ( children || [] ).map( bare ) } );

	// A class this site doesn't have yet, until applying creates it.
	const NEW_STYLE = 'etk-new-style:';

	/**
	 * What ticking amounts to: the component's blocks, props, name and
	 * description, and the class changes that go with them. Incoming layers
	 * point to this site's classes and components: a class this site has is
	 * linked, one it doesn't is made (its CSS only if that's ticked), and
	 * a CSS change applies only to a class the result still uses.
	 */
	const plan = () => {
		const { incoming, now, tree, props, meta } = reviewing;
		const sides = makeSides( incoming );
		const local = window.etch.styles.list();
		const byId = new Map( local.map( ( style ) => [ style.id, style ] ) );
		const bySelector = new Map( local.map( ( style ) => [ style.selector, style ] ) );
		const create = new Map(); // Selector => CSS, for classes to make.
		const missing = new Set(); // Components this site doesn't have.

		const styleId = ( id ) => {
			const style = sides.incoming.style( id );
			// Unknown here and not in the JSON. Etch links the class again when a page using it saves.
			if ( ! style ) return null;
			if ( bySelector.has( style.selector ) ) return bySelector.get( style.selector ).id;
			if ( ! create.has( style.selector ) ) create.set( style.selector, decisions.css.get( style.selector ) ? style.css : '' );
			return NEW_STYLE + style.selector;
		};
		const localize = ( block ) => {
			const out = { ...block, children: ( block.children || [] ).map( localize ) };
			if ( Array.isArray( block.styles ) ) out.styles = block.styles.map( styleId ).filter( Boolean );
			if ( block.type === 'etch/component' ) {
				const id = sides.incoming.componentId( block.componentId );
				if ( id === null ) missing.add( sides.incoming.componentName( block.componentId ) );
				else out.componentId = id;
			}
			return out;
		};
		const localizeProp = ( prop ) => ( {
			...prop,
			...( prop.type?.specialized === 'class' && Array.isArray( prop.default ) ? { default: prop.default.map( ( id ) => styleId( id ) ?? id ) } : {} ),
			...( Array.isArray( prop.properties ) ? { properties: prop.properties.map( localizeProp ) } : {} ),
		} );

		const assemble = ( nodes ) =>
			nodes.flatMap( ( node ) => {
				if ( node.status === 'added' ) return layerApproved( node ) ? [ bare( localize( node.incoming.block ) ) ] : [];
				if ( node.status === 'removed' ) return layerApproved( node ) ? [] : [ bare( node.current.block ) ];
				const choice = decisions.layers.get( node.id );
				const base = node.html.length && choice.html ? localize( { ...node.incoming.block, children: [] } ) : node.current.block;
				const { id, parentId, children, script, ...fields } = base;
				const code = ( node.js && choice.js ? node.incoming.block : node.current.block ).script;
				return [ { ...fields, ...( code ? { script: { ...code } } : {} ), children: assemble( node.children ) } ];
			} );

		const blocks = assemble( tree );
		const properties = props.flatMap( ( prop ) => {
			const yes = decisions.props.get( prop.key );
			if ( prop.status === 'same' ) return [ prop.current ];
			if ( prop.status === 'added' ) return yes ? [ localizeProp( prop.incoming ) ] : [];
			if ( prop.status === 'removed' ) return yes ? [] : [ prop.current ];
			return [ yes ? localizeProp( prop.incoming ) : prop.current ];
		} );
		const details = Object.fromEntries( [ 'name', 'description' ].map( ( key ) => [ key, meta.find( ( field ) => field.key === key && decisions.meta.get( key ) )?.to ?? now[ key ] ?? '' ] ) );

		// The CSS each class would get, and the classes the result uses.
		const incomingCss = new Map();
		for ( const node of walk( tree ) ) for ( const change of node.css ) incomingCss.set( change.selector, change.to );
		const used = new Set();
		const collect = ( list ) =>
			list.forEach( ( block ) => {
				( block.styles || [] ).forEach( ( id ) => used.add( id.startsWith?.( NEW_STYLE ) ? id.slice( NEW_STYLE.length ) : byId.get( id )?.selector ) );
				collect( block.children || [] );
			} );
		collect( blocks );
		const update = [ ...decisions.css ]
			.filter( ( [ selector, yes ] ) => yes && used.has( selector ) && bySelector.has( selector ) )
			.map( ( [ selector ] ) => ( { id: bySelector.get( selector ).id, selector, from: bySelector.get( selector ).css ?? '', to: incomingCss.get( selector ) } ) );

		return { blocks, properties, ...details, create, update, missing };
	};

	// Put this site's IDs for the classes just made in place of their placeholders.
	const resolveNew = ( value, made ) => {
		if ( Array.isArray( value ) ) return value.map( ( item ) => resolveNew( item, made ) );
		if ( typeof value === 'string' && value.startsWith( NEW_STYLE ) ) return made.get( value.slice( NEW_STYLE.length ) ) ?? value;
		if ( isObject( value ) ) return Object.fromEntries( Object.entries( value ).map( ( [ key, item ] ) => [ key, resolveNew( item, made ) ] ) );
		return value;
	};

	// What was there before the last update, to put back.
	let previous = null;

	// The component as it was, as JSON to keep.
	const snapshot = ( json ) => ( { name: json.name, key: json.key, description: json.description, properties: json.properties, blocks: json.blocks.map( bare ) } );

	/**
	 * Save the ticked changes. The component is written at once, the way
	 * Etch's paste writes it. Class changes are made in the builder, like
	 * Etch's own, and saved with Etch's Save.
	 */
	const apply = async () => {
		const { current, now } = reviewing;
		let result;
		try {
			result = plan();
		} catch ( error ) {
			warn( errorText( error ) );
			return;
		}
		if ( result.missing.size ) {
			warn( `Add these components first: ${ [ ...result.missing ].join( ', ' ) }.` );
			return;
		}

		const { approved, total } = tally();
		const classes = result.update.length + result.create.size;
		const dialog = toolkit.confirmDialog( {
			title: `Update ${ current.name }?`,
			message: [
				el( 'p', { textContent: `Saves ${ approved } of ${ plural( total, 'change', 'changes' ) } now.` } ),
				classes ? el( 'p', { textContent: classes === 1 ? '1 class changes in the builder too. Save to keep it.' : `${ classes } classes change in the builder too. Save to keep them.` } ) : null,
				el( 'p', { textContent: 'You can restore the previous version later.' } ),
			].filter( Boolean ),
			confirmLabel: 'Update component',
			busyLabel: 'Updating…',
			variant: 'primary',
			failTitle: 'The component wasn’t updated',
		} );
		if ( ! ( await dialog.result ) ) return;

		// Class changes first, so the blocks can point to the new ones.
		const made = new Map();
		const undoStyles = () => {
			for ( const change of result.update ) window.etch.styles.update( change.id, { css: change.from } );
			for ( const id of made.values() ) window.etch.styles.delete( id );
		};
		try {
			for ( const [ selector, css ] of result.create ) made.set( selector, window.etch.styles.create( selector, css ) );
			for ( const change of result.update ) window.etch.styles.update( change.id, { css: change.to } );
			await window.etch.components.updateAsync( current.id, resolveNew( { blocks: result.blocks, properties: result.properties, name: result.name, description: result.description }, made ) );
		} catch ( error ) {
			try {
				undoStyles();
			} catch {}
			dialog.fail( `${ errorText( error ) } Nothing was changed.` );
			return;
		}

		previous = { id: current.id, name: result.name || current.name, json: snapshot( now ), update: result.update, made: [ ...made.values() ] };
		dialog.close();
		go( 'done' );
		announce( `${ previous.name } is updated.` );
	};

	// Put the component back as it was before the last update, and its classes.
	const restore = async ( trigger ) => {
		if ( ! previous ) return;
		trigger.disabled = true;
		try {
			await window.etch.components.updateAsync( previous.id, previous.json );
			for ( const change of previous.update ) window.etch.styles.update( change.id, { css: change.from } );
			for ( const id of previous.made ) {
				try {
					window.etch.styles.delete( id );
				} catch {}
			}
			const name = previous.json.name;
			previous = null;
			render();
			announce( `Put back the previous version of ${ name }.` );
			main.querySelector( '.etk-manager__page-title' )?.focus();
		} catch ( error ) {
			trigger.disabled = false;
			warn( `Couldn’t put the previous version back: ${ errorText( error ) }` );
		}
	};

	const download = () => downloadJson( JSON.stringify( previous.json, null, 2 ), `${ previous.json.key || 'component' }-before-update.json` );

	/* ---- Class usage, for how far a CSS change reaches ---- */

	let usage = null; // { selector: elements using it, across the site } | null while it loads.
	const loadUsage = () => {
		usage = null;
		toolkit
			.api( 'style-usage' )
			.then( ( data ) => {
				usage = data.counts || {};
				if ( view === 'review' ) render();
			} )
			.catch( () => ( usage = {} ) );
	};

	// Layers in this component that use a class, now.
	const usesHere = ( selector ) => [ ...walk( reviewing.tree ) ].filter( ( node ) => node.current?.styles.some( ( style ) => style.selector === selector ) ).length;

	/* ---- The layer tree, drawn like the Structure panel ---- */

	// Etch's caret, as in the Structure panel.
	const CARET =
		'<svg class="etk-components__caret-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.71304 5.30711C8.99329 5.19103 9.31588 5.25519 9.53038 5.46969L15.5303 11.4697C15.8232 11.7626 15.8232 12.2375 15.5303 12.5304L9.53033 18.5304C9.31583 18.7449 8.99324 18.809 8.71299 18.6929C8.43273 18.5768 8.25 18.3034 8.25 18L8.25005 6.00002C8.25005 5.69667 8.43278 5.4232 8.71304 5.30711Z"/></svg>';
	const CATEGORIES = { html: 'HTML', css: 'CSS', js: 'JS' };
	// The Structure panel colors components, loops and conditions.
	const KINDS = { 'etch/component': 'component', 'etch/loop': 'loop', 'etch/condition': 'condition' };

	// Layers closed in the tree (everything starts open).
	let closedLayers = new Set();
	let closedProps = new Set(); // Group and condition props folded shut, by path.

	// Whether the Layers and Props groups show everything, or only what changed.
	let showAll = { layers: false, props: false };

	// Folded runs of unchanged lines that were opened.
	let unfolded = new Set();

	// What the code pane shows: { kind: 'layer', id }, { kind: 'prop', key } or { kind: 'meta' }.
	let selected = null;
	const CODE_PANE = 'etk-components-code';
	const isSelected = ( kind, id ) => selected?.kind === kind && ( kind === 'meta' || selected.id === id );

	const chip = ( kind, text ) => el( 'span', { class: `etk-components__chip etk-components__chip--${ kind }`, textContent: text } );

	// "a", "a and b", "a, b and c".
	const listOf = ( items ) => ( items.length > 1 ? `${ items.slice( 0, -1 ).join( ', ' ) } and ${ items.at( -1 ) }` : items.join( '' ) );

	// Which categories changed on a layer. An added layer can still change a class's CSS.
	const changedCategories = ( node ) => Object.keys( CATEGORIES ).filter( ( key ) => ( key === 'js' ? node.js : node[ key ].length ) );

	const layerTitle = ( layer ) => ( layer.tag ? `${ layer.tag } ${ layer.label }` : layer.label );

	/**
	 * A tickbox. Ticked takes the incoming version, unticked keeps this
	 * site's, and 'some' shows a dash for one over several changes.
	 */
	const tick = ( label, value, onchange, focusKey ) =>
		el( 'input', { type: 'checkbox', class: 'etk-checkbox', checked: value === true, indeterminate: value === 'some', 'aria-label': label, 'data-focus': focusKey, onchange: ( e ) => onchange( e.target.checked ) } );

	// Show all, or only what changed. Only offered when something didn't change.
	const showToggle = ( key, what ) =>
		button(
			showAll[ key ] ? 'Show changed' : 'Show all',
			() => {
				showAll[ key ] = ! showAll[ key ];
				render();
				announce( showAll[ key ] ? `Showing every ${ what }.` : `Showing changed ${ what }s only.` );
			},
			{ class: 'etk-btn etk-btn--secondary etk-components__btn--small', 'data-focus': `show:${ key }` }
		);

	// A group on the left: its label, Show all, and its rows.
	const group = ( id, title, toggle, body ) =>
		el( 'section', { class: 'etk-components__group', 'aria-labelledby': id }, el( 'div', { class: 'etk-components__group-head' }, el( 'h3', { id, class: 'etk-manager__label', textContent: title } ), toggle ), body );

	const rows = ( items ) => el( 'div', { class: 'etk-components__tree' }, el( 'ul', { class: 'etk-components__layers', role: 'list' }, items ) );

	// A layer that changed shows, and one with changes inside, to hold them.
	const shownLayer = ( node ) => showAll.layers || node.status !== 'same' || node.inside > 0;

	// What a layer's row says to a screen reader after its name.
	const describeChanges = ( node ) => ( node.status === 'changed' ? `${ listOf( changedCategories( node ).map( ( key ) => CATEGORIES[ key ] ) ) } changed` : node.status );

	const layerChips = ( node ) => {
		if ( node.status === 'added' ) return [ chip( 'added', 'Added' ) ];
		if ( node.status === 'removed' ) return [ chip( 'removed', 'Removed' ) ];
		return changedCategories( node ).map( ( key ) => chip( key, CATEGORIES[ key ] ) );
	};

	const layerRow = ( node ) => {
		const layer = node.incoming || node.current;
		const title = layerTitle( layer );
		const kids = node.children.filter( shownLayer );
		const open = ! closedLayers.has( node.id );
		const hasChanges = node.status !== 'same';
		const showing = hasChanges && isSelected( 'layer', node.id );
		// Layers added or removed with the one they're in have no tickbox of their own.
		const parts = hasChanges && ! follows( node ) ? layerParts( node ) : [];
		const state = parts.length ? stateOf( parts ) : null;

		// Partly ticked, how much. Otherwise what changed. Closed, how much changed inside.
		const trailing = state === 'some' ? [ el( 'span', { class: 'etk-components__count', textContent: `${ parts.filter( Boolean ).length } of ${ parts.length }` } ) ] : hasChanges ? layerChips( node ) : [];
		if ( node.inside && ! open ) trailing.push( chip( 'inside', `${ node.inside } inside` ) );

		const name = el(
			'span',
			{ class: 'etk-components__layer-name' },
			layer.tag ? el( 'span', { class: 'etk-components__layer-tag', textContent: layer.tag } ) : null,
			el( 'span', { class: 'etk-components__layer-label', textContent: layer.label } )
		);
		const chipList = trailing.length ? el( 'span', { class: 'etk-components__chips', 'aria-hidden': 'true' }, trailing ) : null;
		const label = { added: `Add ${ title }`, removed: `Remove ${ title }` }[ node.status ] || `Changes to ${ title }`;

		return el(
			'li',
			{ class: `etk-components__layer etk-components__layer--${ node.status } etk-components__layer--${ KINDS[ layer.block.type ] || 'default' }`, 'data-layer': node.id },
			el(
				'div',
				{ class: `etk-components__row${ showing ? ' is-showing' : '' }` },
				kids.length
					? el( 'button', { type: 'button', class: 'etk-components__caret', 'aria-expanded': String( open ), 'aria-label': `Layers inside ${ title }`, html: CARET, 'data-focus': `${ node.id }:caret`, onclick: () => toggleLayer( node ) } )
					: el( 'span', { class: 'etk-components__leaf', 'aria-hidden': 'true' } ),
				parts.length ? tick( label, state, ( yes ) => decideLayer( node, yes ), `${ node.id }:tick` ) : null,
				// A layer with changes shows them in the code pane, like selecting a layer in the Structure panel.
				hasChanges
					? el(
							'button',
							{ type: 'button', class: 'etk-components__row-toggle', 'aria-current': showing ? 'true' : null, 'aria-controls': CODE_PANE, 'data-focus': `${ node.id }:toggle`, onclick: () => select( { kind: 'layer', id: node.id } ) },
							name,
							el( 'span', { class: 'etk-sr', textContent: `, ${ describeChanges( node ) }` } ),
							chipList
					  )
					: [ name, chipList ]
			),
			kids.length && open ? el( 'ul', { class: 'etk-components__layers etk-components__layers--inside', role: 'list' }, kids.map( layerRow ) ) : null
		);
	};

	const layersView = () => {
		const { tree } = reviewing;
		const shown = tree.filter( shownLayer );
		return group(
			'etk-components-layers-title',
			'Layers',
			[ ...walk( tree ) ].some( ( node ) => node.status === 'same' ) ? showToggle( 'layers', 'layer' ) : null,
			shown.length ? rows( shown.map( layerRow ) ) : el( 'p', { class: 'etk-components__help', textContent: 'No layer changes.' } )
		);
	};

	/* ---- The code pane ---- */

	// Unchanged lines kept around a change in scripts and CSS. Longer runs fold.
	const CONTEXT = 3;

	const diffLine = ( { op, text, before, after } ) =>
		el(
			op === '-' ? 'del' : op === '+' ? 'ins' : 'div',
			{ class: `etk-components__diff-line etk-components__diff-line--${ op === '-' ? 'del' : op === '+' ? 'ins' : 'same' }` },
			el( 'span', { class: 'etk-components__diff-num', 'aria-hidden': 'true', textContent: before ?? '' } ),
			el( 'span', { class: 'etk-components__diff-num', 'aria-hidden': 'true', textContent: after ?? '' } ),
			el( 'span', { class: 'etk-components__diff-mark', textContent: op === '-' ? '−' : op === '+' ? '+' : '' } ),
			el( 'span', { class: 'etk-components__diff-code', textContent: text || ' ' } )
		);

	/**
	 * A unified diff with the line numbers before and after. With a fold key,
	 * runs of unchanged lines further than CONTEXT from a change fold into a
	 * row that opens them.
	 */
	const diffView = ( lines, fold = null ) => {
		let before = 0;
		let after = 0;
		const numbered = lines.map( ( line ) => ( { ...line, before: line.op === '+' ? null : ++before, after: line.op === '-' ? null : ++after } ) );
		const out = [];
		for ( let i = 0; i < numbered.length; ) {
			if ( numbered[ i ].op !== ' ' || ! fold ) {
				out.push( diffLine( numbered[ i++ ] ) );
				continue;
			}
			let end = i;
			while ( end < numbered.length && numbered[ end ].op === ' ' ) end++;
			const head = i === 0 ? 0 : CONTEXT;
			const tail = end === numbered.length ? 0 : CONTEXT;
			const hidden = end - i - head - tail;
			if ( hidden < 2 ) {
				out.push( ...numbered.slice( i, end ).map( diffLine ) );
			} else {
				const id = `${ fold }:${ i }`;
				const open = unfolded.has( id );
				out.push(
					...numbered.slice( i, i + head ).map( diffLine ),
					el(
						'button',
						{ type: 'button', class: 'etk-components__fold', 'aria-expanded': String( open ), 'data-focus': `fold:${ id }`, onclick: () => toggleFold( id ) },
						el( 'span', { class: 'etk-components__fold-mark', 'aria-hidden': 'true', textContent: '⋯' } ),
						plural( hidden, 'unchanged line', 'unchanged lines' )
					),
					...( open ? numbered.slice( i + head, end - tail ).map( diffLine ) : [] ),
					...numbered.slice( end - tail, end ).map( diffLine )
				);
			}
			i = end;
		}
		return el( 'div', { class: 'etk-components__diff' }, out );
	};

	const toggleFold = ( id ) => {
		unfolded.has( id ) ? unfolded.delete( id ) : unfolded.add( id );
		render();
	};

	// One field: a one-line value as before and after, more lines as a line diff.
	const fieldView = ( { label, from, to } ) => {
		const short = ! from.includes( '\n' ) && ! to.includes( '\n' );
		return el(
			'div',
			{ class: `etk-components__field${ label ? '' : ' etk-components__field--bare' }` },
			label ? el( 'span', { class: 'etk-components__field-name', textContent: label } ) : null,
			short
				? el(
						'span',
						{ class: 'etk-components__field-values' },
						from ? el( 'del', { class: 'etk-components__value etk-components__value--del', textContent: from } ) : null,
						to ? el( 'ins', { class: 'etk-components__value etk-components__value--ins', textContent: to } ) : null
				  )
				: diffView( diffOf( from, to ) )
		);
	};
	const fields = ( list ) => el( 'div', { class: 'etk-components__fields' }, list.map( fieldView ) );

	// How far a class's CSS change reaches, from the Style usage counts.
	const reach = ( change ) => {
		if ( change.from === null ) return 'A new class on this site';
		if ( ! usage ) return 'Checking where this class is used…';
		const elsewhere = Math.max( 0, ( usage[ change.selector ] ?? 0 ) - usesHere( change.selector ) );
		return elsewhere ? `Used by ${ plural( elsewhere, 'other element', 'other elements' ) } on the site. Ticking changes them too.` : 'Only used in this component';
	};

	/**
	 * One part of what's picked, in the code pane's card: a header with its
	 * tickbox and label, then its code. Unticked, it says so and its code fades.
	 */
	const part = ( { kind, label, control = null, extra = [], unticked = '' }, ...body ) =>
		el(
			'section',
			{ class: `etk-components__part${ unticked ? ' is-unticked' : '' }` },
			el(
				'div',
				{ class: 'etk-components__part-head' },
				control,
				el( 'h4', { class: `etk-components__part-title etk-components__part-title--${ kind }`, textContent: label } ),
				...extra,
				unticked ? el( 'span', { class: 'etk-components__part-note', textContent: `· ${ unticked }` } ) : null
			),
			el( 'div', { class: 'etk-components__part-body' }, ...body )
		);

	// The code pane's title: what's picked, and a sentence about it.
	const paneHead = ( title, text ) => el( 'div', { class: 'etk-components__pane-head' }, el( 'h3', { class: 'etk-components__pane-title' }, title ), el( 'p', { class: 'etk-manager__muted', textContent: text } ) );

	// Elements that never close.
	const VOID = new Set( [ 'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr' ] );

	/**
	 * A layer's own markup, to read and compare line by line: its tag with an
	 * attribute a line, or what stands in for it, like a loop's {#loop} or a
	 * slot's {@slot}. The layers inside it are an "…".
	 */
	const markup = ( layer ) => {
		const b = layer.block;
		const inside = b.children?.length ? [ '  …' ] : [];
		const attrs = ( entries ) => entries.map( ( [ key, value ] ) => `${ key }="${ asText( value ) }"` );
		const open = ( tag, list, end = '>' ) => ( list.length > 1 ? [ `<${ tag }`, ...list.map( ( a ) => `  ${ a }` ), end.trim() ] : [ `<${ tag }${ list.length ? ` ${ list[ 0 ] }` : '' }${ end }` ] );
		const lines = ( text ) => String( text ?? '' ).split( '\n' );

		switch ( b.type ) {
			case 'etch/text':
				return lines( b.text ).join( '\n' );
			case 'etch/slot-placeholder':
				return `{@slot ${ b.slotName }}`;
			case 'etch/slot-content':
				return [ `{#slot ${ b.slotName }}`, ...inside, '{/slot}' ].join( '\n' );
			case 'etch/condition':
				return [ `{#if ${ b.conditionString }}`, ...inside, '{/if}' ].join( '\n' );
			case 'etch/loop':
				return [ `{#loop ${ b.target ?? b.loopId } as ${ b.itemId }${ b.indexId ? `, ${ b.indexId }` : '' }}`, ...( b.loopParams ? [ `  params: ${ asText( b.loopParams ) }` ] : [] ), ...inside, '{/loop}' ].join( '\n' );
			case 'etch/component': {
				const name = ( layer.html.get( 'component' )?.value || 'Component' ).replace( /\s+/g, '' );
				const list = attrs( Object.entries( b.attributes || {} ) );
				return ( inside.length ? [ ...open( name, list ), ...inside, `</${ name }>` ] : open( name, list, ' />' ) ).join( '\n' );
			}
			case 'etch/raw-html':
				return lines( b.content ).join( '\n' );
			case 'etch/passthrough':
				return asText( b.gutenbergBlock );
		}
		const tag = layer.tag || 'div';
		const list = attrs( Object.entries( b.attributes || {} ).filter( ( [ key ] ) => ! ( b.type === 'etch/dynamic-element' && key === 'tag' ) ) );
		if ( VOID.has( tag ) || b.type === 'etch/dynamic-image' ) return open( tag, list, ' />' ).join( '\n' );
		// Empty, it closes where it opens: <span></span>.
		if ( ! inside.length ) return open( tag, list, `></${ tag }>` ).join( '\n' );
		return [ ...open( tag, list ), ...inside, `</${ tag }>` ].join( '\n' );
	};

	// Changes to a layer that aren't in its markup: its name in the Structure panel, and such.
	const OUTSIDE_MARKUP = new Set( [ 'name', 'hidden', 'options' ] );

	// The sentence under a layer's title in the code pane.
	const layerText = ( node ) => {
		if ( follows( node ) ) {
			const decider = deciderOf( node );
			return `${ node.status === 'added' ? 'Added' : 'Removed' } with ${ layerTitle( decider.incoming || decider.current ) }.`;
		}
		if ( node.status === 'added' ) return 'Added in this version. Untick it in Layers to leave it out.';
		if ( node.status === 'removed' ) return 'Removed in this version. Untick it in Layers to keep it.';
		const several = layerParts( node ).length > 1;
		return `${ node.parent ? '' : 'Root layer. ' }Its ${ listOf( changedCategories( node ).map( ( key ) => CATEGORIES[ key ] ) ) } changed. ${ several ? 'Untick one to keep this site’s version of it.' : 'Untick it to keep this site’s version.' }`;
	};

	/**
	 * What changed on a layer, for the code pane: its markup whole, and the
	 * scripts and classes whose CSS changes, folded around what changed. An
	 * added or removed layer shows all of it.
	 */
	const details = ( node ) => {
		const layer = node.incoming || node.current;
		const title = layerTitle( layer );
		const choices = decisions.layers.get( node.id );
		const whole = node.status === 'added' || node.status === 'removed';
		// An added layer left out isn't added, a removed one left out stays.
		const leftOut = whole && ! layerApproved( node ) ? ( node.status === 'added' ? 'unticked, not added' : 'unticked, stays on this site' ) : '';
		const parts = [];

		// HTML: the layer's markup, and its name if that changed.
		if ( whole || node.html.length ) {
			parts.push(
				part(
					{
						kind: 'html',
						label: 'HTML',
						control: whole ? null : tick( `HTML changes on ${ title }`, choices.html, ( yes ) => decided( () => decide( node, 'html', yes ) ), `${ node.id }:html` ),
						unticked: whole ? leftOut : choices.html ? '' : 'unticked, keeps this site’s markup',
					},
					node.html.some( ( field ) => OUTSIDE_MARKUP.has( field.key ) ) ? fields( node.html.filter( ( field ) => OUTSIDE_MARKUP.has( field.key ) ) ) : null,
					diffView( diffOf( node.current ? markup( node.current ) : '', node.incoming ? markup( node.incoming ) : '' ) )
				)
			);
		}

		// CSS: each class whose CSS would change, decided on its own.
		for ( const change of node.css ) {
			const yes = decisions.css.get( change.selector );
			const wide = change.from !== null && usage && ( usage[ change.selector ] ?? 0 ) > usesHere( change.selector );
			parts.push(
				part(
					{
						kind: 'css',
						label: 'CSS',
						control: tick( `CSS changes to ${ change.selector }`, yes, ( value ) => decided( () => decisions.css.set( change.selector, value ) ), `${ node.id }:css:${ change.selector }` ),
						extra: [ el( 'code', { class: 'etk-components__part-selector', textContent: change.selector } ), el( 'span', { class: `etk-components__reach${ wide ? ' is-wide' : '' }`, textContent: reach( change ) } ) ],
						unticked: yes ? '' : change.from === null ? 'unticked, the new class stays empty' : 'unticked, keeps this site’s CSS',
					},
					diffView( diffOf( change.from ?? '', change.to ), `${ node.id }:css:${ change.selector }` )
				)
			);
		}

		// JS: the script, folded around what changed.
		const scriptBefore = node.current?.script ?? '';
		const scriptAfter = node.incoming?.script ?? '';
		if ( node.js || ( whole && ( scriptBefore || scriptAfter ) ) ) {
			parts.push(
				part(
					{
						kind: 'js',
						label: 'JS',
						control: whole ? null : tick( `JS changes on ${ title }`, choices.js, ( yes ) => decided( () => decide( node, 'js', yes ) ), `${ node.id }:js` ),
						unticked: whole ? leftOut : choices.js ? '' : 'unticked, keeps this site’s script',
					},
					diffView( diffOf( scriptBefore, scriptAfter ), `${ node.id }:js` )
				)
			);
		}

		return [
			paneHead( [ layer.tag ? el( 'span', { class: 'etk-components__pane-tag etk-components__layer-tag', textContent: layer.tag } ) : null, el( 'span', { textContent: layer.label } ) ], layerText( node ) ),
			el( 'div', { class: 'etk-components__card' }, parts ),
		];
	};

	// What the code pane shows for the selection.
	const codePane = () => {
		const node = selected?.kind === 'layer' && [ ...walk( reviewing.tree ) ].find( ( n ) => n.id === selected.id );
		if ( node ) return details( node );
		const prop = selected?.kind === 'prop' && propAt( selected.id );
		if ( prop ) return propDetails( prop );
		if ( selected?.kind === 'meta' && reviewing.meta.length ) return metaDetails();
		return el( 'p', { class: 'etk-components__empty', textContent: tally().total ? 'Select a layer or prop to see what changed.' : 'No changes. This matches the site’s version.' } );
	};

	// The first thing that changed: a layer, a prop, or the name and description.
	const firstChange = () => {
		const node = [ ...walk( reviewing.tree ) ].find( ( n ) => n.status !== 'same' );
		if ( node ) return { kind: 'layer', id: node.id };
		const prop = reviewing.props.find( ( p ) => p.status !== 'same' );
		if ( prop ) return { kind: 'prop', id: prop.key };
		return reviewing.meta.length ? { kind: 'meta' } : null;
	};

	const select = ( next ) => {
		selected = next;
		render();
		// A newly picked layer's code starts at the top.
		document.getElementById( CODE_PANE )?.scrollTo( 0, 0 );
		const layer = next.kind === 'layer' && [ ...walk( reviewing.tree ) ].find( ( n ) => n.id === next.id );
		announce( `Showing ${ layer ? layerTitle( layer.incoming || layer.current ) : next.kind === 'prop' ? `the ${ propName( propAt( next.id ) ) } prop` : `the ${ listOf( reviewing.meta.map( ( field ) => field.label ) ).toLowerCase() }` }.` );
	};

	/* ---- Props, and the component's name and description ---- */

	const PROP_STATUS = { added: 'Added', removed: 'Removed', changed: 'Changed' };

	// A changed prop's chip is in the accent color, like HTML's.
	const propChip = ( prop ) => chip( prop.status === 'changed' ? 'html' : prop.status, PROP_STATUS[ prop.status ] );
	const propName = ( prop ) => ( prop.incoming || prop.current ).name || prop.key;
	const propLabel = ( prop ) => ( { added: `Add the ${ propName( prop ) } prop`, removed: `Remove the ${ propName( prop ) } prop` }[ prop.status ] || `Changes to the ${ propName( prop ) } prop` );

	// Etch's icons for each prop type, as its component editor shows them: name => [ viewBox size, SVG ].
	const PROP_ICON_SVGS = {
		'toggle-on': [ 24, '<path d="M18 6H6C3.79086 6 2 7.79086 2 10V14C2 16.2091 3.79086 18 6 18H18C20.2091 18 22 16.2091 22 14V10C22 7.79086 20.2091 6 18 6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/><path d="M17 9H15C13.8954 9 13 9.89543 13 11V13C13 14.1046 13.8954 15 15 15H17C18.1046 15 19 14.1046 19 13V11C19 9.89543 18.1046 9 17 9Z" stroke="currentColor" stroke-width="1.5" fill="none"/>' ],
		'text-icon': [ 16, '<path d="M9.66667 14H6.33334M8 2V14M3.33334 3.66667V2.66667C3.33334 2.29848 3.63182 2 4 2H12C12.3682 2 12.6667 2.29848 12.6667 2.66667V3.66667" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="fill:none"/>' ],
		'cursor-rectangle-selection-01': [ 24, '<path d="M2 8.5V11.5M11.5 2H8.5M8.5 18H9.5M18 4.5V4C18 2.89543 17.1046 2 16 2H15.5M2 4.5V4C2 2.89543 2.89543 2 4 2H4.5M4.5 18H4C2.89543 18 2 17.1046 2 16V15.5M18 9.5V8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M13.8951 21.6448L10.0224 10.5183C9.91531 10.2107 10.2108 9.91536 10.5186 10.0224L21.6539 13.8929C21.9657 14.0013 22.01 14.4237 21.7274 14.5943L18.728 16.4051C18.511 16.5361 18.4749 16.8361 18.6547 17.0148L21.8851 20.2258C22.038 20.3778 22.0383 20.625 21.8858 20.7775L20.7766 21.8859C20.6244 22.038 20.3776 22.038 20.2253 21.8859L17.0023 18.665C16.8231 18.486 16.5234 18.5226 16.3927 18.7394L14.5972 21.7179C14.4267 22.0007 14.0036 21.9567 13.8951 21.6448Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>' ],
		'image-03': [ 24, '<path d="M20 3H4C2.89543 3 2 3.89543 2 5V19C2 20.1046 2.89543 21 4 21H20C21.1046 21 22 20.1046 22 19V5C22 3.89543 21.1046 3 20 3Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M22 17L16 11H15L10 16L7.5 13.5H6.5L2 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' ],
		'infinity-01': [ 24, '<path d="M12 12C12 12 9.26142 17 6.5 17C3.73858 17 2 14.7614 2 12C2 9.23858 3.73858 7 6.5 7C9.26142 7 12 12 12 12ZM12 12C12 12 14.7386 17 17.5 17C20.2614 17 22 14.7614 22 12C22 9.23858 20.2614 7 17.5 7C14.7386 7 12 12 12 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>' ],
		'code-circle': [ 24, '<path d="M8.5 8H7.5C7.22386 8 7 8.22386 7 8.5V10.3486C7 10.4473 6.97078 10.5438 6.91603 10.626L6 12L6.91603 13.374C6.97078 13.4562 7 13.5527 7 13.6514V15.5C7 15.7761 7.22386 16 7.5 16H8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M15.5 8H16.5C16.7761 8 17 8.22386 17 8.5V10.3486C17 10.4473 17.0292 10.5438 17.084 10.626L18 12L17.084 13.374C17.0292 13.4562 17 13.5527 17 13.6514V15.5C17 15.7761 16.7761 16 16.5 16H15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M10 12H10.009M13.991 12H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" fill="none"></circle>' ],
		'property-group': [ 24, '<path fill-rule="evenodd" clip-rule="evenodd" d="M4.67857 1.75C3.06117 1.75 1.75 3.06117 1.75 4.67857V6.63095C1.75 7.17009 2.18706 7.60714 2.72619 7.60714C3.26533 7.60714 3.70238 7.17009 3.70238 6.63095V4.67857C3.70238 4.13944 4.13944 3.70238 4.67857 3.70238H6.63095C7.17009 3.70238 7.60714 3.26533 7.60714 2.72619C7.60714 2.18706 7.17009 1.75 6.63095 1.75H4.67857ZM17.369 1.75C16.8299 1.75 16.3929 2.18706 16.3929 2.72619C16.3929 3.26533 16.8299 3.70238 17.369 3.70238H19.3214C19.8606 3.70238 20.2976 4.13944 20.2976 4.67857V6.63095C20.2976 7.17009 20.7347 7.60714 21.2738 7.60714C21.8129 7.60714 22.25 7.17009 22.25 6.63095V4.67857C22.25 3.06117 20.9388 1.75 19.3214 1.75H17.369ZM3.70238 17.369C3.70238 16.8299 3.26533 16.3929 2.72619 16.3929C2.18706 16.3929 1.75 16.8299 1.75 17.369V19.3214C1.75 20.9388 3.06117 22.25 4.67857 22.25H6.63095C7.17009 22.25 7.60714 21.8129 7.60714 21.2738C7.60714 20.7347 7.17009 20.2976 6.63095 20.2976H4.67857C4.13944 20.2976 3.70238 19.8606 3.70238 19.3214V17.369ZM22.25 17.369C22.25 16.8299 21.8129 16.3929 21.2738 16.3929C20.7347 16.3929 20.2976 16.8299 20.2976 17.369V19.3214C20.2976 19.8606 19.8606 20.2976 19.3214 20.2976H17.369C16.8299 20.2976 16.3929 20.7347 16.3929 21.2738C16.3929 21.8129 16.8299 22.25 17.369 22.25H19.3214C20.9388 22.25 22.25 20.9388 22.25 19.3214V17.369ZM10.0476 1.75C9.50848 1.75 9.07143 2.18706 9.07143 2.72619C9.07143 3.26533 9.50848 3.70238 10.0476 3.70238H13.9524C14.4915 3.70238 14.9286 3.26533 14.9286 2.72619C14.9286 2.18706 14.4915 1.75 13.9524 1.75H10.0476ZM3.70238 10.0476C3.70238 9.50848 3.26533 9.07143 2.72619 9.07143C2.18706 9.07143 1.75 9.50848 1.75 10.0476V13.9524C1.75 14.4915 2.18706 14.9286 2.72619 14.9286C3.26533 14.9286 3.70238 14.4915 3.70238 13.9524V10.0476ZM22.25 10.0476C22.25 9.50848 21.8129 9.07143 21.2738 9.07143C20.7347 9.07143 20.2976 9.50848 20.2976 10.0476V13.9524C20.2976 14.4915 20.7347 14.9286 21.2738 14.9286C21.8129 14.9286 22.25 14.4915 22.25 13.9524V10.0476ZM10.0476 20.2976C9.50848 20.2976 9.07143 20.7347 9.07143 21.2738C9.07143 21.8129 9.50848 22.25 10.0476 22.25H13.9524C14.4915 22.25 14.9286 21.8129 14.9286 21.2738C14.9286 20.7347 14.4915 20.2976 13.9524 20.2976H10.0476Z" fill="currentColor"/>' ],
		'css-3': [ 24, '<path d="M20.5 2.5H3.5L5.5 19.5L11.5 21.5L18.5 19.5L20.5 2.5Z" stroke="currentColor" fill="none"/><path d="M7.5 6.5H16.5L8 11H16L15.5 16L12 17L8.5 16L8.3 14" stroke="currentColor" fill="none"/>' ],
		'arrow-data-transfer-vertical': [ 24, '<path d="M15 19.0002L15 4.99988L19 7.99988" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M9 4.99951L9 18.9998L5 15.9998" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' ],
		'text-font': [ 24, '<path d="M14 19L9 5H7L2 19M4 14H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M16.5 11.5L16.6298 11.3053C17.1735 10.4898 18.0887 10 19.0688 10C20.6876 10 22 11.3124 22 12.9312V18.5M22 14H18.561C17.1466 14 16 15.1466 16 16.561C16 17.908 17.092 19 18.439 19H18.7408C19.2376 19 19.725 18.865 20.151 18.6094L20.3033 18.518C21.3559 17.8864 22 16.7489 22 15.5213V14Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' ],
	};
	const PROP_ICONS = { boolean: 'toggle-on', string: 'text-icon', 'string:select': 'cursor-rectangle-selection-01', 'string:wpMediaId': 'image-03', 'string:image': 'image-03', 'string:array': 'infinity-01', object: 'code-circle', 'object:group': 'property-group', 'array:repeater': 'property-group', 'array:class': 'css-3', 'string:condition': 'arrow-data-transfer-vertical' };
	const propIcon = ( prop ) => {
		const { type } = prop.incoming || prop.current;
		const name = typeof type === 'string' ? type : type?.specialized ? `${ type.primitive }:${ type.specialized }` : type?.primitive;
		const [ size, svg ] = PROP_ICON_SVGS[ PROP_ICONS[ name ] ?? 'text-font' ];
		return el( 'span', { class: 'etk-components__prop-icon', 'aria-hidden': 'true', html: `<svg viewBox="0 0 ${ size } ${ size }" width="14" height="14" focusable="false">${ svg }</svg>` } );
	};

	// Every compared prop, the ones inside groups and conditions too, depth first.
	const walkProps = function* ( props ) {
		for ( const prop of props ) {
			yield prop;
			yield* walkProps( prop.inner );
		}
	};
	const propAt = ( path ) => [ ...walkProps( reviewing.props ) ].find( ( prop ) => prop.path === path );

	// A prop that changed shows, and so does one with changes inside, to hold them.
	const shownProp = ( prop ) => showAll.props || prop.status !== 'same';

	const toggleProp = ( prop ) => {
		closedProps.has( prop.path ) ? closedProps.delete( prop.path ) : closedProps.add( prop.path );
		render();
	};

	// A prop's row, with the props inside it below. Only a top-level prop has a
	// tickbox: the one tick takes or leaves everything inside it.
	const propRow = ( prop ) => {
		const kids = prop.inner.filter( shownProp );
		const open = ! closedProps.has( prop.path );
		const inside = prop.path !== prop.root;
		const showing = prop.status !== 'same' && isSelected( 'prop', prop.path );
		const trailing = prop.status === 'same' ? [] : [ propChip( prop ) ];
		if ( prop.inside && ! open ) trailing.push( chip( 'inside', `${ prop.inside } inside` ) );
		const name = el( 'span', { class: 'etk-components__layer-name' }, propIcon( prop ), el( 'span', { class: 'etk-components__layer-label', textContent: propName( prop ) } ) );
		const chipList = trailing.length ? el( 'span', { class: 'etk-components__chips', 'aria-hidden': 'true' }, trailing ) : null;
		return el(
			'li',
			{ class: `etk-components__layer etk-components__layer--${ prop.status }` },
			el(
				'div',
				{ class: `etk-components__row${ showing ? ' is-showing' : '' }` },
				kids.length
					? el( 'button', { type: 'button', class: 'etk-components__caret', 'aria-expanded': String( open ), 'aria-label': `Props inside ${ propName( prop ) }`, html: CARET, 'data-focus': `prop:${ prop.path }:caret`, onclick: () => toggleProp( prop ) } )
					: el( 'span', { class: 'etk-components__leaf', 'aria-hidden': 'true' } ),
				prop.status !== 'same' && ! inside ? tick( propLabel( prop ), decisions.props.get( prop.key ), ( yes ) => decided( () => decisions.props.set( prop.key, yes ) ), `prop:${ prop.key }:tick` ) : null,
				prop.status === 'same'
					? [ name, chipList ]
					: el(
							'button',
							{ type: 'button', class: 'etk-components__row-toggle', 'aria-current': showing ? 'true' : null, 'aria-controls': CODE_PANE, 'data-focus': `prop:${ prop.path }:toggle`, onclick: () => select( { kind: 'prop', id: prop.path } ) },
							name,
							el( 'span', { class: 'etk-sr', textContent: `, ${ prop.status }` } ),
							chipList
					  )
			),
			kids.length && open ? el( 'ul', { class: 'etk-components__layers etk-components__layers--inside', role: 'list' }, kids.map( propRow ) ) : null
		);
	};

	// The props inside a group or condition that differ, each with its fields and the props inside it.
	const innerProps = ( list ) => {
		const shown = list.filter( ( prop ) => prop.status !== 'same' );
		if ( ! shown.length ) return null;
		return el(
			'ul',
			{ class: 'etk-components__inner-props' },
			shown.map( ( prop ) =>
				el(
					'li',
					{ class: 'etk-components__inner-prop' },
					el(
						'div',
						{ class: 'etk-components__inner-head' },
						el( 'span', { class: 'etk-components__inner-name', textContent: propName( prop ) } ),
						el( 'code', { class: 'etk-components__pane-tag', textContent: prop.key } ),
						propChip( prop )
					),
					prop.fields.length ? fields( prop.fields ) : null,
					innerProps( prop.inner )
				)
			)
		);
	};

	const propDetails = ( prop ) => {
		const source = prop.incoming || prop.current;
		const top = propAt( prop.root );
		const inside = prop !== top;
		const yes = decisions.props.get( prop.root );
		const changes = [ ...prop.fields.map( ( field ) => field.label.toLowerCase() ), ...( prop.inner.some( ( inner ) => inner.status !== 'same' ) ? [ 'props inside' ] : [] ) ];
		const what = { added: 'Added in this version.', removed: 'Removed in this version.', changed: `Its ${ listOf( changes ) } changed.` }[ prop.status ];
		const how = inside ? `It’s inside ${ propName( top ) }, whose tickbox takes or leaves everything in it.` : { added: 'Untick it to leave it out.', removed: 'Untick it to keep it.', changed: 'Untick it to keep this site’s version.' }[ prop.status ];
		const unticked = inside ? `${ propName( top ) } unticked, keeps this site’s version` : { added: 'unticked, not added', removed: 'unticked, stays on this site', changed: 'unticked, keeps this site’s prop' }[ prop.status ];
		return [
			paneHead( [ el( 'span', { textContent: propName( prop ) } ), source.name ? el( 'code', { class: 'etk-components__pane-tag', textContent: prop.key } ) : null ], `${ what } ${ how }` ),
			el(
				'div',
				{ class: 'etk-components__card' },
				part( { kind: prop.status, label: `${ PROP_STATUS[ prop.status ] } prop`, control: inside ? null : tick( propLabel( prop ), yes, ( value ) => decided( () => decisions.props.set( prop.key, value ) ), `prop:${ prop.key }` ), unticked: yes ? '' : unticked }, prop.fields.length ? fields( prop.fields ) : null, innerProps( prop.inner ) )
			),
		];
	};

	const propsView = () => {
		const { props } = reviewing;
		if ( ! props.length ) return null;
		const shown = props.filter( shownProp );
		return group(
			'etk-components-props-title',
			'Props',
			[ ...walkProps( props ) ].some( ( prop ) => prop.status === 'same' ) ? showToggle( 'props', 'prop' ) : null,
			shown.length ? rows( shown.map( propRow ) ) : el( 'p', { class: 'etk-components__help', textContent: 'No prop changes.' } )
		);
	};

	// The component's name and description, when the JSON has others: a row to select.
	const metaView = () => {
		const { meta } = reviewing;
		if ( ! meta.length ) return null;
		const showing = isSelected( 'meta' );
		const label = listOf( meta.map( ( field ) => field.label ) );
		return group(
			'etk-components-meta-title',
			'Component',
			null,
			rows(
				el(
					'li',
					{ class: 'etk-components__layer etk-components__layer--changed' },
					el(
						'div',
						{ class: `etk-components__row${ showing ? ' is-showing' : '' }` },
						tick( `Changes to the ${ label.toLowerCase() }`, stateOf( meta.map( ( field ) => decisions.meta.get( field.key ) ) ), ( yes ) => decided( () => meta.forEach( ( field ) => decisions.meta.set( field.key, yes ) ) ), 'meta:tick' ),
						el(
							'button',
							{ type: 'button', class: 'etk-components__row-toggle', 'aria-current': showing ? 'true' : null, 'aria-controls': CODE_PANE, 'data-focus': 'meta:toggle', onclick: () => select( { kind: 'meta' } ) },
							el( 'span', { class: 'etk-components__layer-name' }, el( 'span', { class: 'etk-components__layer-label', textContent: label } ) ),
							el( 'span', { class: 'etk-sr', textContent: ', changed' } ),
							el( 'span', { class: 'etk-components__chips', 'aria-hidden': 'true' }, chip( 'html', 'Changed' ) )
						)
					)
				)
			)
		);
	};

	const metaDetails = () => [
		paneHead( listOf( reviewing.meta.map( ( field ) => field.label ) ), reviewing.meta.length > 1 ? 'Both changed. Untick one to keep this site’s version of it.' : `The ${ reviewing.meta[ 0 ].label.toLowerCase() } changed. Untick it to keep this site’s version.` ),
		el(
			'div',
			{ class: 'etk-components__card' },
			reviewing.meta.map( ( field ) => {
				const yes = decisions.meta.get( field.key );
				return part(
					{ kind: 'html', label: field.label, control: tick( `${ field.label } change`, yes, ( value ) => decided( () => decisions.meta.set( field.key, value ) ), `meta:${ field.key }` ), unticked: yes ? '' : `unticked, keeps this site’s ${ field.label.toLowerCase() }` },
					fields( [ { ...field, label: '' } ] )
				);
			} )
		),
	];

	const toggleLayer = ( node ) => {
		closedLayers.has( node.id ) ? closedLayers.delete( node.id ) : closedLayers.add( node.id );
		render();
	};

	// Render the view again, keeping focus on the same control and panes scrolled where they were.
	const render = () => {
		if ( ! main ) return;
		const focused = main.contains( document.activeElement ) ? document.activeElement.dataset.focus : null;
		const scrolled = new Map( [ ...main.querySelectorAll( '[data-scroll]' ) ].map( ( pane ) => [ pane.dataset.scroll, pane.scrollTop ] ) );
		main.replaceChildren( el( 'div', { class: `etk-manager__page etk-components__page--${ view }` }, ...views[ view ]() ) );
		syncPicks();
		main.querySelectorAll( '[data-scroll]' ).forEach( ( pane ) => ( pane.scrollTop = scrolled.get( pane.dataset.scroll ) ?? 0 ) );
		if ( focused ) main.querySelector( `[data-focus="${ CSS.escape( focused ) }"]` )?.focus( { preventScroll: true } );
	};

	// Focus goes to the view's title, or the search on the list.
	const go = ( next, { focus = true } = {} ) => {
		view = next;
		render();
		if ( focus ) main.querySelector( '.etk-manager__page-title, [data-focus="search"]' )?.focus();
	};

	const loadUsedOn = () =>
		toolkit
			.api( 'components/usage' )
			.then( ( data ) => {
				usedOn = data.usage || {};
				if ( view === 'list' ) render();
			} )
			.catch( ( error ) => warn( `Couldn’t check where components are used: ${ errorText( error ) }` ) );

	const showList = () => {
		target = null;
		loadUsedOn();
		go( 'list' );
	};

	const updateOne = ( component ) => {
		target = component;
		pasted = '';
		go( 'import' );
	};

	/* ---- Editing in Etch ---- */

	// Marks the instance Edit adds to the open page, to take off again.
	const TEMPORARY = 'etchToolkitTemporary';
	const isTemporary = ( blockId ) => !! window.etch.blocks.getJson( blockId ).options?.[ TEMPORARY ];
	const temporaries = () => window.etch.blocks.find( { type: 'etch/component' } ).filter( isTemporary );

	// An instance of a component on the page that's open, not one Edit added.
	const instanceOf = ( id ) => window.etch.blocks.find( { type: 'etch/component' } ).find( ( blockId ) => window.etch.blocks.getJson( blockId ).componentId === id && ! isTemporary( blockId ) ) ?? null;

	// An edit through an instance Edit added: its page, whether that was saved with it, and the timer watching it.
	let editing = null;

	/**
	 * Take the added instance off the page. Saving in Etch's component editor
	 * saves the page too, so if it was saved with the instance, save again.
	 * If that fails, Etch still shows the page as unsaved.
	 */
	const tidy = async ( saved ) => {
		temporaries().forEach( ( id ) => window.etch.blocks.delete( id ) );
		if ( ! saved ) return;
		try {
			await toolkit.save();
		} catch ( error ) {
			console.error( 'Etch Toolkit: the page wasn’t saved without the component’s instance.', error );
		}
	};

	const stopEditing = () => {
		window.clearInterval( editing.timer );
		const done = editing;
		editing = null;
		return done;
	};

	// Once the editor closes, the added instance goes.
	const watch = async () => {
		const active = window.etch.navigation.getActivePostId();
		if ( active === editing.postId ) {
			if ( ! window.etch.blocks.isInComponentEditMode() ) tidy( stopEditing().saved );
			return;
		}
		// Another page was opened mid-edit. Etch keeps this one as it was and saves every page
		// opened this session, so go back, close the editor and take the instance off first.
		const { postId, saved } = stopEditing();
		try {
			await window.etch.navigation.openPostAsync( postId );
			if ( window.etch.blocks.isInComponentEditMode() ) window.etch.blocks.exitComponentEditMode();
			await tidy( saved );
		} finally {
			await window.etch.navigation.openPostAsync( active );
		}
	};

	toolkit.afterSave?.( () => {
		if ( editing && window.etch.navigation.getActivePostId() === editing.postId ) {
			editing.saved = true;
		} else if ( ! editing && window.etch?.blocks && temporaries().length ) {
			// One brought back after its edit, by undo. Not waited for: this runs inside Etch's save.
			window.setTimeout( () => tidy( true ) );
		}
	} );

	/**
	 * Open a component in Etch's component editor, which edits through an
	 * instance on the open page: one already there, or one added at the top
	 * and taken off again when the editor closes.
	 */
	const editInEtch = ( component ) => {
		if ( window.etch.blocks.isInComponentEditMode() ) {
			warn( 'Finish editing the open component first.' );
			return;
		}
		try {
			// Etch's editor needs the component loaded.
			window.etch.components.getJson( component.id );
			let blockId = instanceOf( component.id );
			if ( ! blockId ) {
				blockId = window.etch.blocks.create( { type: 'etch/component', version: 1, context: {}, options: { [ TEMPORARY ]: true }, children: [], componentId: component.id, attributes: {} }, null, 0 );
				editing = { postId: window.etch.navigation.getActivePostId(), saved: false, timer: window.setInterval( watch, 250 ) };
			}
			window.etch.blocks.select( blockId );
			window.etch.blocks.enterComponentEditMode( blockId );
			close( { focus: false } );
		} catch ( error ) {
			if ( editing ) tidy( stopEditing().saved );
			warn( `Couldn’t open ${ component.name }: ${ errorText( error ) }` );
		}
	};

	/**
	 * A component as Etch's copy (Cmd+C) gives it, with its classes, loops and
	 * nested components. Etch copies from the page, so this copies an instance
	 * added at the top and taken straight off again, with its props at their
	 * defaults. Unmarked, or the mark would go with it into every paste.
	 */
	const copyOf = ( component ) => {
		if ( window.etch.blocks.isInComponentEditMode() ) throw new Error( 'Finish editing the open component first.' );
		// Etch's copy needs the component loaded.
		window.etch.components.getJson( component.id );
		const blockId = window.etch.blocks.create( { type: 'etch/component', version: 1, context: {}, options: {}, children: [], componentId: component.id, attributes: {} }, null, 0 );
		try {
			return window.etch.blocks.copy( blockId );
		} finally {
			window.etch.blocks.delete( blockId );
		}
	};

	const review = ( { incoming, current } ) => {
		const now = window.etch.components.getJson( current.id );
		const meta = [
			[ 'name', 'Name' ],
			[ 'description', 'Description' ],
		]
			.map( ( [ key, label ] ) => ( { key, label, from: String( now[ key ] ?? '' ), to: incoming[ key ] } ) )
			// JSON without a description leaves this site's alone.
			.filter( ( field ) => field.to && field.from !== field.to );
		reviewing = { incoming, current, now, tree: compare( now, incoming ), props: compareProps( now.properties || [], incoming.properties, makeSides( incoming ) ), meta };
		closedLayers = new Set();
		closedProps = new Set();
		showAll = { layers: false, props: false };
		unfolded = new Set();
		diffs = new Map();
		resetDecisions( reviewing );
		selected = firstChange();
		loadUsage();
		go( 'review' );
	};

	/* ------------------------------------------------------------------ */
	/* Panel                                                               */
	/* ------------------------------------------------------------------ */

	const build = () => {
		status = el( 'div', { class: 'etk-manager__status', role: 'status', 'aria-live': 'polite' } );
		main = el( 'div', { class: 'etk-manager__main' } );
		panel = el(
			'section',
			{
				id: 'etk-components',
				class: 'etk-manager etk-manager--panel etk-manager--single etk-components',
				hidden: true,
				'aria-labelledby': 'etk-components-title',
				// Esc clears the picked components first.
				...managerKeys( () => ( picked.size ? clearPicks() : close() ) ),
			},
			// Across the top, like Etch's Style Manager.
			el(
				'header',
				{ class: 'etk-manager__header' },
				el( 'button', { type: 'button', class: 'etk-btn etk-btn--secondary etk-btn--icon', 'aria-label': 'Back to the builder', 'data-etk-tooltip': 'Back to the builder', html: icon( 'arrow-left' ), onclick: () => close() } ),
				el( 'h1', { id: 'etk-components-title', class: 'etk-manager__title', textContent: 'Components' } )
			),
			el( 'div', { class: 'etk-manager__body' }, status, el( 'div', { class: 'etk-manager__content' }, main ), buildBulkBar() )
		);
		document.body.append( panel );
	};

	const open = () => {
		if ( ! panel ) build();
		openManager( panel );
		control.expanded( true );
		if ( view === 'list' ) loadUsedOn();
		go( view );
	};

	// focus: false when another Settings Bar button closed it, so focus stays on that one.
	const close = ( { focus = true } = {} ) => {
		if ( ! panel || panel.hidden ) return;
		panel.hidden = true;
		control.expanded( false );
		if ( focus ) control.focus();
	};

	/* ------------------------------------------------------------------ */
	/* Boot                                                                */
	/* ------------------------------------------------------------------ */

	// Etch's own component icon, as on its component blocks.
	const control = settingsBarButton( {
		section: 'top',
		id: CONTROL_ID,
		icon: 'etch:component-stroke',
		tooltip: 'Component manager',
		label: 'Component manager',
		controls: 'etk-components',
		onclick: () => ( panel && ! panel.hidden ? close() : open() ),
		onother: () => close( { focus: false } ),
		enabled,
	} );

	// Turned on or off in the toolkit's settings.
	window.addEventListener( 'etch-toolkit-settings', () => {
		if ( enabled() ) return control.add();
		close( { focus: false } );
		control.remove();
	} );

	// For tests and other features.
	toolkit.components = { parse, fromGutenberg };
} )();
