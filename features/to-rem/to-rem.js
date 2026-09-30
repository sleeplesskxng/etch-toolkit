/**
 * Etch Toolkit: to rem.
 *
 * In CSS editors, every top-level px value gets a button right before it:
 * in declarations, variables and media queries alike. A click wraps it in
 * to-rem(), so 60px becomes to-rem(60px), which Etch writes as rem.
 *
 * Only what Etch converts gets one: a plain number and px, lowercase. Not
 * inside a function, like calc() or a to-rem() already, where a button
 * would split the expression. Not in comments or strings, and not 0px.
 *
 * The change reaches Etch as one step of its undo history and the editor's,
 * so one Cmd+Z takes it back.
 *
 * Typing it works too: tr80, then a space, `;`, `,`, `)`, Enter or Tab,
 * becomes to-rem(80px).
 */
( () => {
	const { el, icon, cssText, editorWidgets, editorViewAt, editorEdit } = window.etchToolkit || {};
	if ( ! editorWidgets ) return;
	const { stringEnd, commentEnd, parenEnd, declarations } = cssText;

	const IDENT = /(?:--|-?[a-zA-Z_])[\w-]*/y;
	const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-zA-Z%]*/iy;
	// What Etch's to-rem() takes: to-rem\(\s*(-?[\d.]+)\s*px\s*\).
	const PX = /^-?(?:\d+\.?\d*|\.\d+)px$/;

	// The px values in a style's CSS, as { from, to }.
	const pxIn = ( text ) => {
		const found = [];
		for ( let i = 0; i < text.length;  ) {
			const c = text[ i ];
			if ( c === '"' || c === "'" ) {
				i = stringEnd( text, i ) + 1;
				continue;
			}
			if ( c === '/' && text[ i + 1 ] === '*' ) {
				i = commentEnd( text, i ) + 1;
				continue;
			}
			// A hex color, an id, an at-rule's name or an escape: never a value.
			if ( c === '#' || c === '@' || c === '\\' ) {
				i += 1 + ( /^[\w-]*/.exec( text.slice( i + 1, i + 64 ) )?.[ 0 ].length || 0 );
				continue;
			}
			NUMBER.lastIndex = i;
			const number = /[\d.+-]/.test( c ) && NUMBER.exec( text )?.[ 0 ];
			if ( number ) {
				if ( PX.test( number ) && parseFloat( number ) !== 0 ) found.push( { from: i, to: i + number.length } );
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
			// A function: its insides are left alone.
			if ( text[ after ] === '(' ) {
				i = parenEnd( text, after ) + 1;
				continue;
			}
			i = after;
		}
		return found;
	};

	// Once per version of a document.
	const parsed = new WeakMap();
	const pxInDoc = ( doc ) => {
		if ( ! parsed.has( doc ) ) parsed.set( doc, pxIn( doc.toString() ).map( ( found ) => ( { ...found, text: doc.sliceString( found.from, found.to ) } ) ) );
		return parsed.get( doc );
	};

	editorWidgets( ( doc ) =>
		pxInDoc( doc ).map( ( found ) => ( {
			at: found.from,
			key: 'rem',
			render: ( view ) => {
				const button = el( 'button', { type: 'button', className: 'etk-rem-button', html: icon( 'magic-wand', { size: 12 } ), title: `Convert ${ found.text } to rem`, 'aria-label': `Convert ${ found.text } to rem` } );
				// Keep the press from moving the editor's cursor.
				button.addEventListener( 'mousedown', ( event ) => event.preventDefault() );
				button.addEventListener( 'click', () => convert( view, button ) );
				return button;
			},
		} ) )
	);

	const convert = ( view, button ) => {
		const from = view.posAtDOM( button );
		const found = pxInDoc( view.state.doc ).find( ( px ) => px.from === from );
		if ( ! found ) return;
		const edit = editorEdit( view, from, found.text );
		edit.set( `to-rem(${ found.text })` );
		edit.finish( true );
	};

	/*
	 * tr and a number, like tr80 or tr-1.5, before the cursor in a
	 * declaration's value, and not in a comment or a string. A px after the
	 * number is fine too.
	 */
	const SHORTHAND = /(?<![\w\-.#@\\])tr(-?(?:\d+(?:\.\d+)?|\.\d+))(?:px)?$/;
	// The keys that end one. Each still does what it would have, but Tab, which only expands.
	const ENDS = new Set( [ ' ', ';', ',', ')', 'Enter', 'Tab' ] );

	// Whether `at` is in a comment or a string, reading from `from`, where neither is open.
	const quoted = ( text, from, at ) => {
		for ( let i = from; i < at; i++ ) {
			const c = text[ i ];
			let end = -1;
			if ( c === '"' || c === "'" ) end = stringEnd( text, i );
			else if ( c === '/' && text[ i + 1 ] === '*' ) end = commentEnd( text, i );
			if ( end >= at ) return true;
			if ( end >= 0 ) i = end;
		}
		return false;
	};

	// Before the editor's own key handling, like CodeMirror's commit characters.
	document.addEventListener(
		'keydown',
		( event ) => {
			if ( ! ENDS.has( event.key ) || event.isComposing || event.metaKey || event.ctrlKey || event.altKey ) return;
			if ( event.key === 'Tab' && event.shiftKey ) return;
			const view = editorViewAt( event.target );
			const { main, ranges } = view?.state.selection || {};
			if ( ! main?.empty || ranges.length > 1 ) return;
			// While the completions are open, Enter and Tab pick one.
			if ( event.key.length > 1 && view.dom.querySelector( '.cm-tooltip-autocomplete' ) ) return;
			const line = view.state.doc.lineAt( main.head );
			const match = SHORTHAND.exec( line.text.slice( 0, main.head - line.from ) );
			if ( ! match ) return;
			const from = main.head - match[ 0 ].length;
			const text = view.state.doc.toString();
			const value = declarations( text ).find( ( d ) => d.from <= from && main.head <= d.to );
			if ( ! value || quoted( text, value.from, from ) ) return;
			const insert = `to-rem(${ match[ 1 ] }px)`;
			// Its own step of the editor's history, so Cmd+Z brings back what was typed.
			view.dispatch( { changes: { from, to: main.head, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.complete', scrollIntoView: true } );
			if ( event.key === 'Tab' ) {
				event.preventDefault();
				event.stopPropagation();
			}
		},
		true
	);
} )();
