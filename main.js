import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SUN, PLANETS } from './data.js';

const SUN_RADIUS = 3.4;
const INSTANT = new URLSearchParams(location.search).has('instant'); // debug: skip tweens + boot
const $ = (id) => document.getElementById(id);
const pad = (n, w = 2) => String(n).padStart(w, '0');

/* ======================================================================
   Noise — deterministic value noise used to carve continents
   ====================================================================== */
function hash3(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
function fbm(x, y, z, seed) {
  let sum = 0, amp = 0.5, f = 1.6;
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * f, y * f, z * f, seed + o * 17);
    amp *= 0.5; f *= 2.1;
  }
  return sum;
}
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ======================================================================
   Renderer / scene
   ====================================================================== */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000306);
scene.fog = new THREE.FogExp2(0x000306, 0.006);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 2000);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.4, 0.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ======================================================================
   Hex-dot point material (the ENCOM globe look)
   ====================================================================== */
function hexPointsMaterial(color, size) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uSize: { value: size },
      uScale: { value: window.innerHeight * renderer.getPixelRatio() / 2 },
      uTime: { value: 0 },
      uActiveCity: { value: -1 },
      uFocus: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aBright;
      attribute float aCity;
      attribute float aPhase;
      uniform float uSize, uScale, uTime, uActiveCity, uFocus;
      varying float vBright;
      varying float vCity;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float twinkle = 0.85 + 0.15 * sin(uTime * 1.7 + aPhase * 6.283);
        float isActive = (aCity >= 0.0 && abs(aCity - uActiveCity) < 0.5) ? 1.0 : 0.0;
        vBright = aBright * twinkle + isActive * (0.12 + 0.12 * sin(uTime * 4.0 + aPhase * 6.283));
        vCity = aCity >= 0.0 ? 1.0 : 0.0;
        gl_PointSize = uSize * uScale * projectionMatrix[1][1] / -mv.z * (1.0 + isActive * 0.35);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vBright;
      varying float vCity;
      void main() {
        vec2 p = abs(gl_PointCoord - 0.5);
        float hex = max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
        if (hex > 0.42) discard;
        vec3 col = mix(uColor, vec3(1.0, 0.97, 0.9), vCity * 0.3);
        float edge = 1.0 - smoothstep(0.34, 0.42, hex);
        gl_FragColor = vec4(col * vBright, edge * clamp(vBright, 0.0, 1.0));
      }
    `,
  });
}

/* Fresnel atmosphere shell */
function atmosphereMaterial(color, power = 3.0, intensity = 1.0) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uIntensity: { value: intensity } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uPower, uIntensity;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(clamp(-dot(vN, vV), 0.0, 1.0), uPower);
        gl_FragColor = vec4(uColor * f * uIntensity, f * uIntensity);
      }
    `,
  });
}

/* ======================================================================
   Starfield
   ====================================================================== */
{
  const rand = mulberry(7);
  const N = 4000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 300 + rand() * 500;
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(2 * rand() - 1);
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)], i * 3);
    const t = rand();
    const c = t < 0.75 ? [0.55, 0.85, 0.9] : t < 0.92 ? [1, 1, 1] : [1, 0.8, 0.5];
    const b = 0.3 + rand() * 0.7;
    col.set(c.map((v) => v * b), i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, vertexColors: true, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
  scene.add(stars);
}

/* Faint ecliptic grid */
{
  const grid = new THREE.PolarGridHelper(38, 24, 12, 96, 0x0c3a40, 0x0c3a40);
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  grid.position.y = -0.01;
  scene.add(grid);
}

/* ======================================================================
   Sun
   ====================================================================== */
