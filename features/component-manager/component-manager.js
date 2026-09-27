/**
 * Etch Toolkit: component manager.
 *
 * A Settings Bar control opens a manager beside the bar, headed like Etch's
 * Style Manager. It lists the site's components and where they're used, in
 * a table like the Fonts manager's files. Each row's buttons edit one in
 * Etch's component editor, update it from a JSON file or pasted JSON after
 * reviewing the changes, or delete it.
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
	// Etch's hugeicons:arrow-left-02, the back button on its own managers.
	const BACK = '<path d="M8.99996 16.9998L4 11.9997L9 6.99976"/><path d="M4 12H20"/>';
	// Etch's hugeicons:search-01, as on the Selectors tab and Recipes.
	const SEARCH = '<path d="M17.5 17.5L22 22"/><path d="M20 11C20 6.02944 15.9706 2 11 2C6.02944 2 2 6.02944 2 11C2 15.9706 6.02944 20 11 20C15.9706 20 20 15.9706 20 11Z"/>';
	// Hugeicons free arrow-up-right-01, as Etch uses for "Open in Builder".
	const OPEN = '<path d="M9 6.65s6.938-.542 7.915.435S17.35 15 17.35 15m-.85-7.5l-10 10"/>';
	// Hugeicons pencil-edit-01, for each row's Edit.
	const EDIT = '<path d="M15.2141 5.98239L16.6158 4.58063C17.39 3.80646 18.6452 3.80646 19.4194 4.58063C20.1935 5.3548 20.1935 6.60998 19.4194 7.38415L18.0176 8.78591M15.2141 5.98239L6.98023 14.2163C5.93493 15.2616 5.41226 15.7842 5.05637 16.4211C4.70047 17.058 4.3424 18.5619 4 20C5.43809 19.6576 6.94199 19.2995 7.57889 18.9436C8.21579 18.5877 8.73844 18.0651 9.78375 17.0198L18.0176 8.78591M15.2141 5.98239L18.0176 8.78591"/><path d="M11 20H17"/>';
	const UPLOAD = '<path d="M12 4.5L12 14.5M12 4.5C11.2998 4.5 9.99153 6.4943 9.5 7M12 4.5C12.7002 4.5 14.0085 6.4943 14.5 7"/><path d="M20 16.5C20 18.982 19.482 19.5 17 19.5H7C4.518 19.5 4 18.982 4 16.5"/>';
	const stroke = ( paths, size = 16 ) =>
		`<svg class="etk-components__icon" viewBox="0 0 24 24" width="${ size }" height="${ size }" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ paths }</svg>`;

	const enabled = () => window.etchToolkitSettings?.settings?.componentManager === true && typeof window.etch?.components?.updateAsync === 'function';

	// h( 'button', { class: 'x', onclick }, child, … ), like the settings screen's.
	const PROPS = new Set( [ 'value', 'checked', 'indeterminate', 'disabled', 'hidden', 'textContent', 'htmlFor' ] );
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

	/* ------------------------------------------------------------------ */
	/* Views                                                               */
	/* ------------------------------------------------------------------ */

	let panel = null;
	let main = null;
	let status = null;
	let controlButton = null;
	let view = 'list';
	let pasted = '';
	let search = '';
	let filter = 'all'; // 'all', 'used' or 'unused'.
	let expanded = new Set(); // Components whose every use shows.
	let target = null; // The component being updated.
	let usedOn = null; // Component ID => the posts using it, from the server. Null while it loads.
	let reviewing = null;

	const announce = ( message, { error = false } = {} ) => {
		if ( ! status ) return;
		status.textContent = '';
		status.classList.toggle( 'is-error', error );
		// Cleared first so a repeated message is read again.
		window.setTimeout( () => ( status.textContent = message ), 50 );
	};
	const warn = ( message ) => announce( message, { error: true } );

	const button = ( label, onclick, { variant = 'secondary', ...attrs } = {} ) => h( 'button', { type: 'button', class: `etk-components__btn etk-components__btn--${ variant }`, onclick, ...attrs }, label );

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
		return h(
			'div',
			{ class: 'etk-components__uses' },
			shown.map( ( post ) =>
				h(
					'button',
					{ type: 'button', class: 'etk-components__use', title: 'Open in Etch', 'data-focus': `use:${ component.id }:${ post.id }`, onclick: () => openUse( post ) },
					post.postType === 'wp_block' ? `${ post.title } (component)` : post.title,
					h( 'span', { class: 'screen-reader-text', textContent: ', open in Etch' } ),
					h( 'span', { class: 'etk-components__use-icon', html: stroke( OPEN, 12 ) } )
				)
			),
			posts.length > USES
				? h(
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
					? h( 'p', { textContent: `It’s used on ${ titles.length <= 3 ? listOf( titles ) : `${ titles.slice( 0, 2 ).join( ', ' ) } and ${ titles.length - 2 } more` }. It will disappear from ${ titles.length === 1 ? 'there' : 'all of them' }.` } )
					: here.length
						? null
						: h( 'p', { textContent: 'No page uses it.' } ),
				here.length ? h( 'p', { textContent: `It’s removed from the page you have open. Save to keep that.` } ) : null,
				h( 'p', { textContent: 'This can’t be undone.' } ),
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
		return h(
			'fieldset',
			{ class: 'etk-components__seg etk-track' },
			h( 'legend', { class: 'screen-reader-text', textContent: 'Show' } ),
			[
				[ 'all', 'All' ],
				[ 'used', 'In use' ],
				[ 'unused', 'Unused' ],
			].map( ( [ value, label ] ) =>
				h(
					'label',
					{},
					h( 'input', {
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
					value === 'unused' && unused ? h( 'span', { class: 'etk-components__count etk-components__count--unused', textContent: String( unused ) } ) : null
				)
			)
		);
	};

	const componentRow = ( component ) => {
		const used = usedOn ? isUsed( component ) : null;
		const action = ( key, label, title, icon, onclick, extra = '' ) =>
			button( '', onclick, { class: `etk-components__btn etk-components__btn--secondary etk-components__row-action${ extra }`, 'aria-label': label, title, html: icon, 'data-focus': `${ key }:${ component.id }` } );
		return h(
			'tr',
			{ class: used === false ? 'is-unused' : null },
			h( 'th', { scope: 'row' }, h( 'span', { class: 'etk-components__cell-name', textContent: component.name } ) ),
			h( 'td', {}, h( 'code', { class: 'etk-components__key', textContent: component.key } ) ),
			h( 'td', {}, used === null ? null : h( 'span', { class: `etk-components__status-badge etk-components__status-badge--${ used ? 'success' : 'warning' }`, textContent: used ? 'In use' : 'Unused' } ) ),
			used ? h( 'td', { class: 'etk-components__uses-cell' }, usesCell( component ) ) : h( 'td', { class: 'etk-components__none', textContent: used === null ? 'Checking…' : '—' } ),
			h(
				'td',
				{},
				h(
					'div',
					{ class: 'etk-components__row-actions' },
					action( 'edit', `Edit ${ component.name } in Etch`, 'Edit in Etch', stroke( EDIT, 14 ), () => editInEtch( component ) ),
					action( 'update', `Update ${ component.name } from JSON`, 'Update from JSON', stroke( UPLOAD, 14 ), () => updateOne( component ) ),
					action( 'delete', `Delete ${ component.name }`, 'Delete', toolkit.DELETE_ICON, () => remove( component ), ' etk-components__row-delete' )
				)
			)
		);
	};

	const views = {
		list: () => {
			const count = h( 'span', { class: 'etk-components__muted', role: 'status' } );
			const body = h( 'tbody' );
			// Only the rows change as you type, so the field keeps its caret.
			const fill = () => {
				const all = window.etch.components.list().sort( ( a, b ) => a.name.localeCompare( b.name ) );
				const term = search.trim().toLowerCase();
				// Until usage loads, every component shows.
				const inFilter = ( c ) => filter === 'all' || ! usedOn || ( filter === 'used' ) === isUsed( c );
				const shown = all.filter( ( c ) => inFilter( c ) && ( ! term || `${ c.name } ${ c.key }`.toLowerCase().includes( term ) ) );
				count.textContent = shown.length === all.length ? plural( all.length, 'component', 'components' ) : `${ shown.length } of ${ plural( all.length, 'component', 'components' ) }`;
				const empty = ! all.length ? 'This site has no components yet.' : term ? 'No components match.' : filter === 'used' ? 'No component is in use.' : 'Every component is in use.';
				body.replaceChildren( ...( shown.length ? shown.map( componentRow ) : [ h( 'tr', {}, h( 'td', { colspan: '5', class: 'etk-components__empty-row', textContent: empty } ) ) ] ) );
			};
			fill();
			const th = ( text ) => h( 'th', { scope: 'col', textContent: text } );
			return [
				h(
					'div',
					{ class: 'etk-components__toolbar' },
					filters( fill ),
					// Built like Recipes' search: Etch's magnifier and a bare field.
					h(
						'div',
						{ class: 'etk-components__search' },
						h( 'span', { class: 'etk-components__search-icon', html: stroke( SEARCH, 14 ) } ),
						h( 'input', {
							type: 'text',
							class: 'etk-components__search-input',
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
						} )
					),
					count
				),
				h(
					'table',
					{ class: 'etk-components__table', 'aria-label': 'Components' },
					h( 'thead', {}, h( 'tr', {}, th( 'Component' ), th( 'Key' ), th( 'Status' ), th( 'Used on' ), h( 'th', { scope: 'col' }, h( 'span', { class: 'screen-reader-text', textContent: 'Actions' } ) ) ) ),
					body
				),
			];
		},

		import: () => [
			h(
				'div',
				{ class: 'etk-components__review-head' },
				button( '', () => showList(), { class: 'etk-components__btn etk-components__btn--secondary etk-components__icon-btn', 'aria-label': 'Back to components', title: 'Back to components', html: stroke( BACK ), 'data-focus': 'back' } ),
				h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: `Update ${ target.name }` } )
			),
			h( 'p', { class: 'etk-components__help', textContent: `Drop or paste JSON for ${ target.name }. In Etch, select it and press Cmd+C. You’ll review changes before saving.` } ),
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
				h( 'div', { class: 'etk-components__actions' }, button( 'Review changes', () => ( pasted.trim() ? read( pasted ) : warn( 'Paste some JSON first.' ) ), { variant: 'primary' } ) )
			),
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
							button( 'Back to components', showList, { 'data-focus': 'another' } )
						),
				  ]
				: [
						h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: 'The previous version is back' } ),
						h( 'div', { class: 'etk-components__done-actions' }, button( 'Back to components', showList, { 'data-focus': 'another' } ) ),
				  ],

		// Layers and props on the left, the picked one's code on the right.
		review: () => {
			const { current } = reviewing;
			const { approved, total } = tally();
			const lines = lineTotals();
			return [
				h(
					'div',
					{ class: 'etk-components__review-head' },
					button( '', () => go( 'import' ), { class: 'etk-components__btn etk-components__btn--secondary etk-components__icon-btn', 'aria-label': 'Back to the JSON', title: 'Back to the JSON', html: stroke( BACK ), 'data-focus': 'back' } ),
					h(
						'div',
						{ class: 'etk-components__review-title' },
						h( 'h2', { class: 'etk-components__page-title', tabindex: '-1', textContent: `Update ${ current.name }` } ),
						h( 'p', { class: 'etk-components__muted', textContent: total ? 'Pick a layer to see its code.' : 'No changes. This matches the site’s version.' } )
					),
					total
						? h(
								'div',
								{ class: 'etk-components__review-actions' },
								approved < total ? h( 'span', { class: 'etk-components__muted', textContent: `${ plural( total - approved, 'change', 'changes' ) } left out` } ) : null,
								h(
									'span',
									{ class: 'etk-components__lines' },
									h( 'span', { class: 'etk-components__lines-added', 'aria-hidden': 'true', textContent: `+${ lines.added }` } ),
									h( 'span', { class: 'etk-components__lines-removed', 'aria-hidden': 'true', textContent: `−${ lines.removed }` } ),
									h( 'span', { class: 'screen-reader-text', textContent: `${ plural( lines.added, 'line', 'lines' ) } added, ${ lines.removed } removed` } )
								),
								button( 'Update component', apply, { variant: 'primary', disabled: ! approved, 'data-focus': 'apply' } )
						  )
						: null
				),
				h(
					'div',
					{ class: 'etk-components__workspace' },
					h( 'div', { class: 'etk-components__side', 'data-scroll': 'side' }, layersView(), propsView(), metaView() ),
					h( 'section', { id: CODE_PANE, class: 'etk-components__code', 'aria-label': 'Changes', 'data-scroll': 'code' }, codePane() )
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
				h( 'p', { textContent: `Saves ${ approved } of ${ plural( total, 'change', 'changes' ) } now.` } ),
				classes ? h( 'p', { textContent: classes === 1 ? '1 class changes in the builder too. Save to keep it.' : `${ classes } classes change in the builder too. Save to keep them.` } ) : null,
				h( 'p', { textContent: 'You can restore the previous version later.' } ),
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

	// Layers closed in the tree (everything starts open).
	let closedLayers = new Set();

	// Whether the Layers and Props groups show everything, or only what changed.
	let showAll = { layers: false, props: false };

	// Folded runs of unchanged lines that were opened.
	let unfolded = new Set();

	// What the code pane shows: { kind: 'layer', id }, { kind: 'prop', key } or { kind: 'meta' }.
	let selected = null;
	const CODE_PANE = 'etk-components-code';
	const isSelected = ( kind, id ) => selected?.kind === kind && ( kind === 'meta' || selected.id === id );

	const chip = ( kind, text ) => h( 'span', { class: `etk-components__chip etk-components__chip--${ kind }`, textContent: text } );

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
		h( 'input', { type: 'checkbox', class: 'etk-checkbox', checked: value === true, indeterminate: value === 'some', 'aria-label': label, 'data-focus': focusKey, onchange: ( e ) => onchange( e.target.checked ) } );

	// Show all, or only what changed. Only offered when something didn't change.
	const showToggle = ( key, what ) =>
		button(
			showAll[ key ] ? 'Show changed' : 'Show all',
			() => {
				showAll[ key ] = ! showAll[ key ];
				render();
				announce( showAll[ key ] ? `Showing every ${ what }.` : `Showing changed ${ what }s only.` );
			},
			{ class: 'etk-components__btn etk-components__btn--secondary etk-components__btn--small', 'data-focus': `show:${ key }` }
		);

	// A group on the left: its label, Show all, and its rows.
	const group = ( id, title, toggle, body ) =>
		h( 'section', { class: 'etk-components__group', 'aria-labelledby': id }, h( 'div', { class: 'etk-components__group-head' }, h( 'h3', { id, class: 'etk-components__label', textContent: title } ), toggle ), body );

	const rows = ( items ) => h( 'div', { class: 'etk-components__tree' }, h( 'ul', { class: 'etk-components__layers', role: 'list' }, items ) );

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
		const trailing = state === 'some' ? [ h( 'span', { class: 'etk-components__count', textContent: `${ parts.filter( Boolean ).length } of ${ parts.length }` } ) ] : hasChanges ? layerChips( node ) : [];
		if ( node.inside && ! open ) trailing.push( chip( 'inside', `${ node.inside } inside` ) );

		const name = h(
			'span',
			{ class: 'etk-components__layer-name' },
			layer.tag ? h( 'span', { class: 'etk-components__layer-tag', textContent: layer.tag } ) : null,
			h( 'span', { class: 'etk-components__layer-label', textContent: layer.label } )
		);
		const chipList = trailing.length ? h( 'span', { class: 'etk-components__chips', 'aria-hidden': 'true' }, trailing ) : null;
		const label = { added: `Add ${ title }`, removed: `Remove ${ title }` }[ node.status ] || `Changes to ${ title }`;

		return h(
			'li',
			{ class: `etk-components__layer etk-components__layer--${ node.status } etk-components__layer--${ KINDS[ layer.block.type ] || 'default' }`, 'data-layer': node.id },
			h(
				'div',
				{ class: `etk-components__row${ showing ? ' is-showing' : '' }` },
				kids.length
					? h( 'button', { type: 'button', class: 'etk-components__caret', 'aria-expanded': String( open ), 'aria-label': `Layers inside ${ title }`, html: CARET, 'data-focus': `${ node.id }:caret`, onclick: () => toggleLayer( node ) } )
					: h( 'span', { class: 'etk-components__leaf', 'aria-hidden': 'true' } ),
				parts.length ? tick( label, state, ( yes ) => decideLayer( node, yes ), `${ node.id }:tick` ) : null,
				// A layer with changes shows them in the code pane, like selecting a layer in the Structure panel.
				hasChanges
					? h(
							'button',
							{ type: 'button', class: 'etk-components__row-toggle', 'aria-current': showing ? 'true' : null, 'aria-controls': CODE_PANE, 'data-focus': `${ node.id }:toggle`, onclick: () => select( { kind: 'layer', id: node.id } ) },
							name,
							h( 'span', { class: 'screen-reader-text', textContent: `, ${ describeChanges( node ) }` } ),
							chipList
					  )
					: [ name, chipList ]
			),
			kids.length && open ? h( 'ul', { class: 'etk-components__layers etk-components__layers--inside', role: 'list' }, kids.map( layerRow ) ) : null
		);
	};

	const layersView = () => {
		const { tree } = reviewing;
		const shown = tree.filter( shownLayer );
		return group(
			'etk-components-layers-title',
			'Layers',
			[ ...walk( tree ) ].some( ( node ) => node.status === 'same' ) ? showToggle( 'layers', 'layer' ) : null,
			shown.length ? rows( shown.map( layerRow ) ) : h( 'p', { class: 'etk-components__help', textContent: 'No layer changes.' } )
		);
	};

	/* ---- The code pane ---- */

	// Unchanged lines kept around a change in scripts and CSS. Longer runs fold.
	const CONTEXT = 3;

	const diffLine = ( { op, text, before, after } ) =>
		h(
			op === '-' ? 'del' : op === '+' ? 'ins' : 'div',
			{ class: `etk-components__diff-line etk-components__diff-line--${ op === '-' ? 'del' : op === '+' ? 'ins' : 'same' }` },
			h( 'span', { class: 'etk-components__diff-num', 'aria-hidden': 'true', textContent: before ?? '' } ),
			h( 'span', { class: 'etk-components__diff-num', 'aria-hidden': 'true', textContent: after ?? '' } ),
			h( 'span', { class: 'etk-components__diff-mark', textContent: op === '-' ? '−' : op === '+' ? '+' : '' } ),
			h( 'span', { class: 'etk-components__diff-code', textContent: text || ' ' } )
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
					h(
						'button',
						{ type: 'button', class: 'etk-components__fold', 'aria-expanded': String( open ), 'data-focus': `fold:${ id }`, onclick: () => toggleFold( id ) },
						h( 'span', { class: 'etk-components__fold-mark', 'aria-hidden': 'true', textContent: '⋯' } ),
						plural( hidden, 'unchanged line', 'unchanged lines' )
					),
					...( open ? numbered.slice( i + head, end - tail ).map( diffLine ) : [] ),
					...numbered.slice( end - tail, end ).map( diffLine )
				);
			}
			i = end;
		}
		return h( 'div', { class: 'etk-components__diff' }, out );
	};

	const toggleFold = ( id ) => {
		unfolded.has( id ) ? unfolded.delete( id ) : unfolded.add( id );
		render();
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
				: diffView( diffOf( from, to ) )
		);
	};
	const fields = ( list ) => h( 'div', { class: 'etk-components__fields' }, list.map( fieldView ) );

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
		h(
			'section',
			{ class: `etk-components__part${ unticked ? ' is-unticked' : '' }` },
			h(
				'div',
				{ class: 'etk-components__part-head' },
				control,
				h( 'h4', { class: `etk-components__part-title etk-components__part-title--${ kind }`, textContent: label } ),
				...extra,
				unticked ? h( 'span', { class: 'etk-components__part-note', textContent: `· ${ unticked }` } ) : null
			),
			h( 'div', { class: 'etk-components__part-body' }, ...body )
		);

	// The code pane's title: what's picked, and a sentence about it.
	const paneHead = ( title, text ) => h( 'div', { class: 'etk-components__pane-head' }, h( 'h3', { class: 'etk-components__pane-title' }, title ), h( 'p', { class: 'etk-components__muted', textContent: text } ) );

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
						extra: [ h( 'code', { class: 'etk-components__part-selector', textContent: change.selector } ), h( 'span', { class: `etk-components__reach${ wide ? ' is-wide' : '' }`, textContent: reach( change ) } ) ],
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
			paneHead( [ layer.tag ? h( 'span', { class: 'etk-components__pane-tag etk-components__layer-tag', textContent: layer.tag } ) : null, h( 'span', { textContent: layer.label } ) ], layerText( node ) ),
			h( 'div', { class: 'etk-components__card' }, parts ),
		];
	};

	// What the code pane shows for the selection.
	const codePane = () => {
		const node = selected?.kind === 'layer' && [ ...walk( reviewing.tree ) ].find( ( n ) => n.id === selected.id );
		if ( node ) return details( node );
		const prop = selected?.kind === 'prop' && reviewing.props.find( ( p ) => p.key === selected.id );
		if ( prop ) return propDetails( prop );
		if ( selected?.kind === 'meta' && reviewing.meta.length ) return metaDetails();
		return h( 'p', { class: 'etk-components__empty', textContent: tally().total ? 'Select a layer or prop to see what changed.' : 'No changes. This matches the site’s version.' } );
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
		announce( `Showing ${ layer ? layerTitle( layer.incoming || layer.current ) : next.kind === 'prop' ? `the ${ next.id } prop` : `the ${ listOf( reviewing.meta.map( ( field ) => field.label ) ).toLowerCase() }` }.` );
	};

	/* ---- Props, and the component's name and description ---- */

	const PROP_STATUS = { added: 'Added', removed: 'Removed', changed: 'Changed' };

	// A changed prop's chip is in the accent color, like HTML's.
	const propChip = ( prop ) => chip( prop.status === 'changed' ? 'html' : prop.status, PROP_STATUS[ prop.status ] );
	const propName = ( prop ) => ( prop.incoming || prop.current ).name || prop.key;
	const propLabel = ( prop ) => ( { added: `Add the ${ propName( prop ) } prop`, removed: `Remove the ${ propName( prop ) } prop` }[ prop.status ] || `Changes to the ${ propName( prop ) } prop` );

	const propRow = ( prop ) => {
		const showing = isSelected( 'prop', prop.key );
		const name = h( 'span', { class: 'etk-components__layer-name' }, h( 'span', { class: 'etk-components__layer-label', textContent: propName( prop ) } ) );
		if ( prop.status === 'same' ) return h( 'li', { class: 'etk-components__layer etk-components__layer--same' }, h( 'div', { class: 'etk-components__row' }, name ) );
		return h(
			'li',
			{ class: `etk-components__layer etk-components__layer--${ prop.status }` },
			h(
				'div',
				{ class: `etk-components__row${ showing ? ' is-showing' : '' }` },
				tick( propLabel( prop ), decisions.props.get( prop.key ), ( yes ) => decided( () => decisions.props.set( prop.key, yes ) ), `prop:${ prop.key }:tick` ),
				h(
					'button',
					{ type: 'button', class: 'etk-components__row-toggle', 'aria-current': showing ? 'true' : null, 'aria-controls': CODE_PANE, 'data-focus': `prop:${ prop.key }:toggle`, onclick: () => select( { kind: 'prop', id: prop.key } ) },
					name,
					h( 'span', { class: 'screen-reader-text', textContent: `, ${ prop.status }` } ),
					h( 'span', { class: 'etk-components__chips', 'aria-hidden': 'true' }, propChip( prop ) )
				)
			)
		);
	};

	const propDetails = ( prop ) => {
		const source = prop.incoming || prop.current;
		const yes = decisions.props.get( prop.key );
		const list =
			prop.status === 'changed'
				? prop.fields
				: [ ...propFields( source, makeSides( reviewing.incoming )[ prop.incoming ? 'incoming' : 'current' ] ).values() ].filter( ( field ) => field.value ).map( ( field ) => ( { label: field.label, from: prop.status === 'removed' ? field.value : '', to: prop.status === 'added' ? field.value : '' } ) );
		const text = {
			added: 'Added in this version. Untick it to leave it out.',
			removed: 'Removed in this version. Untick it to keep it.',
			changed: `Its ${ listOf( prop.fields.map( ( field ) => field.label.toLowerCase() ) ) } changed. Untick it to keep this site’s version.`,
		}[ prop.status ];
		const unticked = { added: 'unticked, not added', removed: 'unticked, stays on this site', changed: 'unticked, keeps this site’s prop' }[ prop.status ];
		return [
			paneHead( [ h( 'span', { textContent: propName( prop ) } ), source.name ? h( 'code', { class: 'etk-components__pane-tag', textContent: prop.key } ) : null ], text ),
			h(
				'div',
				{ class: 'etk-components__card' },
				part( { kind: prop.status, label: `${ PROP_STATUS[ prop.status ] } prop`, control: tick( propLabel( prop ), yes, ( value ) => decided( () => decisions.props.set( prop.key, value ) ), `prop:${ prop.key }` ), unticked: yes ? '' : unticked }, fields( list ) )
			),
		];
	};

	const propsView = () => {
		const { props } = reviewing;
		if ( ! props.length ) return null;
		const shown = showAll.props ? props : props.filter( ( prop ) => prop.status !== 'same' );
		return group(
			'etk-components-props-title',
			'Props',
			props.some( ( prop ) => prop.status === 'same' ) ? showToggle( 'props', 'prop' ) : null,
			shown.length ? rows( shown.map( propRow ) ) : h( 'p', { class: 'etk-components__help', textContent: 'No prop changes.' } )
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
				h(
					'li',
					{ class: 'etk-components__layer etk-components__layer--changed' },
					h(
						'div',
						{ class: `etk-components__row${ showing ? ' is-showing' : '' }` },
						tick( `Changes to the ${ label.toLowerCase() }`, stateOf( meta.map( ( field ) => decisions.meta.get( field.key ) ) ), ( yes ) => decided( () => meta.forEach( ( field ) => decisions.meta.set( field.key, yes ) ) ), 'meta:tick' ),
						h(
							'button',
							{ type: 'button', class: 'etk-components__row-toggle', 'aria-current': showing ? 'true' : null, 'aria-controls': CODE_PANE, 'data-focus': 'meta:toggle', onclick: () => select( { kind: 'meta' } ) },
							h( 'span', { class: 'etk-components__layer-name' }, h( 'span', { class: 'etk-components__layer-label', textContent: label } ) ),
							h( 'span', { class: 'screen-reader-text', textContent: ', changed' } ),
							h( 'span', { class: 'etk-components__chips', 'aria-hidden': 'true' }, chip( 'html', 'Changed' ) )
						)
					)
				)
			)
		);
	};

	const metaDetails = () => [
		paneHead( listOf( reviewing.meta.map( ( field ) => field.label ) ), reviewing.meta.length > 1 ? 'Both changed. Untick one to keep this site’s version of it.' : `The ${ reviewing.meta[ 0 ].label.toLowerCase() } changed. Untick it to keep this site’s version.` ),
		h(
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
		main.replaceChildren( h( 'div', { class: `etk-components__page etk-components__page--${ view }` }, ...views[ view ]() ) );
		main.querySelectorAll( '[data-scroll]' ).forEach( ( pane ) => ( pane.scrollTop = scrolled.get( pane.dataset.scroll ) ?? 0 ) );
		if ( focused ) main.querySelector( `[data-focus="${ CSS.escape( focused ) }"]` )?.focus( { preventScroll: true } );
	};

	// Focus goes to the view's title, or the search on the list.
	const go = ( next, { focus = true } = {} ) => {
		view = next;
		render();
		if ( focus ) main.querySelector( '.etk-components__page-title, [data-focus="search"]' )?.focus();
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
			// Across the top, like Etch's Style Manager.
			h(
				'header',
				{ class: 'etk-components__header' },
				h( 'button', { type: 'button', class: 'etk-components__btn etk-components__btn--secondary etk-components__icon-btn', 'aria-label': 'Back to the builder', title: 'Back to the builder', html: stroke( BACK ), onclick: () => close() } ),
				h( 'h1', { id: 'etk-components-title', class: 'etk-components__title', textContent: 'Components' } )
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
		if ( view === 'list' ) loadUsedOn();
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

	let listening = false;
	let added = false;
	const addControl = () => {
		const bar = window.etchControls?.builder?.settingsBar?.top;
		const section = document.querySelector( '.settings-bar__section.top' );
		if ( ! bar || ! section?.querySelector( 'button' ) ) return false;

		const before = new Set( section.querySelectorAll( 'button' ) );
		added = true;
		// Etch's own component icon, as on its component blocks.
		bar.addAfter( { id: CONTROL_ID, icon: 'etch:component-stroke', tooltip: 'Component manager', callback: () => ( panel && ! panel.hidden ? close() : open() ) } );

		// Etch renders the button on its next update. Label it for toggling state.
		const observer = new MutationObserver( () => {
			controlButton = [ ...section.querySelectorAll( 'button' ) ].find( ( b ) => ! before.has( b ) );
			if ( ! controlButton ) return;
			observer.disconnect();
			controlButton.setAttribute( 'aria-label', 'Component manager' );
			controlButton.setAttribute( 'aria-expanded', 'false' );
			controlButton.setAttribute( 'aria-controls', 'etk-components' );
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
	toolkit.components = { parse, fromGutenberg };
} )();
