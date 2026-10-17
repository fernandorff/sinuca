// Cena 3D: a física vive no plano (x, y); aqui (x, y) vira (x − L/2, R, y − W/2) no plano XZ.
import * as THREE from 'three';
import { L, POCKETS, R, W, type BallPos } from '../shared/table.ts';

const BALL_COLORS = ['#f4f1e8', '#f2c230', '#1d4fb8', '#c8282b', '#5a2a86', '#e3711c', '#1c7a43', '#7a1f22', '#111111'];
const FELT = '#1f6b4a';
const CUSHION = '#1a5c40';
const WOOD = '#5b3419';
const RAIL_H = 0.042;
const CUSHION_W = 0.045;
const FRAME_W = 0.13;

const toScene = (x: number, y: number) => new THREE.Vector3(x - L / 2, R, y - W / 2);

function ballTexture(id: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const color = BALL_COLORS[id <= 8 ? id : id - 8];
  const stripe = id >= 9;
  g.fillStyle = stripe ? '#f4f1e8' : color;
  g.fillRect(0, 0, 256, 128);
  if (stripe) {
    g.fillStyle = color;
    g.fillRect(0, 34, 256, 60);
  }
  if (id > 0) {
    for (const u of [64, 192]) {
      g.fillStyle = '#f4f1e8';
      g.beginPath();
      g.ellipse(u, 64, 22, 26, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#151515';
      g.font = 'bold 30px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(id), u, 66);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export type GameScene = ReturnType<typeof createScene>;

export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(maxRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14110d');
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 20);

  scene.add(new THREE.HemisphereLight('#fff3e0', '#1a1612', 0.9));
  const lamp = new THREE.DirectionalLight('#fff6e8', 1.8);
  lamp.position.set(0.3, 3, 0.4);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  Object.assign(lamp.shadow.camera, { left: -1.6, right: 1.6, top: 1, bottom: -1, near: 1, far: 5 });
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
  const corner = 0.09;
  const side = 0.075;
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
  const pocketMat = new THREE.MeshBasicMaterial({ color: '#050505' });
  for (const p of POCKETS) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.002, 32), pocketMat);
    hole.position.copy(toScene(p.x, p.y)).setY(RAIL_H + 0.006);
    scene.add(hole);
  }

  // bolas
  const sphere = new THREE.SphereGeometry(R, 32, 20);
  const meshes = new Map<number, THREE.Mesh>();
  const last = new Map<number, { x: number; y: number }>();
  function mesh(id: number) {
    let m = meshes.get(id);
    if (!m) {
      m = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ map: ballTexture(id), roughness: 0.22 }));
      m.castShadow = true;
      m.rotation.set(0, Math.PI / 2, Math.PI / 2);
      scene.add(m);
      meshes.set(id, m);
    }
    return m;
  }

  // taco e linha de mira
  const stick = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.014, 1.45, 16), new THREE.MeshStandardMaterial({ color: '#c99a5b', roughness: 0.5 }));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -1.45 / 2;
  shaft.castShadow = true;
  stick.add(shaft);
  scene.add(stick);
  const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const aimLine = new THREE.Line(aimGeo, new THREE.LineDashedMaterial({ color: '#f4f1e8', dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.55 }));
  aimLine.computeLineDistances();
  scene.add(aimLine);
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
    if (!stick.visible) return;
    const c = cuePos();
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const gap = R + 0.012 + pull * 0.22;
    stick.position.copy(c).addScaledVector(dir, -gap).setY(R + 0.012);
    stick.rotation.set(0, -angle, 0.06);
    aimLine.position.copy(c);
    aimLine.rotation.set(0, -angle, 0);
    aimLine.scale.setScalar(0.9);
  }

  function placeCamera() {
    const aspect = camera.aspect;
    if (camMode === 'top') {
      const portrait = aspect < 1;
      const long = L + 2 * (CUSHION_W + FRAME_W) + 0.08;
      const short = W + 2 * (CUSHION_W + FRAME_W) + 0.08;
      const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      // distância que cabe a mesa inteira, no sentido do comprimento e da largura da tela
      const fitH = (portrait ? long : short) / 2 / halfTan;
      const fitW = (portrait ? short : long) / 2 / halfTan / aspect;
      camera.position.set(0, Math.max(fitH, fitW), 0.0001);
      camera.up.set(portrait ? -1 : 0, 0, portrait ? 0 : -1);
      camera.lookAt(0, 0, 0);
      return;
    }
    const target = follow ? toScene(follow.x, follow.y) : cuePos();
    const dir = new THREE.Vector3(Math.cos(cueState.angle), 0, Math.sin(cueState.angle));
    camera.up.set(0, 1, 0);
    const back = aspect < 1 ? 1.5 : 1;
    camera.position.copy(target).addScaledVector(dir, -0.85 * back).setY(0.42 * back);
    camera.lookAt(target.clone().addScaledVector(dir, 0.55));
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
