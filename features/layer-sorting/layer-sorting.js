/**
 * Etch Toolkit: enhanced layer sorting.
 *
 * Etch drags layers in the Structure panel with dnd-kit, and with its
 * Instant Sort setting (on by default) moves the real block each time the
 * drag passes a row. Each move re-renders the canvas and takes an undo
 * snapshot of every style, so on a big page the drag stutters.
 *
 * This takes over mouse drags on layers instead. It measures the rows once
 * as a drag starts, then only moves a drop line, in the panel and on the
 * canvas where the layer will land. Letting go moves the block once, through
 * Etch's API: one canvas update, one undo step.
 *
 * - The top or bottom of a row drops before or after it. The middle of a
 *   closed layer that holds others drops inside it, last. The lower half of
 *   an open one drops inside it, first.
 * - Where levels meet, moving left or right picks the level. Over the dragged
 *   layer itself, moving left takes it out of its parent.
 * - A spot holds until the pointer is a few pixels past it, so it doesn't flicker.
 * - Resting on a closed layer opens it. Near the panel's top or bottom, it scrolls.
 * - Resting on a spot the canvas can't show scrolls the canvas to it.
 * - Esc cancels.
 *
 * Selecting a layer on the canvas also scrolls its row to the middle of the panel.
 *
 * Touch and Etch's keyboard dragging stay Etch's. Turned off in the
 * toolkit's settings (General), Etch's own drag comes back.
 */
