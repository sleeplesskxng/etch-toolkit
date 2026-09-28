/**
 * Etch Toolkit: color mix.
 *
 * In CSS editors, every color gets a swatch right before it, the way
 * Chrome's DevTools show them: hex, color functions, named colors, and
 * var()s that hold a color. A swatch opens a small panel that wraps the
 * color in color-mix(), in one of two modes:
 *
 * - Transparent: the color, and a slider for its opacity.
 * - Two colors: the color and another, a slider for which is stronger, and
 *   the space they mix in.
 *
 * A color-mix() opens with its own values, in the mode that fits it.
 *
 * Changes show in the code and on the canvas as you make them. Esc or Cancel
 * puts the color back, Done, Enter or a click outside keeps it. Only what's
 * kept reaches Etch, as one step of its undo history and the editor's, so
 * one Cmd+Z takes the whole change back.
 */
( () => {
	const { el, slider, cssText, editorWidgets, editorEdit, editorPanel, colorField, resolveColor, isColor } = window.etchToolkit || {};
	if ( ! editorWidgets ) return;
	const { stringEnd, commentEnd, parenEnd, splitTop, declarations } = cssText;

	const SPACES = [ 'oklch', 'oklab', 'srgb', 'lab', 'lch', 'hsl', 'hwb', 'srgb-linear', 'display-p3', 'xyz' ];
	const POLAR = new Set( [ 'oklch', 'lch', 'hsl', 'hwb' ] );
	const COLOR_FUNCTIONS = new Set( [ 'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark' ] );
	// Functions whose insides aren't colors.
	const OPAQUE_FUNCTIONS = new Set( [ 'url', 'env', 'attr', 'format', 'local', 'counter', 'counters' ] );
	// A var() that doesn't resolve on the canvas still counts as a color here.
	const COLOR_PROPERTY = /^(?:color|background-color|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-color|outline-color|text-decoration-color|text-emphasis-color|column-rule-color|caret-color|accent-color|fill|stroke|stop-color|flood-color|lighting-color)$/i;
	// Here a word like `red` is a name, not a color.
	const NAMES_PROPERTY = /^(?:transition|transition-property|will-change|animation|animation-name|font|font-family|grid|grid-template|grid-template-areas|grid-area|content|container|container-name|view-transition-name|anchor-name|position-anchor|counter-reset|counter-increment|counter-set|list-style|list-style-type)$/i;
	const KEYWORDS = new Set( [ 'inherit', 'initial', 'unset', 'revert', 'revert-layer' ] );

	const named = new Map();
	const isNamedColor = ( word ) => {
		const key = word.toLowerCase();
		if ( KEYWORDS.has( key ) ) return false;
		if ( ! named.has( key ) ) named.set( key, CSS.supports( 'color', key ) );
		return named.get( key );
	};

	// ---- Reading the CSS ----

	const IDENT = /(?:--|-?[a-zA-Z_])[\w-]*/y;
	const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-zA-Z%]*/iy;
	const HEX = /#[0-9a-fA-F]+(?![\w-])/y;

	/*
	 * Colors in text[ from, to ), a declaration's value, as { from, to, var }.
	 * A var() is only a color if it resolves to one, checked later. Other
	 * functions, like gradients and shadows, are searched inside.
	 */
	const colorsIn = ( text, from, to, property, found ) => {
		for ( let i = from; i < to;  ) {
			const c = text[ i ];
			if ( c === '"' || c === "'" ) {
				i = stringEnd( text, i ) + 1;
				continue;
			}
			if ( c === '/' && text[ i + 1 ] === '*' ) {
				i = commentEnd( text, i ) + 1;
				continue;
			}
			if ( c === '#' ) {
				HEX.lastIndex = i;
				const hex = HEX.exec( text )?.[ 0 ];
				if ( hex && [ 4, 5, 7, 9 ].includes( hex.length ) && i + hex.length <= to ) found.push( { from: i, to: i + hex.length } );
				i += hex?.length || 1;
				continue;
			}
			NUMBER.lastIndex = i;
			const number = /[\d.+-]/.test( c ) && NUMBER.exec( text )?.[ 0 ];
			if ( number ) {
				i += number.length;
				continue;
			}
			IDENT.lastIndex = i;
			const word = IDENT.exec( text )?.[ 0 ];
			if ( ! word ) {
				i++;
				continue;
			}
			const after = i + word.length;
			if ( text[ after ] === '(' ) {
				const end = Math.min( parenEnd( text, after, to ), to - 1 );
				const fn = word.toLowerCase();
				if ( COLOR_FUNCTIONS.has( fn ) ) found.push( { from: i, to: end + 1 } );
				else if ( fn === 'var' ) found.push( { from: i, to: end + 1, var: true } );
				else if ( ! OPAQUE_FUNCTIONS.has( fn ) ) colorsIn( text, after + 1, end, property, found );
				i = end + 1;
				continue;
			}
			if ( ! NAMES_PROPERTY.test( property ) && isNamedColor( word ) ) found.push( { from: i, to: after } );
			i = after;
		}
	};

	// Every color in a style's CSS, with its declaration's property.
	const colorsInCss = ( text ) =>
		declarations( text ).flatMap( ( { property, from, to } ) => {
			const colors = [];
			colorsIn( text, from, to, property, colors );
			return colors.map( ( color ) => ( { ...color, property } ) );
		} );

	// Resolved again after a few seconds, in case the site's variables changed.
	const resolvedCache = new Map();
	let resolvedAt = 0;
	const resolveCached = ( value ) => {
		if ( Date.now() - resolvedAt > 3000 ) {
			resolvedCache.clear();
			resolvedAt = Date.now();
		}
		if ( ! resolvedCache.has( value ) ) resolvedCache.set( value, resolveColor( value ) );
		return resolvedCache.get( value );
	};

	// The colors in a document, as { from, to, text, color }. Once per version of it.
	const parsed = new WeakMap();
	const colorsInDoc = ( doc ) => {
		if ( ! parsed.has( doc ) ) {
			const colors = colorsInCss( doc.toString() )
				.map( ( found ) => {
					const text = doc.sliceString( found.from, found.to );
					return { ...found, text, color: resolveCached( text ) };
				} )
				.filter( ( found ) => ! found.var || found.color || COLOR_PROPERTY.test( found.property ) );
			parsed.set( doc, colors );
		}
		return parsed.get( doc );
	};

	// A color-mix()'s parts, or null for anything else.
	const parseMix = ( text ) => {
		const inner = /^color-mix\(([^]*)\)$/i.exec( text.trim() )?.[ 1 ];
		if ( inner === undefined ) return null;
		const args = splitTop( inner, /,/ );
		const method = /^in\s+([\w-]+)(?:\s+((?:shorter|longer|increasing|decreasing)\s+hue))?$/i.exec( args[ 0 ] || '' );
		if ( args.length !== 3 || ! method ) return null;
		const part = ( arg ) => {
			const words = splitTop( arg, /\s/ );
			const at = words.findIndex( ( word ) => /^(?:\d+\.?\d*|\.\d+)%$/.test( word ) );
			const pct = at < 0 ? null : parseFloat( words.splice( at, 1 )[ 0 ] );
			return { color: words.join( ' ' ), pct };
		};
		const a = part( args[ 1 ] );
		const b = part( args[ 2 ] );
		const amount = a.pct ?? ( b.pct === null ? 50 : 100 - b.pct );
		return { base: a.color, other: b.color, amount: Math.round( Math.min( 100, Math.max( 0, amount ) ) ), space: method[ 1 ].toLowerCase(), hue: method[ 2 ] || '' };
	};

	// ---- Swatches ----

	editorWidgets( ( doc ) =>
		colorsInDoc( doc ).map( ( found ) => ( {
			at: found.from,
			key: `${ found.text } ${ found.color }`,
			render: ( view ) => {
				const button = el( 'button', { type: 'button', className: 'etk-swatch', title: `Mix ${ found.text }`, 'aria-label': `Mix ${ found.text }` } );
				if ( found.color ) button.style.setProperty( '--etk-swatch-color', found.color );
				// Keep the press from moving the editor's cursor.
				button.addEventListener( 'mousedown', ( event ) => event.preventDefault() );
				button.addEventListener( 'click', () => open( view, button ) );
				return button;
			},
		} ) )
	);

	// ---- Panel ----

	const isClear = ( value ) => /^transparent$/i.test( value.trim() );

	const open = ( view, button ) => {
		const from = view.posAtDOM( button );
		const token = colorsInDoc( view.state.doc ).find( ( found ) => found.from === from );
		if ( ! token ) return;

		/*
		 * Mixed with transparent, either way round, is one color at some
		 * opacity. Anything else mixed is two colors. A plain color starts
		 * with transparent.
		 */
		const original = token.text;
		const mix = parseMix( original );
		let mode = 'transparent';
		let color = original;
		let other = '';
		let amount = 70; // Percent of the first color
		if ( mix && isClear( mix.other ) ) {
			color = mix.base;
			amount = mix.amount;
		} else if ( mix && isClear( mix.base ) ) {
			color = mix.other;
			amount = 100 - mix.amount;
		} else if ( mix ) {
			mode = 'two';
			color = mix.base;
			other = mix.other;
			amount = mix.amount;
		}
		let space = mix?.space || 'oklch';
		const hue = mix?.hue || '';

		const edit = editorEdit( view, from, original );

		const compose = () => {
			const second = mode === 'transparent' ? 'transparent' : other;
			if ( ! isColor( color ) || ! isColor( second ) ) return null;
			const method = space + ( POLAR.has( space ) && hue ? ` ${ hue }` : '' );
			return `color-mix(in ${ method }, ${ color.trim() } ${ amount }%, ${ second.trim() })`;
		};

		const result = el( 'div', { className: 'etk-mix__result', 'aria-hidden': 'true' } );
		const update = () => {
			const text = compose();
			result.style.setProperty( '--etk-swatch-color', resolveColor( text ?? edit.text() ) || 'transparent' );
			if ( text ) edit.set( text );
		};

		const modes = el( 'fieldset', { className: 'etk-mix__modes etk-seg etk-seg--fill etk-track' }, [
			el( 'legend', { className: 'etk-sr', textContent: 'Mix with' } ),
			...[
				[ 'transparent', 'Transparent' ],
				[ 'two', 'Two colors' ],
			].map( ( [ value, label ] ) => el( 'label', {}, [ el( 'input', { type: 'radio', name: 'etk-mix-mode', value, checked: value === mode } ), el( 'span', { textContent: label } ) ] ) ),
		] );

		const spaceSelect = el(
			'select',
			{ id: 'etk-mix-space' },
			[ ...new Set( [ ...SPACES, space ] ) ].map( ( value ) => el( 'option', { value, textContent: value, selected: value === space } ) )
		);
		spaceSelect.addEventListener( 'change', () => {
			space = spaceSelect.value;
			update();
		} );
		const spaceRow = el( 'div', { className: 'etk-pop__row' }, [ el( 'label', { htmlFor: 'etk-mix-space', textContent: 'Space' } ), el( 'div', { className: 'etk-pop__select' }, [ spaceSelect ] ) ] );

		// Transparent: the color and its opacity. Two colors: both, a balance between them, and the space they mix in.
		const fields = el( 'div', { className: 'etk-pop__fields' } );
		const render = () => {
			const first = colorField( {
				id: 'etk-mix-color',
				label: 'Color',
				value: color,
				oninput: ( value ) => {
					color = value;
					update();
				},
			} );
			if ( mode === 'transparent' ) {
				const opacity = slider( {
					name: 'Opacity',
					min: 0,
					max: 100,
					value: amount,
					text: ( v ) => `${ v }%`,
					onchange: ( v ) => {
						amount = v;
						update();
					},
				} );
				fields.replaceChildren( first, opacity );
				return;
			}
			const second = colorField( {
				id: 'etk-mix-with',
				label: 'With',
				value: other,
				placeholder: 'Second color',
				oninput: ( value ) => {
					other = value;
					update();
				},
			} );
			// Further right, more of the second color.
			const balance = slider( {
				name: 'Balance',
				label: 'Balance between the colors',
				min: 0,
				max: 100,
				value: 100 - amount,
				text: ( v ) => `${ 100 - v } / ${ v }`,
				spoken: ( v ) => `${ 100 - v }% color, ${ v }% with`,
				onchange: ( v ) => {
					amount = 100 - v;
					update();
				},
			} );
			fields.replaceChildren( first, second, balance, spaceRow );
		};
		modes.addEventListener( 'change', ( event ) => {
			mode = event.target.value;
			render();
			update();
		} );
		render();
		result.style.setProperty( '--etk-swatch-color', resolveColor( original ) || 'transparent' );

		editorPanel( {
			anchor: button,
			label: 'Color mix',
			className: 'etk-mix',
			content: [ modes, result, fields ],
			focus: fields.querySelector( '#etk-mix-color' ),
			onclose: ( keep ) => edit.finish( keep ),
		} );
	};
} )();
