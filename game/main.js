/* ============================================================
   AZ VELOCITY — arcade hyper-racing (Asphalt-style)
   Pure Three.js, zero network deps, tuned for low-end GPUs.
   Plain script (no modules) so the game runs straight from
   disk via file:// — just open index.html.
   ============================================================ */
'use strict';
/* global THREE */

/* ---------------- settings (persisted) ---------------- */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('azv_' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('azv_' + k, JSON.stringify(v)); } catch {} },
};
const settings = {
  quality: store.get('quality', 'med'),     // low | med | high
  laps:    store.get('laps', 3),
  bots:    store.get('bots', 5),
  sound:   store.get('sound', 'on'),
  shake:   store.get('shake', 'on'),
  carIdx:  store.get('carIdx', 0),
  trackIdx:store.get('trackIdx', 0),
};
const QUALITY = {
  low:  { pixelRatio: 0.7,  fog: 420, scenery: 0.35, aa: false, particles: 40  },
  med:  { pixelRatio: 1.0,  fog: 650, scenery: 0.7,  aa: true,  particles: 90  },
  high: { pixelRatio: Math.min(devicePixelRatio, 2), fog: 950, scenery: 1.0, aa: true, particles: 160 },
};
let Q = QUALITY[settings.quality] || QUALITY.med;

/* ---------------- renderer / scene ---------------- */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 4000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------- tiny helpers ---------------- */
const rngFactory = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;
const wrapAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const fmtTime = ms => {
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, t = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
};
const ORD = n => n + (['th','st','nd','rd'][((n%100)>10&&(n%100)<14)?0:Math.min(n%10,4)%4] || 'th');

function canvasTexture(size, draw, repX = 1, repY = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repX, repY);
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ============================================================
   CAR CATALOG — 10 hypercars, procedural low-poly bodies
   ============================================================ */
const CARS = [
  { name:'Aether SSR',   cls:'Hypercar S',   color:0x7a2bff, accent:0x00e5ff, topSpeed:418, accel:9.0, handling:7.5, nitro:9.5, spoiler:1.6, lenF:1.06, wide:1.04 },
  { name:'Volt EV-9',    cls:'Electric S',   color:0x00e5ff, accent:0xffffff, topSpeed:380, accel:10 , handling:8.5, nitro:8.0, spoiler:0.4, lenF:0.98, wide:1.0  },
  { name:'Tempest GT-R', cls:'Track Beast',  color:0xd81c2f, accent:0x111111, topSpeed:402, accel:8.6, handling:8.0, nitro:8.6, spoiler:2.0, lenF:1.0,  wide:1.06 },
  { name:'Falcon LM-X',  cls:'Le Mans Proto',color:0x18b663, accent:0xffc83d, topSpeed:396, accel:8.2, handling:9.2, nitro:8.2, spoiler:2.2, lenF:1.1,  wide:1.02 },
  { name:'Phantom V12',  cls:'Grand Tourer', color:0x14151c, accent:0xff2d78, topSpeed:408, accel:8.0, handling:7.0, nitro:9.0, spoiler:0.8, lenF:1.12, wide:1.05 },
  { name:'Solaris One',  cls:'Hypercar',     color:0xff7b00, accent:0x222222, topSpeed:390, accel:8.8, handling:8.2, nitro:8.4, spoiler:1.2, lenF:1.0,  wide:1.0  },
  { name:'Katana RS',    cls:'Street Samurai',color:0xf2f4f8,accent:0xd81c2f, topSpeed:372, accel:8.4, handling:9.4, nitro:7.6, spoiler:1.4, lenF:0.95, wide:0.98 },
  { name:'Apex Furia',   cls:'V10 Screamer', color:0xffd400, accent:0x111111, topSpeed:386, accel:8.7, handling:8.6, nitro:8.0, spoiler:1.8, lenF:0.97, wide:1.05 },
  { name:'Mirage W16',   cls:'Quad-Turbo',   color:0x1257d8, accent:0x9fd8ff, topSpeed:415, accel:8.9, handling:6.8, nitro:9.2, spoiler:0.6, lenF:1.08, wide:1.07 },
  { name:'Titan Zero',   cls:'Concept X',    color:0xb9c2cf, accent:0x00e5ff, topSpeed:399, accel:8.5, handling:8.0, nitro:8.8, spoiler:1.0, lenF:1.04, wide:1.0  },
];

