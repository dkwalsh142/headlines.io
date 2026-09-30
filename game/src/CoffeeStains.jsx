// Randomized coffee stains on the newspaper, for visual interest: up to
// MAX_STAINS per page, each either an irregular "blob" (a dried drip: pale
// fill, darker rim, sometimes stray droplets) or a "crescent" (part of the
// ring a mug's base leaves behind, tapering where the cup only half touched;
// sometimes the full ring).
//
// Drawn on the same 3px pixel grid as the torn edge (see --pixel), as SVG
// cell paths with crispEdges, so they read as pixel art rather than smooth
// vector blobs. Multiply-blended so text shows through, and click-through.
//
// Uses Math.random (like the column layout in Newspaper.jsx): stains
// reshuffle on every load but stay fixed for the life of one page.

const CELL = 3; // px per stain "pixel"; matches --pixel
// Stains are off for now (0 = none ever drawn); everything else here is kept
// to revisit. Set back to 3 to turn them on.
const MAX_STAINS = 0;
const FULL_RING_CHANCE = 0.35; // share of mug rings drawn as a complete circle

const COFFEE = '120, 72, 28';
const BLOB_FILL = `rgba(${COFFEE}, 0.1)`;
const BLOB_RIM = `rgba(${COFFEE}, 0.22)`;
const RING = `rgba(${COFFEE}, 0.21)`;

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));

// A smooth random wobble around a circle: a few low-frequency sine waves
// with random amplitudes/phases. Returns a function of angle -> multiplier.
function makeWobble(amount) {
  const waves = [2, 3, 4, 5].map((k) => ({ k, a: rand(0.3, 1) * amount / k * 2, p: rand(0, Math.PI * 2) }));
  return (theta) => 1 + waves.reduce((sum, w) => sum + w.a * Math.sin(w.k * theta + w.p), 0);
}

// One grid cell as an SVG path segment.
const cell = (x, y) => `M${x} ${y}h1v1h-1z`;

function makeBlob() {
  const radius = rand(10, 24); // in cells
  const wobble = makeWobble(0.14);
  const rimWidth = rand(0.8, 1.6);
  const extent = Math.ceil(radius * 1.8);
  let fill = '';
  let rim = '';

  for (let y = -extent; y <= extent; y++) {
    for (let x = -extent; x <= extent; x++) {
      const d = Math.hypot(x + 0.5, y + 0.5);
      const edge = radius * wobble(Math.atan2(y + 0.5, x + 0.5));
      if (d > edge) continue;
      if (edge - d < rimWidth) rim += cell(x, y);
      else fill += cell(x, y);
    }
  }

  // A few stray droplets flung off the main stain.
  for (let i = randInt(0, 3); i > 0; i--) {
    const angle = rand(0, Math.PI * 2);
    const dist = radius * rand(1.2, 1.6);
    const cx = Math.cos(angle) * dist;
    const cy = Math.sin(angle) * dist;
    const r = rand(0.8, 2.2);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) rim += cell(x, y);
      }
    }
  }

  return { extent, paths: [{ d: fill, color: BLOB_FILL }, { d: rim, color: BLOB_RIM }] };
}

function makeCrescent() {
  const radius = rand(22, 32); // roughly a mug's base at this paper's scale
  const wobble = makeWobble(0.03);
  const maxWidth = rand(1.6, 2.8);
  const start = rand(0, Math.PI * 2);
  const fullRing = Math.random() < FULL_RING_CHANCE;
  const span = fullRing ? Math.PI * 2 : rand(Math.PI * 0.7, Math.PI * 1.5); // partial: 126°–270°
  const extent = Math.ceil(radius * 1.15 + maxWidth);
  let ring = '';

  for (let y = -extent; y <= extent; y++) {
    for (let x = -extent; x <= extent; x++) {
      const theta = Math.atan2(y + 0.5, x + 0.5);
      // Position along the arc, 0..1, or skip cells outside it.
      const along = (((theta - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (along > span) continue;
      const t = along / span;
      const width = fullRing
        ? // Unbroken, but heavier on the side the cup pressed down on.
          maxWidth * (0.7 + 0.3 * Math.pow(Math.sin(Math.PI * t), 2))
        : // Thickest mid-arc, tapering to nothing at both ends.
          maxWidth * Math.pow(Math.sin(Math.PI * t), 0.6);
      const d = Math.hypot(x + 0.5, y + 0.5);
      if (Math.abs(d - radius * wobble(theta)) <= width / 2) ring += cell(x, y);
    }
  }

  return { extent, paths: [{ d: ring, color: RING }] };
}

// Picks 0..MAX_STAINS stains at random spots on the page. Positions are
// percentages of the paper; stains may hang off the edge (the paper's
// torn-edge clip trims them).
export function makeCoffeeStains() {
  const stains = [];
  const count = randInt(0, MAX_STAINS);
  for (let i = 0; i < count; i++) {
    // Keep stains from piling onto each other: retry a few times for a spot
    // far enough from the ones already placed.
    let pos;
    for (let attempt = 0; attempt < 10; attempt++) {
      pos = { left: rand(5, 95), top: rand(8, 92) };
      if (stains.every((s) => Math.hypot(s.left - pos.left, s.top - pos.top) > 30)) break;
    }
    const shape = Math.random() < 0.5 ? makeBlob() : makeCrescent();
    stains.push({ ...pos, ...shape });
  }
  return stains;
}

export default function CoffeeStains({ stains }) {
  if (!stains.length) return null;
  return (
    <div className="coffee-stains" aria-hidden="true">
      {stains.map((stain, i) => {
        const size = (stain.extent * 2 + 1) * CELL;
        return (
          <svg
            key={i}
            className="coffee-stain"
            style={{ left: `${stain.left}%`, top: `${stain.top}%`, width: size, height: size }}
            viewBox={`${-stain.extent} ${-stain.extent} ${stain.extent * 2 + 1} ${stain.extent * 2 + 1}`}
            shapeRendering="crispEdges"
          >
            {stain.paths.map((p, j) => p.d && <path key={j} d={p.d} fill={p.color} />)}
          </svg>
        );
      })}
    </div>
  );
}
