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
 * puts the color back, Done, Enter or a click outside keeps it. The previews
 * stay out of the editor's undo history, so Cmd+Z in the editor takes the
 * whole change back in one step. Etch's own undo can't be held off from
 * outside, so it may keep a step for each pause.
 *
 * Etch's CSS editors are CodeMirror views, reached from their DOM. The
 * swatches are CodeMirror widgets, added to each editor as it appears.
 */
( () => {
	const { el, slider } = window.etchToolkit || {};
	if ( ! el || ! slider ) return;

	const EDITOR = '.etch-css-editor .cm-editor';
	const CANVAS = '#etch-iframe';
	const LIST = 'etk-mix-colors';
	// Etch's own variables, which the canvas has for its UI.
	const ETCH_SHEET = 'etch-default-iframe-styles';

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

	const viewOf = ( editor ) => editor?.querySelector( '.cm-content' )?.cmTile?.root?.view || null;
	const canvas = () => document.querySelector( CANVAS )?.contentDocument || null;

	/*
	 * Colors resolve on the canvas, where the site's variables are. The probe
	 * sits in a box with an unlikely color, so a var() that doesn't resolve,
	 * which leaves the probe on its parent's color, reads as null.
	 */
	const SENTINEL = 'rgb(1, 2, 3)';
	let probe = null;
	const resolve = ( value ) => {
		const doc = canvas();
		if ( ! doc?.body || ! value ) return null;
		if ( ! probe?.isConnected || probe.ownerDocument !== doc ) {
			const box = doc.createElement( 'div' );
			box.setAttribute( 'aria-hidden', 'true' );
			box.style.cssText = 'position:absolute;inset:0 auto auto 0;visibility:hidden;pointer-events:none';
			probe = doc.createElement( 'span' );
			box.append( probe );
			doc.body.append( box );
		}
		const view = doc.defaultView;
		// currentColor is the parent's color, so there it's the page's text color.
		const current = /currentcolor/i.test( value );
		probe.parentElement.style.color = current ? view.getComputedStyle( doc.body ).color : SENTINEL;
		probe.style.color = '';
		probe.style.setProperty( 'color', value );
		if ( ! probe.style.color ) return null;
		const color = view.getComputedStyle( probe ).color;
		return color === SENTINEL && ! current ? null : color;
	};

	const named = new Map();
	const isNamedColor = ( word ) => {
		const key = word.toLowerCase();
		if ( KEYWORDS.has( key ) ) return false;
		if ( ! named.has( key ) ) named.set( key, CSS.supports( 'color', key ) );
		return named.get( key );
	};

	// ---- Reading the CSS ----

	// The index of a string's closing quote, or the end.
	const stringEnd = ( text, i ) => {
		const quote = text[ i ];
		for ( i++; i < text.length; i++ ) {
			if ( text[ i ] === '\\' ) i++;
			else if ( text[ i ] === quote || text[ i ] === '\n' ) return i;
		}
		return text.length;
	};

	const commentEnd = ( text, i ) => {
		const end = text.indexOf( '*/', i + 2 );
		return end < 0 ? text.length : end + 1;
	};

	// The index of the `)` that closes the `(` at i. An unclosed one, while
	// you're typing, stops before the next `;`, `{` or `}`.
	const parenEnd = ( text, i, to = text.length ) => {
		let depth = 0;
		for ( ; i < to; i++ ) {
			const c = text[ i ];
			if ( c === '"' || c === "'" ) i = stringEnd( text, i );
			else if ( c === '/' && text[ i + 1 ] === '*' ) i = commentEnd( text, i );
			else if ( c === '(' ) depth++;
			else if ( c === ')' && --depth === 0 ) return i;
			else if ( c === ';' || c === '{' || c === '}' ) return i - 1;
		}
		return to - 1;
	};

	const IDENT = /(?:--|-?[a-zA-Z_])[\w-]*/y;
	const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-zA-Z%]*/iy;
	const HEX = /#[0-9a-fA-F]+(?![\w-])/y;
	const PROPERTY = /^(?:\s|\/\*[^]*?\*\/)*(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:/;

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

	/*
	 * Every color in a style's CSS, with its declaration's property. It goes
	 * through the text a statement at a time: what ends in `;` or `}` can be a
	 * declaration, what ends in `{` is a selector or an at-rule.
	 */
	const colorsInCss = ( text ) => {
		const found = [];
		const statement = ( from, to ) => {
			const property = PROPERTY.exec( text.slice( from, to ) );
			if ( ! property ) return;
			const colors = [];
			colorsIn( text, from + property[ 0 ].length, to, property[ 1 ], colors );
			colors.forEach( ( color ) => found.push( { ...color, property: property[ 1 ] } ) );
		};
		let start = 0;
		for ( let i = 0; i < text.length; i++ ) {
			const c = text[ i ];
			if ( c === '"' || c === "'" ) i = stringEnd( text, i );
			else if ( c === '/' && text[ i + 1 ] === '*' ) i = commentEnd( text, i );
			else if ( c === '(' ) i = parenEnd( text, i );
			else if ( c === '{' ) start = i + 1;
			else if ( c === ';' || c === '}' ) {
				statement( start, i );
				start = i + 1;
			}
		}
		statement( start, text.length );
		return found;
	};


	// Resolved again after a few seconds, in case the site's variables changed.
	const resolvedCache = new Map();
	let resolvedAt = 0;
	const resolveCached = ( value ) => {
		if ( Date.now() - resolvedAt > 3000 ) {
			resolvedCache.clear();
			resolvedAt = Date.now();
		}
		if ( ! resolvedCache.has( value ) ) resolvedCache.set( value, resolve( value ) );
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


	// Splits at a separator outside parentheses and strings.
	const splitTop = ( text, separator ) => {
		const parts = [];
		let depth = 0;
		let start = 0;
		for ( let i = 0; i < text.length; i++ ) {
			const c = text[ i ];
			if ( c === '"' || c === "'" ) i = stringEnd( text, i );
			else if ( c === '(' ) depth++;
			else if ( c === ')' ) depth--;
			else if ( depth === 0 && separator.test( c ) ) {
				parts.push( text.slice( start, i ) );
				start = i + 1;
			}
		}
		parts.push( text.slice( start ) );
		return parts.map( ( part ) => part.trim() ).filter( ( part, i, all ) => part || all.length === 1 );
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

	// Custom properties the site sets on :root, html or body that hold a color, as var()s.
	const siteColors = () => {
		const doc = canvas();
		if ( ! doc ) return [];
		const names = new Set();
		const walk = ( rules ) => {
			for ( const rule of rules ) {
				if ( rule.style && rule.selectorText && rule.selectorText.split( ',' ).some( ( s ) => /^(?::root|html|body|:where\(:root\))$/.test( s.trim() ) ) ) {
					for ( const name of rule.style ) if ( name.startsWith( '--' ) ) names.add( name );
				}
				if ( rule.cssRules ) walk( rule.cssRules );
			}
		};
		for ( const sheet of doc.styleSheets ) {
			if ( sheet.ownerNode?.id === ETCH_SHEET ) continue;
			try {
				walk( sheet.cssRules );
			} catch {}
		}
		const root = doc.defaultView.getComputedStyle( doc.documentElement );
		return [ ...names ]
			.filter( ( name ) => CSS.supports( 'color', root.getPropertyValue( name ).trim() ) )
			.sort()
			.map( ( name ) => `var(${ name })` );
	};


	// ---- Swatches ----

	/*
	 * CodeMirror's classes, from Etch's copy, which it doesn't expose:
	 * EditorView is a view's constructor, StateEffect an effect's, and
	 * Decoration the parent class of a syntax highlight's mark. Found once an
	 * editor has highlighted text.
	 */
	let cm = null;
	const codemirror = ( view ) => {
		if ( cm ) return cm;
		const mark = [ ...document.querySelectorAll( '.cm-line span' ) ].map( ( span ) => span.cmTile?.mark ).find( Boolean );
		const Decoration = mark && Object.getPrototypeOf( mark.constructor );
		const EditorView = view.constructor;
		const StateEffect = EditorView.scrollIntoView?.( 0 )?.constructor;
		if ( typeof Decoration?.widget !== 'function' || ! EditorView.decorations || ! StateEffect?.appendConfig ) return null;
		cm = { EditorView, StateEffect, Decoration };
		return cm;
	};

	// The swatch before a color. Shaped like CodeMirror's WidgetType, which isn't exposed either.
	class Swatch {
		constructor( text, color ) {
			this.text = text;
			this.color = color;
		}

		eq( other ) {
			return other.text === this.text && other.color === this.color;
		}

		compare( other ) {
			return this === other || ( this.constructor === other.constructor && this.eq( other ) );
		}

		toDOM( view ) {
			const button = el( 'button', { type: 'button', className: 'etk-mix-swatch', title: `Mix ${ this.text }` } );
			button.setAttribute( 'aria-label', `Mix ${ this.text }` );
			if ( this.color ) button.style.setProperty( '--etk-mix-color', this.color );
			// Keep the press from moving the editor's cursor.
			button.addEventListener( 'mousedown', ( event ) => event.preventDefault() );
			button.addEventListener( 'click', () => open( view, button ) );
			return button;
		}

		updateDOM() {
			return false;
		}

		get estimatedHeight() {
			return -1;
		}

		get lineBreaks() {
			return 0;
		}

		ignoreEvent() {
			return true;
		}

		coordsAt() {
			return null;
		}

		get isHidden() {
			return false;
		}

		get editable() {
			return false;
		}

		destroy() {}
	}

	const decorated = new WeakMap();
	const swatches = ( view ) => {
		const doc = view.state.doc;
		if ( ! decorated.has( doc ) ) {
			const { Decoration } = cm;
			const ranges = colorsInDoc( doc ).map( ( found ) => Decoration.widget( { widget: new Swatch( found.text, found.color ), side: -1 } ).range( found.from ) );
			decorated.set( doc, Decoration.set( ranges, true ) );
		}
		return decorated.get( doc );
	};

	// Etch builds and rebuilds its editors, so each one gets the swatches whenever it shows up without them.
	const install = () => {
		for ( const editor of document.querySelectorAll( EDITOR ) ) {
			const view = viewOf( editor );
			if ( ! view || ! codemirror( view ) ) continue;
			const { EditorView, StateEffect } = cm;
			if ( ! view.state.facet( EditorView.decorations ).includes( swatches ) ) {
				view.dispatch( { effects: StateEffect.appendConfig.of( EditorView.decorations.of( swatches ) ) } );
			}
		}
	};
	let queued = 0;
	new MutationObserver( () => {
		queued ||= requestAnimationFrame( () => {
			queued = 0;
			install();
		} );
	} ).observe( document.body, { childList: true, subtree: true } );

	// ---- Panel ----

	let session = null; // The open panel
	const isClear = ( value ) => /^transparent$/i.test( value.trim() );
	const isColor = ( value ) => value.trim() !== '' && CSS.supports( 'color', value.trim() );

	// A text field for a color, with a swatch of it. Empty isn't wrong, just not ready.
	const colorField = ( { id, label, value, placeholder = '', oninput } ) => {
		const swatch = el( 'span', { className: 'etk-mix-swatch etk-mix-swatch--field' } );
		swatch.setAttribute( 'aria-hidden', 'true' );
		const input = el( 'input', { type: 'text', id, value, placeholder, spellcheck: false, autocomplete: 'off' } );
		input.setAttribute( 'list', LIST );
		const paint = () => {
			swatch.style.setProperty( '--etk-mix-color', resolve( input.value.trim() ) || 'transparent' );
			// var()s pass at parse time, so only typos show.
			input.setAttribute( 'aria-invalid', String( input.value.trim() !== '' && ! isColor( input.value ) ) );
		};
		input.addEventListener( 'input', () => {
			paint();
			oninput( input.value );
		} );
		paint();
		return el( 'div', { className: 'etk-mix__row' }, [ el( 'label', { htmlFor: id, textContent: label } ), el( 'div', { className: 'etk-mix__input' }, [ swatch, input ] ) ] );
	};

	const open = ( view, button ) => {
		if ( session ) return;
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

		// Transactions carry the annotations that keep previews out of the undo history.
		const Transaction = view.state.update( {} ).constructor;
		const preview = Transaction.addToHistory.of( false );
		let current = original;
		const write = ( text, annotations ) => {
			if ( ! view.dom.isConnected ) return;
			view.dispatch( { changes: { from, to: from + current.length, insert: text }, annotations } );
			current = text;
		};

		const compose = () => {
			const second = mode === 'transparent' ? 'transparent' : other;
			if ( ! isColor( color ) || ! isColor( second ) ) return null;
			const method = space + ( POLAR.has( space ) && hue ? ` ${ hue }` : '' );
			return `color-mix(in ${ method }, ${ color.trim() } ${ amount }%, ${ second.trim() })`;
		};

		const result = el( 'div', { className: 'etk-mix__result' } );
		result.setAttribute( 'aria-hidden', 'true' );
		const update = () => {
			const text = compose();
			result.style.setProperty( '--etk-mix-color', resolve( text ?? current ) || 'transparent' );
			if ( text && text !== current ) write( text, preview );
		};

		const modes = el( 'fieldset', { className: 'etk-mix__modes etk-track' }, [
			el( 'legend', { className: 'etk-mix__hidden', textContent: 'Mix with' } ),
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
		const spaceRow = el( 'div', { className: 'etk-mix__row' }, [ el( 'label', { htmlFor: 'etk-mix-space', textContent: 'Space' } ), el( 'div', { className: 'etk-mix__select' }, [ spaceSelect ] ) ] );

		// Transparent: the color and its opacity. Two colors: both, a balance between them, and the space they mix in.
		const fields = el( 'div', { className: 'etk-mix__fields' } );
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
		result.style.setProperty( '--etk-mix-color', resolve( original ) || 'transparent' );

		const datalist = el(
			'datalist',
			{ id: LIST },
			[ 'white', 'black', 'currentColor', ...siteColors() ].map( ( value ) => el( 'option', { value } ) )
		);
		const cancel = el( 'button', { type: 'button', className: 'etk-confirm__btn etk-confirm__btn--cancel', textContent: 'Cancel' } );
		const done = el( 'button', { type: 'button', className: 'etk-confirm__btn etk-confirm__btn--primary', textContent: 'Done' } );
		const dialog = el( 'dialog', { className: 'etk-mix' }, [ modes, result, fields, el( 'div', { className: 'etk-mix__actions' }, [ cancel, done ] ), datalist ] );
		dialog.setAttribute( 'aria-label', 'Color mix' );

		const close = ( keep ) => {
			if ( session !== dialog ) return;
			session = null;
			const final = current;
			if ( final !== original ) {
				write( original, preview );
				if ( keep ) write( final, Transaction.userEvent.of( 'input' ) );
			}
			dialog.close();
			dialog.remove();
			if ( view.dom.isConnected ) view.focus();
		};

		cancel.addEventListener( 'click', () => close( false ) );
		done.addEventListener( 'click', () => close( true ) );
		// Esc puts it back.
		dialog.addEventListener( 'cancel', ( event ) => {
			event.preventDefault();
			close( false );
		} );
		// A click outside keeps it.
		dialog.addEventListener( 'click', ( event ) => {
			if ( event.target !== dialog ) return;
			const r = dialog.getBoundingClientRect();
			if ( event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom ) close( true );
		} );
		for ( const type of [ 'keydown', 'keyup' ] ) {
			dialog.addEventListener( type, ( event ) => {
				if ( type === 'keydown' && event.key === 'Enter' && event.target.matches( 'input:not([type="radio"])' ) ) {
					event.preventDefault();
					close( true );
				}
				// Etch's shortcuts, Esc included, stay out of it while you type here.
				event.stopPropagation();
			} );
		}

		const at = button.getBoundingClientRect();
		session = dialog;
		document.body.append( dialog );
		dialog.showModal();

		// Below the swatch, or above it where there's no room, left edges lined up.
		const gap = 8;
		const edge = 16;
		const { offsetWidth: width, offsetHeight: height } = dialog;
		const left = Math.min( Math.max( edge, at.left ), window.innerWidth - width - edge );
		const below = at.bottom + gap;
		const top = below + height <= window.innerHeight - edge ? below : Math.max( edge, at.top - gap - height );
		dialog.style.left = `${ left }px`;
		dialog.style.top = `${ top }px`;
		const input = dialog.querySelector( '#etk-mix-color' );
		input.focus();
		input.select();
	};
} )();