function buildCar(cfg) {
  const g = new THREE.Group();
  const W = 1.92 * cfg.wide, L = cfg.lenF;
  const paint = new THREE.MeshPhongMaterial({ color: cfg.color, shininess: 90, specular: 0x888888 });
  const dark  = new THREE.MeshPhongMaterial({ color: 0x101318, shininess: 30 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x0a1828, shininess: 140, specular: 0xaaccff });
  const accent= new THREE.MeshPhongMaterial({ color: cfg.accent, shininess: 80 });

  // body — extruded side profile (x = length, y = height)
  const prof = new THREE.Shape();
  const pts = [
    [-2.30*L, .18], [-2.38*L, .58], [-2.05*L, .80], [-.55*L, .86],
    [ .45*L, .80], [ 1.55*L, .52], [ 2.30*L, .30], [ 2.34*L, .18],
  ];
  prof.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) prof.lineTo(pts[i][0], pts[i][1]);
  prof.lineTo(pts[pts.length-1][0], .12); prof.lineTo(pts[0][0], .12); prof.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(prof, { depth: W, bevelEnabled: true, bevelThickness: .14, bevelSize: .12, bevelSegments: 1 });
  bodyGeo.translate(0, 0, -W / 2);
  bodyGeo.rotateY(-Math.PI / 2);                 // forward = +Z
  g.add(new THREE.Mesh(bodyGeo, paint));

  // cabin
  const cab = new THREE.Shape();
  const cp = [[-1.5*L,.84],[-1.25*L,1.26],[-.1*L,1.3],[.85*L,.92]];
  cab.moveTo(cp[0][0], cp[0][1]);
  for (let i = 1; i < cp.length; i++) cab.lineTo(cp[i][0], cp[i][1]);
  cab.lineTo(cp[3][0], .8); cab.lineTo(cp[0][0], .8); cab.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(cab, { depth: W * .68, bevelEnabled: true, bevelThickness: .08, bevelSize: .1, bevelSegments: 1 });
  cabGeo.translate(0, 0, -W * .68 / 2); cabGeo.rotateY(-Math.PI / 2);
  g.add(new THREE.Mesh(cabGeo, glass));

  // spoiler
  if (cfg.spoiler > 0.5) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(W * .96, .07, .42), accent);
    sp.position.set(0, .78 + cfg.spoiler * .22, -2.25 * L);
    g.add(sp);
    for (const s of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(.07, cfg.spoiler * .22 + .1, .2), dark);
      strut.position.set(s * W * .36, .68 + cfg.spoiler * .11, -2.2 * L);
      g.add(strut);
    }
  }
  // front splitter + side skirts
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(W * 1.02, .08, .5), dark);
  splitter.position.set(0, .14, 2.25 * L); g.add(splitter);

  // lights
  const headMat = new THREE.MeshBasicMaterial({ color: 0xeaffff });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff1133 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(.4, .1, .06), headMat);
    h.position.set(s * W * .33, .52, 2.36 * L); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(.46, .1, .06), tailMat);
    t.position.set(s * W * .3, .62, -2.42 * L); g.add(t);
  }

  // wheels
  const tire = new THREE.MeshPhongMaterial({ color: 0x0c0c0e, shininess: 10 });
  const rim  = new THREE.MeshPhongMaterial({ color: 0xc8d2e0, shininess: 120 });
  const wheels = [];
  const wGeo = new THREE.CylinderGeometry(.43, .43, .36, 14); wGeo.rotateZ(Math.PI / 2);
  const rGeo = new THREE.CylinderGeometry(.26, .26, .38, 8);  rGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1, 1.55*L], [1, 1.55*L], [-1, -1.55*L], [1, -1.55*L]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(wGeo, tire));
    w.add(new THREE.Mesh(rGeo, rim));
    w.position.set(x * W * .52, .43, z);
    g.add(w); wheels.push(w);
  }

  // nitro flames (hidden until boosting)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x33ccff, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(.14, 1.2, 6), flameMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(s * W * .22, .35, -2.55 * L);
    f.visible = false; g.add(f); flames.push(f);
  }
  // underglow
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.6, 5.4 * L),
    new THREE.MeshBasicMaterial({ color: cfg.accent, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = .06; g.add(glow);

  g.userData = { wheels, flames };
  return g;
}

/* ============================================================
   TRACK CATALOG — 6 themed circuits, procedural loops
   ============================================================ */
const TRACKS = [
  { name:'Neon City Circuit', sub:'Night &middot; Downtown', seed:7,  scale:1.0, sky:0x050816, fog:0x0a1030, ground:0x12162a, amb:0x4a5890, sun:0x8fb4ff, sunI:.9, theme:'city',   dark:true },
  { name:'Sunset Dunes',      sub:'Desert &middot; Dusk',    seed:23, scale:1.1, sky:0xff8c4a, fog:0xd96a3a, ground:0xc88b4f, amb:0x9a6a50, sun:0xffd9a0, sunI:1.1,theme:'desert' },
  { name:'Alpine Rush',       sub:'Snow &middot; Day',       seed:41, scale:0.95,sky:0xbfe3ff, fog:0xd8ecff, ground:0xeef4fb, amb:0xbcd4ee, sun:0xffffff, sunI:1.2,theme:'snow'   },
  { name:'Azure Coast',       sub:'Beach &middot; Noon',     seed:59, scale:1.05,sky:0x57c9ff, fog:0x9adfff, ground:0xe6d29a, amb:0x88b6cf, sun:0xfff3d0, sunI:1.25,theme:'beach' },
  { name:'Volcanic Ridge',    sub:'Lava &middot; Night',     seed:77, scale:0.9, sky:0x12060a, fog:0x35100e, ground:0x241a1c, amb:0x7a3a2c, sun:0xff5a2a, sunI:1.0,theme:'volcano',dark:true },
  { name:'Emerald Forest',    sub:'Hills &middot; Morning',  seed:95, scale:1.0, sky:0x9fd9ff, fog:0xbfe6d8, ground:0x3f7d3a, amb:0x86b08a, sun:0xfff7d8, sunI:1.15,theme:'forest'},
];
const ROAD_W = 16, WALL_X = ROAD_W / 2 + 1.2, SAMPLES = 900;

function makeCurve(seed, scale) {
  const rnd = rngFactory(seed * 1013 + 7);
  const n = 11 + Math.floor(rnd() * 4), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = (240 + rnd() * 170) * scale;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', .6);
}

function sampleCurve(curve) {
  const pos = [], tan = [], left = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    const p = curve.getPointAt(t), d = curve.getTangentAt(t);
    pos.push(p); tan.push(d);
    left.push(new THREE.Vector3(-d.z, 0, d.x)); // left-hand normal
  }
  return { pos, tan, left };
}

