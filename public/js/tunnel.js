(function () {
  const canvas = document.getElementById('tunnel-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Accent palette pulled from the CSS custom properties
  const COLORS = [
    [79, 209, 197],  // --accent  (teal)
    [99, 179, 237],  // --accent-strong (blue)
    [72, 187, 120],  // --success (green)
    [236, 201, 75],  // --warning (amber)
  ];

  const RINGS = 18;
  let W, H, cx, cy;

  function resize() {
    const parent = canvas.parentElement;
    W = canvas.width  = parent.offsetWidth;
    H = canvas.height = parent.offsetHeight;
    cx = W / 2;
    cy = H / 2;
  }

  function draw(ts) {
    const t = ts * 0.001; // seconds

    ctx.clearRect(0, 0, W, H);

    const maxR = Math.hypot(cx, cy) * 1.45;

    for (let i = 0; i < RINGS; i++) {
      // Each ring travels outward; stagger them evenly in a loop
      const phase = ((i / RINGS) + t * 0.10) % 1; // 0 → 1 continuously

      // Fade in near centre, fade out near edge
      let alpha;
      if (phase < 0.12) {
        alpha = (phase / 0.12) * 0.15;
      } else if (phase > 0.65) {
        alpha = ((1 - phase) / 0.35) * 0.15;
      } else {
        alpha = 0.15;
      }

      const r = phase * maxR;
      const [rc, gc, bc] = COLORS[i % COLORS.length];

      // Polygon: 6, 8 or 10 sides — alternates for the fractal texture
      const sides = 6 + (i % 3) * 2;

      // Each ring spins slowly; even/odd rings counter-rotate
      const spin = t * 0.07 * (i % 2 === 0 ? 1 : -1) + (i / RINGS) * Math.PI;

      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const angle = (s / sides) * Math.PI * 2 + spin;
        // Subtle radial wave gives the organic / fractal wobble
        const wave = 1 + 0.055 * Math.sin(s * 2.1 + t * 0.12 + i * 1.4);
        // Slightly elliptical so it doesn't feel perfectly mechanical
        const px = cx + Math.cos(angle) * r * wave;
        const py = cy + Math.sin(angle) * r * wave * (H / W) * 1.15;
        s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();

      ctx.strokeStyle = `rgba(${rc},${gc},${bc},${alpha.toFixed(3)})`;
      // Thicker lines nearer the centre (just emerging), thinner at the edge
      ctx.lineWidth = Math.max(0.4, (1 - phase) * 1.8);
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }

  resize();
  new ResizeObserver(resize).observe(canvas.parentElement);
  requestAnimationFrame(draw);
})();