const sun = new THREE.Group();
scene.add(sun);
{
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS * 0.94, 64, 64),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() {
          vP = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vP; varying vec3 vN; varying vec3 vV;
        float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
        float n(vec3 p){
          vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
        void main() {
          vec3 p = vP * 1.4;
          float t = uTime * 0.15;
          float v = n(p + t) * 0.5 + n(p * 2.3 - t) * 0.3 + n(p * 5.1 + t * 2.0) * 0.2;
          float rim = pow(1.0 - max(dot(vN, vV), 0.0), 2.0);
          vec3 a = vec3(0.9, 0.3, 0.04), b = vec3(1.0, 0.75, 0.35);
          vec3 col = mix(a, b, smoothstep(0.35, 0.75, v)) * (0.55 + rim * 0.5);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  core.name = 'sunCore';
  sun.add(core);

  // hex-dot shell around the core, same language as the planets
  const N = 3200;
  const pos = new Float32Array(N * 3), bright = new Float32Array(N), city = new Float32Array(N), phase = new Float32Array(N);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    pos.set([x * SUN_RADIUS, y * SUN_RADIUS, z * SUN_RADIUS], i * 3);
    bright[i] = 0.25 + fbm(x * 2, y * 2, z * 2, 99) * 0.7;
    city[i] = -1; phase[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  g.setAttribute('aCity', new THREE.BufferAttribute(city, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const shell = new THREE.Points(g, hexPointsMaterial('#ffc857', Math.sqrt((4 * Math.PI * SUN_RADIUS * SUN_RADIUS) / N) * 1.05));
  shell.name = 'sunShell';
  sun.add(shell);

  sun.add(new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS * 1.45, 48, 48), atmosphereMaterial('#ff9a3c', 1.6, 1.1)));

  // corona sprite
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,200,120,0.9)');
  grad.addColorStop(0.25, 'rgba(255,150,60,0.35)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 256);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sprite.scale.setScalar(SUN_RADIUS * 4.2);
  sun.add(sprite);

  // equatorial HUD ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(SUN_RADIUS * 1.55, SUN_RADIUS * 1.58, 128),
    new THREE.MeshBasicMaterial({ color: '#ffc857', transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  ring.rotation.x = Math.PI / 2;
  sun.add(ring);

  // pick target
  const hit = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS * 1.1, 16, 16), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData = { kind: 'sun' };
  sun.add(hit);
  sun.userData.hit = hit;
}

/* ======================================================================
   Planets + civilizations
   ====================================================================== */
const pickables = [sun.userData.hit];
const planets = PLANETS.map((data, pi) => buildPlanet(data, pi));

function buildPlanet(data, pi) {
  const R = data.radius;
  const rand = mulberry(data.seed);
  const root = new THREE.Group(); // orbit position
  const tilt = new THREE.Group(); // axial tilt
  const spin = new THREE.Group(); // self rotation
  tilt.rotation.z = (rand() - 0.5) * 0.5;
  root.add(tilt); tilt.add(spin);
  scene.add(root);

  // --- surface points (fibonacci sphere, carved into continents) ---
  const N = Math.round(1500 * R * R);
  const dirs = new Float32Array(N * 3);
  const noise = new Float32Array(N);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    dirs.set([x, y, z], i * 3);
    noise[i] = fbm(x + 10, y + 10, z + 10, data.seed);
  }
  const sorted = Array.from(noise).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(N * 0.52)];

  // place civilizations: spread around longitude, mid-latitudes, snapped to land
  const civDirs = data.civs.map((_, ci) => {
    const n = data.civs.length;
    const lon = (ci / n) * Math.PI * 2 + rand() * 0.5;
    const lat = (rand() - 0.5) * (n > 4 ? 1.4 : 0.9) + (n > 4 ? (ci % 2 ? 0.35 : -0.35) : 0);
    const v = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
    let best = -2, bi = 0;
    for (let i = 0; i < N; i++) {
      if (noise[i] < threshold) continue;
      const d = dirs[i * 3] * v.x + dirs[i * 3 + 1] * v.y + dirs[i * 3 + 2] * v.z;
      if (d > best) { best = d; bi = i; }
    }
    return new THREE.Vector3(dirs[bi * 3], dirs[bi * 3 + 1], dirs[bi * 3 + 2]);
  });

  const pos = [], bright = [], city = [], phase = [];
  const cityRadius = 0.2;
  for (let i = 0; i < N; i++) {
    const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
    let ci = -1, cd = 0;
    civDirs.forEach((c, k) => {
      const d = c.x * x + c.y * y + c.z * z;
      if (d > Math.cos(cityRadius) && d > cd) { cd = d; ci = k; }
    });
    const land = noise[i] >= threshold;
    if (!land && ci < 0) {
      // sparse ocean grid so the sphere still reads as a sphere
      if (i % 5 !== 0) continue;
      pos.push(x * R, y * R, z * R); bright.push(0.14); city.push(-1); phase.push(Math.random());
      continue;
    }
    const elev = land ? (noise[i] - threshold) * 0.06 * R : 0;
    pos.push(x * (R + elev), y * (R + elev), z * (R + elev));
    bright.push(ci >= 0 ? 0.55 : 0.4 + (noise[i] - threshold) * 1.4);
    city.push(ci); phase.push(Math.random());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1));
  g.setAttribute('aCity', new THREE.Float32BufferAttribute(city, 1));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  const spacing = Math.sqrt((4 * Math.PI * R * R) / N);
  const surfaceMat = hexPointsMaterial(data.color, spacing * 1.05);
  spin.add(new THREE.Points(g, surfaceMat));

  // dark occluder so back-side dots are hidden
  const occluder = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.985, 48, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(data.color).multiplyScalar(0.035) }),
  );
  occluder.userData = { kind: 'planet', planet: pi };
  spin.add(occluder);
  pickables.push(occluder);

  tilt.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.22, 48, 48), atmosphereMaterial(data.color, 1.4, 0.8)));

  // latitude ring like a HUD bracket
  const band = new THREE.Mesh(
    new THREE.RingGeometry(R * 1.32, R * 1.335, 96),
    new THREE.MeshBasicMaterial({ color: data.color, transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
  );
  band.rotation.x = Math.PI / 2;
  tilt.add(band);

  // --- civilization markers ---
  const civs = data.civs.map((civ, ci) => {
    const dir = civDirs[ci];
    const base = dir.clone().multiplyScalar(R * 1.01);
    const top = dir.clone().multiplyScalar(R * 1.32);
    const marker = new THREE.Group();

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([base, top]),
      new THREE.LineBasicMaterial({ color: data.color, transparent: true, opacity: 0.8 }),
    );
    marker.add(line);

    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(R * 0.035),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(data.color).lerp(new THREE.Color('#ffffff'), 0.5) }),
    );
    beacon.position.copy(top);
    marker.add(beacon);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.06, R * 0.075, 32),
      new THREE.MeshBasicMaterial({ color: data.color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.position.copy(base);
    ring.lookAt(base.clone().multiplyScalar(2));
    marker.add(ring);

    const hit = new THREE.Mesh(new THREE.SphereGeometry(R * 0.14, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(dir.clone().multiplyScalar(R * 1.15));
    hit.userData = { kind: 'civ', planet: pi, civ: ci };
    marker.add(hit);
    pickables.push(hit);

    spin.add(marker);
    return { data: civ, dir, top, ring, beacon, line, marker };
  });

  // --- orbit path ---
  const pts = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * data.orbit, 0, Math.sin(a) * data.orbit));
  }
  const orbitLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: data.color, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.28 }),
  );
  orbitLine.computeLineDistances();
  scene.add(orbitLine);

  return {
    data, index: pi, root, tilt, spin, civs, surfaceMat, orbitLine,
    angle: rand() * Math.PI * 2,
    spinSpeed: 0.08 + rand() * 0.06,
  };
}