const roadTex = canvasTexture(256, (ctx, s) => {
  ctx.fillStyle = '#26282e'; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {                       // asphalt noise
    ctx.fillStyle = `rgba(${30+Math.random()*40|0},${30+Math.random()*40|0},${36+Math.random()*40|0},.5)`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  ctx.fillStyle = '#e8ecf2'; ctx.fillRect(6, 0, 7, s); ctx.fillRect(s - 13, 0, 7, s); // edge lines
  ctx.fillStyle = '#ffc83d';                                                          // dashed center
  for (let y = 0; y < s; y += 64) ctx.fillRect(s / 2 - 4, y, 8, 34);
}, 1, 1);

const wallTex = canvasTexture(128, (ctx, s) => {
  ctx.fillStyle = '#d8dce4'; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#e03040';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s / 2, 0); ctx.lineTo(0, s); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(s, s / 2); ctx.lineTo(s / 2, s); ctx.lineTo(s, s); ctx.closePath(); ctx.fill();
}, 1, 1);

function ribbon(samples, offA, offB, y, mat, vScale = 0.06) {
  // builds a closed strip between two lateral offsets along the track
  const { pos, left } = samples, N = SAMPLES;
  const verts = new Float32Array((N + 1) * 2 * 3), uvs = new Float32Array((N + 1) * 2 * 2), idx = [];
  for (let i = 0; i <= N; i++) {
    const j = i % N, p = pos[j], l = left[j];
    verts.set([p.x + l.x * offA, y, p.z + l.z * offA], i * 6);
    verts.set([p.x + l.x * offB, y, p.z + l.z * offB], i * 6 + 3);
    uvs.set([0, i * vScale, 1, i * vScale], i * 4);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function wallMesh(samples, off, mat) {
  const { pos, left } = samples, N = SAMPLES, H = 1.1;
  const verts = new Float32Array((N + 1) * 2 * 3), uvs = new Float32Array((N + 1) * 2 * 2), idx = [];
  for (let i = 0; i <= N; i++) {
    const j = i % N, p = pos[j], l = left[j];
    const x = p.x + l.x * off, z = p.z + l.z * off;
    verts.set([x, 0, z, x, H, z], i * 6);
    uvs.set([i * .25, 0, i * .25, 1], i * 4);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.material.side = THREE.DoubleSide;
  return m;
}

/* ----- per-theme scenery built with InstancedMesh (cheap) ----- */
function scatterPoints(samples, count, rnd, minD = 26, maxD = 150) {
  const out = [];
  let guard = count * 14;
  while (out.length < count && guard-- > 0) {
    const i = Math.floor(rnd() * SAMPLES);
    const side = rnd() < .5 ? -1 : 1;
    const d = minD + rnd() * (maxD - minD);
    const p = samples.pos[i], l = samples.left[i];
    const x = p.x + l.x * d * side, z = p.z + l.z * d * side;
    // reject if too close to any nearby road sample
    let ok = true;
    for (let k = -30; k <= 30; k += 6) {
      const q = samples.pos[(i + k + SAMPLES) % SAMPLES];
      if ((q.x - x) ** 2 + (q.z - z) ** 2 < minD * minD) { ok = false; break; }
    }
    if (ok) out.push({ x, z, r: rnd(), s: rnd() });
  }
  return out;
}

function instMesh(geo, mat, pts, place) {
  const m = new THREE.InstancedMesh(geo, mat, pts.length);
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), Qt = new THREE.Quaternion(), S = new THREE.Vector3();
  pts.forEach((p, i) => { place(p, P, Qt, S); M.compose(P, Qt, S); m.setMatrixAt(i, M); });
  m.instanceMatrix.needsUpdate = true;
  return m;
}

function buildScenery(theme, samples, group, rnd) {
  const mult = Q.scenery;
  const up = new THREE.Quaternion();
  if (theme === 'city') {
    const winTex = canvasTexture(64, (ctx, s) => {
      ctx.fillStyle = '#0b0e1a'; ctx.fillRect(0, 0, s, s);
      for (let y = 4; y < s; y += 8) for (let x = 4; x < s; x += 8)
        if (Math.random() < .55) { ctx.fillStyle = ['#ffd98a','#9fd8ff','#ff6f9f'][Math.random()*3|0]; ctx.fillRect(x, y, 4, 5); }
    }, 2, 4);
    const mat = new THREE.MeshLambertMaterial({ map: winTex, emissive: 0x222a44, emissiveMap: winTex });
    const pts = scatterPoints(samples, Math.floor(140 * mult), rnd, 30, 240);
    group.add(instMesh(new THREE.BoxGeometry(1, 1, 1), mat, pts, (p, P, Qt, S) => {
      const h = 25 + p.r * 95, w = 12 + p.s * 16;
      P.set(p.x, h / 2, p.z); Qt.setFromAxisAngle(new THREE.Vector3(0,1,0), p.r * TAU); S.set(w, h, w);
    }));
    // neon strips near track
    const nm = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const np = scatterPoints(samples, Math.floor(40 * mult), rnd, 22, 34);
    group.add(instMesh(new THREE.BoxGeometry(.3, 7, .3), nm, np, (p, P, Qt, S) => {
      P.set(p.x, 3.5, p.z); Qt.copy(up); S.set(1, 1, 1);
    }));
  } else if (theme === 'desert') {
    const rock = new THREE.MeshLambertMaterial({ color: 0xa06a3a });
    const pts = scatterPoints(samples, Math.floor(120 * mult), rnd, 26, 260);
    group.add(instMesh(new THREE.DodecahedronGeometry(1, 0), rock, pts, (p, P, Qt, S) => {
      const s = 2 + p.r * 9; P.set(p.x, s * .4, p.z);
      Qt.setFromEuler(new THREE.Euler(p.s, p.r * TAU, p.s)); S.set(s, s * .7, s);
    }));
    const cac = new THREE.MeshLambertMaterial({ color: 0x2f7d3a });
    const cp = scatterPoints(samples, Math.floor(60 * mult), rnd, 24, 160);
    group.add(instMesh(new THREE.CylinderGeometry(.5, .6, 6, 6), cac, cp, (p, P, Qt, S) => {
      P.set(p.x, 3, p.z); Qt.copy(up); S.set(1, .6 + p.r, 1);
    }));
  } else if (theme === 'snow' || theme === 'forest') {
    const trunk = theme === 'snow' ? 0xddeaf6 : 0x1d6b2a;
    const tree = new THREE.MeshLambertMaterial({ color: trunk });
    const pts = scatterPoints(samples, Math.floor(220 * mult), rnd, 24, 240);
    group.add(instMesh(new THREE.ConeGeometry(2.4, 9, 7), tree, pts, (p, P, Qt, S) => {
      const s = .7 + p.r * 1.5; P.set(p.x, 4.5 * s, p.z); Qt.copy(up); S.set(s, s, s);
    }));
    const rk = new THREE.MeshLambertMaterial({ color: theme === 'snow' ? 0xc3d6e8 : 0x7d8a77 });
    const rp = scatterPoints(samples, Math.floor(50 * mult), rnd, 26, 200);
    group.add(instMesh(new THREE.DodecahedronGeometry(1, 0), rk, rp, (p, P, Qt, S) => {
      const s = 1.5 + p.r * 5; P.set(p.x, s * .4, p.z);
      Qt.setFromEuler(new THREE.Euler(0, p.r * TAU, 0)); S.set(s, s * .6, s);
    }));
  } else if (theme === 'beach') {
    const trunkM = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
    const leafM  = new THREE.MeshLambertMaterial({ color: 0x2fae5a });
    const pts = scatterPoints(samples, Math.floor(110 * mult), rnd, 24, 200);
    group.add(instMesh(new THREE.CylinderGeometry(.28, .45, 8, 6), trunkM, pts, (p, P, Qt, S) => {
      P.set(p.x, 4, p.z); Qt.setFromEuler(new THREE.Euler(p.r * .25, 0, p.s * .25)); S.set(1, 1, 1);
    }));
    group.add(instMesh(new THREE.ConeGeometry(3.2, 1.6, 7), leafM, pts, (p, P, Qt, S) => {
      P.set(p.x + p.r, 8.2, p.z + p.s); Qt.copy(up); S.set(1, 1, 1);
    }));
  } else if (theme === 'volcano') {
    const rock = new THREE.MeshLambertMaterial({ color: 0x231417 });
    const pts = scatterPoints(samples, Math.floor(150 * mult), rnd, 26, 260);
    group.add(instMesh(new THREE.DodecahedronGeometry(1, 0), rock, pts, (p, P, Qt, S) => {
      const s = 3 + p.r * 14; P.set(p.x, s * .35, p.z);
      Qt.setFromEuler(new THREE.Euler(p.s, p.r * TAU, p.s * .5)); S.set(s, s * .8, s);
    }));
    const lava = new THREE.MeshBasicMaterial({ color: 0xff5a1a });
    const lp = scatterPoints(samples, Math.floor(60 * mult), rnd, 30, 220);
    group.add(instMesh(new THREE.CylinderGeometry(1, 1, .25, 8), lava, lp, (p, P, Qt, S) => {
      const s = 2 + p.r * 7; P.set(p.x, .12, p.z); Qt.copy(up); S.set(s, 1, s);
    }));
  }
}

function buildTrackScene(track) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(track.sky);
  scene.fog = new THREE.Fog(track.fog, 60, Q.fog);

  scene.add(new THREE.AmbientLight(track.amb, track.dark ? 2.2 : 1.4));
  const sun = new THREE.DirectionalLight(track.sun, track.sunI);
  sun.position.set(250, 380, 120);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(track.sky, track.ground, .5));

  const curve = makeCurve(track.seed, track.scale);
  const samples = sampleCurve(curve);
  const rnd = rngFactory(track.seed * 31 + 3);

  // ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2400, 40),
    new THREE.MeshLambertMaterial({ color: track.ground }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.08;
  scene.add(ground);

  // road + shoulders + walls (road is self-lit on night tracks)
  const roadMat = track.dark
    ? new THREE.MeshLambertMaterial({ map: roadTex, emissive: 0x8890a0, emissiveMap: roadTex })
    : new THREE.MeshLambertMaterial({ map: roadTex });
  const road = ribbon(samples, ROAD_W / 2, -ROAD_W / 2, .01, roadMat, .08);
  scene.add(road);
  const shoulderMat = new THREE.MeshLambertMaterial({ color: track.theme === 'snow' ? 0xd6e6f4 : 0x3a3f49 });
  scene.add(ribbon(samples, WALL_X, ROAD_W / 2, .005, shoulderMat, .05));
  scene.add(ribbon(samples, -ROAD_W / 2, -WALL_X, .005, shoulderMat, .05));
  const wm = new THREE.MeshLambertMaterial({ map: wallTex });
  scene.add(wallMesh(samples, WALL_X, wm));
  scene.add(wallMesh(samples, -WALL_X, wm.clone()));

  // start gate
  const sp = samples.pos[0], sl = samples.left[0];
  const gateMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(.8, 9, .8), gateMat);
    pillar.position.set(sp.x + sl.x * WALL_X * s, 4.5, sp.z + sl.z * WALL_X * s);
    scene.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(WALL_X * 2 + 1, 1, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xff2d78 }));
  beam.position.set(sp.x, 9, sp.z);
  beam.rotation.y = Math.atan2(sl.x, sl.z) + Math.PI / 2;
  scene.add(beam);

  // stars for night themes
  if (track.theme === 'city' || track.theme === 'volcano') {
    const n = 350, posA = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = 900 + Math.random() * 900;
      posA.set([Math.cos(a) * r, 150 + Math.random() * 700, Math.sin(a) * r], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(posA, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfd8ff, size: 2.4, sizeAttenuation: false, fog: false })));
  }

  const scen = new THREE.Group();
  buildScenery(track.theme, samples, scen, rnd);
  scene.add(scen);

  return { scene, curve, samples };
}