( () => {
	const WRAP = '.etch-builder-structure-wrapper';
	const ITEM = '.etch-builder-accordion__item';
	const HEADER = '[data-testid="accordion-header"][data-blockid]';
	const CONTENT = '[data-testid="accordion-content"]';
	const TRIGGER = '[data-testid="accordion-trigger"]';
	const CANVAS = '#etch-iframe';
	// Presses on these do what they do. Etch's drag leaves them alone too.
	const INTERACTIVE = 'button, input, select, textarea, a[href], [contenteditable]:not([contenteditable="false"])';

	const THRESHOLD = 4; // Pixels a press moves before it's a drag.
	const EDGE = 48; // Pixels from the panel's top or bottom where it scrolls.
	const SPEED = 20; // Pixels a frame, at the very edge.
	const OPEN_DELAY = 600; // Milliseconds resting on a closed layer before it opens.
	const REVEAL_DELAY = 400; // Milliseconds resting on a spot before the canvas scrolls to it.
	const SLOP = 4; // Pixels the pointer goes past a spot's edge before the spot changes.

	// Etch keeps a p or heading to phrasing content: its acceptsChild(), which move() checks.
	const PHRASING_ONLY = new Set( [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ] );
	const PHRASING = new Set( 'a abbr b bdi bdo br cite code data dfn em i img kbd label mark math meter output progress q ruby rt rp s samp small span strong sub sup template time u var wbr'.split( ' ' ) );

	// Etch's own drag, if its API ever moves.
	const enabled = () => window.etchToolkitSettings?.settings?.layerSorting !== false && typeof window.etch?.blocks?.move === 'function';
	const clamp = ( n, min, max ) => Math.min( max, Math.max( min, n ) );

	// While it's on, layers get a little more room (layer-sorting.css).
	const markOn = () => document.documentElement.classList.toggle( 'etk-layer-sorting', window.etchToolkitSettings?.settings?.layerSorting !== false );
	markOn();
	window.addEventListener( 'etch-toolkit-settings', markOn );

	// The HTML tag a block renders as, for the rule above. Null for blocks that aren't HTML.
	const htmlTag = ( block ) => {
		if ( block?.type === 'etch/element' ) return String( block.tag || 'div' ).toLowerCase();
		if ( block?.type === 'etch/dynamic-element' ) return String( block.attributes?.tag || 'div' ).toLowerCase();
		if ( block?.type === 'etch/svg' ) return 'svg';
		if ( /image/.test( block?.type ?? '' ) ) return 'img';
		return null;
	};

	const nameOf = ( header ) =>
		header.querySelector( '.etch-builder-accordion__header-label' )?.textContent.trim() ||
		header.querySelector( '.etch-builder-accordion__header-tag' )?.textContent.trim() ||
		header.textContent.trim();

	/* ---- The drop line, the ghost and the announcement ---- */

	let overlay = null;
	let status = null;
	const parts = {};

	const build = () => {
		const div = ( className, parent ) => parent.appendChild( Object.assign( document.createElement( 'div' ), { className } ) );
		overlay = div( 'etk-sort', document.body );
		overlay.hidden = true;
		overlay.setAttribute( 'aria-hidden', 'true' );
		parts.panel = div( 'etk-sort__clip', overlay );
		parts.line = div( 'etk-sort__line', parts.panel );
		parts.box = div( 'etk-sort__box', parts.panel );
		parts.canvas = div( 'etk-sort__clip', overlay );
		parts.canvasBox = div( 'etk-sort__box etk-sort__box--canvas', parts.canvas );
		parts.canvasLine = div( 'etk-sort__line etk-sort__line--canvas', parts.canvas );
		parts.ghost = div( 'etk-sort__ghost', overlay );
		status = div( 'etk-sr', document.body );
		status.setAttribute( 'role', 'status' );
	};

	const place = ( node, x, y, width, height ) => {
		node.hidden = false;
		node.style.transform = `translate(${ x }px, ${ y }px)`;
		node.style.width = `${ Math.max( 0, width ) }px`;
		if ( height !== undefined ) node.style.height = `${ Math.max( 0, height ) }px`;
	};

	const clip = ( node, rect ) => Object.assign( node.style, { left: `${ rect.left }px`, top: `${ rect.top }px`, width: `${ rect.width }px`, height: `${ rect.height }px` } );

	const announce = ( message ) => {
		status.textContent = '';
		// Cleared first so the same message is read again.
		window.setTimeout( () => ( status.textContent = message ), 50 );
	};

	/* ---- Pressing ---- */

	let press = null; // A press on a layer that may become a drag.
	let drag = null; // The drag under way.

	const endPress = () => {
		press = null;
		document.removeEventListener( 'pointermove', onPressMove, true );
		document.removeEventListener( 'pointerup', endPress, true );
		document.removeEventListener( 'pointercancel', endPress, true );
	};

	const onPressMove = ( event ) => {
		if ( event.pointerId !== press.pointerId ) return;
		if ( Math.hypot( event.clientX - press.x, event.clientY - press.y ) >= THRESHOLD ) start( event );
	};

	document.addEventListener(
		'pointerdown',
		( event ) => {
			if ( drag || ! enabled() || event.button !== 0 || ! event.isPrimary || event.pointerType === 'touch' ) return;
			const wrap = event.target.closest?.( WRAP );
			const item = wrap && event.target.closest( ITEM );
			if ( ! item || event.target.closest( INTERACTIVE ) ) return;
			const header = event.target.closest( HEADER );
			// Ones Etch won't drag either: read-only layers, and any while several are selected.
			if ( header?.dataset.blockReadonly === 'true' || wrap.querySelectorAll( `${ HEADER }[data-block-selected="true"]` ).length > 1 ) return;

			// Etch's drag starts from this press, so it never gets it. Clicks, double-clicks
			// and right-clicks still arrive, as their own events.
			event.stopPropagation();
			if ( ! header || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey ) return;
			endPress();
			press = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, wrap, item, header };
			document.addEventListener( 'pointermove', onPressMove, true );
			document.addEventListener( 'pointerup', endPress, true );
			document.addEventListener( 'pointercancel', endPress, true );
		},
		true
	);

	/* ---- Dragging ---- */

	const start = ( event ) => {
		const { wrap, item, header, pointerId, x } = press;
		endPress();
		const id = header.dataset.blockid;
		let block = null;
		try {
			block = window.etch.blocks.getJson( id );
		} catch {
			return;
		}
		if ( ! overlay ) build();

		window.getSelection()?.removeAllRanges();
		document.documentElement.classList.add( 'etk-sorting' );
		item.setAttribute( 'data-etk-sort-source', '' );
		// Its own layers go with it, so they fold away while it moves, as in Etch.
		const content = item.querySelector( CONTENT );
		const folded = content?.closest( ITEM ) === item ? content : null;
		folded?.setAttribute( 'data-etk-sort-folded', '' );

		drag = { wrap, item, folded, id, pointerId, name: nameOf( header ), tag: htmlTag( block ), startX: x, pointer: { x: event.clientX, y: event.clientY }, target: null, cleanup: [] };
		wrap.setPointerCapture( pointerId );
		measure();

		const ghost = parts.ghost;
		ghost.replaceChildren();
		const icon = header.querySelector( '.etch-builder-accordion__header-block-icon svg' );
		if ( icon ) ghost.append( icon.cloneNode( true ) );
		ghost.append( Object.assign( document.createElement( 'span' ), { textContent: drag.name } ) );
		const frame = document.querySelector( CANVAS );
		if ( frame ) clip( parts.canvas, frame.getBoundingClientRect() );
		overlay.hidden = false;

		const on = ( target, type, fn, options = true ) => {
			target.addEventListener( type, fn, options );
			drag.cleanup.push( () => target.removeEventListener( type, fn, options ) );
		};
		on( document, 'pointermove', ( e ) => {
			if ( e.pointerId !== drag.pointerId ) return;
			drag.pointer = { x: e.clientX, y: e.clientY };
			schedule();
		} );
		on( document, 'pointerup', ( e ) => e.pointerId === drag.pointerId && drop() );
		on( document, 'pointercancel', ( e ) => e.pointerId === drag.pointerId && finish() );
		on( wrap, 'lostpointercapture', () => finish() );
		on( window, 'blur', () => finish() );
		on( window, 'keydown', ( e ) => {
			if ( e.key !== 'Escape' ) return;
			// Not Etch's Esc, which would deselect the layer.
			e.preventDefault();
			e.stopPropagation();
			finish( { held: true } );
		} );
		on( wrap, 'scroll', () => schedule(), { passive: true } );
		const view = frame?.contentWindow;
		if ( view ) on( view, 'scroll', () => drag.spot && showSpot( drag.spot ), { passive: true } );

		schedule();
	};

	/**
	 * Every row the panel shows, top to bottom, where it sits in the panel's
	 * scrolled content, and where it sits among its siblings once the dragged
	 * layer is out.
	 */
	const measure = () => {
		const { wrap } = drag;
		const box = wrap.getBoundingClientRect();
		const scroll = wrap.scrollTop;
		const rows = [];
		const byItem = new Map();
		let top = 0; // Rows at the top level.

		for ( const header of wrap.querySelectorAll( HEADER ) ) {
			const rect = header.getBoundingClientRect();
			// In a closed layer, or the dragged one's.
			if ( ! rect.height ) continue;
			const item = header.closest( ITEM );
			const parent = byItem.get( item.parentElement.closest( ITEM ) ) ?? null;
			const trigger = header.querySelector( TRIGGER );
			const row = {
				id: header.dataset.blockid,
				header,
				parent,
				depth: parent ? parent.depth + 1 : 0,
				top: rect.top - box.top + scroll,
				bottom: rect.bottom - box.top + scroll,
				left: rect.left,
				right: rect.right,
				holds: !! trigger, // Takes layers inside. Etch has no drop spot in others.
				open: trigger?.getAttribute( 'aria-expanded' ) === 'true',
				readonly: header.dataset.blockReadonly === 'true',
				tag: header.querySelector( '.etch-builder-accordion__header-tag' )?.textContent.trim().toLowerCase() || null,
				source: item === drag.item,
				children: 0,
			};
			// Its index once the dragged layer is out, as Etch's move() counts.
			row.index = parent ? parent.children : top;
			if ( ! row.source ) parent ? parent.children++ : top++;
			byItem.set( item, row );
			rows.push( row );
		}

		const nested = rows.find( ( row ) => row.parent );
		drag.rows = rows;
		drag.box = box;
		drag.src = rows.find( ( row ) => row.source );
		drag.indent = nested ? nested.left - nested.parent.left || 12 : 12;
		drag.base = rows.length ? rows[ 0 ].left - rows[ 0 ].depth * drag.indent : box.left;
		drag.right = rows.length ? rows[ 0 ].right : box.right;
		// The space between rows.
		drag.gap = rows.length > 1 ? Math.max( 0, rows[ 1 ].top - rows[ 0 ].bottom ) : 0;
		drag.zone = null;
		clip( parts.panel, box );
	};

	// The nearest row that isn't the dragged one, from index i going by step.
	const other = ( i, step ) => {
		const { rows } = drag;
		while ( rows[ i ]?.source ) i += step;
		return rows[ i ] ?? null;
	};

	/**
	 * A spot between two rows. After prev, it can be at any level from next's
	 * down to prev's, or inside prev if prev is an open layer. Moving left or
	 * right from where the drag started picks one.
	 */
	const between = ( prev, next ) => {
		if ( ! prev && ! next ) return null;
		const max = prev ? prev.depth + ( prev.holds && prev.open ? 1 : 0 ) : 0;
		const min = Math.min( max, next ? next.depth : 0 );
		// The level the dragged layer's left edge is at. The last level holds until it's well past.
		const at = drag.src.depth + ( drag.pointer.x - drag.startX ) / drag.indent;
		const last = drag.target?.depth;
		const depth = last >= min && last <= max && Math.abs( at - last ) < 0.5 + SLOP / drag.indent ? last : clamp( Math.round( at ), min, max );
		// Kept clear of the panel's top edge, which would clip it above the first row.
		const y = next ? Math.max( 4, next.top - drag.gap / 2 ) : prev.bottom + drag.gap / 2;
		if ( prev && depth > prev.depth ) return { parent: prev, index: 0, depth, y };
		let anchor = prev;
		while ( anchor && anchor.depth > depth ) anchor = anchor.parent;
		return { parent: anchor ? anchor.parent : null, index: anchor ? anchor.index + 1 : 0, depth, y };
	};

	/**
	 * What's under y, in the panel's scrolled content: the gap between two rows,
	 * or the middle of a layer that holds others. Each row reaches halfway into
	 * the space around it.
	 */
	const zoneAt = ( y ) => {
		const { rows, gap } = drag;
		// The last row reaching up to y or above it.
		let low = 0;
		let high = rows.length - 1;
		let k = -1;
		while ( low <= high ) {
			const mid = ( low + high ) >> 1;
			if ( rows[ mid ].top - gap / 2 <= y ) {
				k = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		if ( k === -1 ) return { prev: null, next: other( 0, 1 ) };
		const row = rows[ k ];
		const prev = other( k - 1, -1 );
		const next = other( k + 1, 1 );
		// The dragged layer's own row is the spot it's in, so moving left can take it out a level.
		if ( row.source ) return { prev, next };
		const at = ( y - row.top + gap / 2 ) / ( row.bottom - row.top + gap );
		// An open layer's lower half is inside it already, first, so only a closed or empty one has a middle.
		if ( row.holds && ! ( row.open && next?.parent === row ) && at >= 0.25 && at <= 0.75 ) return { row };
		return at < 0.5 ? { prev, next: row } : { prev: row, next };
	};

	const sameZone = ( a, b ) => a.row === b.row && a.prev === b.prev && a.next === b.next;

	// Where the pointer drops the layer.
	const locate = () => {
		const { box, wrap, pointer } = drag;
		const y = pointer.y - box.top + wrap.scrollTop;
		let zone = zoneAt( y );
		// Just past the last one's edge, it holds.
		const last = drag.zone;
		if ( last && ! sameZone( zone, last ) && ( sameZone( zoneAt( y - SLOP ), last ) || sameZone( zoneAt( y + SLOP ), last ) ) ) zone = last;
		drag.zone = zone;
		// Inside a closed layer, at the end. Inside an open, empty one, first.
		if ( zone.row ) return { parent: zone.row, index: zone.row.open ? 0 : null, depth: zone.row.depth + 1, inside: true };
		return between( zone.prev, zone.next );
	};

	const allowed = ( { parent } ) => {
		if ( parent?.readonly ) return false;
		return ! ( parent && PHRASING_ONLY.has( parent.tag ) && drag.tag && ! PHRASING.has( drag.tag ) );
	};

	let frame = 0;
	const schedule = () => {
		frame ||= requestAnimationFrame( tick );
	};

	const tick = () => {
		frame = 0;
		if ( ! drag ) return;
		const scrolled = autoscroll();
		render( locate() );
		if ( scrolled ) schedule();
	};

	// Faster the closer to the edge, and flat out past it.
	const autoscroll = () => {
		const { box, pointer, wrap } = drag;
		if ( pointer.x < box.left - EDGE || pointer.x > box.right + EDGE ) return false;
		const up = box.top + EDGE - pointer.y;
		const down = pointer.y - ( box.bottom - EDGE );
		const speed = ( into ) => Math.ceil( SPEED * Math.min( 1, into / EDGE ) ** 2 );
		const step = up > 0 ? -speed( up ) : down > 0 ? speed( down ) : 0;
		if ( ! step ) return false;
		const before = wrap.scrollTop;
		wrap.scrollTop = before + step;
		return wrap.scrollTop !== before;
	};

	const render = ( target ) => {
		const { src, box, wrap, pointer } = drag;
		const last = drag.target;
		const same = target && last ? target.parent === last.parent && target.index === last.index && target.depth === last.depth && target.inside === last.inside : target === last;
		if ( same && target ) {
			target = Object.assign( last, { y: target.y } );
		} else if ( target ) {
			target.ok = allowed( target );
			// Right where it already is.
			target.stays = target.parent === src.parent && target.index === src.index;
		}
		drag.target = target;

		parts.ghost.style.transform = `translate(${ pointer.x + 14 }px, ${ pointer.y + 10 }px)`;
		overlay.classList.toggle( 'is-blocked', !! target && ! target.ok );

		const scroll = wrap.scrollTop;
		parts.line.hidden = parts.box.hidden = true;
		if ( target && ! target.stays ) {
			if ( target.inside ) {
				const row = target.parent;
				place( parts.box, row.left - box.left, row.top - scroll, row.right - row.left, row.bottom - row.top );
			} else {
				const left = drag.base + target.depth * drag.indent;
				place( parts.line, left - box.left, target.y - scroll, drag.right - left );
			}
		}

		if ( same ) return;
		// Resting on a closed layer opens it.
		window.clearTimeout( drag.opening );
		if ( target?.inside && ! target.parent.open ) drag.opening = window.setTimeout( () => open( target.parent ), OPEN_DELAY );
		canvas( target && ! target.stays ? target : null );
	};

	const open = ( row ) => {
		if ( ! drag || drag.target?.parent !== row ) return;
		row.header.querySelector( TRIGGER )?.click();
		// Etch shows its layers on its next update. Measure once they're in.
		requestAnimationFrame( () =>
			requestAnimationFrame( () => {
				if ( ! drag ) return;
				measure();
				drag.target = null;
				schedule();
			} )
		);
	};

	/* ---- The canvas ---- */

	/**
	 * Where the target lands on the canvas: an edge of the sibling it goes
	 * before or after, across or down depending on how the siblings flow,
	 * and the parent it goes into.
	 */
	const canvas = ( target ) => {
		window.clearTimeout( drag.revealing );
		drag.spot = null;
		parts.canvasLine.hidden = parts.canvasBox.hidden = true;
		const doc = document.querySelector( CANVAS )?.contentDocument;
		if ( ! target || ! doc ) return;

		const find = ( row ) => {
			const node = row && doc.querySelector( `[data-etch-id="${ CSS.escape( row.id ) }"]` );
			return node?.getClientRects().length ? node : null;
		};
		const parent = target.parent ? find( target.parent ) : null;
		// Its siblings, in order, without it. Not known for a closed layer: it goes in at the end.
		const siblings = target.parent && ! target.parent.open ? [] : drag.rows.filter( ( row ) => row.parent === target.parent && ! row.source );
		const index = target.index ?? siblings.length;
		const next = find( siblings[ index ] );
		const prev = find( siblings[ index - 1 ] );
		const edge = next ? { node: next, end: false, other: prev || find( siblings[ index + 1 ] ) } : prev ? { node: prev, end: true, other: find( siblings[ index - 2 ] ) } : null;

		drag.spot = { parent, edge, end: target.index === null || index > 0 };
		showSpot( drag.spot );
		// The canvas scrolls to a spot it can't show, once the pointer rests there.
		const anchor = edge?.node || parent;
		if ( anchor ) drag.revealing = window.setTimeout( () => reveal( anchor ), REVEAL_DELAY );
	};

	const showSpot = ( { parent, edge, end } ) => {
		const frame = document.querySelector( CANVAS );
		if ( ! frame ) return;
		const outer = frame.getBoundingClientRect();
		const scale = frame.clientWidth ? outer.width / frame.clientWidth : 1;
		const rect = ( node ) => {
			const r = node.getBoundingClientRect();
			return { left: r.left * scale + frame.clientLeft, top: r.top * scale + frame.clientTop, right: r.right * scale + frame.clientLeft, bottom: r.bottom * scale + frame.clientTop };
		};

		parts.canvasBox.hidden = ! parent;
		if ( parent ) {
			const r = rect( parent );
			place( parts.canvasBox, r.left, r.top, r.right - r.left, r.bottom - r.top );
		}

		parts.canvasLine.classList.remove( 'is-down' );
		if ( edge ) {
			const r = rect( edge.node );
			const o = edge.other && rect( edge.other );
			// Side by side: the siblings share a row.
			const across = o && Math.abs( o.top - r.top ) < Math.min( r.bottom - r.top, o.bottom - o.top ) / 2 && ( o.right <= r.left + 1 || o.left >= r.right - 1 );
			if ( across ) {
				parts.canvasLine.classList.add( 'is-down' );
				place( parts.canvasLine, edge.end ? r.right : r.left, r.top, 2, r.bottom - r.top );
			} else {
				place( parts.canvasLine, r.left, edge.end ? r.bottom : r.top, r.right - r.left, 2 );
			}
		} else if ( parent ) {
			// An empty parent, or one whose layers the canvas doesn't draw as elements.
			const r = rect( parent );
			place( parts.canvasLine, r.left, end ? r.bottom - 4 : r.top + 2, r.right - r.left, 2 );
		} else {
			parts.canvasLine.hidden = true;
		}
	};

	const reveal = ( node ) => {
		if ( ! drag ) return;
		const view = node.ownerDocument.defaultView;
		const r = node.getBoundingClientRect();
		if ( r.bottom < 0 || r.top > view.innerHeight ) node.scrollIntoView( { block: 'center', behavior: 'smooth' } );
	};

	/* ---- Following the selection ---- */

	/*
	 * Etch opens a layer's parents when you select it on the canvas, but
	 * leaves the panel where it was. Once the layer's row is in, the panel
	 * scrolls it to the middle, unless it's already in full view. A click
	 * in the panel is on a row you can see, so it stays put.
	 */
	let followed = null; // The id the panel last scrolled to, or found in view.
	let pressedPanel = 0; // When the panel was last pressed. The canvas's presses stay in its frame.
	let following = 0;

	document.addEventListener(
		'pointerdown',
		( event ) => {
			if ( event.target.closest?.( WRAP ) ) pressedPanel = event.timeStamp;
		},
		true
	);

	const follow = () => {
		following = 0;
		if ( drag || ! enabled() ) return;
		const wrap = document.querySelector( WRAP );
		const selected = wrap?.querySelectorAll( `${ HEADER }[data-block-selected="true"]` );
		if ( selected?.length !== 1 ) {
			followed = null;
			return;
		}
		const header = selected[ 0 ];
		const id = header.dataset.blockid;
		if ( id === followed ) return;
		const row = header.getBoundingClientRect();
		// Not shown yet, while its parents open.
		if ( ! row.height ) return;
		followed = id;
		if ( performance.now() - pressedPanel < 1000 ) return;
		const box = wrap.getBoundingClientRect();
		// Etch's panel pads its end for a fade, which hides what's under it.
		const bottom = box.bottom - ( parseFloat( getComputedStyle( wrap ).paddingBlockEnd ) || 0 );
		if ( row.top >= box.top && row.bottom <= bottom ) return;
		const top = wrap.scrollTop + row.top - box.top - ( wrap.clientHeight - row.height ) / 2;
		const reduce = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
		wrap.scrollTo( { top: Math.max( 0, top ), behavior: reduce ? 'auto' : 'smooth' } );
	};

	// The panel re-renders as layers open and selections change. Checked once a frame at most.
	let watched = null;
	const observer = new MutationObserver( () => {
		following ||= requestAnimationFrame( follow );
	} );
	const watch = () => {
		const wrap = document.querySelector( WRAP );
		if ( wrap === watched ) return;
		observer.disconnect();
		watched = wrap;
		followed = null;
		if ( wrap ) observer.observe( wrap, { subtree: true, childList: true, attributes: true, attributeFilter: [ 'data-block-selected' ] } );
	};
	// Etch mounts the panel again when you switch pages or panels.
	window.etchToolkit?.onPageChange?.( watch );
	watch();

	/* ---- Letting go ---- */

	const drop = () => {
		const { target, id, name } = drag;
		const selected = drag.src?.header.dataset.blockSelected === 'true';
		finish();
		swallowClick();
		if ( ! target?.ok || target.stays ) return;
		try {
			window.etch.blocks.move( id, target.parent?.id ?? null, target.index );
		} catch ( error ) {
			console.warn( '[Etch Toolkit] Could not move the layer:', error );
			return;
		}
		// Etch deselects a block it moves.
		if ( selected ) {
			try {
				window.etch.blocks.select( id );
			} catch {}
		}
		announce( `Moved ${ name }.` );
	};

	// The click that ends a drag isn't one.
	const swallowClick = () => {
		const swallow = ( event ) => {
			event.preventDefault();
			event.stopPropagation();
		};
		window.addEventListener( 'click', swallow, { capture: true, once: true } );
		window.setTimeout( () => window.removeEventListener( 'click', swallow, { capture: true } ), 100 );
	};

	// held: cancelled with the button still down. The panel keeps the pointer until
	// it's let go, so that release isn't a click either.
	const finish = ( { held = false } = {} ) => {
		if ( ! drag ) return;
		const done = drag;
		drag = null;
		cancelAnimationFrame( frame );
		frame = 0;
		window.clearTimeout( done.opening );
		window.clearTimeout( done.revealing );
		done.cleanup.forEach( ( fn ) => fn() );
		if ( held ) {
			const release = ( event ) => {
				if ( event.pointerId !== done.pointerId ) return;
				document.removeEventListener( 'pointerup', release, true );
				document.removeEventListener( 'pointercancel', release, true );
				if ( event.type === 'pointerup' ) swallowClick();
			};
			document.addEventListener( 'pointerup', release, true );
			document.addEventListener( 'pointercancel', release, true );
		} else {
			try {
				done.wrap.releasePointerCapture( done.pointerId );
			} catch {}
		}
		done.item.removeAttribute( 'data-etk-sort-source' );
		done.folded?.removeAttribute( 'data-etk-sort-folded' );
		document.documentElement.classList.remove( 'etk-sorting' );
		overlay.hidden = true;
		overlay.classList.remove( 'is-blocked' );
	};
} )();