/* ======================================================================
   Camera rig — spherical orbit around a moving target
   ====================================================================== */
const rig = {
  target: new THREE.Vector3(),
  targetGoal: new THREE.Vector3(),
  theta: 0.6, phi: 1.05, radius: 140,
  goal: { theta: 0.6, phi: 1.05, radius: 62 },
  min: 4, max: 120,
};
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
function updateCamera(dt) {
  const k = INSTANT ? 1 : 1 - Math.pow(0.0025, dt);
  rig.target.lerp(rig.targetGoal, k);
  rig.theta = angleLerp(rig.theta, rig.goal.theta, k);
  rig.phi += (rig.goal.phi - rig.phi) * k;
  rig.radius += (rig.goal.radius - rig.radius) * k;
  const s = Math.sin(rig.phi);
  camera.position.set(
    rig.target.x + rig.radius * s * Math.sin(rig.theta),
    rig.target.y + rig.radius * Math.cos(rig.phi),
    rig.target.z + rig.radius * s * Math.cos(rig.theta),
  );
  camera.lookAt(rig.target);
}

/* ======================================================================
   State / navigation
   ====================================================================== */
const state = {
  view: 'system', // 'system' | 'sun' | 'planet'
  planet: -1,
  civ: -1,
  timeScale: 1,
  idle: 0,
};

