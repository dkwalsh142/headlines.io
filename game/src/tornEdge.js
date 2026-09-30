// Generates a pixel-art staggered border outline for clip-path, sized to a
// box's actual rendered dimensions. A plain rectangular clip-path can't
// produce a border with visible thickness on its own (clip-path clips away
// everything outside the path, box-shadow included) — instead, TornFrame
// (see Newspaper.jsx) layers two elements, each clipped to its own polygon
// from this function: an outer one (the "ink" edge) and an inner one inset
// by the border thickness (the paper), so the gap between the two paths
// reads as a consistent-thickness staggered border.
//
// The mechanic: walking along an edge, every `unit` px the line either
// keeps going straight or shifts sideways by exactly one `unit` (never more,
// never a fraction) — a simple pixel-by-pixel nudge left/right or up/down,
// not a smooth/diagonal tear. Every vertex sits on the `unit` grid, so
// corners are always 90 degrees. Offset is a three-state toggle — left,
// center, or right — that always returns to center before switching
// direction (no left-after-left or right-after-right), and always starts
// and ends each edge at 0 so every corner lands exactly on the box corner.
//
// Border thickness (outer-to-inner distance) MUST stay exactly `inset`
// everywhere along the edge, including right at a jog. The earlier version
// built the outer and inner paths as two independent walks (or the same
// pattern independently rescaled to each edge's own length) — either way,
// the along-edge coordinate where a jog lands could round to a different
// pixel for the outer path than for the inner path, since insetting shortens
// each edge by a different absolute amount. In the sliver between those two
// slightly-offset jog points, the visible gap between the paths briefly
// becomes |off_outer - off_inner| * unit instead of the intended `inset` —
// exactly the "sometimes 1 unit, sometimes 2" bug. The fix: build ONE
// pattern per edge in the OUTER box's own absolute pixel coordinates, then
// have the inner path reuse those exact same along-edge coordinates (offset
// only by where its own edge begins/ends) rather than re-deriving its own
// jog positions from scratch — so a jog always lands at the identical
// along-edge pixel for both paths, and the perpendicular gap between them
// is always exactly `inset`, everywhere.
//
// Deterministic per (width, height, seed) — same box size + seed always
// produces the same stagger pattern, so it doesn't reshuffle on re-render.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// Builds the shift pattern for one edge spanning `length` px (the OUTER
// box's own edge length — always the same reference length regardless of
// what inset will later read this pattern), as a list of [travelledPx,
// offset] pairs. offset is in whole units (-1, 0, or 1), perpendicular to
// the edge. The same direction can't fire twice in a row: a shift away from
// center must return to center before a new direction can be chosen. Every
// flat run (the straight stretch between one jog and the next) is at least
// `minRunLength` px long, so jogs never crowd right next to each other.
// Offset always starts and ends at 0 so an edge's own endpoints stay
// exactly on the box corners.
function buildShiftPattern(rand, length, unit, shiftChance, minRunLength) {
  const steps = Math.max(1, Math.round(length / unit));
  const pattern = [[0, 0]];
  let offset = 0;
  let lastDirection = 0;
  let lastShiftAt = 0; // px position of the most recent jog (0 = the edge's own start)
  for (let i = 1; i < steps; i++) {
    const travelled = i * unit;
    const stepsLeft = steps - i;
    const longEnoughSinceLastShift = travelled - lastShiftAt >= minRunLength;
    // A shift AWAY from center (offset 0 -> +-1) needs at least one more
    // step afterward to shift back to 0 before the edge ends — otherwise
    // the edge would end still displaced, producing a diagonal jump into
    // the next edge's start point instead of a clean corner. A shift BACK
    // to center never has this problem (0 is always a safe final state).
    const mustReturnToZero = offset !== 0 && stepsLeft <= 1;
    const canStartNewShift = offset === 0 && stepsLeft > 1 && longEnoughSinceLastShift;
    const wantsToShift = !mustReturnToZero && rand() < shiftChance && (offset !== 0 || canStartNewShift);
    if (mustReturnToZero || wantsToShift) {
      pattern.push([travelled, offset]); // end of the flat run, at the old offset

      let nextOffset;
      if (mustReturnToZero || offset !== 0) {
        nextOffset = 0; // shifted -> the only legal move is back to center
      } else {
        const options = [-1, 1].filter((d) => d !== lastDirection);
        nextOffset = options.length === 1 ? options[0] : pick(rand, options);
      }
      if (nextOffset !== 0) lastDirection = nextOffset;
      offset = nextOffset;
      lastShiftAt = travelled;
      pattern.push([travelled, offset]); // start of the next run, at the new offset
    }
  }
  pattern.push([length, 0]); // guaranteed exact endpoint, offset forced to 0
  return pattern;
}

