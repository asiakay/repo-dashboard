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

  // "Effective time" that only advances while the mouse is active.
  // This means the animation freezes when the cursor is idle.
  let effectiveT = 0;
  let prevTs = null;
  let mouseActivity = 0; // 0..1; jumps to 1 on move, decays to 0 when still
  const DECAY_SECS = 1.2; // seconds until fully frozen after mouse stops

  document.addEventListener('mousemove', () => { mouseActivity = 1; }, { passive: true });

  function resize() {
    const parent = canvas.parentElement;
    W = canvas.width  = parent.offsetWidth;
    H = canvas.height = parent.offsetHeight;
    cx = W / 2;
    cy = H / 2;
  }

  function draw(ts) {
    const dt = prevTs === null ? 0 : Math.min((ts - prevTs) * 0.001, 0.1);
    prevTs = ts;

    // Decay activity smoothly; advance effective time proportionally
    mouseActivity = Math.max(0, mouseActivity - dt / DECAY_SECS);
    effectiveT += dt * mouseActivity;

    const t = effectiveT;

    ctx.clearRect(0, 0, W, H);

    const maxR = Math.hypot(cx, cy) * 1.45;

    for (let i = 0; i < RINGS; i++) {
      const phase = ((i / RINGS) + t * 0.05) % 1;

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
      const sides = 6 + (i % 3) * 2;
      const spin = t * 0.03 * (i % 2 === 0 ? 1 : -1) + (i / RINGS) * Math.PI;

      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const angle = (s / sides) * Math.PI * 2 + spin;
        const wave  = 1 + 0.055 * Math.sin(s * 2.1 + t * 0.06 + i * 1.4);
        const px = cx + Math.cos(angle) * r * wave;
        const py = cy + Math.sin(angle) * r * wave * (H / W) * 1.15;
        s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();

      ctx.strokeStyle = `rgba(${rc},${gc},${bc},${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.4, (1 - phase) * 1.8);
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }

  resize();
  new ResizeObserver(resize).observe(canvas.parentElement);
  requestAnimationFrame(draw);
})();