/* ============================================================
   RACERS — shared arcade physics for player & AI
   ============================================================ */
const KMH_PER_UNIT = 3.6;   // 1 unit/s ≈ 3.6 km/h display
function maxSpeedOf(cfg, boosting) {
  return (cfg.topSpeed / KMH_PER_UNIT) * .62 * (boosting ? 1.28 + cfg.nitro * .012 : 1);
}

class Racer {
  constructor(cfg, mesh, isPlayer, samples) {
    this.cfg = cfg; this.mesh = mesh; this.isPlayer = isPlayer; this.samples = samples;
    this.pos = new THREE.Vector3(); this.heading = 0; this.speed = 0;
    this.steer = 0; this.drift = 0; this.nitro = 1; this.boosting = false;
    this.idx = 0; this.lap = 1; this.maxIdxThisLap = 0; this.finished = false; this.finishTime = 0;
    this.wallHitCD = 0; this.wrongWayT = 0;
    // AI personality
    this.laneOffset = (Math.random() - .5) * 8;
    this.skill = .86 + Math.random() * .12;
    this.aiNitroT = 2 + Math.random() * 8;
  }
  placeAtGrid(slot) {
    const N = SAMPLES, row = Math.floor(slot / 2), col = slot % 2 ? 1 : -1;
    const i = (N - 8 - row * 7 + N) % N;
    const p = this.samples.pos[i], l = this.samples.left[i], t = this.samples.tan[i];
    this.pos.set(p.x + l.x * col * 4, 0, p.z + l.z * col * 4);
    this.heading = Math.atan2(t.x, t.z);
    this.idx = i; this.lap = 1; this.maxIdxThisLap = 0; this.speed = 0; this.nitro = 1;
    this.finished = false; this.finishTime = 0;
    this.syncMesh(0);
  }
  nearestIdx() {
    // local window search around last known index
    const N = SAMPLES, pos = this.samples.pos;
    let best = this.idx, bd = Infinity;
    for (let k = -26; k <= 26; k++) {
      const i = (this.idx + k + N) % N;
      const d = (pos[i].x - this.pos.x) ** 2 + (pos[i].z - this.pos.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  trackInfo() {
    const i = this.idx, p = this.samples.pos[i], l = this.samples.left[i], t = this.samples.tan[i];
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    return { lateral: dx * l.x + dz * l.z, tangentAngle: Math.atan2(t.x, t.z), left: l };
  }
  drive(dt, input, totalLaps, raceTime) {
    const cfg = this.cfg;
    if (this.finished) { input = { throttle: .35, brake: 0, steer: 0, nitroKey: false, drift: false }; }

    // nitro
    this.boosting = input.nitroKey && this.nitro > 0.02;
    if (this.boosting) this.nitro = Math.max(0, this.nitro - dt * .30);
    else this.nitro = Math.min(1, this.nitro + dt * .055);

    const top = maxSpeedOf(cfg, this.boosting);
    const accel = (cfg.accel * 5.4) * (this.boosting ? 1.8 : 1);
    if (input.throttle > 0) this.speed += accel * input.throttle * dt * Math.max(.15, 1 - this.speed / top);
    if (input.brake > 0)    this.speed -= 95 * input.brake * dt;
    this.speed -= this.speed * .25 * dt;                       // drag
    this.speed = clamp(this.speed, 0, top);

    // steering — stronger at low speed, drift loosens rear
    const grip = input.drift ? .55 : 1;
    const steerRate = (1.1 + cfg.handling * .12) * grip;
    const sf = clamp(this.speed / 18, 0, 1) * (1 / (1 + this.speed * .012));
    this.steer = lerp(this.steer, input.steer, dt * 9);
    this.heading += this.steer * steerRate * sf * dt * 2.6;
    this.drift = lerp(this.drift, input.drift ? this.steer * .5 : 0, dt * 5);

    // integrate — velocity slightly off-axis while drifting
    const slip = this.drift * .6;
    const vx = Math.sin(this.heading - slip), vz = Math.cos(this.heading - slip);
    this.pos.x += vx * this.speed * dt;
    this.pos.z += vz * this.speed * dt;

    // track relation
    this.idx = this.nearestIdx();
    const ti = this.trackInfo();
    const adist = Math.abs(ti.lateral);
    if (adist > ROAD_W / 2 + .5 && adist < WALL_X) {          // shoulder = slow
      this.speed -= this.speed * 1.1 * dt;
    }
    if (adist >= WALL_X - .9) {                                // wall clamp + scrape
      const lim = (WALL_X - .95) * Math.sign(ti.lateral);
      this.pos.x -= ti.left.x * (ti.lateral - lim);
      this.pos.z -= ti.left.z * (ti.lateral - lim);
      if (this.wallHitCD <= 0) { this.speed *= .62; this.wallHitCD = .5; if (this.isPlayer) audio.thump(); }
      // nudge heading toward track direction
      this.heading = lerp(this.heading, ti.tangentAngle + wrapAngle(this.heading - ti.tangentAngle) * .6, .5);
    }
    this.wallHitCD -= dt;

    // wrong-way detection (player only display)
    const hd = Math.abs(wrapAngle(this.heading - ti.tangentAngle));
    this.wrongWayT = (hd > Math.PI * .62 && this.speed > 6) ? this.wrongWayT + dt : 0;

    // lap counting
    const N = SAMPLES;
    if (this.idx > this.maxIdxThisLap && this.idx - this.maxIdxThisLap < 60) this.maxIdxThisLap = this.idx;
    if (this.maxIdxThisLap > N * .7 && this.idx < 40 && !this.finished) {
      this.lap++; this.maxIdxThisLap = this.idx;
      if (this.lap > totalLaps) { this.finished = true; this.finishTime = raceTime; }
      else if (this.isPlayer) flashMsg(`LAP ${this.lap}`);
    }
    this.syncMesh(dt);
  }
  aiInput(dt) {
    const N = SAMPLES, look = 14 + Math.floor(this.speed * .42);
    const ti = (this.idx + look) % N;
    const tp = this.samples.pos[ti], tl = this.samples.left[ti];
    const tx = tp.x + tl.x * this.laneOffset, tz = tp.z + tl.z * this.laneOffset;
    const want = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    const diff = wrapAngle(want - this.heading);
    // curvature ahead -> braking
    const t2 = this.samples.tan[(this.idx + 60) % N], t1 = this.samples.tan[this.idx];
    const curv = Math.abs(wrapAngle(Math.atan2(t2.x, t2.z) - Math.atan2(t1.x, t1.z)));
    const targetSpeed = maxSpeedOf(this.cfg, false) * this.skill * clamp(1.25 - curv * 1.5, .42, 1);
    this.aiNitroT -= dt;
    let nitroKey = false;
    if (this.aiNitroT < 0) {
      if (curv < .12 && this.nitro > .45) { nitroKey = true; if (this.nitro < .47) this.aiNitroT = 5 + Math.random() * 7; }
      else this.aiNitroT = 1.5 + Math.random() * 3;
    }
    return {
      throttle: this.speed < targetSpeed ? 1 : 0,
      brake: this.speed > targetSpeed * 1.18 ? .8 : 0,
      steer: clamp(diff * 2.2, -1, 1),
      drift: Math.abs(diff) > .55,
      nitroKey,
    };
  }
  syncMesh(dt) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.heading - this.drift * .8, 0);
    this.mesh.rotation.z = -this.steer * .09 - this.drift * .25;   // body roll
    this.mesh.rotation.x = clamp(-(this.boosting ? .02 : 0) - this.speed * .0001, -.05, 0);
    const { wheels, flames } = this.mesh.userData;
    for (let i = 0; i < wheels.length; i++) {
      wheels[i].rotation.x += this.speed * dt * 2.4;
      if (i < 2) wheels[i].rotation.y = this.steer * .42;
    }
    const fl = this.boosting;
    for (const f of flames) {
      f.visible = fl;
      if (fl) { const s = .8 + Math.random() * .7; f.scale.set(s, 1 + Math.random(), s); }
    }
  }
  progress() { return (this.lap - 1) + this.idx / SAMPLES + (this.finished ? 100 - this.finishTime * 1e-7 : 0); }
}

/* ============================================================
   AUDIO — tiny synth engine (no assets)
   ============================================================ */
const audio = (() => {
  let ctx = null, engineOsc = null, engineGain = null, noiseSrc = null, noiseGain = null;
  const on = () => settings.sound === 'on';
  function ensure() {
    if (ctx || !on()) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    engineGain = ctx.createGain(); engineGain.gain.value = 0;
    engineOsc.connect(lp).connect(engineGain).connect(ctx.destination);
    engineOsc.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = buf; noiseSrc.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1600;
    noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
    noiseSrc.connect(hp).connect(noiseGain).connect(ctx.destination);
    noiseSrc.start();
  }
  return {
    unlock() { ensure(); if (ctx?.state === 'suspended') ctx.resume(); },
    engine(speed, top, boosting, racing) {
      if (!ctx || !on()) return;
      const r = clamp(speed / top, 0, 1);
      engineOsc.frequency.setTargetAtTime(45 + r * 175 + (boosting ? 35 : 0), ctx.currentTime, .05);
      engineGain.gain.setTargetAtTime(racing ? .035 + r * .05 : 0, ctx.currentTime, .1);
      noiseGain.gain.setTargetAtTime(racing && boosting ? .05 : racing ? r * .012 : 0, ctx.currentTime, .12);
    },
    beep(freq = 440, dur = .12, vol = .12) {
      if (!ctx || !on()) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
    },
    thump() {
      if (!ctx || !on()) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(110, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + .18);
      g.gain.setValueAtTime(.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .2);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .22);
    },
    silence() { if (ctx) { engineGain.gain.value = 0; noiseGain.gain.value = 0; } },
  };
})();

