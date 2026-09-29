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
 * - Inset, for a shadow inside the element, as if pressed in.
 * - A slider for each value but the direction, for the keyboard, or anyone
 *   who'd rather.
 *
 * With Automatic.css and its box shadow variables on, the panel has two tabs.
 * Presets picks one of its variables, which the shadow then uses as
 * var(--box-shadow-…). Custom is the above, and can save its shadow over one
 * of the variables, which Automatic.css writes at once, unlike the rest.
 *
 * The layers follow the curves of the Beautiful Shadows Figma plugin, up to
 * the size you set, and add up to the opacity you set. A shadow it wrote opens
 * with its own values. Others open with what can be read from them, and are
 * only replaced once you change something.
 *
 * As with color mix, changes show in the code and on the canvas as you make
 * them, Esc or Cancel puts the shadow back, and only what's kept reaches
 * Etch, so one Cmd+Z takes the whole change back.
 */
( () => {
	const { api, el, slider, cssText, confirmDialog, errorDialog, errorText, editorWidgets, editorEdit, editorPanel, colorField, styleDoc, resolveColor, isColor } = window.etchToolkit || {};
	if ( ! editorWidgets ) return;
	const { splitTop, declarations } = cssText;

	const PROPERTY = /^box-shadow$/i;
	const LAYERS = { min: 1, max: 8, start: 6 };
	const SIZE = { min: 1, max: 288, start: 24 }; // The biggest layer's offset, in pixels.
	const SOFTNESS = { min: 1, max: 3.5, start: 2 }; // 2 blurs as the plugin does.
	const OPACITY = 20; // Percent, to start.

	// The stage, in pixels: how close to its edge the light goes, and how much smaller the tile's shadow is than the real one.
	const EDGE = 18;
	const TILE = 0.35;

	/*
	 * How far out the light is, 0 to 1, for a size, and back. On a curve, so
	 * small shadows, the most used, get room around the tile, and the big
	 * ones share the edge.
	 */
	const reachFor = ( size ) => Math.sqrt( size / SIZE.max );
	const sizeFor = ( out ) => Math.round( Math.min( out, 1 ) ** 2 * SIZE.max );

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
	 * The layers, closest first, on the curves of the Beautiful Shadows Figma
	 * plugin (github.com/alexwidua/figma-beautiful-shadows). Offsets start
	 * slow and grow fast, up to the size. Blur grows fast and levels off, so
	 * close layers are soft and far ones barely blurrier. Close layers are
	 * the darkest and far ones fade out, and layer over layer they reach the
	 * opacity.
	 */
	const easeIn = ( t ) => t * t;
	const easeOut = ( t ) => 1 - ( 1 - t ) ** 2;
	const fade = ( t ) => 1 - ( t < 0.5 ? 4 * t ** 3 : 1 - ( 2 - 2 * t ) ** 3 / 2 );
	const BLUR = 0.1; // Times the softness.
	// Where each layer sits along the curves, 0 to 1. The plugin's first, at 0, would be nothing.
	const steps = ( count ) => Array.from( { length: count }, ( _, i ) => ( i + 1 ) / ( count + 1 ) );
	// Each layer's opacity, faded, and scaled until together they reach the whole.
	const shares = ( count, opacity ) => {
		const weights = steps( count ).map( fade );
		const reach = ( scale ) => 1 - weights.reduce( ( left, weight ) => left * ( 1 - scale * weight ), 1 );
		let low = 0;
		let high = 1 / Math.max( ...weights );
		for ( let i = 0; i < 30; i++ ) {
			const mid = ( low + high ) / 2;
			if ( reach( mid ) < opacity / 100 ) low = mid;
			else high = mid;
		}
		return weights.map( ( weight ) => weight * low );
	};
	const layers = ( { angle, size, count, opacity, softness } ) => {
		const rad = ( angle * Math.PI ) / 180;
		const at = steps( count );
		const far = easeIn( at.at( -1 ) );
		const alphas = shares( count, opacity );
		return at.map( ( t, i ) => {
			const offset = ( size * easeIn( t ) ) / far;
			// Away from the light.
			return {
				x: half( -Math.sin( rad ) * offset ),
				y: half( Math.cos( rad ) * offset ),
				blur: half( ( size * softness * BLUR * easeOut( t ) ) / far ),
				alpha: round( 100 * alphas[ i ] ),
			};
		} );
	};

	const list = ( shadow, color ) => layers( shadow ).map( ( l ) => `${ shadow.inset ? 'inset ' : '' }${ px( l.x ) } ${ px( l.y ) } ${ px( l.blur ) } color-mix(in srgb, ${ color } ${ l.alpha }%, transparent)` );
	const compose = ( shadow, color, indent ) => {
		const layered = list( shadow, color );
		return layered.length === 1 ? ` ${ layered[ 0 ] }` : layered.map( ( layer ) => `\n${ indent }${ layer }` ).join( ',' );
	};

	const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/i;

	// A color-mix() with transparent: a color, at an opacity if it has one.
	const seeThrough = ( word ) => {
		const mix = /^color-mix\(\s*in\s+[\w-]+\s*,([^]*)\)$/i.exec( word || '' );
		const parts = mix && splitTop( mix[ 1 ], /,/ );
		if ( parts?.length !== 2 || ! /^transparent$/i.test( parts[ 1 ] ) ) return null;
		const words = splitTop( parts[ 0 ], /\s/ );
		const pct = words.findIndex( ( w ) => /^[\d.]+%$/.test( w ) );
		const alpha = pct >= 0 ? parseFloat( words.splice( pct, 1 )[ 0 ] ) / 100 : null;
		return { color: words.join( ' ' ), alpha };
	};

	/*
	 * A shadow's values, best read: its number of layers, the biggest one's
	 * direction, offset and blur, and the color. Layers of color-mix()es with
	 * transparent are a color at opacities, which together are the whole's.
	 */
	const parse = ( value ) => {
		const found = { angle: 0, size: SIZE.start, count: LAYERS.start, opacity: OPACITY, softness: SOFTNESS.start, inset: false, color: 'black' };
		const list = splitTop( value.trim(), /,/ ).filter( Boolean );
		if ( ! list.length || /^none$/i.test( value.trim() ) ) return found;
		let far = null;
		const colors = [];
		for ( const layer of list ) {
			const words = splitTop( layer, /\s/ );
			const lengths = words.filter( ( word ) => LENGTH.test( word ) ).map( parseFloat );
			if ( words.some( ( word ) => /^inset$/i.test( word ) ) ) found.inset = true;
			colors.push( words.find( ( word ) => ! LENGTH.test( word ) && ! /^inset$/i.test( word ) ) ?? null );
			if ( lengths.length < 2 ) continue;
			const [ x, y, blur = 0 ] = lengths;
			if ( ! far || Math.hypot( x, y ) > Math.hypot( far.x, far.y ) ) far = { x, y, blur };
		}
		// A single shadow is one to layer, not one layer to keep.
		if ( list.length > 1 ) found.count = clamp( list.length, LAYERS.min, LAYERS.max );
		if ( far && Math.hypot( far.x, far.y ) ) {
			const offset = Math.hypot( far.x, far.y );
			found.size = clamp( Math.round( offset ), SIZE.min, SIZE.max );
			found.angle = Math.round( ( ( Math.atan2( -far.x, far.y ) * 180 ) / Math.PI + 360 ) % 360 );
			// The far layer's blur for its offset, as the curves give it.
			const t = found.count / ( found.count + 1 );
			found.softness = clamp( round( ( far.blur / offset ) * ( easeIn( t ) / ( BLUR * easeOut( t ) ) ) ), SOFTNESS.min, SOFTNESS.max );
		}
		const [ color ] = colors;
		const mixes = colors.map( seeThrough );
		if ( mixes[ 0 ] ) {
			found.color = mixes[ 0 ].color;
			if ( mixes.every( ( mix ) => mix?.alpha !== null && mix?.alpha !== undefined ) ) {
				const left = mixes.reduce( ( rest, mix ) => rest * ( 1 - mix.alpha ), 1 );
				found.opacity = clamp( Math.round( 100 * ( 1 - left ) ), 0, 100 );
			}
		} else if ( color && isColor( color ) ) {
			found.color = color;
			// A see-through color is the shadow's strength already.
			if ( /^rgba\(|\/\s*[\d.]+\)$/.test( resolveColor( color ) || '' ) ) found.opacity = 100;
		}
		return found;
	};

	// ---- Automatic.css's box shadow variables ----

	// { slot, name, value } for each, empty ones too since a shadow can be saved into them. Null when there are none to use.
	let presets = window.etchToolkitBoxShadow?.presets ?? null;
	const varOf = ( preset ) => `--box-shadow-${ preset.name }`;
	const filled = () => ( presets || [] ).filter( ( preset ) => preset.value );
	// The preset a value points at, when it's just var(--box-shadow-…).
	const presetFor = ( value ) => {
		const name = /^var\(\s*(--[\w-]+)\s*\)$/.exec( value.trim() )?.[ 1 ];
		return name ? filled().find( ( preset ) => varOf( preset ) === name ) ?? null : null;
	};

	let shadowProbe = null;
	// A shadow as the canvas paints it, where the site's variables are, or null.
	const paintedShadow = ( value ) => {
		const doc = styleDoc();
		if ( ! doc?.body ) return null;
		if ( ! shadowProbe?.isConnected || shadowProbe.ownerDocument !== doc ) {
			shadowProbe = doc.createElement( 'div' );
			shadowProbe.setAttribute( 'aria-hidden', 'true' );
			shadowProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
			doc.body.append( shadowProbe );
		}
		shadowProbe.style.boxShadow = '';
		shadowProbe.style.boxShadow = value;
		const painted = doc.defaultView.getComputedStyle( shadowProbe ).boxShadow;
		return painted === 'none' ? null : painted;
	};

	// A shadow for the tile, its lengths shrunk as the custom shadow's are, and whether its color is light.
	const tileShadow = ( value ) => {
		const painted = paintedShadow( value );
		if ( ! painted ) return { css: '', light: false };
		let color = null;
		const css = splitTop( painted, /,/ )
			.map( ( layer ) =>
				splitTop( layer.trim(), /\s/ )
					.map( ( word ) => {
						if ( /^-?[\d.]+px$/.test( word ) ) return `${ round( parseFloat( word ) * TILE ) }px`;
						if ( ! /^inset$/i.test( word ) ) color ??= word;
						return word;
					} )
					.join( ' ' )
			)
			.join( ', ' );
		return { css, light: color ? isLight( color ) : false };
	};

	// The canvas, or styleDoc()'s copy of it, has Automatic.css's old files. Load them again, and drop the old ones once the new are in, so nothing flashes unstyled.
	const reloadAutomaticCss = () => {
		for ( const old of styleDoc()?.querySelectorAll( 'link[rel="stylesheet"][href*="/automatic-css/"]' ) ?? [] ) {
			const url = new URL( old.href );
			url.searchParams.set( 'etk', Date.now() );
			const next = old.cloneNode();
			next.href = url.href;
			next.addEventListener( 'load', () => old.remove() );
			old.after( next );
		}
	};

	// Automatic.css writes it and rebuilds its CSS at once, not with Etch's Save.
	const saveToPreset = async ( slot, value ) => {
		presets = ( await api( `box-shadows/${ slot }`, 'PUT', { value } ) ).presets;
		reloadAutomaticCss();
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

		// The preset on the element now, if it's one. Its var() isn't a shadow to read.
		let applied = presetFor( original );
		let mode = applied ? 'presets' : 'custom';
		const shadow = parse( applied ? '' : original );
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
		let shownLight = isLight( shown );
		const paint = () => {
			// A preset's shadow, on a tile that keeps still.
			const preset = mode === 'presets' && applied ? tileShadow( applied.value ) : null;
			stage.dataset.theme = ( preset ? preset.light : shownLight ) ? 'dark' : 'light';
			if ( preset ) {
				tile.style.boxShadow = preset.css;
				return;
			}
			const rad = ( shadow.angle * Math.PI ) / 180;
			const out = reachFor( shadow.size );
			// From the middle, as a share of the way to the edge.
			stage.style.setProperty( '--etk-shadow-x', round( Math.sin( rad ) * out * 1000 ) / 1000 );
			stage.style.setProperty( '--etk-shadow-y', round( -Math.cos( rad ) * out * 1000 ) / 1000 );
			aim.style.rotate = `${ shadow.angle + 180 }deg`;
			drawBeam();
			tile.style.boxShadow = layers( { ...shadow, size: shadow.size * TILE } )
				.map( ( l ) => `${ shadow.inset ? 'inset ' : '' }${ l.x }px ${ l.y }px ${ l.blur }px color-mix(in srgb, ${ shown } ${ l.alpha }%, transparent)` )
				.join( ', ' );
		};

		// Written once a frame at most, since each write redraws the canvas.
		let writing = 0;
		const update = () => {
			// Whatever it was, it's this now.
			applied = null;
			paint();
			saveable();
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
			field( 'softness', { name: 'Softness', label: 'Shadow softness', min: SOFTNESS.min, max: SOFTNESS.max, step: 0.1, text: ( v ) => `${ round( v ) }×`, spoken: ( v ) => `Softness ${ round( v ) }` }, 'etk-shadow__for-beam' ),
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
				set( { angle, size: clamp( sizeFor( Math.hypot( x, y ) / reach ), SIZE.min, SIZE.max ) } );
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
				shownLight = isLight( shown );
				update();
			},
		} );

		const inset = el( 'input', { type: 'checkbox', id: 'etk-shadow-inset', className: 'etk-checkbox', checked: shadow.inset } );
		inset.addEventListener( 'change', () => {
			shadow.inset = inset.checked;
			update();
		} );
		const insetRow = el( 'div', { className: 'etk-pop__row' }, [ el( 'label', { htmlFor: 'etk-shadow-inset', textContent: 'Inset' } ), inset ] );

		// ---- Save to a preset ----

		const targets = el( 'select', { id: 'etk-shadow-target' } );
		const save = el( 'button', { type: 'button', className: 'etk-confirm__btn etk-confirm__btn--cancel etk-shadow__save', textContent: 'Save', disabled: true } );
		const status = el( 'p', { className: 'etk-sr', role: 'status' } );
		let saving = false;
		const saveable = () => ( save.disabled = saving || ! target() || ! isColor( color ) );
		const target = () => presets?.find( ( preset ) => String( preset.slot ) === targets.value ) ?? null;
		const fillTargets = () => {
			const chosen = targets.value;
			targets.replaceChildren(
				el( 'option', { value: '', textContent: 'Choose a preset', disabled: true } ),
				...( presets || [] ).map( ( preset ) => el( 'option', { value: String( preset.slot ), textContent: `${ varOf( preset ) }${ preset.value ? '' : ' (empty)' }` } ) )
			);
			targets.value = chosen;
			saveable();
		};
		targets.addEventListener( 'change', saveable );

		save.addEventListener( 'click', async () => {
			const preset = target();
			if ( saving || ! preset || ! isColor( color ) ) return;
			saving = true;
			saveable();
			const name = varOf( preset );
			// One line, since Automatic.css keeps it in a field.
			const value = list( shadow, color.trim() ).join( ', ' );
			let dialog = null;
			try {
				// Filling an empty one takes nothing away.
				if ( preset.value ) {
					dialog = confirmDialog( {
						title: `Replace ${ name }?`,
						message: [ el( 'p', { textContent: 'Everything on the site that uses it changes too. Automatic.css saves it now, so Cancel on the shadow panel won\'t take it back.' } ) ],
						confirmLabel: 'Replace',
						busyLabel: 'Saving…',
						variant: 'primary',
					} );
					if ( ! ( await dialog.result ) ) return;
				}
				await saveToPreset( preset.slot, value );
				dialog?.close();
				fillTargets();
				// It's a variable now, so the element uses it, on the Presets tab, and Done keeps it.
				applied = presets.find( ( item ) => item.slot === preset.slot );
				cancelAnimationFrame( writing );
				writing = 0;
				edit.set( ` var(${ name })` );
				tabs.querySelector( 'input[value="presets"]' ).checked = true;
				switchTo( 'presets' );
				status.textContent = `Saved to ${ name }. The element uses it now.`;
				setTimeout( () => ( status.textContent = '' ), 4000 );
			} catch ( error ) {
				if ( dialog ) dialog.fail( errorText( error ) );
				else errorDialog( 'Couldn\'t save the preset', errorText( error ) );
			} finally {
				saving = false;
				saveable();
			}
		} );

		const saveRow = presets
			? el( 'div', { className: 'etk-pop__row etk-shadow__saveto' }, [
					el( 'label', { htmlFor: 'etk-shadow-target', textContent: 'Save to ACSS' } ),
					el( 'div', { className: 'etk-shadow__target' }, [ el( 'div', { className: 'etk-pop__select' }, [ targets ] ), save ] ),
			  ] )
			: null;

		// ---- Presets: Automatic.css's variables, one to pick ----

		const picker = el( 'select', { id: 'etk-shadow-preset' } );
		const pickerRow = el( 'div', { className: 'etk-pop__row' }, [ el( 'label', { htmlFor: 'etk-shadow-preset', textContent: 'Preset' } ), el( 'div', { className: 'etk-pop__select' }, [ picker ] ) ] );
		const pickerValue = el( 'code', { className: 'etk-shadow__value' } );
		const pickerEmpty = el( 'p', { className: 'etk-shadow__none', textContent: 'None of Automatic.css\'s box shadows have a value yet. Make one in Custom, then save it to a preset.' } );
		const fillPresets = () => {
			const options = filled();
			picker.replaceChildren(
				el( 'option', { value: '', textContent: 'Choose a preset', disabled: true } ),
				...options.map( ( preset ) => el( 'option', { value: String( preset.slot ), textContent: varOf( preset ) } ) )
			);
			// A preset saved over shows its new shadow.
			applied &&= options.find( ( preset ) => preset.slot === applied.slot ) ?? null;
			picker.value = applied ? String( applied.slot ) : '';
			pickerValue.textContent = applied?.value ?? '';
			pickerRow.hidden = pickerValue.hidden = ! options.length;
			pickerEmpty.hidden = options.length > 0;
			paint();
		};
		picker.addEventListener( 'change', () => {
			const preset = filled().find( ( item ) => String( item.slot ) === picker.value );
			if ( ! preset ) return;
			applied = preset;
			// A change from Custom still waiting on its frame would land over it.
			cancelAnimationFrame( writing );
			writing = 0;
			edit.set( ` var(${ varOf( preset ) })` );
			pickerValue.textContent = preset.value;
			paint();
		} );

		const customPane = el( 'div', { className: 'etk-pop__fields' }, [ colorRow, insetRow, ...fields, saveRow ] );
		const presetsPane = el( 'div', { className: 'etk-pop__fields' }, [ pickerRow, pickerValue, pickerEmpty ] );

		// ---- Tabs ----

		let panel = null;
		const switchTo = ( next ) => {
			mode = next;
			stage.classList.toggle( 'is-presets', mode === 'presets' );
			customPane.hidden = mode !== 'custom';
			presetsPane.hidden = mode !== 'presets';
			if ( mode === 'presets' ) fillPresets();
			else paint();
			// The two panes are different heights.
			panel?.place();
		};
		const tabs = presets
			? el( 'fieldset', { className: 'etk-shadow__tabs etk-seg etk-seg--fill etk-track' }, [
					el( 'legend', { className: 'etk-sr', textContent: 'Shadow from' } ),
					...[
						[ 'presets', 'Presets' ],
						[ 'custom', 'Custom' ],
					].map( ( [ value, label ] ) => el( 'label', {}, [ el( 'input', { type: 'radio', name: 'etk-shadow-mode', value, checked: value === mode } ), el( 'span', { textContent: label } ) ] ) ),
			  ] )
			: null;
		tabs?.addEventListener( 'change', ( event ) => switchTo( event.target.value ) );

		if ( presets ) {
			fillTargets();
			fillPresets();
		}
		switchTo( mode );
		panel = editorPanel( {
			anchor: button,
			label: 'Box shadow',
			className: 'etk-shadow',
			content: [ tabs, stage, customPane, presets ? presetsPane : null, status ],
			focus: mode === 'presets' ? picker : inputOf( 'size' ),
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
