import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tornBorder } from './tornEdge.js';

// A "torn paper" replacement for .pixel-frame's clean rectangular border,
// used only on the Newspaper root (not the app's other cards/lists, which
// keep the plain pixel-stepped border). A single clip-path can't produce a
// border with visible thickness — clipping removes everything outside the
// path, box-shadow included — so this layers two torn shapes instead: an
// outer one filled with --ink (the "torn edge" itself) sitting behind an
// inner one inset by the border thickness and filled with --card-bg (the
// actual paper), so the gap between the two paths reads as a jagged,
// consistent-thickness border.
//
// Re-measures via ResizeObserver since the box's height is content-driven
// (a short headline vs. a long one) — the torn shape is regenerated (same
// seed, so still deterministic) whenever the box's size actually changes.

const UNIT = 3; // matches --pixel in index.css — the jog step size
const BORDER_THICKNESS = 6; // px, thicker than .pixel-frame's 3px so the jag reads clearly

// Re-anchors a polygon()-string's coordinates by (dx,dy) — used because
// .torn-frame-ink is expanded by UNIT on every side (see Newspaper.css) so
// outward jogs (which can land outside the frame's own [0,width]x[0,height]
// box) aren't clipped flat at the element's edge; that expanded box's own
// origin is UNIT px up/left of the un-expanded one, so every polygon point
// needs the same UNIT px added to land in the right place within it.
function shiftPolygon(polygonStr, dx, dy) {
  if (polygonStr === 'none') return polygonStr;
  return polygonStr.replace(/(-?\d+(?:\.\d+)?)px (-?\d+(?:\.\d+)?)px/g, (_, x, y) => {
    return `${Number(x) + dx}px ${Number(y) + dy}px`;
  });
}

export default function TornFrame({ seed, className, children, ...rest }) {
  const ref = useRef(null);
  const [size, setSize] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { inlineSize, blockSize } = entry.borderBoxSize?.[0] ?? {};
      if (inlineSize && blockSize) setSize({ width: inlineSize, height: blockSize });
      else setSize({ width: el.offsetWidth, height: el.offsetHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Both polygons come from the same tornBorder() call so their shifts land
  // at identical points — otherwise the outer/inner edges would drift out
  // of sync and the border thickness would visibly vary around the frame.
  const border = useMemo(
    () => (size ? tornBorder({ ...size, seed, unit: UNIT }) : null),
    [size, seed]
  );
  // .torn-frame-ink's reference box is expanded by UNIT on every side, so
  // its own (0,0) sits UNIT px up-and-left of .torn-frame's (0,0) — shift
  // every point by +UNIT to compensate. .torn-frame-paper stays inset:0
  // (the inner path never juts outward past the frame's own box, since its
  // jogs move toward the interior relative to that boundary), so it needs
  // no shift.
  const outerClip = border ? shiftPolygon(border.outer, UNIT, UNIT) : 'none';
  const innerClip = border ? border.inner(BORDER_THICKNESS) : 'none';

  return (
    <div ref={ref} className={['torn-frame', className].filter(Boolean).join(' ')} {...rest}>
      <div className="torn-frame-ink" style={{ clipPath: outerClip }} aria-hidden="true" />
      <div className="torn-frame-paper" style={{ clipPath: innerClip }}>
        {children}
      </div>
    </div>
  );
}
