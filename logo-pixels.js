// "Pixel build" logo reveal for the intro: the logo assembles from scattered hex dots (the same hexagons
// the planets are made of) that fly in and lock into its shape, then the solid logo fades in over them.

const ACCENT = '#4cf0ff';

// sample the logo image on a hex grid: one dot wherever the logo has ink
function sampleDots(img, spacing) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height).data;
  const dots = [];
  const rowH = spacing * Math.sqrt(3) / 2;
  for (let r = 0, y = rowH / 2; y < c.height; r++, y += rowH) {
    for (let px = (r % 2 ? spacing / 2 : 0) + spacing / 2; px < c.width; px += spacing) {
      if (data[(Math.floor(y) * c.width + Math.floor(px)) * 4 + 3] > 140) dots.push({ x: px / c.width, y: y / c.height });
    }
  }
  return dots;
}

function hexPath(ctx, x, y, r) {
  ctx.moveTo(x + r, y);
  for (let k = 1; k < 6; k++) ctx.lineTo(x + r * Math.cos(k * Math.PI / 3), y + r * Math.sin(k * Math.PI / 3));
  ctx.closePath();
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// Runs the build over the whole screen (a canvas added to `host`), assembling onto `box` (the .boot-logo
// element). Resolves when the dots have locked in.
export function buildLogoFromPixels(host, box, img, { duration = 1000 } = {}) {
  return new Promise((resolve) => {
    const start = () => {
      const rect = box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vw = window.innerWidth, vh = window.innerHeight;
      const canvas = document.createElement('canvas');
      canvas.className = 'logo-pixels';
      canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
      host.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      // about 70 dots across the logo, whatever its display size
      const spacing = img.naturalWidth / 70;
      const dots = sampleDots(img, spacing);
      for (const d of dots) {
        // in screen pixels (× dpr): target on the logo, start anywhere on the screen
        d.tx = (rect.left + d.x * rect.width) * dpr; d.ty = (rect.top + d.y * rect.height) * dpr;
        d.sx = Math.random() * canvas.width; d.sy = Math.random() * canvas.height;
        d.delay = Math.random() * 0.45; // share of the duration before this dot sets off
      }
      const r = (spacing / img.naturalWidth) * rect.width * dpr * 0.5;

      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = ACCENT;
        ctx.shadowColor = ACCENT; ctx.shadowBlur = 6 * dpr;
        ctx.beginPath();
        for (const d of dots) {
          const p = easeOut(Math.max(0, Math.min(1, (t - d.delay) / (1 - 0.45))));
          const x = d.sx + (d.tx - d.sx) * p;
          const y = d.sy + (d.ty - d.sy) * p;
          hexPath(ctx, x, y, r * (0.55 + 0.45 * p)); // dots grow slightly as they lock in
        }
        ctx.fill();
        if (t < 1) requestAnimationFrame(frame);
        else resolve(canvas);
      };
      requestAnimationFrame(frame);
    };
    if (img.complete && img.naturalWidth) start();
    else img.addEventListener('load', start, { once: true });
  });
}

// "Light-speed jump" exit: the logo (mark and motto) becomes points of light that stretch into streaks
// rushing towards the screen centre, with faint background stars streaking too; then the tails whip in,
// everything collapses into the centre with a white flash, and the site shows through.
export function hyperspaceJump(host, box, imgs, { duration = 1100 } = {}) {
  return new Promise((resolve) => {
    const rect = box.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth, vh = window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.className = 'logo-pixels';
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2;

    // points on the logo's ink, in screen pixels (× dpr)
    const pts = [];
    for (const img of imgs) {
      if (!img.naturalWidth) continue;
      for (const d of sampleDots(img, img.naturalWidth / 90)) {
        pts.push({ x: (rect.left + d.x * rect.width) * dpr, y: (rect.top + d.y * rect.height) * dpr, a: 1, lag: Math.random() * 0.08 });
      }
    }
    // faint background stars, so the whole view feels like it's jumping
    for (let i = 0; i < 160; i++) {
      pts.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, a: 0.35, lag: Math.random() * 0.15 });
    }

    const easeIn = (t) => t * t * t;
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const p of pts) {
        const s = Math.max(0, Math.min(1, (t - p.lag) / (1 - p.lag)));
        // 0–0.7: the head races towards the centre while the tail barely moves (a long streak);
        // 0.7–0.85: the tail whips in after it and the streak collapses into the centre
        const head = easeIn(Math.min(1, s / 0.7)) * 0.97;
        const tail = s < 0.7 ? 0.04 * s : 0.03 + 0.97 * Math.min(1, (s - 0.7) / 0.15);
        if (tail >= head && s > 0.7) continue;
        const hx = p.x + (cx - p.x) * head, hy = p.y + (cy - p.y) * head;
        const tx = p.x + (cx - p.x) * tail, ty = p.y + (cy - p.y) * tail;
        if (Math.hypot(hx - tx, hy - ty) < 3 * dpr) {
          // still too short to read as a streak: draw a solid point of light, so the logo stays visible
          ctx.fillStyle = `rgba(160, 248, 255, ${p.a})`;
          ctx.fillRect(hx - dpr, hy - dpr, 2 * dpr, 2 * dpr);
          continue;
        }
        const g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, 'rgba(76, 240, 255, 0)');
        g.addColorStop(1, `rgba(220, 253, 255, ${p.a})`); // brightest at the leading tip
        ctx.strokeStyle = g;
        ctx.lineWidth = (1 + head * 1.5) * dpr;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      }
      // the white flash as everything collapses into the centre
      const flash = Math.max(0, 1 - Math.abs(t - 0.86) / 0.12);
      if (flash > 0) {
        const r = Math.max(canvas.width, canvas.height) * (0.15 + 0.6 * flash);
        const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        fg.addColorStop(0, `rgba(255, 255, 255, ${0.9 * flash})`);
        fg.addColorStop(0.3, `rgba(180, 250, 255, ${0.35 * flash})`);
        fg.addColorStop(1, 'rgba(76, 240, 255, 0)');
        ctx.fillStyle = fg; ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (t < 1) requestAnimationFrame(frame);
      else { canvas.remove(); resolve(); }
    };
    requestAnimationFrame(frame);
  });
}