function worldPos(obj, v = new THREE.Vector3()) { return obj.getWorldPosition(v); }

function goSystem({ push = true } = {}) {
  state.view = 'system'; state.planet = -1; state.civ = -1;
  rig.targetGoal.set(0, 0, 0);
  rig.goal.radius = window.innerWidth < 820 ? 88 : 58;
  rig.goal.phi = 1.05;
  rig.min = 12; rig.max = 120;
  closeDetail();
  afterNav(push);
}

function goSun({ push = true } = {}) {
  state.view = 'sun'; state.planet = -1; state.civ = -1;
  rig.targetGoal.set(0, 0, 0);
  rig.goal.radius = SUN_RADIUS * (window.innerWidth < 820 ? 7.5 : 5.6);
  rig.goal.phi = 1.25;
  rig.min = SUN_RADIUS * 2; rig.max = 60;
  openDetail(renderSun(), SUN.id, '#ffc857');
  afterNav(push);
}

function goPlanet(pi, { push = true } = {}) {
  const p = planets[pi];
  state.view = 'planet'; state.planet = pi; state.civ = -1;
  rig.goal.radius = p.data.radius * (window.innerWidth < 820 ? 7.5 : 5.4);
  rig.goal.phi = 1.2;
  rig.min = p.data.radius * 1.8; rig.max = 40;
  openDetail(renderPlanet(p), p.data.id, p.data.color);
  afterNav(push);
}

function goCiv(pi, ci, { push = true } = {}) {
  if (state.planet !== pi) goPlanet(pi, { push: false });
  const p = planets[pi];
  state.view = 'planet'; state.civ = ci;
  // turn the camera to face the civilization
  const civ = p.civs[ci];
  p.spin.updateMatrixWorld(true);
  const center = worldPos(p.root);
  const w = civ.top.clone().applyMatrix4(p.spin.matrixWorld).sub(center).normalize();
  rig.goal.theta = Math.atan2(w.x, w.z) + (window.innerWidth < 820 ? 0 : 0.25);
  rig.goal.phi = THREE.MathUtils.clamp(Math.acos(w.y) + 0.12, 0.35, Math.PI - 0.35);
  rig.goal.radius = p.data.radius * (window.innerWidth < 820 ? 6.2 : 4.4);
  openDetail(renderCiv(p, ci), `${p.data.id}-${civ.data.id}`, p.data.color);
  afterNav(push);
}

function goBack() {
  if (state.view === 'planet' && state.civ >= 0) goPlanet(state.planet);
  else if (state.view !== 'system') goSystem();
}

function afterNav(push) {
  document.body.classList.toggle('focus', state.view !== 'system');
  $('backBtn').hidden = state.view === 'system';
  planets.forEach((p, i) => p.surfaceMat.uniforms.uActiveCity.value = i === state.planet ? state.civ : -1);
  renderCrumbs();
  renderIndex();
  if (push) {
    const h = hashFor();
    if (location.hash !== h) history.pushState(null, '', h || location.pathname);
  }
}

function hashFor() {
  if (state.view === 'sun') return '#/origin';
  if (state.view === 'planet') {
    const p = planets[state.planet];
    return `#/${p.data.id}` + (state.civ >= 0 ? `/${p.civs[state.civ].data.id}` : '');
  }
  return '';
}

