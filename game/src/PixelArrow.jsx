// Pixel-art arrow, drawn on a 9×7 grid to match the pixel font. `unit` is
// the size of one grid pixel in screen px (so the arrow is 9u × 7u);
// `direction` "left" mirrors it. Decorative: the button around it carries
// the accessible name.
export default function PixelArrow({ direction = 'right', unit = 4, className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 9 7"
      width={9 * unit}
      height={7 * unit}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={direction === 'left' ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path fill="currentColor" d="M0 3h6v1H0zM6 1h1v5H6zM7 2h1v3H7zM8 3h1v1H8z" />
    </svg>
  );
}
