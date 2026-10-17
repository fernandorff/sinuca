// Cena 3D: a física vive no plano (x, y); aqui (x, y) vira (x − L/2, R, y − W/2) no plano XZ.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MODES, type Mode } from '../shared/rules/index.ts';
import { predictAim } from '../shared/aim.ts';
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
  const { L, W, R, pockets } = MODES[mode].table;
  const toScene = (x: number, y: number) => new THREE.Vector3(x - L / 2, R, y - W / 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(maxRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d0a07');
  scene.fog = new THREE.Fog('#0d0a07', 4.5, 11);
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

  // mesa: feltro, tabelas entre as caçapas, moldura de madeira e caçapas
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(L + 2 * CUSHION_W, W + 2 * CUSHION_W), new THREE.MeshStandardMaterial({ color: FELT, roughness: 0.95 }));
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const cushionMat = new THREE.MeshStandardMaterial({ color: CUSHION, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.55 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  // as aberturas das tabelas acompanham o tamanho das caçapas de cada mesa
  const corner = pockets[0].r * 1.45;
  const side = pockets[4].r * 1.35;
  const longSeg = L / 2 - corner - side;
  for (const z of [-(W / 2 + CUSHION_W / 2), W / 2 + CUSHION_W / 2]) {
    box(longSeg, RAIL_H, CUSHION_W, -L / 4 + (side - corner) / 2, RAIL_H / 2, z, cushionMat);
    box(longSeg, RAIL_H, CUSHION_W, L / 4 - (side - corner) / 2, RAIL_H / 2, z, cushionMat);
  }
  for (const x of [-(L / 2 + CUSHION_W / 2), L / 2 + CUSHION_W / 2]) box(CUSHION_W, RAIL_H, W - 2 * corner, x, RAIL_H / 2, 0, cushionMat);
  const outerL = L + 2 * CUSHION_W + 2 * FRAME_W;
  const outerW = W + 2 * CUSHION_W + 2 * FRAME_W;
  for (const z of [-(outerW / 2 - FRAME_W / 2), outerW / 2 - FRAME_W / 2]) box(outerL, RAIL_H + 0.01, FRAME_W, 0, (RAIL_H + 0.01) / 2, z, woodMat);
  for (const x of [-(outerL / 2 - FRAME_W / 2), outerL / 2 - FRAME_W / 2]) box(FRAME_W, RAIL_H + 0.01, outerW - 2 * FRAME_W, x, (RAIL_H + 0.01) / 2, 0, woodMat);
  box(outerL + 0.04, 0.6, outerW + 0.04, 0, -0.302, 0, woodMat);
  // caçapas: buraco escuro com parede por dentro e um aro de couro por cima
  const pocketMat = new THREE.MeshBasicMaterial({ color: '#030303', side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: '#24150c', roughness: 0.6 });
  for (const p of pockets) {
    const at = toScene(p.x, p.y);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(p.r, 32), pocketMat);
    hole.rotation.x = -Math.PI / 2;
    hole.position.copy(at).setY(0.0015);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, RAIL_H + 0.012, 32, 1, true), pocketMat);
    wall.position.copy(at).setY((RAIL_H + 0.012) / 2);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(p.r + 0.003, 0.0055, 10, 40), leather);
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(at).setY(RAIL_H + 0.009);
    scene.add(hole, wall, rim);
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
  const setLine = (l: THREE.Line, a: THREE.Vector3, b: THREE.Vector3) => {
    l.geometry.setFromPoints([a, b]);
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
  let cueState = { visible: false, angle: 0, pull: 0 };
  let camMode: 'aim' | 'top' = 'top';
  let follow: { x: number; y: number } | null = null;

  function cuePos() {
    const p = last.get(0);
    return p ? toScene(p.x, p.y) : toScene(L / 4, W / 2);
  }

  function placeCue() {
    const { visible, angle, pull } = cueState;
    const cue = last.get(0);
    stick.visible = aimLine.visible = visible && !!cue;
    ghost.visible = targetLine.visible = cueLine.visible = false;
    if (!stick.visible || !cue) return;
    const c = cuePos();
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const dir = new THREE.Vector3(dx, 0, dy);
    const gap = R + 0.012 + pull * 0.22;
    stick.position.copy(c).addScaledVector(dir, -gap).setY(R + 0.012);
    stick.rotation.set(0, -angle, 0.06);

    const aim = predictAim(current, cue, dx, dy, MODES[mode].table);
    setLine(aimLine, onFelt(cue.x, cue.y), onFelt(aim.end.x, aim.end.y));
    if (aim.ghost && aim.targetDir && aim.target !== null) {
      ghost.visible = targetLine.visible = true;
      ghost.position.copy(toScene(aim.ghost.x, aim.ghost.y));
      const t = last.get(aim.target)!;
      setLine(targetLine, onFelt(t.x, t.y), onFelt(t.x + aim.targetDir.x * 0.32, t.y + aim.targetDir.y * 0.32));
      if (aim.cueDir) {
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
      camera.up.set(portrait ? -1 : 0, 0, portrait ? 0 : -1);
      camera.lookAt(cx, 0, cz);
      return;
    }
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
  function loop(t: number) {
    requestAnimationFrame(loop);
    if (!dirty) {
      frames = [];
      return;
    }
    dirty = false;
    placeCue();
    placeCamera();
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

  const api = {
    setBalls(balls: BallPos[]) {
      for (const b of balls) {
        const m = mesh(b.id);
        m.visible = !b.pocketed;
        const prev = last.get(b.id);
        if (prev && !b.pocketed) {
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
    setCue(visible: boolean, angle: number, pull: number) {
      cueState = { visible, angle, pull };
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