/* ============================================================
   INPUT
   ============================================================ */
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') togglePause();
  if (e.code === 'KeyC' && state === 'racing') camMode = (camMode + 1) % 3;
  audio.unlock();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('pointerdown', () => audio.unlock());
function playerInput() {
  return {
    throttle: (keys.KeyW || keys.ArrowUp) ? 1 : 0,
    brake:    (keys.KeyS || keys.ArrowDown) ? 1 : 0,
    steer:    ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0),
    nitroKey: !!keys.Space,
    drift:    !!(keys.ShiftLeft || keys.ShiftRight),
  };
}

/* ============================================================
   RACE ORCHESTRATION
   ============================================================ */
let state = 'loading';            // loading|menu|garage|tracks|settings|countdown|racing|paused|results
let world = null;                 // { scene, curve, samples }
let racers = [], player = null;
let raceTime = 0, countdownT = 0, camMode = 0, msgT = 0;
let mapPath = null;               // prerendered minimap path

const $ = id => document.getElementById(id);
const screens = ['menuMain','garage','menuTracks','menuSettings','menuPause','menuResults','hud'];
function show(...ids) {
  for (const s of screens) $(s).classList.toggle('hidden', !ids.includes(s));
}
function flashMsg(text, hold = 1.2) {
  const el = $('raceMsg');
  el.textContent = text; el.classList.remove('hidden');
  msgT = hold;
}