function fromHash() {
  const [, a, b] = location.hash.split('/');
  if (a === 'origin') return goSun({ push: false });
  const pi = planets.findIndex((p) => p.data.id === a);
  if (pi < 0) return goSystem({ push: false });
  const ci = planets[pi].civs.findIndex((c) => c.data.id === b);
  if (ci >= 0) goCiv(pi, ci, { push: false });
  else goPlanet(pi, { push: false });
}
window.addEventListener('popstate', fromHash);

/* ======================================================================
   HUD rendering
   ====================================================================== */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const detail = $('detail'), detailBody = $('detailBody');

function openDetail(html, key, color) {
  detail.style.setProperty('--c', color);
  if (detail.dataset.key !== key) {
    detailBody.innerHTML = html;
    detail.scrollTop = 0;
    detail.dataset.key = key;
  }
  detail.classList.add('open');
}
function closeDetail() { detail.classList.remove('open'); detail.dataset.key = ''; }

function coordFor(p, ci) {
  const d = p.civs[ci].dir;
  const lat = (Math.asin(d.y) * 180) / Math.PI;
  const lon = (Math.atan2(d.z, d.x) * 180) / Math.PI;
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

function renderSun() {
  return `<div class="d-wrap">
    <div class="d-kicker">${SUN.designation} · SECTOR 00</div>
    <h2 class="d-title">${esc(SUN.name)}</h2>
    <div class="d-coord">${esc(SUN.tagline)}</div>
    ${SUN.bio.map((b) => `<p class="d-text">${esc(b)}</p>`).join('')}
    <div class="d-sec">TELEMETRY</div>
    ${SUN.stats.map(([k, v]) => `<div class="stat"><span>${k}</span><span>${esc(v)}</span></div>`).join('')}
    <blockquote class="q">“${esc(SUN.quote.text)}”<cite>— ${esc(SUN.quote.by)}</cite></blockquote>
    <div class="d-sec">ORBITING BODIES</div>
    <ul class="civ-list">${planets.map((p, i) => `
      <li><button data-planet="${i}" style="--c:${p.data.color}">
        <span class="n">${pad(i + 1)}</span><span>${p.data.name}</span><span class="t">${pad(p.civs.length)} CIV</span>
      </button></li>`).join('')}
    </ul>
    <div class="d-actions">${SUN.links.map((l, i) => `<a class="btn ${i ? 'ghost' : ''}" href="${l.href}" target="_blank" rel="noopener">${l.label} ↗</a>`).join('')}</div>
  </div>`;
}

function renderPlanet(p) {
  const d = p.data;
  return `<div class="d-wrap">
    <div class="d-kicker">PLANET ${pad(p.index + 1)} · ORBIT ${d.orbit.toFixed(1)} AU</div>
    <h2 class="d-title">${d.name}</h2>
    <div class="d-coord">${pad(p.civs.length)} CIVILIZATION${p.civs.length === 1 ? '' : 'S'} DETECTED</div>
    <p class="d-text">${esc(d.blurb)}</p>
    <div class="d-sec">SETTLEMENTS</div>
    <ul class="civ-list">${p.civs.map((c, i) => `
      <li><button data-planet="${p.index}" data-civ="${i}">
        <span class="n">${pad(i + 1)}</span><span>${esc(c.data.name)}</span><span class="t">${esc(c.data.tech[0] || '')}</span>
      </button></li>`).join('')}
    </ul>
  </div>`;
}

function renderCiv(p, ci) {
  const c = p.civs[ci].data;
  const n = p.civs.length;
  return `<div class="d-wrap">
    <div class="d-kicker">${p.data.name} · CIV ${pad(ci + 1)}/${pad(n)}</div>
    <h2 class="d-title">${esc(c.name)}</h2>
    <div class="d-coord">${coordFor(p, ci)}${c.meta ? ' · ' + esc(c.meta) : ''}</div>
    ${c.badge ? `<div class="d-badge">★ ${esc(c.badge)}</div>` : ''}
    <p class="d-text">${esc(c.desc)}</p>
    <div class="d-sec">BUILT WITH</div>
    <div class="chips">${c.tech.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    ${c.link ? `<div class="d-actions"><a class="btn" href="${c.link}" target="_blank" rel="noopener">${c.linkLabel || 'VISIT'} ↗</a></div>` : ''}
    <div class="pager">
      <button data-planet="${p.index}" data-civ="${(ci - 1 + n) % n}">◂ PREV</button>
      <button data-planet="${p.index}">ALL ${pad(n)}</button>
      <button data-planet="${p.index}" data-civ="${(ci + 1) % n}">NEXT ▸</button>
    </div>
  </div>`;
}

detail.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-planet]');
  if (!b) return;
  const pi = +b.dataset.planet;
  if (b.dataset.civ != null) goCiv(pi, +b.dataset.civ);
  else goPlanet(pi);
});
$('detailClose').addEventListener('click', () => (state.view === 'planet' && state.civ >= 0 ? goPlanet(state.planet) : goSystem()));
$('backBtn').addEventListener('click', goBack);

