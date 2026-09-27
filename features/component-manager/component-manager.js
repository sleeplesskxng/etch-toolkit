/**
 * Etch Toolkit: component manager.
 *
 * A Settings Bar control opens a manager beside the bar, like the Fonts
 * manager. Drop a JSON file or paste JSON, and it lists the components in it,
 * each matched to one on this site by key, the way Etch's paste matches them.
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
	// Hugeicons free git-compare.
	const CONTROL_ICON =
		'<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M19 17v-6c0-2.828 0-4.243-.879-5.121C17.243 5 15.828 5 13 5h-3m0 0c0-.7 1.994-2.008 2.5-2.5M10 5c0 .7 1.994 2.008 2.5 2.5M5 7.5v6c0 2.828 0 4.243.879 5.121c.878.879 2.293.879 5.121.879h3m0 0c0 .7-1.994 2.009-2.5 2.5m2.5-2.5c0-.7-1.994-2.009-2.5-2.5"/><circle cx="19" cy="19" r="2"/><circle cx="5" cy="5" r="2"/></g>';
	// Etch's hugeicons:arrow-left-02, the back button on its own managers.
	const BACK = '<path d="M8.99996 16.9998L4 11.9997L9 6.99976"/><path d="M4 12H20"/>';
	const UPLOAD = '<path d="M12 4.5L12 14.5M12 4.5C11.2998 4.5 9.99153 6.4943 9.5 7M12 4.5C12.7002 4.5 14.0085 6.4943 14.5 7"/><path d="M20 16.5C20 18.982 19.482 19.5 17 19.5H7C4.518 19.5 4 18.982 4 16.5"/>';
	const stroke = ( paths, size = 16 ) =>
		`<svg class="etk-components__icon" viewBox="0 0 24 24" width="${ size }" height="${ size }" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ paths }</svg>`;

	const enabled = () => window.etchToolkitSettings?.settings?.componentManager === true && typeof window.etch?.components?.updateAsync === 'function';

	// h( 'button', { class: 'x', onclick }, child, … ), like the settings screen's.
	const PROPS = new Set( [ 'value', 'checked', 'disabled', 'hidden', 'textContent', 'htmlFor' ] );
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

	const plural = ( n, one, many ) => `${ n } ${ n === 1 ? one : many }`;
	const errorText = ( error ) => error?.message || String( error );
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
			if ( ! found.length ) throw new Error( 'This JSON has layers but no components. In Etch, select a component and copy it (Cmd+C), then paste that here.' );
		} else {
			found = ( Array.isArray( data ) ? data : [ data ] ).map( ( source ) => readComponent( source ) );
		}

		found = found.filter( Boolean );
		if ( ! found.length ) throw new Error( 'No components found. Paste Etch’s copy of a component, or a component’s JSON with its key and blocks.' );
		return found;
	};

	// Each component matched to this site's by key, as Etch's paste matches them.
	const match = ( components ) => {
		const local = window.etch.components.list();
		return components.map( ( incoming ) => ( { incoming, current: local.find( ( c ) => incoming.key && c.key === incoming.key ) || null } ) );
	};

	/* ------------------------------------------------------------------ */
	/* Comparing                                                           */
	/* ------------------------------------------------------------------ */

	// A value as text to compare and show. Objects as indented JSON.
	const asText = ( value ) => ( typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify( value, null, 2 ) );

	// A class attribute's names, split on whitespace outside {…} the way Etch splits
	// them. Dynamic parts like {props.extra} aren't names, so they're left out.
	const classNames = ( value ) =>
		String( value || '' )
			.split( /\s+(?![^{]*})/ )
			.filter( ( name ) => name && ! name.includes( '{' ) );

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

	// How alike two layers are, 0 to 1. Layers of different types never pair.
	const similarity = ( a, b ) => {
		if ( a.block.type !== b.block.type ) return 0;
		let score = 0.1;
		if ( a.name && a.name === b.name ) score += 0.4;
		if ( a.tag === b.tag ) score += 0.15;
		const ours = new Set( a.classes );
		const all = new Set( [ ...a.classes, ...b.classes ] );
		score += all.size ? ( 0.3 * b.classes.filter( ( name ) => ours.has( name ) ).length ) / all.size : 0.15;
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

	const PROP_FIELDS = { name: 'Name', type: 'Type', default: 'Default', description: 'Description', selectOptionsString: 'Options', properties: 'Props inside' };

	// A class prop's default is style IDs, which differ between sites. Their selectors don't.
	const readableProp = ( prop, side ) =>
		prop && {
			...prop,
			...( prop.type?.specialized === 'class' && Array.isArray( prop.default ) ? { default: prop.default.map( ( id ) => side.style( id )?.selector ?? id ) } : {} ),
			...( Array.isArray( prop.properties ) ? { properties: prop.properties.map( ( inner ) => readableProp( inner, side ) ) } : {} ),
		};

	// A prop's fields as text, key aside. Its type reads like Etch's picker: "string, select".
	const propFields = ( prop, side ) => {
		const fields = new Map();
		for ( const [ key, value ] of Object.entries( ( side ? readableProp( prop, side ) : prop ) || {} ) ) {
			if ( key === 'key' ) continue;
			const text = key === 'type' && value && typeof value === 'object' && ! Array.isArray( value ) ? Object.values( value ).join( ', ' ) : asText( value );
			fields.set( key, { label: PROP_FIELDS[ key ] || key, value: text } );
		}
		return fields;
	};

	/**
	 * Compare two components' props, matched by key. Returns them in the
	 * incoming order, with removed ones where they were: { key, status,
	 * current, incoming, fields }, fields the ones that differ.
	 */
	const compareProps = ( ours, theirs, sides ) => {
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
			const status = ! current ? 'added' : ! incoming ? 'removed' : fields.length ? 'changed' : 'same';
			result.push( { key, status, current, incoming, fields } );
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

	// Unchanged lines more than this far from a change fold away.
	const CONTEXT = 3;

	/* ------------------------------------------------------------------ */
	/* Views                                                               */
	/* ------------------------------------------------------------------ */

	let panel = null;
	let main = null;
	let status = null;
	let controlButton = null;
	let view = 'import';
	let pasted = '';
	let matches = [];
	let reviewing = null;
	let fileName = '';

	const announce = ( message, { error = false } = {} ) => {
		if ( ! status ) return;
		status.textContent = '';
		status.classList.toggle( 'is-error', error );
		// Cleared first so a repeated message is read again.
		window.setTimeout( () => ( status.textContent = message ), 50 );
	};
	const warn = ( message ) => announce( message, { error: true } );

	const button = ( label, onclick, { variant = 'secondary', ...attrs } = {} ) => h( 'button', { type: 'button', class: `etk-components__btn etk-components__btn--${ variant }`, onclick, ...attrs }, label );

	const read = ( text, from = '' ) => {
		try {
			matches = match( parse( text ) );
			fileName = from;
			status.textContent = '';
			status.classList.remove( 'is-error' );
			render();
			announce( `Found ${ plural( matches.length, 'component', 'components' ) }.` );
			main.querySelector( '.etk-components__found-title' )?.focus();
		} catch ( error ) {
			matches = [];
			render();
			warn( errorText( error ) );
		}
	};

	const readFile = async ( file ) => read( await file.text(), file.name );

	const dropzone = () => {
		const input = h( 'input', {
			type: 'file',
			accept: '.json,application/json',
			class: 'screen-reader-text',
			onchange: ( e ) => {
				const [ file ] = e.target.files;
				e.target.value = '';
				if ( file ) readFile( file );
			},
		} );
		const zone = h(
			'div',
			{
				class: 'etk-components__dropzone',
				ondragover: ( e ) => {
					e.preventDefault();
					zone.classList.add( 'is-over' );
				},
				ondragleave: () => zone.classList.remove( 'is-over' ),
				ondrop: ( e ) => {
					e.preventDefault();
					zone.classList.remove( 'is-over' );
					if ( e.dataTransfer.files[ 0 ] ) readFile( e.dataTransfer.files[ 0 ] );
				},
			},
			h( 'span', { class: 'etk-components__dropzone-icon', html: stroke( UPLOAD ) } ),
			h( 'p', { class: 'etk-components__dropzone-text', textContent: 'Drop a .json file here' } ),
			h( 'label', { class: 'etk-components__btn etk-components__btn--secondary etk-components__file-btn' }, input, 'Choose file' )
		);
		return zone;
	};

	const foundRow = ( { incoming, current } ) =>
		h(
			'li',
			{ class: 'etk-components__found-row' },
			h(
				'div',
				{ class: 'etk-components__found-text' },
				h( 'span', { class: 'etk-components__found-name', textContent: incoming.name } ),
				h( 'span', { class: 'etk-components__muted', textContent: current ? `Updates ${ current.name } on this site` : `Not on this site${ incoming.key ? ` (key ${ incoming.key })` : '' }` } )
			),
			current
				? button( 'Review', () => review( { incoming, current } ), { 'aria-label': `Review changes to ${ current.name }` } )
				: null
		);

	const views = {
		import: () => [
			h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: 'Update a component' } ),
			h( 'p', { class: 'etk-components__help', textContent: 'Drop in a JSON file or paste JSON: Etch’s copy of a component (select it and press Cmd+C), or a component’s JSON. You’ll see what changed before anything is saved.' } ),
			dropzone(),
			h(
				'div',
				{ class: 'etk-components__paste' },
				h( 'label', { class: 'etk-components__label', htmlFor: 'etk-components-json', textContent: 'Or paste JSON' } ),
				h( 'textarea', {
					id: 'etk-components-json',
					class: 'etk-components__textarea',
					spellcheck: 'false',
					rows: '6',
					value: pasted,
					oninput: ( e ) => ( pasted = e.target.value ),
				} ),
				h( 'div', { class: 'etk-components__actions' }, button( 'Find components', () => ( pasted.trim() ? read( pasted ) : warn( 'Paste some JSON first.' ) ), { variant: 'primary' } ) )
			),
			matches.length
				? h(
						'section',
						{ class: 'etk-components__found', 'aria-labelledby': 'etk-components-found-title' },
						h( 'h3', { id: 'etk-components-found-title', class: 'etk-components__found-title', tabindex: '-1', textContent: `${ plural( matches.length, 'component', 'components' ) } in ${ fileName || 'the JSON' }` } ),
						h( 'ul', { class: 'etk-components__found-list', role: 'list' }, matches.map( foundRow ) )
				  )
				: null,
		],

		done: () =>
			previous
				? [
						h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: `${ previous.name } is updated` } ),
						h( 'p', { class: 'etk-components__help', textContent: previous.update.length || previous.made.length ? 'The component is saved. Save in Etch to keep the class changes too.' : 'The component is saved.' } ),
						h(
							'div',
							{ class: 'etk-components__done-actions' },
							button( 'Put back the previous version', ( e ) => restore( e.currentTarget ), { 'data-focus': 'restore' } ),
							button( 'Download the previous version', download, { 'data-focus': 'download' } ),
							button( 'Update another component', () => go( 'import' ), { 'data-focus': 'another' } )
						),
				  ]
				: [
						h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: 'The previous version is back' } ),
						h( 'div', { class: 'etk-components__done-actions' }, button( 'Update another component', () => go( 'import' ), { 'data-focus': 'another' } ) ),
				  ],

		review: () => {
			const { current, tree } = reviewing;
			const counts = { changed: 0, added: 0, removed: 0 };
			for ( const node of walk( tree ) ) if ( node.status in counts ) counts[ node.status ]++;
			const summary = [ counts.changed && `${ plural( counts.changed, 'layer', 'layers' ) } changed`, counts.added && `${ counts.added } added`, counts.removed && `${ counts.removed } removed` ].filter( Boolean ).join( ', ' );
			const { approved, total } = tally();
			return [
				h(
					'div',
					{ class: 'etk-components__review-head' },
					button( '', () => go( 'import' ), { class: 'etk-components__btn etk-components__btn--secondary etk-components__icon-btn', 'aria-label': 'Back to import', title: 'Back to import', html: stroke( BACK ), 'data-focus': 'back' } ),
					h( 'div', { class: 'etk-components__review-title' }, h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: current.name } ), h( 'p', { class: 'etk-components__muted', textContent: summary || 'No layer changes' } ) ),
					total
						? h(
								'div',
								{ class: 'etk-components__review-actions' },
								h( 'span', { class: 'etk-components__muted', textContent: `${ approved } of ${ plural( total, 'change', 'changes' ) } approved` } ),
								button( 'Approve all', () => decideAll( true ), { 'data-focus': 'approve-all' } ),
								button( 'Reject all', () => decideAll( false ), { 'data-focus': 'reject-all' } ),
								button( 'Update component', apply, { variant: 'primary', disabled: ! approved, 'data-focus': 'apply' } )
						  )
						: null
				),
				h(
					'section',
					{ class: 'etk-components__group', 'aria-labelledby': 'etk-components-layers-title' },
					h( 'h3', { id: 'etk-components-layers-title', class: 'etk-components__label', textContent: 'Layers' } ),
					h( 'div', { class: 'etk-components__tree' }, h( 'ul', { class: 'etk-components__layers', role: 'list' }, tree.map( layerRow ) ) )
				),
				propsView(),
				metaView(),
			];
		},
	};

	/* ---- Decisions ---- */


	/*
	 * Everything starts approved: approving takes the incoming version,
	 * rejecting keeps this site's. A changed layer decides its HTML and JS; an
	 * added or removed one decides whether it's added or removed, and the
	 * layers inside it go with it. CSS is decided per class, since a class is
	 * the same everywhere it's used.
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
	const decideLayer = ( node, value ) => {
		if ( node.status === 'added' || node.status === 'removed' ) decide( node, 'layer', value );
		for ( const key of changedCategories( node ) ) decide( node, key, value );
		render();
		announce( `${ value ? 'Approved' : 'Rejected' } the changes to ${ ( node.incoming || node.current ).label }.` );
	};
	const decideAll = ( value ) => {
		for ( const node of walk( reviewing.tree ) ) {
			decisions.layers.set( node.id, { html: value, js: value, layer: value } );
			for ( const change of node.css ) decisions.css.set( change.selector, value );
		}
		for ( const map of [ decisions.props, decisions.meta ] ) for ( const key of map.keys() ) map.set( key, value );
		render();
		announce( value ? 'Approved every change.' : 'Rejected every change.' );
	};

	// Approved of all the changes: each changed layer's HTML and JS, each layer added
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

	// Whether a category on a layer is approved: true, false, or 'some' for CSS across classes.
	const approvedCategory = ( node, key ) => {
		if ( key !== 'css' ) return decisions.layers.get( node.id )[ key ];
		const values = node.css.map( ( change ) => decisions.css.get( change.selector ) );
		return values.every( Boolean ) ? true : values.some( Boolean ) ? 'some' : false;
	};

	/* ---- Applying ---- */

	// Layer JSON as Etch takes it back, without the IDs it hands out with it.
	const bare = ( { id, parentId, children, ...rest } ) => ( { ...rest, children: ( children || [] ).map( bare ) } );

	// A class this site doesn't have yet, until applying creates it.
	const NEW_STYLE = 'etk-new-style:';

	/**
	 * What approving amounts to: the component's blocks, props, name and
	 * description, and the class changes that go with them. Incoming layers
	 * point to this site's classes and components: a class this site has is
	 * linked, one it doesn't is made (its CSS only if that's approved), and
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
	 * Save the approved changes. The component is written at once, the way
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
			warn( `This uses components this site doesn’t have: ${ [ ...result.missing ].join( ', ' ) }. Add them first, then try again.` );
			return;
		}

		const { approved, total } = tally();
		const classes = result.update.length + result.create.size;
		const dialog = toolkit.confirmDialog( {
			title: `Update ${ current.name }?`,
			message: [
				h( 'p', { textContent: `${ approved } of ${ plural( total, 'change', 'changes' ) } approved. The component is saved now, the way Etch saves a pasted one.` } ),
				classes ? h( 'p', { textContent: classes === 1 ? '1 class changes in the builder too. Save to keep it.' : `${ classes } classes change in the builder too. Save to keep them.` } ) : null,
				h( 'p', { textContent: 'You can put the previous version back afterwards.' } ),
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
			main.querySelector( '.etk-components__page-title' )?.focus();
		} catch ( error ) {
			trigger.disabled = false;
			warn( `Couldn’t put the previous version back: ${ errorText( error ) }` );
		}
	};

	const download = () => {
		const url = URL.createObjectURL( new Blob( [ JSON.stringify( previous.json, null, 2 ) ], { type: 'application/json' } ) );
		h( 'a', { href: url, download: `${ previous.json.key || 'component' }-before-update.json` } ).click();
		// Revoking straight away can cancel the download in some browsers.
		window.setTimeout( () => URL.revokeObjectURL( url ), 60000 );
	};

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

	// Layers closed in the tree (everything starts open), and layers showing their changes.
	let closedLayers = new Set();
	let openDetails = new Set();

	// A change cue. A rejected one is struck through, one partly approved is dashed.
	const chip = ( kind, text, approved = true ) => h( 'span', { class: `etk-components__chip etk-components__chip--${ kind }${ approved === false ? ' is-rejected' : approved === 'some' ? ' is-partial' : '' }`, textContent: text } );

	// Which categories changed on a layer. An added layer can still change a class's CSS.
	const changedCategories = ( node ) => Object.keys( CATEGORIES ).filter( ( key ) => ( key === 'js' ? node.js : node[ key ].length ) );

	const layerTitle = ( layer ) => ( layer.tag ? `${ layer.tag } ${ layer.label }` : layer.label );

	// What a layer's row says to a screen reader after its name.
	const describeChanges = ( node ) => {
		const parts = [];
		if ( node.status === 'added' ) parts.push( layerApproved( node ) ? 'added' : 'added, rejected' );
		if ( node.status === 'removed' ) parts.push( layerApproved( node ) ? 'removed' : 'removed, rejected' );
		for ( const key of changedCategories( node ) ) {
			const yes = approvedCategory( node, key );
			parts.push( `${ CATEGORIES[ key ] } changed${ yes === false ? ', rejected' : yes === 'some' ? ', partly approved' : '' }` );
		}
		return parts.join( '; ' );
	};

	const layerRow = ( node ) => {
		const layer = node.incoming || node.current;
		const open = ! closedLayers.has( node.id );
		const hasChanges = node.status !== 'same';
		const showing = hasChanges && openDetails.has( node.id );
		const chips = [];
		if ( node.status === 'added' ) chips.push( chip( 'added', 'Added', layerApproved( node ) ) );
		if ( node.status === 'removed' ) chips.push( chip( 'removed', 'Removed', layerApproved( node ) ) );
		for ( const key of changedCategories( node ) ) chips.push( chip( key, CATEGORIES[ key ], node.status === 'changed' || key === 'css' ? approvedCategory( node, key ) : layerApproved( node ) ) );
		// A closed layer says how much changed inside it.
		if ( node.inside && ! open ) chips.push( chip( 'inside', `${ node.inside } inside` ) );
		const detailsId = `${ node.id }-changes`;

		const name = h(
			'span',
			{ class: 'etk-components__layer-name' },
			layer.tag ? h( 'span', { class: 'etk-components__layer-tag', textContent: layer.tag } ) : null,
			h( 'span', { class: 'etk-components__layer-label', textContent: layer.label } )
		);
		const chipList = chips.length ? h( 'span', { class: 'etk-components__chips', 'aria-hidden': 'true' }, chips ) : null;

		return h(
			'li',
			{ class: `etk-components__layer etk-components__layer--${ node.status } etk-components__layer--${ KINDS[ layer.block.type ] || 'default' }${ hasChanges && ! layerApproved( node ) ? ' is-rejected' : '' }`, 'data-layer': node.id },
			h(
				'div',
				{ class: `etk-components__layer-header${ showing ? ' is-showing' : '' }` },
				node.children.length
					? h( 'button', { type: 'button', class: 'etk-components__caret', 'aria-expanded': String( open ), 'aria-label': `Layers inside ${ layerTitle( layer ) }`, html: CARET, 'data-focus': `${ node.id }:caret`, onclick: () => toggleLayer( node ) } )
					: h( 'span', { class: 'etk-components__leaf', 'aria-hidden': 'true' } ),
				// A layer with changes opens them, like selecting a layer in the Structure panel.
				hasChanges
					? h(
							'button',
							{ type: 'button', class: 'etk-components__layer-toggle', 'aria-expanded': String( showing ), 'aria-controls': showing ? detailsId : null, 'data-focus': `${ node.id }:toggle`, onclick: () => toggleDetails( node ) },
							name,
							h( 'span', { class: 'screen-reader-text', textContent: `, ${ describeChanges( node ) }` } ),
							chipList
					  )
					: [ name, chipList ]
			),
			showing ? details( node, detailsId ) : null,
			node.children.length && open ? h( 'ul', { class: 'etk-components__layers etk-components__layers--inside', role: 'list' }, node.children.map( layerRow ) ) : null
		);
	};

	/* ---- A layer's changes ---- */

	// Approve and Reject, as a pair of pressed buttons.
	const choice = ( label, value, onchange, focusKey, { disabled = false } = {} ) =>
		h(
			'div',
			{ class: 'etk-components__choice', role: 'group', 'aria-label': label },
			[ [ true, 'Approve' ], [ false, 'Reject' ] ].map( ( [ yes, text ] ) =>
				h( 'button', {
					type: 'button',
					class: `etk-components__choice-btn etk-components__choice-btn--${ yes ? 'approve' : 'reject' }`,
					'aria-pressed': String( value === yes ),
					disabled,
					'data-focus': `${ focusKey }:${ text }`,
					textContent: text,
					onclick: () => onchange( yes ),
				} )
			)
		);

	// Lines of a diff, with unchanged runs folded down to CONTEXT lines around each change.
	const diffView = ( lines ) => {
		const near = lines.map( ( line, i ) => line.op !== ' ' || lines.slice( Math.max( 0, i - CONTEXT ), i + CONTEXT + 1 ).some( ( other ) => other.op !== ' ' ) );
		const rows = [];
		for ( let i = 0; i < lines.length; i++ ) {
			if ( ! near[ i ] ) {
				let j = i;
				while ( j < lines.length && ! near[ j ] ) j++;
				rows.push( h( 'div', { class: 'etk-components__diff-fold', textContent: plural( j - i, 'unchanged line', 'unchanged lines' ) } ) );
				i = j - 1;
				continue;
			}
			const { op, text } = lines[ i ];
			rows.push( h( op === '-' ? 'del' : op === '+' ? 'ins' : 'div', { class: `etk-components__diff-line etk-components__diff-line--${ op === '-' ? 'del' : op === '+' ? 'ins' : 'same' }` }, text || ' ' ) );
		}
		return h( 'div', { class: 'etk-components__diff' }, rows );
	};

	// One field: a one-line value as before and after, more lines as a line diff.
	const fieldView = ( { label, from, to } ) => {
		const short = ! from.includes( '\n' ) && ! to.includes( '\n' );
		return h(
			'div',
			{ class: `etk-components__field${ label ? '' : ' etk-components__field--bare' }` },
			label ? h( 'span', { class: 'etk-components__field-name', textContent: label } ) : null,
			short
				? h(
						'span',
						{ class: 'etk-components__field-values' },
						from ? h( 'del', { class: 'etk-components__value etk-components__value--del', textContent: from } ) : null,
						to ? h( 'ins', { class: 'etk-components__value etk-components__value--ins', textContent: to } ) : null
				  )
				: diffView( diffLines( from, to ) )
		);
	};

	// How far a class's CSS change reaches, from the Style usage counts.
	const reach = ( change ) => {
		if ( change.from === null ) return 'A new class on this site.';
		if ( ! usage ) return 'Checking where this class is used…';
		const elsewhere = Math.max( 0, ( usage[ change.selector ] ?? 0 ) - usesHere( change.selector ) );
		return elsewhere ? `Used by ${ plural( elsewhere, 'other element', 'other elements' ) } on the site. Approving changes them too.` : 'Only used in this component.';
	};

	const section = ( title, control, ...body ) =>
		h( 'section', { class: 'etk-components__change' }, h( 'div', { class: 'etk-components__change-head' }, h( 'h4', { class: 'etk-components__change-title', textContent: title } ), control ), ...body );

	const details = ( node, id ) => {
		const layer = node.incoming || node.current;
		const title = layerTitle( layer );
		const choices = decisions.layers.get( node.id );
		const parts = [];

		if ( node.status === 'changed' ) {
			const all = changedCategories( node ).map( ( key ) => approvedCategory( node, key ) );
			// With more than one kind of change, one choice for them all.
			if ( all.length > 1 ) parts.push(
				h(
					'div',
					{ class: 'etk-components__details-head' },
					h( 'span', { class: 'etk-components__muted', textContent: 'Every change on this layer' } ),
					choice( `Every change on ${ title }`, all.every( ( v ) => v === true ) ? true : all.every( ( v ) => v === false ) ? false : null, ( yes ) => decideLayer( node, yes ), `${ node.id }:all` )
				)
			);
			if ( node.html.length ) parts.push( section( 'HTML', choice( `HTML changes on ${ title }`, choices.html, ( yes ) => ( decide( node, 'html', yes ), render() ), `${ node.id }:html` ), node.html.map( fieldView ) ) );
			if ( node.js ) parts.push( section( 'JS', choice( `JS changes on ${ title }`, choices.js, ( yes ) => ( decide( node, 'js', yes ), render() ), `${ node.id }:js` ), diffView( diffLines( node.js.from, node.js.to ) ) ) );
		} else {
			// An added or removed layer: all of it, as it would arrive or leave.
			const added = node.status === 'added';
			const decider = deciderOf( node );
			const fields = [ ...layer.html.values() ].filter( ( field ) => field.value ).map( ( field ) => ( { label: field.label, from: added ? '' : field.value, to: added ? field.value : '' } ) );
			parts.push(
				h(
					'div',
					{ class: 'etk-components__details-head' },
					h( 'span', { class: 'etk-components__muted', textContent: follows( node ) ? `${ added ? 'Added' : 'Removed' } with ${ layerTitle( decider.incoming || decider.current ) }` : added ? 'Approving adds this layer.' : 'Approving removes this layer.' } ),
					follows( node ) ? null : choice( `${ added ? 'Add' : 'Remove' } ${ title }`, choices.layer, ( yes ) => ( decide( node, 'layer', yes ), render() ), `${ node.id }:layer` )
				)
			);
			if ( fields.length ) parts.push( section( 'HTML', null, fields.map( fieldView ) ) );
			if ( layer.script ) parts.push( section( 'JS', null, diffView( diffLines( added ? '' : layer.script, added ? layer.script : '' ) ) ) );
		}

		for ( const change of node.css ) {
			parts.push(
				section(
					`CSS ${ change.selector }`,
					choice( `CSS changes to ${ change.selector }`, decisions.css.get( change.selector ), ( yes ) => ( decisions.css.set( change.selector, yes ), render() ), `${ node.id }:css:${ change.selector }` ),
					h( 'p', { class: `etk-components__reach${ change.from !== null && usage && ( usage[ change.selector ] ?? 0 ) > usesHere( change.selector ) ? ' is-wide' : '' }`, textContent: reach( change ) } ),
					diffView( diffLines( change.from ?? '', change.to ) )
				)
			);
		}

		return h( 'div', { class: 'etk-components__details', id, role: 'region', 'aria-label': `Changes to ${ title }` }, parts );
	};

	/* ---- Props, and the component's name and description ---- */

	const PROP_STATUS = { added: 'Added', removed: 'Removed', changed: 'Changed' };
	let openProps = new Set();

	const propRow = ( prop ) => {
		const source = prop.incoming || prop.current;
		const title = source.name ? `${ source.name } (${ prop.key })` : prop.key;
		const approved = decisions.props.get( prop.key );
		const showing = openProps.has( prop.key );
		const id = `etk-prop-${ CSS.escape( prop.key ) }-changes`;
		const head = [
			h( 'span', { class: 'etk-components__prop-name' }, h( 'span', { textContent: source.name || prop.key } ), source.name ? h( 'code', { class: 'etk-components__prop-key', textContent: prop.key } ) : null ),
			prop.status === 'same' ? null : h( 'span', { class: 'etk-components__chips', 'aria-hidden': 'true' }, chip( prop.status === 'changed' ? 'html' : prop.status, PROP_STATUS[ prop.status ], approved ) ),
		];
		if ( prop.status === 'same' ) return h( 'li', { class: 'etk-components__prop' }, h( 'div', { class: 'etk-components__prop-head' }, head ) );

		const fields =
			prop.status === 'changed'
				? prop.fields
				: [ ...propFields( source, makeSides( reviewing.incoming )[ prop.incoming ? 'incoming' : 'current' ] ).values() ].filter( ( field ) => field.value ).map( ( field ) => ( { label: field.label, from: prop.status === 'removed' ? field.value : '', to: prop.status === 'added' ? field.value : '' } ) );
		const verb = { added: 'Approving adds this prop.', removed: 'Approving removes this prop.', changed: 'Approving takes the incoming version.' }[ prop.status ];
		return h(
			'li',
			{ class: `etk-components__prop etk-components__prop--${ prop.status }${ approved ? '' : ' is-rejected' }` },
			h(
				'button',
				{ type: 'button', class: `etk-components__prop-head etk-components__prop-toggle${ showing ? ' is-showing' : '' }`, 'aria-expanded': String( showing ), 'aria-controls': showing ? id : null, 'data-focus': `prop:${ prop.key }:toggle`, onclick: () => toggleProp( prop ) },
				head,
				h( 'span', { class: 'screen-reader-text', textContent: `, ${ prop.status }${ approved ? '' : ', rejected' }` } )
			),
			showing
				? h(
						'div',
						{ class: 'etk-components__details', id, role: 'region', 'aria-label': `Changes to the ${ title } prop` },
						h( 'div', { class: 'etk-components__details-head' }, h( 'span', { class: 'etk-components__muted', textContent: verb } ), choice( `${ PROP_STATUS[ prop.status ] } prop ${ title }`, approved, ( yes ) => ( decisions.props.set( prop.key, yes ), render() ), `prop:${ prop.key }` ) ),
						fields.map( fieldView )
				  )
				: null
		);
	};

	const propsView = () => {
		const { props } = reviewing;
		if ( ! props.length ) return null;
		const changed = props.filter( ( prop ) => prop.status !== 'same' ).length;
		return h(
			'section',
			{ class: 'etk-components__group', 'aria-labelledby': 'etk-components-props-title' },
			h( 'div', { class: 'etk-components__group-head' }, h( 'h3', { id: 'etk-components-props-title', class: 'etk-components__label', textContent: 'Props' } ), h( 'span', { class: 'etk-components__muted', textContent: changed ? `${ changed } changed` : 'No changes' } ) ),
			h( 'ul', { class: 'etk-components__props', role: 'list' }, props.map( propRow ) )
		);
	};

	// The component's name and description, when the JSON has others.
	const metaView = () => {
		const { meta } = reviewing;
		if ( ! meta.length ) return null;
		return h(
			'section',
			{ class: 'etk-components__group', 'aria-labelledby': 'etk-components-meta-title' },
			h( 'h3', { id: 'etk-components-meta-title', class: 'etk-components__label', textContent: 'Component' } ),
			h(
				'div',
				{ class: 'etk-components__details etk-components__details--card' },
				meta.map( ( field ) =>
					h(
						'section',
						{ class: 'etk-components__change' },
						h( 'div', { class: 'etk-components__change-head' }, h( 'h4', { class: 'etk-components__change-title', textContent: field.label } ), choice( `Component ${ field.label.toLowerCase() }`, decisions.meta.get( field.key ), ( yes ) => ( decisions.meta.set( field.key, yes ), render() ), `meta:${ field.key }` ) ),
						fieldView( { ...field, label: '' } )
					)
				)
			)
		);
	};

	const toggleProp = ( prop ) => {
		openProps.has( prop.key ) ? openProps.delete( prop.key ) : openProps.add( prop.key );
		render();
	};

	const toggleLayer = ( node ) => {
		closedLayers.has( node.id ) ? closedLayers.delete( node.id ) : closedLayers.add( node.id );
		render();
	};

	const toggleDetails = ( node ) => {
		openDetails.has( node.id ) ? openDetails.delete( node.id ) : openDetails.add( node.id );
		render();
	};

	// Render the view again, keeping focus on the same control.
	const render = () => {
		if ( ! main ) return;
		const focused = main.contains( document.activeElement ) ? document.activeElement.dataset.focus : null;
		main.replaceChildren( h( 'div', { class: `etk-components__page etk-components__page--${ view }` }, ...views[ view ]() ) );
		if ( focused ) main.querySelector( `[data-focus="${ CSS.escape( focused ) }"]` )?.focus();
	};

	const go = ( next ) => {
		view = next;
		render();
		main.querySelector( '.etk-components__page-title' )?.focus();
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
		openDetails = new Set();
		openProps = new Set();
		resetDecisions( reviewing );
		loadUsage();
		go( 'review' );
	};

	/* ------------------------------------------------------------------ */
	/* Panel                                                               */
	/* ------------------------------------------------------------------ */

	const build = () => {
		status = h( 'div', { class: 'etk-components__status', role: 'status', 'aria-live': 'polite' } );
		main = h( 'div', { class: 'etk-components__main' } );
		panel = h(
			'section',
			{
				id: 'etk-components',
				class: 'etk-components',
				hidden: true,
				'aria-labelledby': 'etk-components-title',
				// Keep typing in the panel away from Etch's keyboard shortcuts. Esc closes.
				onkeydown: ( e ) => {
					e.stopPropagation();
					if ( e.key === 'Escape' && ! e.target.closest( 'dialog' ) ) {
						e.preventDefault();
						close();
					}
					// Except Cmd/Ctrl+S, which saves instead of opening the browser's Save Page.
					if ( ( e.metaKey || e.ctrlKey ) && ( e.code === 'KeyS' || e.key.toLowerCase() === 's' ) ) {
						e.preventDefault();
						window.etch?.saveAsync?.();
					}
				},
				onkeyup: ( e ) => e.stopPropagation(),
			},
			h(
				'header',
				{ class: 'etk-components__header' },
				h( 'button', { type: 'button', class: 'etk-components__btn etk-components__btn--secondary etk-components__icon-btn', 'aria-label': 'Back to the builder', title: 'Back to the builder', html: stroke( BACK ), onclick: () => close() } ),
				h( 'h1', { id: 'etk-components-title', class: 'etk-components__title', textContent: 'Component manager' } )
			),
			h( 'div', { class: 'etk-components__body' }, status, h( 'div', { class: 'etk-components__content' }, main ) )
		);
		document.body.append( panel );
	};

	const open = () => {
		if ( ! panel ) build();
		// One manager at a time, like Etch's own, so Back goes straight to the canvas.
		try {
			if ( window.etch.navigation.getCurrentPlace() !== 'builder' ) window.etch.navigation.goTo( 'builder' );
		} catch {}
		// Pinning Automatic.css's dashboard writes left and max-width onto every fixed element. Its place comes from the CSS.
		panel.removeAttribute( 'style' );
		panel.hidden = false;
		controlButton?.setAttribute( 'aria-expanded', 'true' );
		controlButton?.setAttribute( 'selected', 'true' );
		go( view );
	};

	// focus: false when another Settings Bar button closed it, so focus stays on that one.
	const close = ( { focus = true } = {} ) => {
		if ( ! panel || panel.hidden ) return;
		panel.hidden = true;
		controlButton?.setAttribute( 'aria-expanded', 'false' );
		controlButton?.removeAttribute( 'selected' );
		if ( focus ) controlButton?.focus();
	};

	/* ------------------------------------------------------------------ */
	/* Boot                                                                */
	/* ------------------------------------------------------------------ */

	// Etch draws its buttons' icons from a name. This one gets its own swapped in after,
	// and again whenever Etch re-renders it. Compared as the browser writes it back.
	let drawn = '';
	const useIcon = () => {
		const svg = controlButton?.querySelector( 'svg' );
		if ( ! svg || svg.innerHTML === drawn ) return;
		svg.setAttribute( 'viewBox', '0 0 24 24' );
		svg.innerHTML = CONTROL_ICON;
		drawn = svg.innerHTML;
	};

	let listening = false;
	let added = false;
	const addControl = () => {
		const bar = window.etchControls?.builder?.settingsBar?.top;
		const section = document.querySelector( '.settings-bar__section.top' );
		if ( ! bar || ! section?.querySelector( 'button' ) ) return false;

		const before = new Set( section.querySelectorAll( 'button' ) );
		added = true;
		bar.addAfter( { id: CONTROL_ID, icon: 'hugeicons:layers-01', tooltip: 'Component manager', callback: () => ( panel && ! panel.hidden ? close() : open() ) } );

		// Etch renders the button on its next update. Label it for toggling state.
		const observer = new MutationObserver( () => {
			controlButton = [ ...section.querySelectorAll( 'button' ) ].find( ( b ) => ! before.has( b ) );
			if ( ! controlButton ) return;
			observer.disconnect();
			controlButton.setAttribute( 'aria-label', 'Component manager' );
			controlButton.setAttribute( 'aria-expanded', 'false' );
			controlButton.setAttribute( 'aria-controls', 'etk-components' );
			useIcon();
			new MutationObserver( useIcon ).observe( controlButton, { childList: true, subtree: true } );
		} );
		observer.observe( section, { childList: true, subtree: true } );

		// Opening one of Etch's own managers, or another of the toolkit's, closes this one.
		if ( ! listening ) {
			listening = true;
			document.querySelector( '.settings-bar' )?.addEventListener( 'click', ( e ) => {
				const clicked = e.target.closest( 'button, a' );
				if ( clicked && clicked !== controlButton ) close( { focus: false } );
			} );
		}
		return true;
	};

	const removeControl = () => {
		close( { focus: false } );
		window.etchControls?.builder?.settingsBar?.top?.remove( CONTROL_ID );
		controlButton = null;
		added = false;
		drawn = '';
	};

	const boot = () => {
		let tries = 0;
		const timer = window.setInterval( () => {
			if ( ! enabled() || addControl() || ++tries > 120 ) window.clearInterval( timer );
		}, 250 );
	};

	// Turned on or off in the toolkit's settings.
	window.addEventListener( 'etch-toolkit-settings', () => ( enabled() ? ! added && boot() : removeControl() ) );

	document.readyState === 'complete' ? boot() : window.addEventListener( 'load', boot );

	// For tests and other features.
	toolkit.components = { parse, match, fromGutenberg };
} )();