function startRace() {
  disposeWorld();
  const track = TRACKS[settings.trackIdx];
  world = buildTrackScene(track);

  racers = [];
  const nBots = settings.bots;
  const order = [...CARS.keys()].filter(i => i !== settings.carIdx);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [order[i], order[j]] = [order[j], order[i]]; }

  player = new Racer(CARS[settings.carIdx], buildCar(CARS[settings.carIdx]), true, world.samples);
  world.scene.add(player.mesh);
  racers.push(player);
  for (let b = 0; b < nBots; b++) {
    const cfg = CARS[order[b % order.length]];
    const r = new Racer(cfg, buildCar(cfg), false, world.samples);
    world.scene.add(r.mesh);
    racers.push(r);
  }
  racers.forEach((r, i) => r.placeAtGrid(i));

  prepMinimap();
  raceTime = 0; countdownT = 3.999; state = 'countdown';
  show('hud');
  $('lapVal').textContent = `LAP 1/${settings.laps}`;
  snapCamera();
}

function disposeWorld() {
  if (!world) return;
  world.scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose?.(); m.dispose(); });
  });
  world = null; racers = []; player = null;
}

function finishRace() {
  state = 'results';
  audio.silence();
  const sorted = [...racers].sort((a, b) => b.progress() - a.progress());
  const list = $('resultsList'); list.innerHTML = '';
  sorted.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'resRow' + (r.isPlayer ? ' me' : '');
    const t = r.finished ? fmtTime(r.finishTime * 1000) : 'DNF';
    row.innerHTML = `<span class="resPos">${ORD(i + 1)}</span><span style="flex:1">${r.cfg.name}${r.isPlayer ? ' (YOU)' : ''}</span><span class="resTime">${t}</span>`;
    list.appendChild(row);
  });
  const myPos = sorted.indexOf(player) + 1;
  $('resTitle').textContent = myPos === 1 ? '🏆 VICTORY!' : `${ORD(myPos)} PLACE`;
  show('menuResults');
}

function togglePause() {
  if (state === 'racing' || state === 'countdown') { state = 'paused'; audio.silence(); show('hud', 'menuPause'); }
  else if (state === 'paused') { state = 'racing'; show('hud'); }
}