// Turns a shift pattern (built against the OUTER edge's own length, with
// `travelled` measured from the OUTER edge's own start corner) into real
// coordinates along one specific inset edge. `outerOriginX, outerOriginY`
// is the outer (inset-0) corner this edge starts from — e.g. (0,0) for the
// top edge. A point at outer-tangential-distance `travelled` maps to the
// SAME tangential distance from the inset edge's own start (which itself
// sits `inset` further along the tangent, past the corner-clearance zone,
// plus `inset` inward along the perpendicular) — so a jog always lands at
// the identical tangential distance from the shared outer corner regardless
// of inset, which is what keeps the perpendicular gap between outer and
// inner (the actual border thickness) constant at exactly `inset`
// everywhere, including right at a jog.
function patternToPoints(pattern, outerOriginX, outerOriginY, ux, uy, nx, ny, inset, unit, edgeLength) {
  const innerStartX = outerOriginX + ux * inset + nx * inset;
  const innerStartY = outerOriginY + uy * inset + ny * inset;

  return pattern.map(([travelled, off]) => {
    const clamped = Math.min(Math.max(travelled - inset, 0), edgeLength);
    const px = innerStartX + ux * clamped + nx * off * unit;
    const py = innerStartY + uy * clamped + ny * off * unit;
    return [px, py];
  });
}

// Precomputes one shift pattern per edge (top/right/bottom/left), each
// built once against the OUTER box's own edge length — call once per box,
// then read both the outer (inset 0) and inner (inset > 0) polygons from
// the SAME returned object. Because both reuse the identical pattern (same
// travelled-px values, not independently rescaled), a jog always lands at
// the same along-edge pixel for outer and inner alike, so the perpendicular
// gap between them — the actual border thickness — stays exactly `inset`
// everywhere, including right at a jog.
export function tornBorder({ width, height, seed, unit = 3, shiftChance = 0.08, minRunLength = 5 }) {
  if (!width || !height) {
    return { outer: 'none', inner: () => 'none' };
  }
  const rand = mulberry32(hashSeed(String(seed)));

  const topPattern = buildShiftPattern(rand, width, unit, shiftChance, minRunLength);
  const rightPattern = buildShiftPattern(rand, height, unit, shiftChance, minRunLength);
  const bottomPattern = buildShiftPattern(rand, width, unit, shiftChance, minRunLength);
  const leftPattern = buildShiftPattern(rand, height, unit, shiftChance, minRunLength);

  // Each edge's outer (inset-0) origin corner, tangent direction, and
  // perpendicular direction (pointing inward, toward the box's interior) —
  // fixed regardless of inset; only patternToPoints' innerStart derivation
  // uses `inset` to push each edge's actual rendered start/end inward.
  const edges = {
    top: { pattern: topPattern, originX: 0, originY: 0, ux: 1, uy: 0, nx: 0, ny: 1, length: width },
    right: { pattern: rightPattern, originX: width, originY: 0, ux: 0, uy: 1, nx: -1, ny: 0, length: height },
    bottom: { pattern: bottomPattern, originX: width, originY: height, ux: -1, uy: 0, nx: 0, ny: -1, length: width },
    left: { pattern: leftPattern, originX: 0, originY: height, ux: 0, uy: -1, nx: 1, ny: 0, length: height },
  };

  function polygonAtInset(inset) {
    const edgeLength = { top: width - 2 * inset, right: height - 2 * inset, bottom: width - 2 * inset, left: height - 2 * inset };
    const points = {};
    for (const [name, e] of Object.entries(edges)) {
      points[name] = patternToPoints(e.pattern, e.originX, e.originY, e.ux, e.uy, e.nx, e.ny, inset, unit, edgeLength[name]);
    }

    // Drop each edge's last point — identical to the next edge's first
    // point (both are the shared corner) — to avoid a duplicate vertex.
    const all = [
      ...points.top.slice(0, -1),
      ...points.right.slice(0, -1),
      ...points.bottom.slice(0, -1),
      ...points.left.slice(0, -1),
    ];
    return `polygon(${all.map(([x, y]) => `${Math.round(x)}px ${Math.round(y)}px`).join(', ')})`;
  }

  return { outer: polygonAtInset(0), inner: polygonAtInset };
}