function renderCrumbs() {
  const parts = [`<button data-go="system">SYSTEM</button>`];
  if (state.view === 'sun') parts.push(`<span class="here">ORIGIN</span>`);
  if (state.view === 'planet') {
    const p = planets[state.planet];
    parts.push(state.civ >= 0 ? `<button data-go="planet">${p.data.name}</button>` : `<span class="here">${p.data.name}</span>`);
    if (state.civ >= 0) parts.push(`<span class="here">${esc(p.civs[state.civ].data.name.toUpperCase())}</span>`);
  }
  $('crumbs').innerHTML = parts.join('<span class="sep">/</span>');
}
$('crumbs').addEventListener('click', (e) => {
  const go = e.target.closest('button')?.dataset.go;
  if (go === 'system') goSystem();
  if (go === 'planet') goPlanet(state.planet);
});

function renderIndex() {
  const items = [
    `<li><button data-i="-1" style="--c:#ffc857" class="${state.view === 'sun' ? 'on' : ''}"><span class="num">00</span><span><i class="dot"></i>ORIGIN</span><span class="count">YOU</span></button></li>`,
    ...planets.map((p, i) => `<li><button data-i="${i}" style="--c:${p.data.color}" class="${state.planet === i ? 'on' : ''}">
      <span class="num">${pad(i + 1)}</span><span><i class="dot"></i>${p.data.name}</span><span class="count">${pad(p.civs.length)}</span></button></li>`),
  ];
  $('indexList').innerHTML = items.join('');
  $('indexCount').textContent = `${planets.length + 1} BODIES`;
}
$('indexList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const i = +b.dataset.i;
  i < 0 ? goSun() : goPlanet(i);
});

/* ---------- projected labels ---------- */
const labelsEl = $('labels');
const sunLabel = mkLabel(`<span class="tag">☉ ${SUN.name}</span><span class="sub">ORIGIN · ABOUT ME</span>`, 'planet', '#ffc857', () => goSun());
planets.forEach((p) => {
  p.label = mkLabel(`<span class="tag">${p.data.name}</span><span class="sub">${pad(p.civs.length)} CIVILIZATION${p.civs.length === 1 ? '' : 'S'}</span>`, 'planet', p.data.color, () => goPlanet(p.index));
  p.civs.forEach((c, ci) => {
    c.label = mkLabel(`<span class="tag">▸ ${esc(c.data.name)}</span>`, 'civ', p.data.color, () => goCiv(p.index, ci));
  });
});
function mkLabel(html, cls, color, onClick) {
  const el = document.createElement('div');
  el.className = `label ${cls} off`;
  el.style.setProperty('--c', color);
  el.innerHTML = html;
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  labelsEl.appendChild(el);
  return el;
}
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3();
function placeLabel(el, world, show, dx = 0, dy = 0) {
  _v.copy(world).project(camera);
  const vis = show && _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
  el.classList.toggle('off', !vis);
  if (!vis) return;
  const x = (_v.x * 0.5 + 0.5) * window.innerWidth + dx;
  const y = (-_v.y * 0.5 + 0.5) * window.innerHeight + dy;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}