/* ---------------- camera ---------------- */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function snapCamera() {
  const f = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
  camPos.copy(player.pos).addScaledVector(f, -11).add(new THREE.Vector3(0, 5, 0));
  camera.position.copy(camPos);
}
function updateCamera(dt) {
  const f = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
  let dist = 10.5, h = 4.6, ld = 14;
  if (camMode === 1) { dist = 16; h = 8; ld = 18; }
  if (camMode === 2) { dist = -.5; h = 1.35; ld = 30; }   // hood cam
  const sp = clamp(player.speed / 70, 0, 1);
  dist += sp * 2.2;
  const target = player.pos.clone().addScaledVector(f, -dist).setY(h);
  camPos.lerp(target, 1 - Math.pow(.0001, dt));
  if (settings.shake === 'on' && state === 'racing') {
    const sh = sp * .14 + (player.boosting ? .12 : 0);
    camPos.x += (Math.random() - .5) * sh;
    camPos.y += (Math.random() - .5) * sh * .6;
  }
  camera.position.copy(camPos);
  camLook.lerp(player.pos.clone().addScaledVector(f, ld).setY(1.2), 1 - Math.pow(.00001, dt));
  camera.lookAt(camLook);
  const targetFov = 70 + sp * 8 + (player.boosting ? 13 : 0);
  camera.fov = lerp(camera.fov, targetFov, dt * 5);
  camera.updateProjectionMatrix();
}

/* ---------------- minimap ---------------- */
const mapC = $('minimap'), mapCtx = mapC.getContext('2d');
let mapScale = 1, mapCx = 0, mapCy = 0;
function prepMinimap() {
  const pts = world.samples.pos;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const pad = 30, W = mapC.width;
  mapScale = (W - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  mapCx = (minX + maxX) / 2; mapCy = (minZ + maxZ) / 2;
  mapPath = new Path2D();
  pts.forEach((p, i) => {
    const x = W / 2 + (p.x - mapCx) * mapScale, y = W / 2 + (p.z - mapCy) * mapScale;
    i ? mapPath.lineTo(x, y) : mapPath.moveTo(x, y);
  });
  mapPath.closePath();
}
function drawMinimap() {
  const W = mapC.width;
  mapCtx.clearRect(0, 0, W, W);
  mapCtx.fillStyle = 'rgba(3,6,16,.55)';
  mapCtx.beginPath(); mapCtx.arc(W/2, W/2, W/2 - 2, 0, TAU); mapCtx.fill();
  mapCtx.strokeStyle = 'rgba(0,229,255,.85)'; mapCtx.lineWidth = 7; mapCtx.stroke(mapPath);
  for (const r of racers) {
    const x = W / 2 + (r.pos.x - mapCx) * mapScale, y = W / 2 + (r.pos.z - mapCy) * mapScale;
    mapCtx.fillStyle = r.isPlayer ? '#ffc83d' : '#ff2d78';
    mapCtx.beginPath(); mapCtx.arc(x, y, r.isPlayer ? 9 : 6, 0, TAU); mapCtx.fill();
  }
}

/* ============================================================
   GARAGE (3D showroom)
   ============================================================ */
const showroom = new THREE.Scene();
showroom.background = new THREE.Color(0x070a16);
showroom.fog = new THREE.Fog(0x070a16, 18, 60);
showroom.add(new THREE.AmbientLight(0x8aa6cc, 1.1));
const sLight = new THREE.DirectionalLight(0xffffff, 1.6); sLight.position.set(6, 10, 8); showroom.add(sLight);
const sLight2 = new THREE.DirectionalLight(0x00e5ff, .8); sLight2.position.set(-8, 5, -6); showroom.add(sLight2);
const plat = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.8, .35, 48),
  new THREE.MeshPhongMaterial({ color: 0x131a2e, shininess: 100 }));
