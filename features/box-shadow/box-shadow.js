/**
 * Etch Toolkit: box shadow.
 *
 * In CSS editors, every box-shadow gets a button right after its colon. It
 * opens a small panel that writes a layered shadow, soft and natural:
 *
 * - A card, and a light around it. Drag the light around the card to change
 *   where the shadow falls, further out for a bigger shadow. A press
 *   anywhere around the card moves the light there.
 * - A handle on a line above the card sets the number of layers. Up for more.
 * - The shadow's color, and its opacity.
 *
 * Each layer is twice as blurry as it is far, growing to the size you set,
 * and they add up to the opacity you set. A shadow it wrote opens with its
 * own values. Others open with what can be read from them, and are only
 * replaced once you change something.
 *
 * As with color mix, changes show in the code and on the canvas as you make
 * them, Esc or Cancel puts the shadow back, and Cmd+Z in the editor takes the
 * whole change back in one step.
 */
( () => {
	const { el, slider, cssText, editorWidgets, editorEdit, editorPanel, colorField, resolveColor, isColor } = window.etchToolkit || {};
	if ( ! editorWidgets ) return;
	const { splitTop, declarations } = cssText;

	const PROPERTY = /^box-shadow$/i;
	const LAYERS = { min: 1, max: 8, start: 5 };
	const SIZE = { min: 1, max: 64, start: 24 }; // The biggest layer's offset, in pixels.
	const OPACITY = 20; // Percent, to start.

	// The stage, in pixels: how far from the card's middle the light goes, and the layers line.
	const NEAR = 84; // Clear of the layers line.
	const FAR = 146;
	const CARD_TOP = 28; // The card's half height.
	const TRACK = { from: CARD_TOP + 8, length: 40 };

	const round = ( n ) => Math.round( n * 10 ) / 10;
	const half = ( n ) => Math.round( n * 2 ) / 2 + 0; // + 0 turns -0 into 0.
	const clamp = ( n, min, max ) => Math.min( max, Math.max( min, n ) );
	const px = ( n ) => ( n === 0 ? '0' : `${ n }px` );

	// Where the light is, as a compass point: 0 is the top, going clockwise.
	const SIDES = [ 'top', 'top right', 'right', 'bottom right', 'bottom', 'bottom left', 'left', 'top left' ];
	const side = ( angle ) => SIDES[ Math.round( ( ( angle % 360 ) + 360 ) % 360 / 45 ) % 8 ];

	// ---- Writing and reading a shadow ----

	/*
	 * The layers, smallest first. Offsets grow as a square, so there are more
	 * close, tight layers than far, soft ones. Together, layer over layer,
	 * they reach the opacity.
	 */
	const layers = ( { angle, size, count, opacity } ) => {
		const rad = ( angle * Math.PI ) / 180;
		const alpha = round( 100 * ( 1 - ( 1 - opacity / 100 ) ** ( 1 / count ) ) );
		return Array.from( { length: count }, ( _, i ) => {
			const offset = size * ( ( i + 1 ) / count ) ** 2;
			// Away from the light.
			return { x: half( -Math.sin( rad ) * offset ), y: half( Math.cos( rad ) * offset ), blur: half( offset * 2 ), alpha };
		} );
	};

	const compose = ( shadow, color, indent ) => {
		const list = layers( shadow ).map( ( l ) => `${ px( l.x ) } ${ px( l.y ) } ${ px( l.blur ) } color-mix(in srgb, ${ color } ${ l.alpha }%, transparent)` );
		return list.length === 1 ? ` ${ list[ 0 ] }` : list.map( ( layer ) => `\n${ indent }${ layer }` ).join( ',' );
	};

	const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/i;

	/*
	 * A shadow's values, best read: its number of layers, the biggest one's
	 * direction and offset, and the color. A color-mix() with transparent is
	 * a color at an opacity, one layer's, from which the whole's follows.
	 */
	const parse = ( value ) => {
		const found = { angle: 0, size: SIZE.start, count: LAYERS.start, opacity: OPACITY, color: 'black' };
		const list = splitTop( value.trim(), /,/ ).filter( Boolean );
		if ( ! list.length || /^none$/i.test( value.trim() ) ) return found;
		let far = null;
		let color = null;
		for ( const layer of list ) {
			const words = splitTop( layer, /\s/ );
			const lengths = words.filter( ( word ) => LENGTH.test( word ) ).map( parseFloat );
			color ??= words.find( ( word ) => ! LENGTH.test( word ) && ! /^inset$/i.test( word ) ) ?? null;
			if ( lengths.length < 2 ) continue;
			const [ x, y ] = lengths;
			if ( ! far || Math.hypot( x, y ) > Math.hypot( far.x, far.y ) ) far = { x, y };
		}
		found.count = clamp( list.length, LAYERS.min, LAYERS.max );
		if ( far && Math.hypot( far.x, far.y ) ) {
			found.size = clamp( Math.round( Math.hypot( far.x, far.y ) ), SIZE.min, SIZE.max );
			found.angle = Math.round( ( ( Math.atan2( -far.x, far.y ) * 180 ) / Math.PI + 360 ) % 360 );
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

		// ---- The stage: the card, the light and the layers line ----

		const card = el( 'div', { className: 'etk-shadow__card' } );
		const ray = el( 'div', { className: 'etk-shadow__ray' } );
		const light = el( 'div', { className: 'etk-shadow__light' } );
		const track = el( 'div', { className: 'etk-shadow__track' } );
		const knob = el( 'div', { className: 'etk-shadow__knob' } );
		const readout = el( 'div', { className: 'etk-shadow__readout' } );
		[ card, ray, light, track, knob, readout ].forEach( ( node ) => node.setAttribute( 'aria-hidden', 'true' ) );
		track.style.setProperty( '--etk-shadow-track-from', `${ TRACK.from }px` );
		track.style.setProperty( '--etk-shadow-track-length', `${ TRACK.length }px` );

		// The keyboard and screen readers get a slider for each, hidden, and the handle they move shows focus.
		const range = ( label, min, max, step, value, valuetext ) => {
			const input = el( 'input', { type: 'range', className: 'etk-sr', min, max, step, value, 'aria-label': label } );
			input.setAttribute( 'aria-valuetext', valuetext( value ) );
			input.addEventListener( 'input', () => input.setAttribute( 'aria-valuetext', valuetext( Number( input.value ) ) ) );
			return input;
		};
		const direction = range( 'Light direction', 0, 355, 5, Math.round( shadow.angle / 5 ) * 5 % 360, ( v ) => `From the ${ side( v ) }, ${ v } degrees` );
		const size = range( 'Shadow size', SIZE.min, SIZE.max, 1, shadow.size, ( v ) => `${ v } pixels` );
		const count = range( 'Shadow layers', LAYERS.min, LAYERS.max, 1, shadow.count, ( v ) => `${ v } ${ v === 1 ? 'layer' : 'layers' }` );
		direction.classList.add( 'etk-shadow__for-light' );
		size.classList.add( 'etk-shadow__for-light' );
		count.classList.add( 'etk-shadow__for-knob' );

		const stage = el( 'div', { className: 'etk-shadow__stage' }, [ ray, track, card, light, knob, readout, direction, size, count ] );

		// Where each handle sits, from the stage's middle.
		const at = ( node, x, y ) => ( node.style.translate = `${ x }px ${ y }px` );
		const radius = () => NEAR + ( ( shadow.size - SIZE.min ) / ( SIZE.max - SIZE.min ) ) * ( FAR - NEAR );
		const knobY = () => -TRACK.from - ( ( shadow.count - LAYERS.min ) / ( LAYERS.max - LAYERS.min ) ) * TRACK.length;

		// The stage shows the real color, which lives on the canvas.
		let shown = resolveColor( color.trim() ) || 'transparent';
		const paint = () => {
			const rad = ( shadow.angle * Math.PI ) / 180;
			const r = radius();
			at( light, Math.sin( rad ) * r, -Math.cos( rad ) * r );
			ray.style.rotate = `${ shadow.angle }deg`;
			ray.style.setProperty( '--etk-shadow-ray', `${ r }px` );
			at( knob, 0, knobY() );
			card.style.boxShadow = layers( shadow )
				.map( ( l ) => `${ l.x }px ${ l.y }px ${ l.blur }px color-mix(in srgb, ${ shown } ${ l.alpha }%, transparent)` )
				.join( ', ' );
			readout.textContent = `${ shadow.size }px · ${ shadow.count } ${ shadow.count === 1 ? 'layer' : 'layers' }`;
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

		const set = ( changes ) => {
			Object.assign( shadow, changes );
			direction.value = shadow.angle;
			size.value = shadow.size;
			count.value = shadow.count;
			for ( const input of [ direction, size, count ] ) input.dispatchEvent( new Event( 'input' ) );
			update();
		};
		direction.addEventListener( 'change', () => set( { angle: Number( direction.value ) } ) );
		size.addEventListener( 'change', () => set( { size: Number( size.value ) } ) );
		count.addEventListener( 'change', () => set( { count: Number( count.value ) } ) );

		/*
		 * A press on the layers handle drags it up and down the line. A press
		 * anywhere else moves the light there and drags it: its angle round
		 * the card is the direction, its distance the size.
		 */
		let press = null;
		const middle = () => {
			const r = stage.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		};
		const move = ( event ) => {
			const m = middle();
			const dx = event.clientX - m.x;
			const dy = event.clientY - m.y;
			if ( press.knob ) {
				const along = ( -dy - TRACK.from ) / TRACK.length;
				set( { count: clamp( Math.round( LAYERS.min + along * ( LAYERS.max - LAYERS.min ) ), LAYERS.min, LAYERS.max ) } );
				return;
			}
			// In the keyboard's steps.
			const angle = ( Math.round( ( ( Math.atan2( dx, -dy ) * 180 ) / Math.PI + 360 ) / 5 ) * 5 ) % 360;
			const out = ( clamp( Math.hypot( dx, dy ), NEAR, FAR ) - NEAR ) / ( FAR - NEAR );
			set( { angle, size: Math.round( SIZE.min + out * ( SIZE.max - SIZE.min ) ) } );
		};
		stage.addEventListener( 'pointerdown', ( event ) => {
			if ( event.button !== 0 ) return;
			event.preventDefault();
			stage.setPointerCapture( event.pointerId );
			press = { id: event.pointerId, knob: event.target === knob };
			stage.classList.add( press.knob ? 'is-layering' : 'is-lighting' );
			( press.knob ? count : direction ).focus( { preventScroll: true } );
			move( event );
		} );
		stage.addEventListener( 'pointermove', ( event ) => event.pointerId === press?.id && move( event ) );
		const release = ( event ) => {
			if ( event.pointerId !== press?.id ) return;
			press = null;
			stage.classList.remove( 'is-layering', 'is-lighting' );
		};
		stage.addEventListener( 'pointerup', release );
		stage.addEventListener( 'pointercancel', release );

		// ---- Color ----

		const colorRow = colorField( {
			id: 'etk-shadow-color',
			label: 'Color',
			value: color,
			oninput: ( value ) => {
				color = value;
				shown = resolveColor( color.trim() ) || 'transparent';
				update();
			},
		} );
		const opacity = slider( {
			name: 'Opacity',
			min: 0,
			max: 100,
			value: shadow.opacity,
			text: ( v ) => `${ v }%`,
			onchange: ( v ) => {
				shadow.opacity = v;
				update();
			},
		} );

		paint();
		editorPanel( {
			anchor: button,
			label: 'Box shadow',
			className: 'etk-shadow',
			content: [ stage, el( 'div', { className: 'etk-pop__fields' }, [ colorRow, opacity ] ) ],
			focus: direction,
			onclose: ( keep ) => {
				cancelAnimationFrame( writing );
				// A change still waiting on its frame.
				if ( writing && keep && isColor( color ) ) edit.set( compose( shadow, color.trim(), indent ) );
				writing = 0;
				edit.finish( keep );
			},
		} );
	};
} )();
