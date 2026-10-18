// Cena 3D: a física vive no plano (x, y); aqui (x, y) vira (x − L/2, R, y − W/2) no plano XZ.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MODES, type Mode } from '../shared/rules/index.ts';
import { predictAim, shotPreview } from '../shared/aim.ts';
import type { Item } from '../shared/physics.ts';
import { BAULK_X, D_R, type BallPos } from '../shared/table.ts';
import { ballLook } from './look.ts';

const FELT = '#1f6b4a';
const CUSHION = '#1a5c40';
const WOOD = '#5b3419';
const RAIL_H = 0.042;
const CUSHION_W = 0.045;
const FRAME_W = 0.13;

function ballTexture(mode: Mode, id: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const { color, stripe, label } = ballLook(mode, id);
  g.fillStyle = stripe ? '#f4f1e8' : color;
  g.fillRect(0, 0, 256, 128);
  if (stripe) {
    g.fillStyle = color;
    g.fillRect(0, 34, 256, 60);
  }
  if (label) {
    for (const u of [64, 192]) {
      g.fillStyle = '#f4f1e8';
      g.beginPath();
      g.ellipse(u, 64, 22, 26, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#151515';
      g.font = 'bold 30px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, u, 66);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export type GameScene = ReturnType<typeof createScene>;

export function createScene(canvas: HTMLCanvasElement, mode: Mode) {
  const { L, W, R, pockets, sideMouth, cornerMouth } = MODES[mode].table;
  const toScene = (x: number, y: number) => new THREE.Vector3(x - L / 2, R, y - W / 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(maxRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d0a07');
  const fog = new THREE.Fog('#0d0a07', 4.5, 11);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 20);
  // reflexos: um "quarto" de luz gerado na hora vira o mapa de ambiente (bolas e madeira brilham)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  // bar: chão, paredes escuras e uma luminária baixa sobre a mesa (aparece na vista de mira)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.78;
  floor.receiveShadow = true;
  scene.add(floor);
  const room = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 14), new THREE.MeshStandardMaterial({ color: '#1b140e', roughness: 1, side: THREE.BackSide }));
  room.position.y = 1.2;
  scene.add(room);
  const shade = new THREE.Group();
  const shadeBody = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.12, 0.34), new THREE.MeshStandardMaterial({ color: '#1f4d36', roughness: 0.5, metalness: 0.3 }));
  const shadeGlow = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.68, 0.3), new THREE.MeshBasicMaterial({ color: '#fff1d6' }));
  shadeGlow.rotation.x = Math.PI / 2;
  shadeGlow.position.y = -0.061;
  shade.add(shadeBody, shadeGlow);
  shade.position.y = 1.15;
  scene.add(shade);
  const pool = new THREE.SpotLight('#ffe9c4', 1.6, 0, Math.PI / 3, 0.7, 0);
  pool.position.set(0, 1.1, 0);
  pool.target.position.set(0, 0, 0);
  scene.add(pool, pool.target);

  scene.add(new THREE.HemisphereLight('#fff3e0', '#1a1612', 0.55));
  const lamp = new THREE.DirectionalLight('#fff6e8', 1.5);
  lamp.position.set(0.3, 3, 0.4);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  Object.assign(lamp.shadow.camera, { left: -L / 2 - 0.3, right: L / 2 + 0.3, top: W / 2 + 0.3, bottom: -W / 2 - 0.3, near: 1, far: 5 });
  scene.add(lamp);

  // caçapas: o furo fica no centro real da caçapa (o mesmo da física), cavado na quina e na parede;
  // o feltro, as tabelas e a moldura são recortados em volta dele, e embaixo fica uma caçapa funda.
  const outerL = L + 2 * CUSHION_W + 2 * FRAME_W;
  const outerW = W + 2 * CUSHION_W + 2 * FRAME_W;
  const POCKET_DEPTH = 0.13;
  // Medidas da WPA para o desenho das caçapas:
  // - canto: boca de cornerMouth na diagonal entre as pontas das tabelas, que ficam a `cornerA` da quina em cada
  //   tabela; o buraco começa uma "prateleira" (35% da boca) atrás da linha da boca, cavado na quina;
  // - meio: buraco do tamanho da boca, com a borda 6 mm fora da linha da tabela (WPA: 0 a 9,5 mm).
  const cornerA = cornerMouth / Math.SQRT2;
  const cornerR = cornerMouth * 0.52;
  const cornerOut = (cornerR - (cornerA / Math.SQRT2 - cornerMouth * 0.35)) / Math.SQRT2;
  const holes = pockets.map((p, i) => {
    const sx = Math.sign(p.x - L / 2);
    const sz = Math.sign(p.y - W / 2);
    return i < 4
      ? { x: sx * (L / 2 + cornerOut), z: sz * (W / 2 + cornerOut), r: cornerR, count: 0 }
      : { x: 0, z: sz * (W / 2 + 0.006 + sideMouth), r: sideMouth, count: 0 };
  });
  // pontas das tabelas: no meio, cortadas a 104° (abrem 14° para fora); no canto, a 142° (a ponta corre a 38°
  // da linha da tabela, para dentro da quina)
  const JAW = Math.tan((14 * Math.PI) / 180);
  const CORNER_JAW = 1 / Math.tan((38 * Math.PI) / 180);

  // peças da mesa: contorno em (x, z) da cena; a forma é desenhada deitada (z da cena = −y da forma)
  const toShape = (pts: [number, number][]) => {
    const sh = new THREE.Shape();
    pts.forEach(([x, z], i) => (i ? sh.lineTo(x, -z) : sh.moveTo(x, -z)));
    sh.closePath();
    return sh;
  };
  const BEVEL = 0.004;
  const solid = (shape: THREE.Shape, depth: number, mat: THREE.Material, base: number, bevel = true) => {
    // cantos arredondados (chanfro) em vez de caixas retas; na moldura, o chanfro no corte côncavo da caçapa
    // cruza a si mesmo e tampa o buraco, então ela vai sem chanfro
    if (!bevel) {
      const flat = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: depth + 2 * BEVEL, bevelEnabled: false, curveSegments: 6 }), mat);
      flat.rotation.x = -Math.PI / 2;
      flat.position.y = base;
      flat.castShadow = flat.receiveShadow = true;
      scene.add(flat);
      return;
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelSegments: 3, curveSegments: 6 });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = base + BEVEL;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  const near = (u: number, cu: number, r: number) => Math.sqrt(Math.max(0, r * r - (u - cu) * (u - cu)));
  const asUV = (axis: 'x' | 'z', withSides = true) =>
    holes.filter((_, i) => withSides || i < 4).map((h) => (axis === 'x' ? { u: h.x, v: h.z, r: h.r } : { u: h.z, v: h.x, r: h.r }));
  const toXZ = (axis: 'x' | 'z', u: number, v: number): [number, number] => (axis === 'x' ? [u, v] : [v, u]);

  // tabela (borracha verde) entre duas caçapas: as pontas são cortadas retas, inclinadas como na mesa de verdade
  function cushion(axis: 'x' | 'z', u0: number, u1: number, v0: number, v1: number) {
    const half = axis === 'x' ? L / 2 : W / 2; // a quina fica em ±half nessa direção
    const depth = (v: number) => Math.abs(v - v0); // quanto entra na tabela, a partir da ponta (linha de jogo)
    const side = (v: number) => sideMouth + depth(v) * JAW;
    const corner = (v: number) => half - cornerA + depth(v) * CORNER_JAW;
    // além do corte reto, a tabela nunca entra no buraco (senão ficam pontinhas verdes lá dentro)
    const cs = asUV(axis).filter((c) => Math.abs(c.v - v0) < c.r + Math.abs(v1 - v0) && Math.sign(c.v) === Math.sign(v0));
    const clipL = (v: number) => cs.filter((c) => c.u < (u0 + u1) / 2 && Math.abs(v - c.v) < c.r).map((c) => c.u + near(v, c.v, c.r));
    const clipR = (v: number) => cs.filter((c) => c.u > (u0 + u1) / 2 && Math.abs(v - c.v) < c.r).map((c) => c.u - near(v, c.v, c.r));
    const left = (v: number) => Math.max(u0 === 0 ? side(v) : -corner(v), ...clipL(v));
    const right = (v: number) => Math.min(u1 === 0 ? -side(v) : corner(v), ...clipR(v));
    const N = 14;
    const vs = Array.from({ length: N + 1 }, (_, i) => v0 + ((v1 - v0) * i) / N);
    const pts = [...vs.map((v) => toXZ(axis, right(v), v)), ...vs.reverse().map((v) => toXZ(axis, left(v), v))];
    solid(toShape(pts), RAIL_H - 2 * BEVEL, cushionMat, 0);
  }

  // moldura de madeira: a borda de dentro ganha uma mordida redonda em cada caçapa
  function frame(axis: 'x' | 'z', u0: number, u1: number, vIn: number, vOut: number) {
    const sign = Math.sign(vOut);
    const cs = asUV(axis).filter((c) => Math.sign(c.v) === sign);
    const inner = (u: number) => {
      let d = Math.abs(vIn);
      for (const c of cs) if (Math.abs(u - c.u) < c.r) d = Math.max(d, Math.abs(c.v) + near(u, c.u, c.r));
      return sign * Math.min(d, Math.abs(vOut) - 0.01);
    };
    const steps = Math.ceil((u1 - u0) / 0.004);
    const us = Array.from({ length: steps + 1 }, (_, i) => u0 + ((u1 - u0) * i) / steps);
    const pts = [...us.map((u) => toXZ(axis, u, inner(u))), toXZ(axis, u1, vOut), toXZ(axis, u0, vOut)];
    solid(toShape(pts), frameH - 2 * BEVEL, woodMat, RAIL_H + 0.01 - frameH, false);
  }

  // feltro: cobre até a borda da moldura, com os furos (assim cada furo fica inteiro dentro dele)
  const feltShape = toShape([[-outerL / 2, -outerW / 2], [outerL / 2, -outerW / 2], [outerL / 2, outerW / 2], [-outerL / 2, outerW / 2]]);
  for (const h of holes) feltShape.holes.push(new THREE.Path().absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true));
  const felt = new THREE.Mesh(new THREE.ShapeGeometry(feltShape, 48), new THREE.MeshStandardMaterial({ color: FELT, roughness: 0.95 }));
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);
  // dentro da caçapa: uma redinha embaixo do pano (o buraco é uma abertura no chão verde, sem parede em pé)
  const netTexture = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#100c09';
    g.fillRect(0, 0, 64, 64);
    // malha em losango: cordas nas duas diagonais
    g.strokeStyle = '#8a6f50';
    g.lineWidth = 3;
    for (let k = -64; k <= 128; k += 16) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 64, 64);
      g.moveTo(k, 64);
      g.lineTo(k + 64, 0);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  for (const h of holes) {
    // a rede afunila e tem a malha repetida em volta; o fundo é a mesma rede
    const wallTex = netTexture.clone();
    wallTex.repeat.set(10, 2);
    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(h.r * 0.995, h.r * 0.85, POCKET_DEPTH, 40, 1, true),
      new THREE.MeshStandardMaterial({ map: wallTex, roughness: 1, side: THREE.DoubleSide }),
    );
    net.position.set(h.x, -POCKET_DEPTH / 2, h.z);
    const floorTex = netTexture.clone();
    floorTex.repeat.set(3, 3);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(h.r * 0.85, 32), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1 }));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(h.x, -POCKET_DEPTH, h.z);
    scene.add(net, bottom);
  }

  const cushionMat = new THREE.MeshStandardMaterial({ color: CUSHION, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.55 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  // a moldura desce como uma saia, escondendo o vão embaixo do pano onde ficam as caçapas
  const frameH = RAIL_H + 0.01 + POCKET_DEPTH + 0.03;
  const eL = L / 2 + CUSHION_W;
  const eW = W / 2 + CUSHION_W;
  for (const s of [-1, 1]) {
    cushion('x', -eL, 0, s * (W / 2), s * eW);
    cushion('x', 0, eL, s * (W / 2), s * eW);
    cushion('z', -eW, eW, s * (L / 2), s * eL);
    frame('x', -outerL / 2, outerL / 2, s * eW, s * (outerW / 2));
    frame('z', -eW, eW, s * eL, s * (outerL / 2));
  }
  box(outerL + 0.04, 0.5, outerW + 0.04, 0, -(POCKET_DEPTH + 0.02) - 0.25, 0, woodMat);
  // sombra suave na boca de cada caçapa
  const lipMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false });
  for (const h of holes) {
    const lip = new THREE.Mesh(new THREE.RingGeometry(h.r, h.r * 1.18, 40), lipMat);
    lip.rotation.x = -Math.PI / 2;
    lip.position.set(h.x, 0.0012, h.z);
    scene.add(lip);
  }
  // diamantes de madrepérola na moldura: 3 entre cada par de caçapas
  const pearl = new THREE.MeshStandardMaterial({ color: '#efe7d2', roughness: 0.25, metalness: 0.1 });
  const diamond = new THREE.CircleGeometry(0.009, 4);
  const railTop = RAIL_H + 0.0105;
  const putDiamond = (x: number, z: number) => {
    const m = new THREE.Mesh(diamond, pearl);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, railTop, z);
    scene.add(m);
  };
  const midLong = W / 2 + CUSHION_W + FRAME_W / 2;
  const midShort = L / 2 + CUSHION_W + FRAME_W / 2;
  for (let k = 1; k < 8; k++) if (k !== 4) for (const z of [-midLong, midLong]) putDiamond(-L / 2 + (k * L) / 8, z);
  for (let k = 1; k < 4; k++) for (const x of [-midShort, midShort]) putDiamond(x, -W / 2 + (k * W) / 4);
  // mesa de sinuca: linha da cabeceira e o "D", onde a branca fica na mão
  if (MODES[mode].table !== MODES.eightball.table) {
    const mark = new THREE.LineBasicMaterial({ color: '#d9e6dc', transparent: true, opacity: 0.55 });
    const pts = [toScene(BAULK_X, 0), toScene(BAULK_X, W)];
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mark));
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = Math.PI / 2 + (i / 32) * Math.PI;
      arc.push(toScene(BAULK_X + Math.cos(a) * D_R, W / 2 + Math.sin(a) * D_R));
    }
    const d = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), mark);
    scene.add(d);
    for (const line of scene.children.slice(-2)) line.position.y = 0.001 - R;
  }

  // bolas
  const sphere = new THREE.SphereGeometry(R, 32, 20);
  const meshes = new Map<number, THREE.Mesh>();
  const last = new Map<number, { x: number; y: number }>();
  let current: BallPos[] = [];
  function mesh(id: number) {
    let m = meshes.get(id);
    if (!m) {
      // verniz: camada brilhante por cima da cor, refletindo o ambiente
      m = new THREE.Mesh(sphere, new THREE.MeshPhysicalMaterial({ map: ballTexture(mode, id), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 }));
      m.castShadow = true;
      m.rotation.set(0, Math.PI / 2, Math.PI / 2);
      scene.add(m);
      meshes.set(id, m);
    }
    return m;
  }

  // taco: a ponta fina encosta na bola (x = 0) e o cabo vai para trás (−x)
  const stick = new THREE.Group();
  let along = 0;
  const seg = (rFront: number, rBack: number, len: number, color: string, rough = 0.45, metal = 0) => {
    // o cilindro deitado tem o topo (+y) virado para −x: topo = parte de trás
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rBack, rFront, len, 20), new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
    m.rotation.z = Math.PI / 2;
    m.position.x = -(along + len / 2);
    m.castShadow = true;
    stick.add(m);
    along += len;
  };
  seg(0.0058, 0.006, 0.01, '#3a6fb0', 0.9); // ponteira com giz
  seg(0.006, 0.0063, 0.022, '#f1ede2', 0.3); // anel branco
  seg(0.0063, 0.0105, 0.76, '#e2c08d', 0.4); // haste de madeira clara
  seg(0.0105, 0.011, 0.014, '#c9c9c9', 0.25, 0.8); // junção de metal
  seg(0.011, 0.0145, 0.6, '#3b1f12', 0.35); // cabo escuro
  seg(0.0145, 0.0145, 0.03, '#111111', 0.6); // ponta do cabo
  scene.add(stick);
  // mira: linha até o primeiro contato, branca fantasma, e as direções da bola alvo e da branca
  const line = (color: string, opacity: number, dashed: boolean) => {
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), mat);
    scene.add(l);
    return l;
  };
  const aimLine = line('#f4f1e8', 0.6, true);
  const targetLine = line('#ffd666', 0.85, false);
  const cueLine = line('#f4f1e8', 0.35, false);
  const ghost = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.28, depthWrite: false }));
  scene.add(ghost);
  const setLine = (l: THREE.Line, ...pts: THREE.Vector3[]) => {
    // o caminho da branca muda de tamanho: o buffer não cresce sozinho, então troca a geometria
    if (l.geometry.getAttribute('position').count !== pts.length) {
      l.geometry.dispose();
      l.geometry = new THREE.BufferGeometry();
    }
    l.geometry.setFromPoints(pts);
    l.computeLineDistances();
  };
  const onFelt = (x: number, y: number) => toScene(x, y).setY(R * 0.25);

  // anel dourado em volta das bolas da vez
  const ringGeo = new THREE.RingGeometry(R * 1.12, R * 1.42, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd666', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const rings = new Map<number, THREE.Mesh>();
  let highlighted: number[] = [];
  function placeRings() {
    for (const [id, ring] of rings) ring.visible = highlighted.includes(id) && !!last.get(id) && !!meshes.get(id)?.visible;
    for (const id of highlighted) {
      let ring = rings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        scene.add(ring);
        rings.set(id, ring);
      }
      const p = last.get(id);
      ring.visible = !!p && !!meshes.get(id)?.visible;
      if (p) ring.position.copy(toScene(p.x, p.y)).setY(0.002);
    }
  }
  let cueState: { visible: boolean; angle: number; pull: number; power: number; spinX: number; spinY: number; item: Item | null } = {
    visible: false,
    angle: 0,
    pull: 0,
    power: 0,
    spinX: 0,
    spinY: 0,
    item: null,
  };
  // Caçapa gigante: anel dourado do tamanho novo em cada caçapa, na mira e durante a tacada (senão a bola
  // parece sumir no pano a 5 cm do buraco)
  const giantRings = new THREE.Group();
  for (const p of pockets) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(p.r * 1.7, p.r * 2, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(toScene(p.x, p.y)).setY(0.004);
    giantRings.add(ring);
  }
  giantRings.visible = false;
  scene.add(giantRings);
  let shotGiant = false;
  // mata-mata: anel na caçapa cantada para a última bola
  const calledRing = new THREE.Mesh(new THREE.RingGeometry(pockets[0].r * 0.95, pockets[0].r * 1.25, 40), ringMat);
  calledRing.rotation.x = -Math.PI / 2;
  calledRing.visible = false;
  scene.add(calledRing);
  // o caminho da branca sai de uma simulação: só refaz quando a mira, a força, o efeito ou as bolas mudam
  let pathKey = '';
  let preview: ReturnType<typeof shotPreview> = null;
  let camMode: 'aim' | 'top' = 'top';
  let follow: { x: number; y: number } | null = null;

  function cuePos() {
    const p = last.get(0);
    return p ? toScene(p.x, p.y) : toScene(L / 4, W / 2);
  }

  function placeCue() {
    const { visible, angle, pull } = cueState;
    giantRings.visible = shotGiant || (visible && cueState.item === 'giant');
    const cue = last.get(0);
    stick.visible = aimLine.visible = visible && !!cue;
    ghost.visible = targetLine.visible = cueLine.visible = false;
    if (!stick.visible || !cue) return;
    const c = cuePos();
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const dir = new THREE.Vector3(dx, 0, dy);
    // a ponta encosta na branca no ponto do efeito (até meio raio do centro, como no bilhar de verdade)
    // e o cabo sobe ~6° para passar por cima da tabela; o recuo da força é ao longo do próprio taco
    const ox = cueState.spinX * R * 0.5;
    const oy = cueState.spinY * R * 0.5;
    const ELEV = 0.1;
    const axis = new THREE.Vector3(dx * Math.cos(ELEV), -Math.sin(ELEV), dy * Math.cos(ELEV));
    stick.position
      .copy(c)
      .add(new THREE.Vector3(-dy * ox, oy, dx * ox))
      .addScaledVector(dir, -Math.sqrt(R * R - ox * ox - oy * oy))
      .addScaledVector(axis, -(0.008 + pull * 0.22));
    stick.rotation.set(0, -angle, -ELEV);

    const aim = predictAim(current, cue, dx, dy, MODES[mode].table);
    setLine(aimLine, onFelt(cue.x, cue.y), onFelt(aim.end.x, aim.end.y));
    if (aim.ghost && aim.targetDir && aim.target !== null) {
      ghost.visible = targetLine.visible = true;
      ghost.position.copy(toScene(aim.ghost.x, aim.ghost.y));
      const t = last.get(aim.target)!;
      // com a força conhecida, as duas linhas saem da física (efeito e desvio inclusos); sem ela
      // (outro jogador num cliente antigo), a geometria do choque
      const { power, spinX, spinY, item } = cueState;
      if (power > 0) {
        const key = [dx, dy, power, spinX, spinY, item, cue.x, cue.y, t.x, t.y].join();
        if (key !== pathKey) {
          pathKey = key;
          preview = shotPreview(current, { dx, dy, power, spinX, spinY, ...(item ? { item } : {}) }, MODES[mode].table);
        }
      } else {
        preview = null;
        pathKey = '';
      }
      const td = preview?.targetDir ?? aim.targetDir;
      setLine(targetLine, onFelt(t.x, t.y), onFelt(t.x + td.x * 0.32, t.y + td.y * 0.32));
      if (preview?.cue) {
        cueLine.visible = true;
        setLine(cueLine, onFelt(aim.ghost.x, aim.ghost.y), ...preview.cue.map((p) => onFelt(p.x, p.y)));
      } else if (!preview && aim.cueDir) {
        cueLine.visible = true;
        setLine(cueLine, onFelt(aim.ghost.x, aim.ghost.y), onFelt(aim.ghost.x + aim.cueDir.x * 0.18, aim.ghost.y + aim.cueDir.y * 0.18));
      }
    }
  }

  function placeCamera() {
    const aspect = camera.aspect;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // a luminária fica entre a câmera de cima e a mesa: só aparece na vista de mira
    shade.visible = camMode === 'aim';
    if (camMode === 'top') {
      const portrait = aspect < 1;
      const long = L + 2 * (CUSHION_W + FRAME_W) + 0.08;
      const short = W + 2 * (CUSHION_W + FRAME_W) + 0.08;
      const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      // área livre, sem o HUD do topo, a coluna da força à direita e os botões de baixo (no celular)
      const pad = portrait ? { top: 150, right: 96, bottom: 110, left: 12 } : { top: 118, right: 104, bottom: 16, left: 16 };
      // com muitos jogadores a lista quebra em várias linhas (até 8 no celular): a mesa começa abaixo dela
      const seatsBottom = document.querySelector('.hud .seats')?.getBoundingClientRect().bottom ?? 0;
      pad.top = Math.max(pad.top, seatsBottom + 8);
      const aw = Math.max(120, w - pad.left - pad.right);
      const ah = Math.max(120, h - pad.top - pad.bottom);
      // distância que cabe a mesa inteira na área livre, no sentido do comprimento e da largura
      const fitV = ((portrait ? long : short) / 2 / halfTan) * (h / ah);
      const fitH = ((portrait ? short : long) / 2 / halfTan / aspect) * (w / aw);
      const d = Math.max(fitV, fitH);
      // move a câmera para a mesa aparecer no centro da área livre (em metros por pixel de tela)
      const perPx = (2 * d * halfTan) / h;
      const sx = (pad.left + aw / 2 - w / 2) * perPx; // quanto a mesa vai para a direita
      const sy = (pad.top + ah / 2 - h / 2) * perPx; // quanto a mesa vai para baixo
      // na tela deitada, direita = +x e baixo = +z; em pé (câmera girada), direita = −z e baixo = +x
      const cx = portrait ? -sy : -sx;
      const cz = portrait ? sx : -sy;
      camera.position.set(cx, d, cz + 0.0001);
      // câmera longe (celular com muitos jogadores): a névoa começa na mesa, senão ela escurece
      fog.near = Math.max(4.5, d);
      fog.far = fog.near + 6.5;
      camera.up.set(portrait ? -1 : 0, 0, portrait ? 0 : -1);
      camera.lookAt(cx, 0, cz);
      return;
    }
    fog.near = 4.5;
    fog.far = 11;
    const target = follow ? toScene(follow.x, follow.y) : cuePos();
    const dir = new THREE.Vector3(Math.cos(cueState.angle), 0, Math.sin(cueState.angle));
    camera.up.set(0, 1, 0);
    // mais alta e mais atrás, olhando para a frente da branca: as bolas próximas não entram na câmera
    const back = aspect < 1 ? 1.45 : 1;
    camera.position.copy(target).addScaledVector(dir, -1.05 * back).setY(0.62 * back);
    camera.lookAt(target.clone().addScaledVector(dir, 0.9));
  }

  // render só quando algo muda; o medidor de fps baixa a qualidade se o aparelho sofrer
  let dirty = true;
  let low = false;
  let frames: number[] = [];
  const invalidate = () => (dirty = true);
  // efeitos com duração (queda na caçapa, brilho, taco batendo): cada um devolve false quando acaba
  const effects: ((now: number) => boolean)[] = [];
  let shakeAmp = 0;
  function loop(t: number) {
    requestAnimationFrame(loop);
    if (effects.length) {
      for (let i = effects.length - 1; i >= 0; i--) if (!effects[i](t)) effects.splice(i, 1);
      dirty = true;
    }
    if (shakeAmp > 0.0004) dirty = true;
    if (!dirty) {
      frames = [];
      return;
    }
    dirty = false;
    placeCue();
    placeCamera();
    if (shakeAmp > 0.0004) {
      camera.position.x += (Math.random() - 0.5) * shakeAmp;
      camera.position.z += (Math.random() - 0.5) * shakeAmp;
      shakeAmp *= 0.86;
    }
    renderer.render(scene, camera);
    frames.push(t);
    while (frames.length && t - frames[0] > 2000) frames.shift();
    if (!low && frames.length > 30 && t - frames[0] > 1900 && frames.length / ((t - frames[0]) / 1000) < 45) api.lowQuality(true);
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  requestAnimationFrame(loop);

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);

  // bolas dentro das caçapas (ficam visíveis lá no fundo) e as que estão caindo
  const inPocket = new Map<number, { hole: number }>();
  const falling = new Set<number>();
  function fall(id: number, m: THREE.Mesh) {
    const from = m.position.clone();
    let hole = 0;
    holes.forEach((h, i) => {
      const best = holes[hole];
      if ((h.x - from.x) ** 2 + (h.z - from.z) ** 2 < (best.x - from.x) ** 2 + (best.z - from.z) ** 2) hole = i;
    });
    const h = holes[hole];
    // as bolas se acomodam lado a lado no fundo da caçapa
    const a = h.count * 2.3;
    const spread = h.count ? h.r * 0.42 : 0;
    const rest = new THREE.Vector3(h.x + Math.cos(a) * spread, -POCKET_DEPTH + R, h.z + Math.sin(a) * spread);
    h.count++;
    falling.add(id);
    const start = performance.now();
    const ROLL = 150;
    const DROP = 320;
    effects.push((now) => {
      if (!falling.has(id)) return false; // a mesa foi reiniciada no meio da queda
      const t = now - start;
      if (t < ROLL) {
        // ainda rolando: chega na boca da caçapa
        const k = t / ROLL;
        m.position.set(from.x + (h.x - from.x) * k, R, from.z + (h.z - from.z) * k);
      } else {
        // despenca: aceleração constante até o fundo, quicando de leve no fim
        const k = Math.min(1, (t - ROLL) / DROP);
        const y = R + (rest.y - R) * k * k;
        const bounce = k === 1 ? 0 : Math.sin(k * Math.PI) * 0.004;
        m.position.set(h.x + (rest.x - h.x) * k, y + bounce, h.z + (rest.z - h.z) * k);
      }
      m.rotateX(0.25);
      if (t < ROLL + DROP) return true;
      m.position.copy(rest);
      falling.delete(id);
      inPocket.set(id, { hole });
      return false;
    });
  }

  // brilho rápido no ponto de um choque
  const flashGeo = new THREE.RingGeometry(R * 0.8, R * 1.05, 28);
  function flash(x: number, y: number, strength: number) {
    const mat = new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0.8 * strength, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(flashGeo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(toScene(x, y)).setY(0.004);
    scene.add(ring);
    const start = performance.now();
    effects.push((now) => {
      const k = (now - start) / 240;
      if (k >= 1) {
        scene.remove(ring);
        mat.dispose();
        return false;
      }
      ring.scale.setScalar(1 + k * 1.6);
      mat.opacity = 0.8 * strength * (1 - k);
      return true;
    });
  }

  const api = {
    setBalls(balls: BallPos[]) {
      for (const b of balls) {
        const m = mesh(b.id);
        if (b.pocketed) {
          // caiu agora: rola até a boca, despenca com gravidade e fica lá dentro
          if (!inPocket.has(b.id) && !falling.has(b.id)) {
            if (m.visible && last.has(b.id)) fall(b.id, m);
            else m.visible = false; // já estava encaçapada quando a mesa carregou
          }
          continue;
        }
        // voltou para a mesa (bola recolocada ou mesa nova): sai da caçapa
        const was = inPocket.get(b.id);
        if (was) {
          holes[was.hole].count--;
          inPocket.delete(b.id);
        }
        falling.delete(b.id);
        m.visible = true;
        const prev = last.get(b.id);
        if (prev) {
          // gira a bola na direção em que rolou
          const dx = b.x - prev.x;
          const dz = b.y - prev.y;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > 1e-6) m.rotateOnWorldAxis(new THREE.Vector3(dz / d, 0, -dx / d), -d / R);
        }
        m.position.copy(toScene(b.x, b.y));
        last.set(b.id, { x: b.x, y: b.y });
      }
      current = balls;
      placeRings();
      invalidate();
    },
    setHighlight(ids: number[]) {
      highlighted = ids;
      placeRings();
      invalidate();
    },
    // o taco recua um pouco mais e bate na branca; resolve no instante do contato
    strike(angle: number, power: number): Promise<void> {
      return new Promise((resolve) => {
        const start = performance.now();
        const back = power * 0.5 + 0.08;
        const BACK = 110;
        const HIT = 60 + (1 - power) * 70; // tacada forte é mais rápida
        effects.push((now) => {
          const t = now - start;
          if (t < BACK) cueState = { ...cueState, visible: true, angle, pull: power * 0.5 + ((back - power * 0.5) * t) / BACK };
          else if (t < BACK + HIT) cueState = { ...cueState, visible: true, angle, pull: back - ((back + 0.06) * (t - BACK)) / HIT };
          else {
            cueState = { ...cueState, visible: false, angle, pull: 0 };
            resolve();
            return false;
          }
          return true;
        });
        invalidate();
      });
    },
    flash,
    shake(amount: number) {
      shakeAmp = Math.max(shakeAmp, amount);
      invalidate();
    },
    // power e efeito só servem para desenhar o caminho da branca depois do choque
    setCue(visible: boolean, angle: number, pull: number, shot: { power: number; spinX: number; spinY: number; item?: Item | null } = { power: 0, spinX: 0, spinY: 0 }) {
      cueState = { visible, angle, pull, power: shot.power, spinX: shot.spinX, spinY: shot.spinY, item: shot.item ?? null };
      invalidate();
    },
    setCalledPocket(p: number | null) {
      calledRing.visible = p !== null;
      if (p !== null) calledRing.position.copy(toScene(pockets[p].x, pockets[p].y)).setY(0.005);
      invalidate();
    },
    // anel da Caçapa gigante durante a tacada de quem usou
    setShotGiant(on: boolean) {
      shotGiant = on;
      invalidate();
    },
    setCamera(mode: 'aim' | 'top', angle?: number) {
      camMode = mode;
      if (angle !== undefined) cueState.angle = angle;
      invalidate();
    },
    // durante a animação a câmera de mira acompanha a branca
    follow(pos: { x: number; y: number } | null) {
      follow = pos;
      invalidate();
    },
    pickTable(clientX: number, clientY: number): { x: number; y: number } | null {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      const x = hit.x + L / 2;
      const y = hit.z + W / 2;
      return x >= 0 && x <= L && y >= 0 && y <= W ? { x, y } : null;
    },
    // ângulo da tela → ângulo na mesa: para girar a mira arrastando, no sentido em que a câmera olha
    screenToTableAngle(): number {
      const f = new THREE.Vector3();
      camera.getWorldDirection(f);
      const right = new THREE.Vector3().crossVectors(f, camera.up).normalize();
      return Math.atan2(right.z, right.x);
    },
    lowQuality(on: boolean) {
      low = on;
      renderer.shadowMap.enabled = !on;
      renderer.setPixelRatio(on ? 1 : maxRatio);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).needsUpdate = true;
      });
      resize();
    },
    invalidate,
  };
  return api;
}
