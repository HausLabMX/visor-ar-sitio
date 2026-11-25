// Código común a los dos modos (AR con WebXR y modo estación).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

function makeLoader() {
  const l = new GLTFLoader();
  const d = new DRACOLoader(); d.setDecoderPath('./vendor/draco/');
  l.setDRACOLoader(d); l.setMeshoptDecoder(MeshoptDecoder);
  return l;
}

export async function loadCfg(projectId) {
  const r = await fetch(`projects/${encodeURIComponent(projectId)}.json`);
  if (!r.ok) throw new Error('No existe projects/' + projectId + '.json');
  return r.json();
}

// Postes y huella del lote en las marcas (sirven para verificar que coinciden con las estacas reales)
export function buildMarks(cfg, group, { poleR = 0.04, capR = 0.12 } = {}) {
  const CP = cfg.controlPoints;
  const mat = new THREE.MeshBasicMaterial({ color: 0xff8a1f });
  CP.forEach((p) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR, 3, 10), mat);
    pole.position.set(p.x, 1.5, p.z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 16, 12), mat);
    cap.position.set(p.x, 3, p.z);
    group.add(pole, cap);
  });
  if (CP.length >= 3) {
    const pts = CP.map((p) => new THREE.Vector3(p.x, 0.03, p.z));
    group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff8a1f })));
  }
}

// Torre de ejemplo dentro del lote de 20 x 30 m (reemplázala con tu GLB real)
export function buildDemoBuilding(cfg, root) {
  const n = cfg.demoFloors || 4, h = 3;
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x6fa8c8, roughness: 0.15, metalness: 0.2 });
  const names = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    g.name = 'Planta ' + (i + 1);
    const w = 14 - i * 0.8, d = 22 - i * 0.8;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), mat);
    slab.position.set(10, i * h + 0.15, 15);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, h - 0.3, d - 0.6), glass);
    body.position.set(10, i * h + 0.3 + (h - 0.3) / 2, 15);
    g.add(slab, body);
    root.add(g);
    names.push(g.name);
  }
  return names;
}

export function loadModel(cfg, root, onDone, onError) {
  makeLoader().load(cfg.model, (gltf) => { root.add(gltf.scene); onDone && onDone(gltf.scene); }, undefined, onError);
}

// Carga un .glb elegido por el usuario (desde el teléfono o la compu), sin subirlo a ningún lado
export async function loadGlbFile(file, root) {
  const buf = await file.arrayBuffer();
  return new Promise((res, rej) => makeLoader().parse(buf, '', (gltf) => {
    root.clear(); root.add(gltf.scene); res(gltf.scene);
  }, (e) => rej(new Error('No se pudo leer el GLB: ' + (e.message || e)))));
}

// Medidas del modelo (para comprobar que viene en metros)
export function modelInfo(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  return { size: b.getSize(new THREE.Vector3()), min: b.min.clone(), max: b.max.clone() };
}
export function describeModel(obj, unitScale) {
  const { size, min } = modelInfo(obj);
  const f = (v) => (v * unitScale).toFixed(1);
  let t = `Medidas: ${f(size.x)} × ${f(size.z)} m en planta, ${f(size.y)} m de alto.`;
  const big = Math.max(size.x, size.z) * unitScale;
  if (big > 500) t += ' ⚠ Parece demasiado grande: ¿exportaste en cm o mm? Cambia «Unidades».';
  else if (big < 2) t += ' ⚠ Parece demasiado chico: revisa «Unidades».';
  if (Math.hypot(min.x, min.z) * unitScale > 1000) t += ' ⚠ El origen del modelo está a más de 1 km: tus marcas deben usar esas mismas coordenadas.';
  return t;
}
// Nombres de las partes principales (para prender/apagar)
export function childNames(scene) {
  let n = scene; while (n.children.length === 1 && n.children[0].children.length) n = n.children[0];
  return n.children.filter((c) => c.name).slice(0, 30).map((c) => c.name);
}
// "A 0 0 esquina suroeste" por línea
export function parseMarks(text) {
  const out = [];
  for (const line of text.split(/\n+/)) {
    const m = line.trim().match(/^(\S+)[\s,;]+(-?[\d.]+)[\s,;]+(-?[\d.]+)\s*(.*)$/);
    if (m) out.push({ id: m[1], x: parseFloat(m[2]), z: parseFloat(m[3]), label: m[4] || ('marca ' + m[1]) });
  }
  if (out.length < 2) throw new Error('Necesitas al menos 2 marcas válidas (formato: A 0 0 descripción)');
  return out;
}
export const marksToText = (CP) => CP.map((p) => `${p.id} ${p.x} ${p.z} ${p.label || ''}`.trim()).join('\n');

export function setOpacity(root, v) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m.userData.baseTransparent === undefined) { m.userData.baseTransparent = m.transparent; m.userData.baseOpacity = m.opacity; }
      m.transparent = v < 1 || m.userData.baseTransparent;
      m.opacity = m.userData.baseOpacity * v;
      m.needsUpdate = true;
    });
  });
}
