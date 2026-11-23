// BEYOND — an animated ASCII visualizer that lives outside the solar system.
// It plays once: an eye opens out of the static (the static is its skin), we fall into the pupil
// at one steady speed and fly through space to a pink core deep inside, then stay there with the
// core slowly beating. At the core, "signals" (interest categories from interests.js) orbit it as
// small character clusters; signals.js layers real buttons over them and runs the panels.
// Every frame each grid cell gets a brightness + colour family from a bit of maths, which picks a
// character from a ramp. Glyphs are pre-rendered once into an atlas, so a frame is just blits.

const FONT = "Inconsolata, ui-monospace, Menlo, monospace";
const RAMP = ' .:-=+*#%@';
const CHARS = RAMP + '+·|—';
const STAR_PLUS = RAMP.length, STAR_DOT = RAMP.length + 1, STAR_V = RAMP.length + 2, STAR_H = RAMP.length + 3;
const DASH = RAMP.indexOf('-'), EQUALS = RAMP.indexOf('=');
const LEVELS = 12;
const FIRE = 0, STAR = 1, PINK = 2, SCLERA = 3;
const FAMILIES = [
  ['#140600', '#5a1d02', '#c24a08', '#ff7a1a', '#ffb066', '#ffe6c7', '#ffffff'], // static + iris
  ['#0a141a', '#2c4650', '#6c9aa1', '#cfeff2', '#ffffff'], // sclera + starfield
  ['#1a0010', '#5c0638', '#b8167a', '#ff3cac', '#ff9ad6', '#ffe3f4'], // core
  ['#16100e', '#4a3c38', '#8f7e77', '#cfc2b8', '#efe6dd', '#fffaf4'], // sclera: warm off-white
];
// timeline (seconds)
// how open the upper lid is over time (smoothly interpolated keyframes): one continuous opening
// that starts slowly, picks up, then settles gently.
const OPEN_KEYS = [[3.4, 0], [4.3, 0.12], [5.4, 0.5], [6.5, 0.88], [7.5, 1]];
const BLINK_AT = 9.7; // one blink before we fall in
const ZOOM_START = 11; // start falling into the pupil
const ZOOM_RATE = 0.3; // one steady zoom speed: everything grows e^0.3 ≈ 1.35× per second
const ZOOM_EASE_IN = 2.5; // seconds to ease from still up to that speed, so the zoom doesn't jolt into motion
const TILT = -0.07; // radians (≈4°); the eye sits slightly tilted with its outer corner raised
const PUPIL_R = 0.16;
const CORE_FAR = 30; // the core starts this many times smaller than its final size
const CORE_SIZE = 0.38; // final radius, in half-screen-heights
const ARRIVE_EASE = 3; // seconds of gentle settling as we reach the core (the only change in speed)
// zoom depth (log of scale) at which the core is full size; it first shows up ~1s into the zoom
const Z_END = Math.log(CORE_FAR) + ZOOM_RATE;
const SETTLE_START = ZOOM_START + ZOOM_EASE_IN / 2 + Z_END / ZOOM_RATE - ARRIVE_EASE / 2;
const HOLD = SETTLE_START + ARRIVE_EASE; // the story stops here; the core keeps beating
export const PHASES = [
  { name: 'STATIC', start: 0 },
  { name: 'EYE', start: OPEN_KEYS[0][0] },
  { name: 'ZOOM', start: ZOOM_START },
  { name: 'SPACE', start: ZOOM_START + ZOOM_EASE_IN / 2 + Math.log(2.3 / PUPIL_R) / ZOOM_RATE }, // pupil fills the screen
  { name: 'CORE', start: SETTLE_START },
];
const BEAT_RATE = 2.4; // radians per second → one gentle beat every ~2.6s
const BEAT_SIZE = 0.015; // how much the core swells per beat

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function hashInt(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function sample(stops, t) {
  const f = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(f), k = f - i;
  const a = parseInt(stops[i].slice(1), 16), b = parseInt(stops[i + 1].slice(1), 16);
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
// upper-lid openness at time t: a Hermite curve through OPEN_KEYS, so it never stops dead between keys
function lidOpen(t) {
  const K = OPEN_KEYS, n = K.length;
  if (t <= K[0][0]) return 0;
  if (t >= K[n - 1][0]) return 1;
  let i = 0;
  while (t > K[i + 1][0]) i++;
  const slope = (a, b) => (K[b][1] - K[a][1]) / (K[b][0] - K[a][0]);
  const m0 = i > 0 ? slope(i - 1, i + 1) : 0;
  const m1 = i + 2 < n ? slope(i, i + 2) : 0;
  const [t0, p0] = K[i], [t1, p1] = K[i + 1];
  const h = t1 - t0, x = (t - t0) / h, x2 = x * x, x3 = x2 * x;
  const p = (2 * x3 - 3 * x2 + 1) * p0 + (x3 - 2 * x2 + x) * h * m0 + (-2 * x3 + 3 * x2) * p1 + (x3 - x2) * h * m1;
  return Math.min(1, Math.max(0, p));
}
// 0 = open, 1 = shut: a quick close (~0.1s), a brief hold, then a slightly slower ease-out re-open
function blinkShut(t) {
  const x = t - BLINK_AT;
  if (x < 0 || x > 0.5) return 0;
  if (x < 0.1) return (x / 0.1) ** 2;
  if (x < 0.15) return 1;
  return (1 - (x - 0.15) / 0.35) ** 2;
}
function mixHex(a, b, k) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const c = (s) => Math.round(((A >> s) & 255) * (1 - k) + ((B >> s) & 255) * k);
  return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
}
// a dark-to-bright palette around one accent colour, like the built-in families
const familyFor = (hex) => [mixHex(hex, '#000000', 0.9), mixHex(hex, '#000000', 0.6), mixHex(hex, '#000000', 0.25), hex, mixHex(hex, '#ffffff', 0.5), mixHex(hex, '#ffffff', 0.85)];
// a satellite: a small round cluster of characters (dx, dy in cells, brightness)
const SAT_SHAPE = [[-2, 0, 0.45], [-1, 0, 0.8], [0, 0, 1], [1, 0, 0.8], [2, 0, 0.45], [-1, -1, 0.35], [0, -1, 0.55], [1, -1, 0.35], [-1, 1, 0.35], [0, 1, 0.55], [1, 1, 0.35]];
const ORBIT_PERIOD = 90; // seconds per lap of the signal ring
const phaseIndex = (t) => {
  let p = 0;
  PHASES.forEach((ph, i) => { if (t >= ph.start) p = i; });
  return p;
};
// zoom speed as a fraction of ZOOM_RATE: eases in from still, holds steady, eases out at the core
function zoomVel(t) {
  if (t < ZOOM_START) return 0;
  return smooth(ZOOM_START, ZOOM_START + ZOOM_EASE_IN, t) * (1 - smooth(SETTLE_START, HOLD, t));
}
// zoom depth = log(scale), the integral of zoomVel: ease in, constant speed, then settle onto Z_END
// (∫ smoothstep = x³ − x⁴/2, so each eased stretch covers exactly half its duration at full speed)
function zoomDepth(t) {
  if (t <= ZOOM_START) return 0;
  const R = ZOOM_RATE, E = ZOOM_EASE_IN;
  if (t <= ZOOM_START + E) {
    const x = (t - ZOOM_START) / E;
    return R * E * (x * x * x - (x * x * x * x) / 2);
  }
  if (t <= SETTLE_START) return R * (E / 2 + t - ZOOM_START - E);
  const x = Math.min(1, (t - SETTLE_START) / ARRIVE_EASE);
  return R * (E / 2 + SETTLE_START - ZOOM_START - E) + R * ARRIVE_EASE * (x - x * x * x + (x * x * x * x) / 2);
}
// how fast we fly through the starfield: steady during the zoom, then a slow drift at the core
const flightSpeed = (t) => 0.06 * smooth(ZOOM_START, ZOOM_START + ZOOM_EASE_IN, t) + 0.4 * zoomVel(t);

export function createBeyond({ canvas, readout, reduceMotion = false, signals = [], onFrame = null, onBackgroundClick = null }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const fams = FAMILIES.concat(signals.map((sg) => familyFor(sg.color)));
  const SIG0 = FAMILIES.length; // palette index of the first signal
  let ring = 0, hoverIdx = -1, selIdx = -1, frameStep = 0, shiftX = 0;
  let tintFrom = PINK, tintTo = PINK, tintMix = 1; // core colour: crossfades cell by cell from → to
  let satGlyph = null, satB = null, satFam = null, satCells = [];
  const satPx = signals.map(() => ({ x: 0, y: 0 }));
  let running = false, paused = false, raf = 0;
  let T = 0, last = 0, fps = 60, hudAt = 0, throttle = 0;
  let W = 0, H = 0, cols = 0, rows = 0, cw = 0, ch = 0, gw = 0, gh = 0, dpr = 1;
  let atlas = null, colX = null, rowY = null, hashA = null, layoutKey = '';
  let starGlyph = null, starB = null, stars = null;
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const speed = reduceMotion ? 0.35 : 1;

  /* ---------- grid + glyph atlas ---------- */
  async function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${w}x${h}@${d}`;
    if (key === layoutKey) return;
    layoutKey = key;
    const mobile = w < 820;
    let px = mobile ? 16 : 12;
    const maxCells = mobile ? 5000 : 22000;
    try { await document.fonts.load(`600 ${px}px Inconsolata`); } catch { /* fall back to system mono */ }

    let ncw, nch, ncols, nrows;
    for (;;) {
      ctx.font = `600 ${px}px ${FONT}`;
      ncw = Math.ceil(ctx.measureText('M').width);
      nch = Math.ceil(px * 1.15);
      ncols = Math.ceil(w / ncw); nrows = Math.ceil(h / nch);
      if (ncols * nrows <= maxCells) break;
      px += 1;
    }
    W = w; H = h; dpr = d; cw = ncw; ch = nch; cols = ncols; rows = nrows;
    gw = Math.ceil(cw * dpr); gh = Math.ceil(ch * dpr);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.imageSmoothingEnabled = false;
    colX = new Float32Array(cols); rowY = new Float32Array(rows);
    for (let i = 0; i < cols; i++) colX[i] = Math.round(i * cw * dpr);
    for (let j = 0; j < rows; j++) rowY[j] = Math.round(j * ch * dpr);
    hashA = new Float32Array(cols * rows);
    for (let k = 0; k < hashA.length; k++) hashA[k] = hashInt(k, 7);
    starGlyph = new Int8Array(cols * rows);
    starB = new Float32Array(cols * rows);
    satGlyph = new Int8Array(cols * rows).fill(-1);
    satB = new Float32Array(cols * rows);
    satFam = new Uint8Array(cols * rows);
    satCells = [];
    if (!stars) initStars(mobile ? 220 : 520);
    atlas = buildAtlas(px);
  }

  // One row per (family, level), one column per character. Brighter levels get a baked-in glow.
  function buildAtlas(px) {
    const c = document.createElement('canvas');
    c.width = gw * CHARS.length;
    c.height = gh * fams.length * LEVELS;
    const x = c.getContext('2d');
    x.font = `600 ${px * dpr}px ${FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    fams.forEach((stops, fi) => {
      for (let l = 0; l < LEVELS; l++) {
        const color = sample(stops, (l + 1) / LEVELS);
        x.fillStyle = color;
        x.shadowColor = color;
        x.shadowBlur = l > LEVELS / 2 ? 3 * dpr : 0;
        const y = (fi * LEVELS + l) * gh;
        for (let k = 0; k < CHARS.length; k++) {
          x.save();
          x.beginPath(); x.rect(k * gw, y, gw, gh); x.clip();
          x.fillText(CHARS[k], k * gw + gw / 2, y + gh / 2);
          x.restore();
        }
      }
    });
    return c;
  }

  /* ---------- 3D starfield we fly through ---------- */
  const STAR_SPREAD = 3, STAR_NEAR = 0.25, STAR_FAR = 6;
  let seed = 1;
  const rnd = () => hashInt(seed++, 99);
  function placeStar(s, far) {
    stars[s * 4] = (rnd() * 2 - 1) * STAR_SPREAD;
    stars[s * 4 + 1] = (rnd() * 2 - 1) * STAR_SPREAD;
    stars[s * 4 + 2] = far ? STAR_FAR : STAR_NEAR + rnd() * (STAR_FAR - STAR_NEAR);
    stars[s * 4 + 3] = rnd();
  }
  function initStars(n) {
    stars = new Float32Array(n * 4);
    for (let s = 0; s < n; s++) placeStar(s, false);
  }
  function flyStars(dz) {
    for (let s = 0; s < stars.length / 4; s++) {
      const z = (stars[s * 4 + 2] -= dz);
      if (z < STAR_NEAR) placeStar(s, true);
    }
  }
  // project every star into a per-cell buffer: far stars are dots, near ones are crosses
  function stampStars() {
    starGlyph.fill(-1);
    starB.fill(0);
    const half = H / 2;
    const put = (i, j, g, b) => {
      if (i < 0 || j < 0 || i >= cols || j >= rows) return;
      const k = j * cols + i;
      if (b > starB[k]) { starB[k] = b; starGlyph[k] = g; }
    };
    for (let s = 0; s < stars.length / 4; s++) {
      const z = stars[s * 4 + 2], sd = stars[s * 4 + 3];
      const i = Math.floor((stars[s * 4] / z * half + W / 2) / cw);
      const j = Math.floor((stars[s * 4 + 1] / z * half + H / 2) / ch);
      const near = 1 - z / STAR_FAR;
      const tw = reduceMotion ? 0.85 : 0.6 + 0.4 * Math.sin(T * (1.2 + sd * 3) + sd * 40);
      const b = Math.min(1, (0.25 + 0.75 * near) * tw);
      if (near > 0.7) {
        put(i, j, STAR_PLUS, b);
        put(i - 1, j, STAR_H, b * 0.55); put(i + 1, j, STAR_H, b * 0.55);
        put(i, j - 1, STAR_V, b * 0.55); put(i, j + 1, STAR_V, b * 0.55);
      } else {
        put(i, j, near > 0.4 ? STAR_PLUS : STAR_DOT, b);
      }
    }
  }

  /* ---------- one frame ---------- */
  function render() {
    const half = H / 2;
    const t = Math.min(T, HOLD); // drives the story; T keeps running for the heartbeat and twinkle

    // the upper lid does the moving; once open it drifts very slightly so it never looks frozen
    const drift = t > OPEN_KEYS[OPEN_KEYS.length - 1][0] ? 0.03 * (0.5 + 0.5 * Math.sin(T * 0.7)) : 0;
    const open = lidOpen(t) * (1 - blinkShut(t)) * (1 - drift);
    const lashIn = smooth(OPEN_KEYS[0][0] - 0.6, OPEN_KEYS[0][0] + 0.2, t); // the closed-eye line appears first
    const Z = zoomDepth(t);
    const scale = Math.exp(Z);
    const pupilR = PUPIL_R;
    const starsInPupil = smooth(ZOOM_START + 0.3, ZOOM_START + 2.5, t);
    const eyeGone = pupilR * scale > Math.hypot(W / H, 1) + 0.1; // the pupil now fills the screen
    const flickRate = reduceMotion ? 1 : 4;

    // the eye follows the pointer, less and less as we fall in (so we land dead centre)
    const follow = 1 - smooth(ZOOM_START, ZOOM_START + 4, t);
    const zx = look.x * 0.13 * follow, zy = look.y * 0.1 * follow; // pupil centre = zoom centre
    const irisX = look.x * 0.09 * follow, irisY = look.y * 0.07 * follow;
    const tc = Math.cos(TILT), ts = Math.sin(TILT);
    const irisLX = irisX * tc + irisY * ts, irisLY = irisY * tc - irisX * ts; // iris centre, eye-local
    const staticFade = 1 - 0.45 * smooth(ZOOM_START, ZOOM_START + 5, t); // the skin dims as we fall in

    // the core: a far point deep in the pupil that grows with the same steady zoom
    const beat = Math.sin(T * BEAT_RATE);
    const coreR = CORE_SIZE * Math.exp(Z - Z_END) * (1 + BEAT_SIZE * beat);
    const coreVis = smooth(ZOOM_START + 0.8, ZOOM_START + 2.3, t);
    const haloW = Math.max(0.015, coreR * 0.55);

    // at the core: signals fade in; on phones the core moves up to make room for the category list
    const mobile = W < 820;
    const arrive = smooth(HOLD - 0.3, HOLD + 1.5, T);
    const n = signals.length;
    const rx = Math.min(0.98, W / H - 0.3), ry = 0.62;
    const ease = 1 - Math.exp(-frameStep * 5);
    // with a panel open on desktop, slide the core and ring left so the panel doesn't cover them
    const wantShift = selIdx >= 0 && !mobile ? Math.max(0, Math.min(0.42, W / H - rx * 0.87 - 0.25)) : 0;
    shiftX += (wantShift - shiftX) * ease;
    const ccx = zx - shiftX, ccy = zy + (mobile ? -0.28 * smooth(HOLD - 1, HOLD + 1, T) : 0);
    for (let s = 0; s < n; s++) {
      const th = ring + (s / n) * Math.PI * 2 - Math.PI / 2;
      const su = ccx + rx * Math.cos(th), sv = ccy + ry * Math.sin(th);
      satPx[s].x = W / 2 + su * half; satPx[s].y = H / 2 + sv * half; satPx[s].depth = 0.8 + 0.2 * Math.sin(th);
    }
    const cx = ccx, cy = ccy;

    // stamp the signal clusters into their own cell buffer (desktop only; phones get a list)
    for (const kk of satCells) satGlyph[kk] = -1;
    satCells = [];
    if (!mobile && arrive > 0) {
      for (let s = 0; s < n; s++) {
        const ci = Math.floor(satPx[s].x / cw), cj = Math.floor(satPx[s].y / ch);
        const hl = s === hoverIdx || s === selIdx ? 1 : 0.62;
        const tw = reduceMotion ? 1 : 0.9 + 0.1 * Math.sin(T * 2 + s * 1.7);
        for (const [dx, dy, bb] of SAT_SHAPE) {
          const i = ci + dx, j = cj + dy;
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          const kk = j * cols + i, b = bb * arrive * satPx[s].depth * hl * tw;
          if (b < 0.06) continue;
          satGlyph[kk] = Math.max(1, Math.min(RAMP.length - 1, Math.floor(b * RAMP.length)));
          satB[kk] = b; satFam[kk] = SIG0 + s; satCells.push(kk);
        }
      }
    }

    if (t >= ZOOM_START) stampStars();

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let k = 0;
    for (let j = 0; j < rows; j++) {
      const v = ((j + 0.5) * ch - half) / half;
      for (let i = 0; i < cols; i++, k++) {
        const u = ((i + 0.5) * cw - W / 2) / half;
        const h1 = hashA[k];
        let b = 0, fam = FIRE, glyph = -1, space = false, spaceMul = 1;
        if (satGlyph[k] >= 0) {
          const lv = Math.min(LEVELS - 1, Math.floor(satB[k] * LEVELS));
          ctx.drawImage(atlas, satGlyph[k] * gw, (satFam[k] * LEVELS + lv) * gh, gw, gh, colX[i], rowY[j], gw, gh);
          continue;
        }

        if (!eyeGone) {
          // 1–3 · an eye opens out of the static, then we fall into the pupil
          const qx = zx + (u - zx) / scale, qy = zy + (v - zy) / scale;
          // eye-local coordinates: the same point, un-rotated by the eye's tilt
          const lx = qx * tc + qy * ts, ly = qy * tc - qx * ts;
          const prof = Math.max(0, 1 - (lx / 1.3) * (lx / 1.3));
          // the lower lid barely moves; the upper lid sweeps up from it (so a closed eye is a low line)
          const lowEdge = 0.42 * prof * (0.88 + 0.12 * open);
          const upEdge = lowEdge + (-0.5 * prof - lowEdge) * open;
          const px = qx - zx, py = qy - zy;
          if (prof <= 0 || ly <= upEdge || ly >= lowEdge) {
            if (prof > 0 && ly <= upEdge && ly > upEdge - 0.03 * lashIn) {
              glyph = open > 0.02 ? EQUALS : DASH; b = 0.16 * staticFade; // upper lash line
            } else if (prof > 0 && ly >= lowEdge && ly < lowEdge + 0.018 * lashIn) {
              glyph = DASH; b = 0.1 * staticFade; // lower lid line
            } else {
              // the static is the skin: dim and mostly orange, with only the odd bright character
              const n = hashInt(k, Math.floor(T * flickRate + h1 * 7));
              b = (0.08 + 0.52 * n * n * n) * staticFade;
            }
          } else if (px * px + py * py < pupilR * pupilR) {
            space = true; spaceMul = starsInPupil; // deep inside the pupil
          } else {
            const along = (ly - upEdge) / (lowEdge - upEdge); // 0 at the upper lid, 1 at the lower
            const dx = lx - irisLX, dy = ly - irisLY;
            const r = Math.sqrt(dx * dx + dy * dy);
            const IR = 0.4;
            if (r < IR) {
              const tt = Math.max(0, (r - pupilR) / (IR - pupilR));
              const ang = Math.atan2(dy, dx);
              const fib = 0.55 + 0.45 * Math.sin(ang * 38 + 2.5 * Math.sin(ang * 7) + h1 * 1.5);
              let base = 1 - 0.55 * tt;
              base *= 1 - 0.75 * smooth(0.8, 1, tt); // dark limbal ring
              base += 0.25 * Math.exp(-((tt - 0.22) ** 2) / 0.004); // collarette
              b = base * fib;
            } else {
              // sclera: warm white, a little greyer towards the corners
              const corner = Math.abs(lx) / 1.3;
              b = 0.8 - 0.3 * corner * corner - 0.08 * h1;
              fam = SCLERA;
            }
            // shadow under the lids, deeper under the upper one
            b *= (1 - 0.6 * (1 - smooth(0, 0.3, along))) * (1 - 0.35 * (1 - smooth(0, 0.15, 1 - along)));
          }
        } else {
          space = true; // 4–5 · flying through space to the core
        }

        if (space) {
          if (starGlyph[k] >= 0) { glyph = starGlyph[k]; b = starB[k] * spaceMul; fam = STAR; }
          if (coreVis > 0) {
            const du = u - cx, dv = v - cy;
            const d = Math.sqrt(du * du + dv * dv);
            const coreFam = h1 < tintMix ? tintTo : tintFrom; // cell-by-cell colour crossfade
            if (d < coreR) {
              const nx = du / coreR, ny = dv / coreR;
              const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
              const lam = Math.max(0, -0.45 * nx - 0.55 * ny + 0.7 * nz);
              b = (0.16 + 0.84 * lam) * (0.92 + 0.08 * Math.sin((du * 3 + dv * 2) * 9 - T * 0.8)) * (0.96 + 0.04 * beat);
              b = Math.max(b, 0.75 * smooth(0.86, 1, d / coreR)); // rim light
              b *= coreVis; glyph = -1; fam = coreFam;
            } else {
              const g = Math.exp(-(d - coreR) / haloW) * 0.55 * coreVis * (0.96 + 0.04 * beat);
              if (g > b) { b = g; glyph = -1; fam = coreFam; }
            }
          }
          if (glyph < 0 && b < 0.06) continue;
          if (glyph >= 0 && b < 0.03) continue;
        }

        if (b > 1) b = 1;
        if (glyph < 0) {
          if (b < 0.06) continue;
          glyph = Math.max(1, Math.min(RAMP.length - 1, Math.floor(b * RAMP.length)));
        }
        const lev = Math.min(LEVELS - 1, Math.max(0, Math.floor(b * LEVELS)));
        ctx.drawImage(atlas, glyph * gw, (fam * LEVELS + lev) * gh, gw, gh, colX[i], rowY[j], gw, gh);
      }
    }
  }

  function updateReadout(force) {
    if (!readout) return;
    const now = performance.now();
    if (!force && now - hudAt < 250) return;
    hudAt = now;
    const p = phaseIndex(Math.min(T, HOLD));
    const where = T >= HOLD && signals.length ? `CORE · ${signals.length} SIGNALS` : `PHASE ${p + 1}/${PHASES.length} · ${PHASES[p].name}`;
    readout.textContent = `BEYOND // ${where} · ${Math.round(fps)} FPS${paused ? ' · PAUSED' : ''}`;
  }

  function tick(now) {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    // reduced motion: a slow, low-frame-rate version
    if (reduceMotion) { throttle += dt; if (throttle < 1 / 12) return; }
    const step = reduceMotion ? throttle : dt;
    throttle = 0;
    if (!paused) {
      const dT = step * speed;
      flyStars(flightSpeed(Math.min(T, HOLD)) * dT);
      T += dT;
      // the ring keeps orbiting (even under the pointer); it only waits while a panel is open
      if (!reduceMotion && selIdx < 0) ring += (dT / ORBIT_PERIOD) * Math.PI * 2;
    }
    tintMix = Math.min(1, tintMix + step * 1.6);
    frameStep = step;
    const ease = 1 - Math.exp(-step * 4);
    look.x += (look.tx - look.x) * ease;
    look.y += (look.ty - look.y) * ease;
    if (step > 0) fps += (1 / step - fps) * 0.1;
    render();
    updateReadout(false);
    if (onFrame) onFrame({ sats: satPx, arrive: smooth(HOLD - 0.3, HOLD + 1.5, T), atCore: T >= HOLD, mobile: W < 820 });
  }

  /* ---------- input (navigation in/out is handled by main.js) ---------- */
  canvas.addEventListener('pointermove', (e) => {
    look.tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
    look.ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
  });
  canvas.addEventListener('pointerleave', () => { look.tx = 0; look.ty = 0; });
  canvas.addEventListener('click', () => {
    if (onBackgroundClick && onBackgroundClick()) return; // e.g. clicking empty space closes a panel
    api.togglePause();
  });
  window.addEventListener('resize', () => {
    if (running) layout();
  });

  const api = {
    get running() { return running; },
    start() {
      if (running) return;
      running = true; paused = false; T = 0; fps = 60;
      layout().then(() => {
        if (!running) return;
        last = performance.now();
        render();
        updateReadout(true);
        raf = requestAnimationFrame(tick);
      });
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    togglePause() {
      paused = !paused;
      updateReadout(true);
    },
    get atCore() { return running && T >= HOLD; },
    // a signal under the pointer / keyboard focus: brightens
    hover(i) { hoverIdx = i; },
    // the open signal (-1 for none): the core crossfades to its colour
    select(i) {
      const target = i >= 0 ? SIG0 + i : PINK;
      selIdx = i;
      if (target === tintTo) return;
      tintFrom = tintMix >= 0.5 ? tintTo : tintFrom;
      tintTo = target;
      tintMix = reduceMotion ? 1 : 0;
    },
    // jump past the eye sequence straight to the arrived core (for people who've seen it)
    skipToCore() {
      T = Math.max(T, HOLD);
      if (running && atlas) render();
      updateReadout(true);
    },
    // start the whole sequence again from static
    replay() {
      T = 0; ring = 0; hoverIdx = -1; selIdx = -1; shiftX = 0; paused = false;
      tintFrom = tintTo = PINK; tintMix = 1;
      if (running && atlas) render();
      updateReadout(true);
    },
    // jump to the start of the next / previous phase (the core is the end, it doesn't wrap)
    skip(dir) {
      const p = Math.max(0, Math.min(PHASES.length - 1, phaseIndex(Math.min(T, HOLD)) + dir));
      if (p === PHASES.length - 1 && dir > 0) T = Math.max(T, HOLD); // straight to the arrived core
      else T = PHASES[p].start;
      if (running && atlas) render();
      updateReadout(true);
    },
  };
  return api;
}