function updateLabels() {
  const sys = state.view === 'system';
  _c.set(0, SUN_RADIUS * 1.2, 0);
  placeLabel(sunLabel, _c, sys, 10, -30);
  planets.forEach((p, i) => {
    const center = worldPos(p.root, _c);
    placeLabel(p.label, _n.copy(center).add(_v.set(0, p.data.radius * 1.3, 0)), sys, 8, -30);
    const focused = state.view === 'planet' && state.planet === i;
    p.civs.forEach((c, ci) => {
      const w = c.top.clone().applyMatrix4(p.spin.matrixWorld);
      // hide civs on the far side
      const facing = _n.copy(w).sub(center).normalize().dot(_v.copy(camera.position).sub(center).normalize());
      placeLabel(c.label, w, focused && facing > 0.15, 14, -10);
      c.label.classList.toggle('active', focused && ci === state.civ);
    });
  });
}

/* ---------- clock ---------- */
function tickClock() {
  const now = new Date();
  const opt = { timeZone: 'America/Los_Angeles' };
  $('clock').textContent = now.toLocaleTimeString('en-GB', { ...opt, hour12: false });
  $('clockDate').textContent = now.toLocaleDateString('en-US', { ...opt, year: 'numeric', month: 'short', day: '2-digit' }).toUpperCase();
}
setInterval(tickClock, 1000); tickClock();

/* ======================================================================
   Input
   ====================================================================== */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let drag = null;
let hovered = null;

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0, theta: rig.goal.theta, phi: rig.goal.phi };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  state.idle = 0;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    rig.goal.theta = drag.theta - dx * 0.005;
    rig.goal.phi = THREE.MathUtils.clamp(drag.phi - dy * 0.005, 0.15, Math.PI - 0.15);
    return;
  }
  hovered = pick(e);
  canvas.style.cursor = hovered ? 'pointer' : 'grab';
});
canvas.addEventListener('pointerup', (e) => {
  if (drag && drag.moved < 6) {
    const hit = pick(e);
    if (hit) {
      const u = hit.userData;
      if (u.kind === 'sun') goSun();
      else if (u.kind === 'planet') state.planet === u.planet ? null : goPlanet(u.planet);
      else if (u.kind === 'civ') goCiv(u.planet, u.civ);
    }
  }
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  state.idle = 0;
  rig.goal.radius = THREE.MathUtils.clamp(rig.goal.radius * Math.exp(e.deltaY * 0.0012), rig.min, rig.max);
}, { passive: false });

// pinch zoom
const touches = new Map();
let pinch0 = 0, pinchR = 0;
canvas.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) touches.set(t.identifier, t);
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    pinch0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchR = rig.goal.radius; drag = null;
  }
}, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) touches.set(t.identifier, t);
  if (touches.size === 2 && pinch0) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    rig.goal.radius = THREE.MathUtils.clamp(pinchR * (pinch0 / d), rig.min, rig.max);
  }
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) touches.delete(t.identifier);
  if (touches.size < 2) pinch0 = 0;
}, { passive: true });

function pick(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  // civ markers only count on the focused planet
  const h = hits.find((x) => x.object.userData.kind !== 'civ' || x.object.userData.planet === state.planet);
  return h ? h.object : null;
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const n = parseInt(e.key, 10);
  if (e.key === 'Escape') goBack();
  else if (e.key === '0') goSun();
  else if (n >= 1 && n <= planets.length) goPlanet(n - 1);
  else if (state.view === 'planet' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const len = planets[state.planet].civs.length;
    const next = state.civ < 0 ? 0 : (state.civ + (e.key === 'ArrowRight' ? 1 : -1) + len) % len;
    goCiv(state.planet, next);
  }
});

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); composer.setSize(w, h);
  const scale = h * renderer.getPixelRatio() / 2;
  planets.forEach((p) => (p.surfaceMat.uniforms.uScale.value = scale));
  sun.getObjectByName('sunShell').material.uniforms.uScale.value = scale;
});

/* ======================================================================
   Loop
   ====================================================================== */