plat.position.y = -.18; showroom.add(plat);
const platRing = new THREE.Mesh(new THREE.TorusGeometry(5.6, .1, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
platRing.rotation.x = Math.PI / 2; platRing.position.y = .02; showroom.add(platRing);
const sFloor = new THREE.Mesh(new THREE.CircleGeometry(60, 24),
  new THREE.MeshPhongMaterial({ color: 0x0a0e1c, shininess: 60 }));
sFloor.rotation.x = -Math.PI / 2; sFloor.position.y = -.36; showroom.add(sFloor);
let showCar = null, showAngle = 0;

function setGarageCar(i) {
  settings.carIdx = (i + CARS.length) % CARS.length;
  store.set('carIdx', settings.carIdx);
  const cfg = CARS[settings.carIdx];
  if (showCar) { showroom.remove(showCar); }
  showCar = buildCar(cfg);
  showroom.add(showCar);
  $('carName').textContent = cfg.name;
  $('carClass').textContent = cfg.cls + ` — ${settings.carIdx + 1}/${CARS.length}`;
  const bars = [['stSpd', cfg.topSpeed / 420, cfg.topSpeed + ' km/h'], ['stAcc', cfg.accel / 10, cfg.accel.toFixed(1)],
                ['stHnd', cfg.handling / 10, cfg.handling.toFixed(1)], ['stNit', cfg.nitro / 10, cfg.nitro.toFixed(1)]];
  for (const [id, v, txt] of bars) { $(id).style.width = (v * 100) + '%'; $(id + 'V').textContent = txt; }
}

/* ============================================================
   TRACK SELECT cards
   ============================================================ */
function buildTrackCards() {
  const grid = $('trackGrid'); grid.innerHTML = '';
  TRACKS.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'trackCard' + (i === settings.trackIdx ? ' sel' : '');
    const cv = document.createElement('canvas'); cv.width = 250; cv.height = 130;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 130);
    g.addColorStop(0, '#' + new THREE.Color(t.sky).getHexString());
    g.addColorStop(1, '#' + new THREE.Color(t.ground).getHexString());
    ctx.fillStyle = g; ctx.fillRect(0, 0, 250, 130);
    // draw the actual circuit shape
    const curve = makeCurve(t.seed, t.scale), pts = curve.getPoints(120);
    let mnX=1e9,mxX=-1e9,mnZ=1e9,mxZ=-1e9;
    for (const p of pts){mnX=Math.min(mnX,p.x);mxX=Math.max(mxX,p.x);mnZ=Math.min(mnZ,p.z);mxZ=Math.max(mxZ,p.z);}
    const sc = 100 / Math.max(mxX-mnX, mxZ-mnZ);
    ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 4.5; ctx.lineJoin = 'round';
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 8;
    ctx.beginPath();
    pts.forEach((p, k) => {
      const x = 125 + (p.x-(mnX+mxX)/2)*sc, y = 65 + (p.z-(mnZ+mxZ)/2)*sc;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath(); ctx.stroke();
    card.appendChild(cv);
    card.insertAdjacentHTML('beforeend', `<div class="tcName">${t.name}</div><div class="tcSub">${t.sub}</div>`);
    card.onclick = () => {
      settings.trackIdx = i; store.set('trackIdx', i);
      grid.querySelectorAll('.trackCard').forEach((c, k) => c.classList.toggle('sel', k === i));
    };
    grid.appendChild(card);
  });
}

/* ============================================================
   SETTINGS UI
   ============================================================ */
function bindSeg(id, key, apply) {
  const seg = $(id);
  const sync = () => seg.querySelectorAll('button').forEach(b =>
    b.classList.toggle('on', String(b.dataset.v) === String(settings[key])));
  seg.querySelectorAll('button').forEach(b => b.onclick = () => {
    settings[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    store.set(key, settings[key]); sync(); apply?.();
  });
  sync();
}
bindSeg('segQuality', 'quality', () => {
  Q = QUALITY[settings.quality];
  renderer.setPixelRatio(Q.pixelRatio);
  if (world) world.scene.fog.far = Q.fog;
});
bindSeg('segLaps', 'laps');
bindSeg('segBots', 'bots');
bindSeg('segSound', 'sound', () => { if (settings.sound === 'off') audio.silence(); });
bindSeg('segShake', 'shake');

/* ---------------- menu wiring ---------------- */
$('btnPlay').onclick     = () => { state = 'tracks'; buildTrackCards(); show('menuTracks'); };
$('btnGarage').onclick   = () => { state = 'garage'; setGarageCar(settings.carIdx); show('garage'); };
$('btnSettings').onclick = () => { state = 'settings'; show('menuSettings'); };
$('settingsBack').onclick= () => { state = 'menu'; show('menuMain'); };
$('garageBack').onclick  = () => { state = 'menu'; show('menuMain'); };
$('garageSelect').onclick= () => { state = 'tracks'; buildTrackCards(); show('menuTracks'); };
$('carPrev').onclick     = () => setGarageCar(settings.carIdx - 1);
$('carNext').onclick     = () => setGarageCar(settings.carIdx + 1);
$('tracksBack').onclick  = () => { state = 'menu'; show('menuMain'); };
$('tracksGo').onclick    = () => { audio.unlock(); startRace(); };
$('btnResume').onclick   = togglePause;
$('btnRestart').onclick  = () => startRace();
$('btnQuit').onclick     = () => { disposeWorld(); state = 'menu'; show('menuMain'); audio.silence(); };
$('resAgain').onclick    = () => startRace();
$('resMenu').onclick     = () => { disposeWorld(); state = 'menu'; show('menuMain'); };

/* ============================================================
   MAIN LOOP
   ============================================================ */
let lastT = performance.now(), countdownStage = 4;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, .05);
  lastT = now;

  if (state === 'menu' || state === 'garage' || state === 'settings' || state === 'tracks') {
    showAngle += dt * .5;
    if (showCar) showCar.rotation.y = showAngle;
    camera.position.set(Math.sin(showAngle * .2) * 1.5, 3.2, 11);
    camera.lookAt(0, .9, 0);
    camera.fov = 55; camera.updateProjectionMatrix();
    renderer.render(showroom, camera);
    return;
  }
  if (!world) return;

  if (state === 'countdown') {
    countdownT -= dt;
    const stage = Math.ceil(countdownT);
    if (stage !== countdownStage) {
      countdownStage = stage;
      if (stage > 0) { flashMsg(String(stage), .9); audio.beep(440, .12); }
      else { flashMsg('GO!', 1); audio.beep(880, .35, .18); state = 'racing'; }
    }
    updateCamera(dt); drawMinimap();
  } else if (state === 'racing') {
    raceTime += dt;
    for (const r of racers) r.drive(dt, r.isPlayer ? playerInput() : r.aiInput(dt), settings.laps, raceTime);

    // simple car-vs-car push-apart
    for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i], b = racers[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 13 && d2 > 1e-4) {
        const d = Math.sqrt(d2), push = (3.6 - d) / d * .5;
        a.pos.x -= dx * push; a.pos.z -= dz * push;
        b.pos.x += dx * push; b.pos.z += dz * push;
        a.speed *= .985; b.speed *= .985;
      }
    }

    // HUD
    $('speedVal').textContent = Math.round(player.speed * KMH_PER_UNIT * 1.6);
    $('nitroBar').style.width = (player.nitro * 100) + '%';
    $('timer').textContent = fmtTime(raceTime * 1000);
    const pos = [...racers].sort((x, y) => y.progress() - x.progress()).indexOf(player) + 1;
    $('posVal').innerHTML = `${pos}<sup>${ORD(pos).replace(String(pos),'')}</sup>`;
    $('lapVal').textContent = player.finished ? 'FINISHED' : `LAP ${Math.min(player.lap, settings.laps)}/${settings.laps}`;
    $('wrongWay').classList.toggle('hidden', player.wrongWayT < .9);
    $('boostFlash').style.opacity = player.boosting ? 1 : 0;
    audio.engine(player.speed, maxSpeedOf(player.cfg, false), player.boosting, true);
    updateCamera(dt); drawMinimap();

    if (player.finished) {
      flashMsg('FINISH!', 1.5);
      setTimeout(finishRace, 1600);
      state = 'finishing';
    }
  } else if (state === 'finishing') {
    raceTime += dt;
    for (const r of racers) r.drive(dt, r.isPlayer ? { throttle: .2, brake: 0, steer: 0, nitroKey: false, drift: false } : r.aiInput(dt), settings.laps, raceTime);
    audio.engine(player.speed, maxSpeedOf(player.cfg, false), false, true);
    updateCamera(dt); drawMinimap();
  } else if (state === 'results' || state === 'paused') {
    updateCamera(0);
  }

  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('raceMsg').classList.add('hidden'); }
  renderer.render(world.scene, camera);
}

/* ---------------- boot ---------------- */
$('loading').remove();
state = 'menu';
setGarageCar(settings.carIdx);   // warm the showroom car
show('menuMain');
requestAnimationFrame(frame);
