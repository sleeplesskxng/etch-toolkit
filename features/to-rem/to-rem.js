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
 */
( () => {
	const { el, icon, cssText, editorWidgets, editorEdit } = window.etchToolkit || {};
	if ( ! editorWidgets ) return;
	const { stringEnd, commentEnd, parenEnd } = cssText;

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
} )();