const clock = new THREE.Clock();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // freeze orbits while inspecting something so the camera stays steady
  const wantScale = state.view === 'system' && !reduceMotion ? 1 : 0;
  state.timeScale += (wantScale - state.timeScale) * (1 - Math.pow(0.02, dt));
  state.idle += dt;
  if (state.view === 'system' && state.idle > 4 && !drag && !reduceMotion) rig.goal.theta += dt * 0.03;

  sun.getObjectByName('sunCore').material.uniforms.uTime.value = t;
  const shell = sun.getObjectByName('sunShell');
  shell.material.uniforms.uTime.value = t;
  shell.rotation.y += dt * 0.03;

  planets.forEach((p, i) => {
    p.angle += dt * p.data.speed * state.timeScale;
    p.root.position.set(Math.cos(p.angle) * p.data.orbit, 0, Math.sin(p.angle) * p.data.orbit);
    const focused = state.view === 'planet' && state.planet === i;
    const spinning = !(focused && state.civ >= 0) && !reduceMotion;
    if (spinning) p.spin.rotation.y += dt * p.spinSpeed * (focused ? 0.5 : 1);
    p.surfaceMat.uniforms.uTime.value = t;
    p.civs.forEach((c, ci) => {
      const pulse = (t * 0.8 + ci * 0.37) % 1;
      c.ring.scale.setScalar(1 + pulse * 1.6);
      c.ring.material.opacity = (1 - pulse) * 0.9;
      c.beacon.rotation.y += dt * 2;
      const active = focused && ci === state.civ;
      c.beacon.scale.setScalar(active ? 1.8 : 1);
    });
    p.orbitLine.material.opacity += ((state.view === 'system' ? 0.28 : 0.08) - p.orbitLine.material.opacity) * 0.1;
  });

  if (state.view === 'planet') worldPos(planets[state.planet].root, rig.targetGoal);
  const wantOffset = detail.classList.contains('open') && window.innerWidth >= 820 ? 4.5 : 0;
  if (Math.abs(camera.filmOffset - wantOffset) > 0.01) {
    camera.filmOffset += (wantOffset - camera.filmOffset) * (INSTANT ? 1 : 1 - Math.pow(0.01, dt));
    camera.updateProjectionMatrix();
  }
  updateCamera(dt);
  scene.updateMatrixWorld();
  updateLabels();
  composer.render();
  requestAnimationFrame(frame);
}

/* ======================================================================
   Boot sequence
   ====================================================================== */
const BOOT = [
  ['EB//OS STELLAR INDEX v12.0', ''],
  ['(c) ELIAS BLUM — LAS VEGAS, NV', ''],
  ['', ''],
  ['> mount /system/origin ................ ', 'ok'],
  ...PLANETS.map((p) => [`> scan  /system/${p.id.padEnd(14, ' ')} ... ${pad(p.civs.length)} civ `, 'ok']),
  ['> calibrate orbital mechanics ......... ', 'ok'],
  ['> render hex lattice .................. ', 'ok'],
  ['', ''],
  ['SYSTEM READY. ENGAGING VIEWPORT', 'warn'],
];
let booted = false;
async function boot() {
  const out = $('bootText');
  const skip = new Promise((r) => {
    $('bootSkip').addEventListener('click', r, { once: true });
    window.addEventListener('keydown', r, { once: true });
    $('boot').addEventListener('click', r, { once: true });
  });
  let skipped = false;
  skip.then(() => (skipped = true));
  const wait = (ms) => Promise.race([new Promise((r) => setTimeout(r, ms)), skip]);
  if (sessionStorageGet('eb-booted') || reduceMotion || INSTANT) skipped = true;
  for (const [line, tag] of BOOT) {
    if (skipped) break;
    out.innerHTML += esc(line);
    if (tag) { await wait(90); out.innerHTML += `<span class="${tag}">${tag === 'ok' ? '[ OK ]' : ''}</span>`; }
    out.innerHTML += '\n';
    await wait(70);
  }
  if (!skipped) await wait(450);
  finishBoot();
}
function finishBoot() {
  if (booted) return;
  booted = true;
  sessionStorageSet('eb-booted', '1');
  $('boot').classList.add('done');
  $('hud').classList.remove('hidden');
  if (location.hash) fromHash();
  else goSystem({ push: false });
}
function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }

renderIndex();
renderCrumbs();
rig.goal.radius = 140; // stay far out until boot finishes
frame();
boot();
