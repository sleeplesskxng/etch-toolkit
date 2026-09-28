/**
 * Etch Toolkit: box shadow.
 *
 * In CSS editors, every box-shadow gets a button right after its colon. It
 * opens a small panel that writes a layered shadow, soft and natural:
 *
 * - A tile, and a light around it. Drag the light around the tile to change
 *   where the shadow falls, further out for a bigger shadow.
 * - The light's beam, which shows while the pointer is on the light, or after
 *   a touch on it. Drag the beam along its length for a stronger shadow, and
 *   across it for a softer one. Pull its edge out for more layers, push it
 *   in for fewer. It draws a ring for each.
 * - The shadow's color. A light color puts it all on a dark stage, so it
 *   shows.
 * - A slider for each value but the direction, for the keyboard, or anyone
 *   who'd rather.
 *
 * Each layer's blur is its offset times the softness, growing to the size
 * you set, and they add up to the opacity you set. A shadow it wrote opens
 * with its own values. Others open with what can be read from them, and are
 * only replaced once you change something.
 *
 * As with color mix, changes show in the code and on the canvas as you make
 * them, Esc or Cancel puts the shadow back, and only what's kept reaches
 * Etch, so one Cmd+Z takes the whole change back.
 */
( () => {
	const { el, slider, cssText, editorWidgets, editorEdit, editorPanel, colorField, resolveColor, isColor } = window.etchToolkit || {};
	if ( ! editorWidgets ) return;
	const { splitTop, declarations } = cssText;

	const PROPERTY = /^box-shadow$/i;
	const LAYERS = { min: 1, max: 8, start: 5 };
	const SIZE = { min: 1, max: 64, start: 24 }; // The biggest layer's offset, in pixels.
	const SOFTNESS = { min: 1, max: 3.5, start: 2 }; // Blur, as times the offset.
	const OPACITY = 20; // Percent, to start.

	// The stage, in pixels: how close to its edge the light goes, and how much smaller the tile's shadow is than the real one.
	const EDGE = 18;
	const TILE = 0.35;

	const round = ( n ) => Math.round( n * 10 ) / 10;
	const half = ( n ) => Math.round( n * 2 ) / 2 + 0; // + 0 turns -0 into 0.
	const clamp = ( n, min, max ) => Math.min( max, Math.max( min, n ) );
	const px = ( n ) => ( n === 0 ? '0' : `${ n }px` );

	// Whether a color is nearer white than black, by its luminance. Painted on a pixel, which reads any color syntax.
	let pixel = null;
	const isLight = ( color ) => {
		if ( ! pixel ) {
			const canvas = el( 'canvas', { width: 1, height: 1 } );
			pixel = canvas.getContext( '2d', { willReadFrequently: true } );
		}
		pixel.clearRect( 0, 0, 1, 1 );
		pixel.fillStyle = '#000';
		pixel.fillStyle = color;
		pixel.fillRect( 0, 0, 1, 1 );
		const linear = ( c ) => ( ( c /= 255 ) <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4 );
		const [ r, g, b ] = pixel.getImageData( 0, 0, 1, 1 ).data;
		// Mid grey, as the eye sees it.
		return 0.2126 * linear( r ) + 0.7152 * linear( g ) + 0.0722 * linear( b ) > 0.18;
	};

	// ---- Writing and reading a shadow ----

	/*
	 * The layers, smallest first. Each is twice as far as the one before, up
	 * to the size, so each adds its own step from tight to wide. Together,
	 * layer over layer, they reach the opacity.
	 */
	const layers = ( { angle, size, count, opacity, softness } ) => {
		const rad = ( angle * Math.PI ) / 180;
		const alpha = round( 100 * ( 1 - ( 1 - opacity / 100 ) ** ( 1 / count ) ) );
		return Array.from( { length: count }, ( _, i ) => {
			const offset = size / 2 ** ( count - 1 - i );
			// Away from the light.
			return { x: half( -Math.sin( rad ) * offset ), y: half( Math.cos( rad ) * offset ), blur: half( offset * softness ), alpha };
		} );
	};

	const compose = ( shadow, color, indent ) => {
		const list = layers( shadow ).map( ( l ) => `${ px( l.x ) } ${ px( l.y ) } ${ px( l.blur ) } color-mix(in srgb, ${ color } ${ l.alpha }%, transparent)` );
		return list.length === 1 ? ` ${ list[ 0 ] }` : list.map( ( layer ) => `\n${ indent }${ layer }` ).join( ',' );
	};

	const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/i;

	/*
	 * A shadow's values, best read: its number of layers, the biggest one's
	 * direction, offset and blur, and the color. A color-mix() with
	 * transparent is a color at an opacity, one layer's, from which the
	 * whole's follows.
	 */
	const parse = ( value ) => {
		const found = { angle: 0, size: SIZE.start, count: LAYERS.start, opacity: OPACITY, softness: SOFTNESS.start, color: 'black' };
		const list = splitTop( value.trim(), /,/ ).filter( Boolean );
		if ( ! list.length || /^none$/i.test( value.trim() ) ) return found;
		let far = null;
		let color = null;
		for ( const layer of list ) {
			const words = splitTop( layer, /\s/ );
			const lengths = words.filter( ( word ) => LENGTH.test( word ) ).map( parseFloat );
			color ??= words.find( ( word ) => ! LENGTH.test( word ) && ! /^inset$/i.test( word ) ) ?? null;
			if ( lengths.length < 2 ) continue;
			const [ x, y, blur = 0 ] = lengths;
			if ( ! far || Math.hypot( x, y ) > Math.hypot( far.x, far.y ) ) far = { x, y, blur };
		}
		found.count = clamp( list.length, LAYERS.min, LAYERS.max );
		if ( far && Math.hypot( far.x, far.y ) ) {
			const offset = Math.hypot( far.x, far.y );
			found.size = clamp( Math.round( offset ), SIZE.min, SIZE.max );
			found.angle = Math.round( ( ( Math.atan2( -far.x, far.y ) * 180 ) / Math.PI + 360 ) % 360 );
			found.softness = clamp( round( far.blur / offset ), SOFTNESS.min, SOFTNESS.max );
		}
		const mix = color && /^color-mix\(\s*in\s+[\w-]+\s*,([^]*)\)$/i.exec( color );
		const parts = mix && splitTop( mix[ 1 ], /,/ );
		if ( parts?.length === 2 && /^transparent$/i.test( parts[ 1 ] ) ) {
			const words = splitTop( parts[ 0 ], /\s/ );
			const pct = words.findIndex( ( word ) => /^[\d.]+%$/.test( word ) );
			if ( pct >= 0 ) {
				const alpha = parseFloat( words.splice( pct, 1 )[ 0 ] ) / 100;
				found.opacity = clamp( Math.round( 100 * ( 1 - ( 1 - alpha ) ** found.count ) ), 0, 100 );
			}
			found.color = words.join( ' ' );
		} else if ( color && isColor( color ) ) {
			found.color = color;
			// A see-through color is the shadow's strength already.
			if ( /^rgba\(|\/\s*[\d.]+\)$/.test( resolveColor( color ) || '' ) ) found.opacity = 100;
		}
		return found;
	};

	// ---- Buttons ----

	// The box-shadow declarations in a document, as { from, to }: from right after the colon. Once per version of it.
	const parsed = new WeakMap();
	const shadowsIn = ( doc ) => {
		if ( ! parsed.has( doc ) ) parsed.set( doc, declarations( doc.toString() ).filter( ( d ) => PROPERTY.test( d.property ) ) );
		return parsed.get( doc );
	};

	editorWidgets( ( doc ) =>
		shadowsIn( doc ).map( ( found ) => ( {
			at: found.from,
			key: 'shadow',
			render: ( view ) => {
				const button = el( 'button', { type: 'button', className: 'etk-shadow-button', title: 'Edit shadow', 'aria-label': 'Edit shadow' } );
				// Keep the press from moving the editor's cursor.
				button.addEventListener( 'mousedown', ( event ) => event.preventDefault() );
				button.addEventListener( 'click', () => open( view, button ) );
				return button;
			},
		} ) )
	);

	// ---- Panel ----

	const open = ( view, button ) => {
		const from = view.posAtDOM( button );
		const found = shadowsIn( view.state.doc ).find( ( d ) => d.from === from );
		if ( ! found ) return;
		const raw = view.state.doc.sliceString( found.from, found.to );
		// Only an empty value keeps its space, which the shadow then takes.
		const original = raw.trim() ? raw.trimEnd() : raw;
		const line = view.state.doc.lineAt( from );
		const indent = `${ /^\s*/.exec( line.text )[ 0 ] }  `;

		const shadow = parse( original );
		let { color } = shadow;
		delete shadow.color;
		const edit = editorEdit( view, from, original );

		// ---- The stage: the tile, the light and its beam ----

		const tile = el( 'div', { className: 'etk-shadow__tile' } );
		// Drawn pointing up from the light. Its aim turns it to the tile.
		const beam = el( 'div', {
			className: 'etk-shadow__beam',
			html: `<svg width="220" height="124" viewBox="-110 -120 220 124">
				<defs>
					<radialGradient id="etk-shadow-beam" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse">
						<stop offset="0" stop-color="currentColor" stop-opacity="0.9"/>
						<stop offset="0.6" stop-color="currentColor" stop-opacity="0.35"/>
						<stop offset="1" stop-color="currentColor" stop-opacity="0"/>
					</radialGradient>
				</defs>
				<path class="etk-shadow__cone" fill="url(#etk-shadow-beam)"/>
				<g class="etk-shadow__rings"></g>
				<path class="etk-shadow__edge"/>
				<path class="etk-shadow__hit"/>
				<path class="etk-shadow__edge-hit"/>
			</svg>`,
		} );
		const part = ( name ) => beam.querySelector( `.etk-shadow__${ name }` );
		const [ cone, rings, edge, hit, edgeHit ] = [ 'cone', 'rings', 'edge', 'hit', 'edge-hit' ].map( part );
		const gradient = beam.querySelector( 'radialGradient' );
		const light = el( 'div', { className: 'etk-shadow__light' } );
		const aim = el( 'div', { className: 'etk-shadow__aim' }, [ beam ] );
		const handle = el( 'div', { className: 'etk-shadow__handle' }, [ aim, light ] );
		[ tile, handle ].forEach( ( node ) => node.setAttribute( 'aria-hidden', 'true' ) );

		const stage = el( 'div', { className: 'etk-shadow__stage' }, [ tile, handle ] );
		stage.style.setProperty( '--etk-shadow-edge', `${ EDGE }px` );

		// The beam: as long as the shadow is strong, as wide as it's soft, a ring for each layer.
		const drawBeam = () => {
			const spread = 0.5 + ( ( shadow.softness - SOFTNESS.min ) / ( SOFTNESS.max - SOFTNESS.min ) ) * 0.8;
			const length = 48 + ( shadow.opacity / 100 ) * 50;
			const a0 = -Math.PI / 2 - spread;
			const a1 = -Math.PI / 2 + spread;
			const pt = ( a, r ) => `${ round( Math.cos( a ) * r ) } ${ round( Math.sin( a ) * r ) }`;
			// Inset at both ends by a length along the arc.
			const arc = ( r, inset = 0 ) => `M ${ pt( a0 + inset / r, r ) } A ${ r } ${ r } 0 0 1 ${ pt( a1 - inset / r, r ) }`;
			cone.setAttribute( 'd', `M 0 0 L ${ pt( a0, length ) } A ${ length } ${ length } 0 0 1 ${ pt( a1, length ) } Z` );
			gradient.setAttribute( 'r', length );
			edge.setAttribute( 'd', arc( length ) );

			// A new ring shows bold for a moment.
			const had = rings.children.length;
			if ( had !== shadow.count ) {
				rings.replaceChildren( ...Array.from( { length: shadow.count }, () => document.createElementNS( 'http://www.w3.org/2000/svg', 'path' ) ) );
				if ( had && shadow.count > had ) {
					const ring = rings.lastElementChild;
					ring.classList.add( 'is-new' );
					setTimeout( () => ring.classList.remove( 'is-new' ), 140 );
				}
			}
			// From near the light out to the edge, fainter as they go.
			[ ...rings.children ].forEach( ( ring, i ) => {
				const out = ( i + 1 ) / shadow.count;
				ring.setAttribute( 'd', arc( 10 + ( length - 10 ) * out, 2 ) );
				ring.setAttribute( 'stroke-opacity', round( 0.34 - out * 0.2 ) );
			} );

			// Where it's caught: its edge for layers, its body for strength and softness.
			const inner = Math.max( 12, length - 12 );
			const outer = length + 10;
			const c0 = a0 - 0.12;
			const c1 = a1 + 0.12;
			edgeHit.setAttribute( 'd', `M ${ pt( c0, inner ) } L ${ pt( c0, outer ) } A ${ outer } ${ outer } 0 0 1 ${ pt( c1, outer ) } L ${ pt( c1, inner ) } A ${ inner } ${ inner } 0 0 0 ${ pt( c0, inner ) } Z` );
			hit.setAttribute( 'd', `M ${ pt( c0, 4 ) } L ${ pt( c0, inner ) } A ${ inner } ${ inner } 0 0 1 ${ pt( c1, inner ) } L ${ pt( c1, 4 ) } Z` );
		};

		// The stage shows the real color, which lives on the canvas, and goes dark for a light one.
		let shown = resolveColor( color.trim() ) || 'transparent';
		const theme = () => ( stage.dataset.theme = isLight( shown ) ? 'dark' : 'light' );
		const paint = () => {
			const rad = ( shadow.angle * Math.PI ) / 180;
			const out = shadow.size / SIZE.max;
			// From the middle, as a share of the way to the edge.
			stage.style.setProperty( '--etk-shadow-x', round( Math.sin( rad ) * out * 1000 ) / 1000 );
			stage.style.setProperty( '--etk-shadow-y', round( -Math.cos( rad ) * out * 1000 ) / 1000 );
			aim.style.rotate = `${ shadow.angle + 180 }deg`;
			drawBeam();
			tile.style.boxShadow = layers( { ...shadow, size: shadow.size * TILE } )
				.map( ( l ) => `${ l.x }px ${ l.y }px ${ l.blur }px color-mix(in srgb, ${ shown } ${ l.alpha }%, transparent)` )
				.join( ', ' );
		};

		// Written once a frame at most, since each write redraws the canvas.
		let writing = 0;
		const update = () => {
			paint();
			if ( ! isColor( color ) ) return;
			writing ||= requestAnimationFrame( () => {
				writing = 0;
				edit.set( compose( shadow, color.trim(), indent ) );
			} );
		};

		// ---- Sliders: the same values, for the keyboard, or anyone who'd rather ----

		const sliders = {};
		const field = ( key, options, className = '' ) => {
			sliders[ key ] = slider( {
				...options,
				value: shadow[ key ],
				// Its steps can add up to 2.1000000000000001.
				onchange: ( v ) => round( v ) !== shadow[ key ] && set( { [ key ]: round( v ) } ),
			} );
			if ( className ) sliders[ key ].classList.add( className );
			return sliders[ key ];
		};
		const fields = [
			field( 'size', { name: 'Size', label: 'Shadow size', min: SIZE.min, max: SIZE.max, text: ( v ) => `${ v }px` }, 'etk-shadow__for-light' ),
			field( 'opacity', { name: 'Opacity', min: 0, max: 100, text: ( v ) => `${ v }%` }, 'etk-shadow__for-beam' ),
			field( 'softness', { name: 'Softness', label: 'Shadow softness', min: SOFTNESS.min, max: SOFTNESS.max, step: 0.1, text: ( v ) => `${ round( v ) }×`, spoken: ( v ) => `Blur ${ round( v ) } times the offset` }, 'etk-shadow__for-beam' ),
			field( 'count', { name: 'Layers', label: 'Shadow layers', min: LAYERS.min, max: LAYERS.max, text: String, spoken: ( v ) => `${ v } ${ v === 1 ? 'layer' : 'layers' }` }, 'etk-shadow__for-edge' ),
		];
		const inputOf = ( key ) => sliders[ key ].querySelector( 'input' );

		const set = ( changes ) => {
			Object.assign( shadow, changes );
			for ( const key of Object.keys( sliders ) ) {
				const input = inputOf( key );
				if ( round( Number( input.value ) ) === shadow[ key ] ) continue;
				input.value = shadow[ key ];
				input.dispatchEvent( new Event( 'input' ) );
			}
			update();
		};

		/*
		 * The beam shows while the pointer is on the light or the beam, and a
		 * moment after it leaves. A touch has no pointer to follow, so after one
		 * on the light the beam stays until a press elsewhere.
		 */
		let drag = null;
		let hiding = 0;
		const show = () => {
			if ( drag?.what === 'light' ) return;
			clearTimeout( hiding );
			stage.classList.add( 'shows-beam' );
		};
		const hide = ( event ) => {
			if ( event.pointerType !== 'mouse' || drag ) return;
			clearTimeout( hiding );
			hiding = setTimeout( () => stage.classList.remove( 'shows-beam' ), 280 );
		};
		light.addEventListener( 'pointerenter', show );
		light.addEventListener( 'pointermove', show );
		light.addEventListener( 'pointerleave', hide );
		beam.addEventListener( 'pointerenter', show );
		beam.addEventListener( 'pointerleave', hide );
		stage.addEventListener( 'pointerdown', ( event ) => {
			if ( beam.contains( event.target ) ) return;
			clearTimeout( hiding );
			stage.classList.remove( 'shows-beam' );
		} );

		/*
		 * The light drags where the pointer takes it: its angle round the tile
		 * is the direction, its distance the size. The beam drags along itself
		 * for opacity and across for softness, and its edge for layers.
		 */
		const move = ( event ) => {
			if ( drag.what === 'light' ) {
				const r = stage.getBoundingClientRect();
				const x = event.clientX - drag.ox - ( r.left + r.width / 2 );
				const y = event.clientY - drag.oy - ( r.top + r.height / 2 );
				const angle = Math.round( ( Math.atan2( x, -y ) * 180 ) / Math.PI + 360 ) % 360;
				const reach = r.width / 2 - EDGE;
				set( { angle, size: clamp( Math.round( ( Math.hypot( x, y ) / reach ) * SIZE.max ), SIZE.min, SIZE.max ) } );
				return;
			}
			const rot = ( ( shadow.angle + 180 ) * Math.PI ) / 180;
			const dx = event.clientX - drag.x;
			const dy = event.clientY - drag.y;
			const along = dx * Math.sin( rot ) - dy * Math.cos( rot );
			const across = dx * Math.cos( rot ) + dy * Math.sin( rot );
			if ( drag.what === 'edge' ) {
				const next = clamp( drag.from.count + Math.round( along / 9 ), LAYERS.min, LAYERS.max );
				if ( next === shadow.count ) return;
				navigator.vibrate?.( 3 );
				set( { count: next } );
				return;
			}
			set( {
				opacity: clamp( Math.round( drag.from.opacity + along * 0.8 ), 0, 100 ),
				softness: clamp( round( drag.from.softness + across * 0.03 ), SOFTNESS.min, SOFTNESS.max ),
			} );
		};
		const grab = ( node, what, input ) => {
			node.addEventListener( 'pointerdown', ( event ) => {
				if ( event.button !== 0 ) return;
				event.preventDefault();
				node.setPointerCapture( event.pointerId );
				const at = light.getBoundingClientRect();
				drag = {
					what,
					id: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					// Where on the light it was caught, so it doesn't jump.
					ox: event.clientX - ( at.left + at.width / 2 ),
					oy: event.clientY - ( at.top + at.height / 2 ),
					from: { ...shadow },
				};
				stage.classList.add( `is-dragging-${ what }` );
				input.focus( { preventScroll: true } );
			} );
			node.addEventListener( 'pointermove', ( event ) => event.pointerId === drag?.id && move( event ) );
			const release = ( event ) => {
				if ( event.pointerId !== drag?.id ) return;
				drag = null;
				stage.classList.remove( `is-dragging-${ what }` );
				if ( event.pointerType !== 'mouse' || light.matches( ':hover' ) || beam.matches( ':hover' ) ) show();
				else hide( event );
			};
			node.addEventListener( 'pointerup', release );
			node.addEventListener( 'pointercancel', release );
		};
		grab( light, 'light', inputOf( 'size' ) );
		grab( hit, 'beam', inputOf( 'opacity' ) );
		grab( edgeHit, 'edge', inputOf( 'count' ) );
		edgeHit.addEventListener( 'pointerenter', () => stage.classList.add( 'is-on-edge' ) );
		edgeHit.addEventListener( 'pointerleave', () => stage.classList.remove( 'is-on-edge' ) );

		// ---- Color ----

		const colorRow = colorField( {
			id: 'etk-shadow-color',
			label: 'Color',
			value: color,
			oninput: ( value ) => {
				color = value;
				shown = resolveColor( color.trim() ) || 'transparent';
				theme();
				update();
			},
		} );

		theme();
		paint();
		editorPanel( {
			anchor: button,
			label: 'Box shadow',
			className: 'etk-shadow',
			content: [ stage, el( 'div', { className: 'etk-pop__fields' }, [ colorRow, ...fields ] ) ],
			focus: inputOf( 'size' ),
			onclose: ( keep ) => {
				cancelAnimationFrame( writing );
				clearTimeout( hiding );
				// A change still waiting on its frame.
				if ( writing && keep && isColor( color ) ) edit.set( compose( shadow, color.trim(), indent ) );
				writing = 0;
				edit.finish( keep );
			},
		} );
	};
} )();
