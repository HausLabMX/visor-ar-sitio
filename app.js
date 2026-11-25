import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { solveCalibration, rad2deg } from './calibrate.js';
import { loadCfg, buildMarks, buildDemoBuilding, loadModel, setOpacity, loadGlbFile, describeModel, childNames, parseMarks, marksToText } from './model.js';

const $ = (id) => document.getElementById(id);
const ui = $('ui'), statusEl = $('status');
const setStatus = (t) => { statusEl.textContent = t; };
const show = (id, v = true) => $(id).classList.toggle('hide', !v);

/* ───────────── Proyecto ───────────── */
const projectId = new URLSearchParams(location.search).get('p') || 'demo';
let cfg;
try {
  cfg = await loadCfg(projectId);
} catch (e) {
  setStatus('No se pudo cargar projects/' + projectId + '.json. Sirve la carpeta por HTTPS (no abras el archivo directo).');
  throw e;
}
$('title').textContent = cfg.name || projectId;
$('btnStation').href = 'estacion.html?p=' + encodeURIComponent(projectId);
const CP = cfg.controlPoints;

// ¿Hay WebGL? Sin él no se puede dibujar el 3D (típico: aceleración por hardware desactivada)
(function () {
  var c = document.createElement('canvas');
  if (!(c.getContext('webgl2') || c.getContext('webgl'))) {
    throw new Error('Este navegador no puede dibujar 3D (WebGL no disponible). En Chrome: Configuración → Sistema → activa «Usar aceleración por hardware», reinicia el navegador. O prueba directo en tu celular.');
  }
})();

/* ───────────── Escena ───────────── */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe8ef); // solo en vista previa; en AR se quita
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 1000);
camera.position.set(-20, 28, 62);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(10, 5, 15);
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(30, 60, 20);
scene.add(sun);

// Suelo de la vista previa (también sirve para "tocar" marcas con el mouse)
const previewGround = new THREE.Group();
const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc9d3dc }));
groundPlane.position.y = -0.01;
previewGround.add(groundPlane, new THREE.GridHelper(200, 200, 0x8a98a6, 0xb4c0cb));
scene.add(previewGround);

// Ancla: todo el modelo cuelga de aquí. La calibración mueve/gira este grupo.
const anchor = new THREE.Group();
anchor.visible = false;
scene.add(anchor);
const modelRoot = new THREE.Group();
const markGroup = new THREE.Group(); // postes + huella del lote (verificación visual)
anchor.add(modelRoot, markGroup);

// Marcas medidas en el terreno (en coordenadas del mundo, NO cuelgan del ancla)
const measuredGroup = new THREE.Group();
scene.add(measuredGroup);

/* ───────────── Modelo ───────────── */
let toggleNames = cfg.toggles || [];
buildMarks(cfg, markGroup);
if (cfg.model) {
  loadModel(cfg, modelRoot, (sc) => { setStatus('Modelo cargado'); if (!toggleNames.length) toggleNames = childNames(sc); buildToggles(); $('modelInfo').innerHTML = '<small>' + describeModel(modelRoot, 1) + '</small>'; },
    (e) => setStatus('Error cargando el modelo: ' + (e.message || e)));
} else {
  toggleNames = buildDemoBuilding(cfg, modelRoot);
}
function buildToggles() {
  const box = $('toggles'); box.innerHTML = '';
  toggleNames.forEach((name) => {
    const l = document.createElement('label');
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = true;
    c.onchange = () => { const o = modelRoot.getObjectByName(name); if (o) o.visible = c.checked; };
    l.append(c, name); box.append(l);
  });
}
buildToggles();
anchor.visible = true; // en vista previa se ve en el origen del modelo hasta calibrar

/* ───────────── Tu modelo y tus marcas ───────────── */
$('marks').value = marksToText(CP);
$('glb').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  setStatus('Leyendo ' + file.name + '…');
  try {
    const sc = await loadGlbFile(file, modelRoot);
    modelRoot.scale.setScalar(parseFloat($('units').value));
    toggleNames = childNames(sc); buildToggles();
    $('modelInfo').innerHTML = '<small>' + file.name + ' · ' + describeModel(sc, parseFloat($('units').value)) + '</small>';
    setStatus('Modelo cargado: ' + file.name);
  } catch (err) { setStatus('⚠ ' + err.message); }
};
$('units').onchange = () => {
  const u = parseFloat($('units').value); modelRoot.scale.setScalar(u);
  const sc = modelRoot.children[0];
  if (sc) $('modelInfo').innerHTML = '<small>' + describeModel(sc, u) + '</small>';
};
$('btnMarks').onclick = () => {
  try {
    const list = parseMarks($('marks').value);
    CP.splice(0, CP.length, ...list);
    markGroup.clear(); buildMarks(cfg, markGroup);
    if (phase === 'collect') startCollect(); else renderPts();
    setStatus(list.length + ' marcas aplicadas. Calibra de nuevo.');
  } catch (err) { setStatus('⚠ ' + err.message); }
};

/* ───────────── Estado de calibración ───────────── */
let phase = 'idle'; // idle | collect | placed
let collected = []; // { id, world: Vector3 }
let xrSession = null, hitSource = null;

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff8a1f }));
reticle.matrixAutoUpdate = false; reticle.visible = false;
scene.add(reticle);

function renderPts() {
  const row = $('ptsRow'); row.innerHTML = '';
  CP.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'pt' + (i < collected.length ? ' done' : i === collected.length ? ' next' : '');
    d.textContent = p.id; row.append(d);
  });
  const next = CP[collected.length];
  $('instr').innerHTML = next
    ? `Ve a la marca <b>${next.id}</b> (${next.label}), apunta el círculo naranja a su base y <b>toca la pantalla</b>.` +
      (collected.length >= 2 ? '<br><small>Ya puedes aplicar; más marcas = más precisión y verificación.</small>' : '')
    : 'Todas las marcas tomadas. Pulsa Aplicar.';
  $('btnApply').disabled = collected.length < 2;
  $('btnUndo').disabled = collected.length === 0;
}

function addMeasured(pos) {
  if (collected.length >= CP.length) return;
  const id = CP[collected.length].id;
  collected.push({ id, world: pos.clone() });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x35c26b }));
  m.position.copy(pos); measuredGroup.add(m);
  renderPts();
  setStatus(`Marca ${id} tomada (${collected.length}/${CP.length})`);
}

function startCollect() {
  phase = 'collect'; collected = []; measuredGroup.clear();
  anchor.visible = false;
  show('secCalib'); show('secAdjust', false); show('secView', false);
  renderPts();
  setStatus(xrSession ? 'Apunta el círculo a la marca A y toca' : 'Vista previa: haz clic en el suelo para cada marca');
}

function applySolution(sol) {
  anchor.position.set(sol.tx, sol.ty, sol.tz);
  anchor.rotation.set(0, sol.yaw, 0);
  anchor.scale.setScalar(sol.scale);
  anchor.visible = true;
}

function applyCalibration() {
  const pairs = collected.map((c, i) => ({ id: c.id, model: CP[i], world: c.world }));
  const sol = solveCalibration(pairs, { fitScale: $('chkScale').checked });
  applySolution(sol);
  phase = 'placed';
  show('secCalib', false); show('secAdjust'); show('secView');
  // Informe de calidad
  const lines = [];
  const worst = Math.max(...sol.residuals.map((r) => r.err));
  lines.push('Error por marca: ' + sol.residuals.map((r) => `${r.id} ${(r.err * 100).toFixed(1)} cm`).join(' · '));
  const b = sol.baseline;
  const pct = (b.measured / b.model - 1) * 100;
  lines.push(`Distancia ${b.a}–${b.b}: medida ${b.measured.toFixed(2)} m vs modelo ${b.model.toFixed(2)} m (${pct >= 0 ? '+' : ''}${pct.toFixed(2)} %)`);
  lines.push(`Rotación aplicada: ${rad2deg(sol.yaw).toFixed(1)}°`);
  let cls = 'good', verdict = 'Calibración buena.';
  if (Math.abs(pct) > 2 || worst > 0.3) { cls = 'bad'; verdict = 'Revisa: marcas mal tomadas, deriva del tracking o modelo/marcas espejados. Recalibra.'; }
  else if (Math.abs(pct) > 0.8 || worst > 0.1) { cls = 'warn'; verdict = 'Aceptable; para más precisión retoma las marcas rápido y sin desviarte del camino.'; }
  $('report').innerHTML = lines.join('\n') + `\n<span class="${cls}">${verdict}</span>`;
  setStatus('Los postes naranjas deben caer sobre tus marcas físicas');
  if (!xrSession) frameLot();
  return sol;
}

// Vista previa: encuadra el lote ya calibrado
function frameLot() {
  const c = anchor.localToWorld(new THREE.Vector3(
    CP.reduce((a, p) => a + p.x, 0) / CP.length, 0, CP.reduce((a, p) => a + p.z, 0) / CP.length));
  controls.target.copy(c);
  camera.position.set(c.x - 18, 30, c.z + 50);
  controls.update();
}

/* ───────────── Ajuste fino (relativo a la cámara) ───────────── */
function camBasis() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const f = new THREE.Vector3(); cam.getWorldDirection(f); f.y = 0;
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  f.normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x); // derecha de la cámara en el plano
  return { f, r };
}
const step = () => parseFloat($('step').value);
const rstep = () => parseFloat($('rstep').value);
document.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => {
  const { f, r } = camBasis(); const s = step();
  const d = { f: f.clone(), b: f.clone().negate(), r: r.clone(), l: r.clone().negate() }[b.dataset.mv];
  anchor.position.addScaledVector(d, s);
});
document.querySelectorAll('[data-rot]').forEach((b) => b.onclick = () => {
  // Gira alrededor del centro de las marcas, para que el edificio no "se vaya" lejos
  const c = new THREE.Vector3(CP.reduce((a, p) => a + p.x, 0) / CP.length, 0, CP.reduce((a, p) => a + p.z, 0) / CP.length);
  const pivot = anchor.localToWorld(c.clone());
  const ang = THREE.MathUtils.degToRad(rstep()) * parseFloat(b.dataset.rot);
  anchor.position.sub(pivot).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).add(pivot);
  anchor.rotation.y += ang;
});
document.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => {
  anchor.position.y += (step() < 0.05 ? 0.02 : 0.05) * parseFloat(b.dataset.h);
});

$('opacity').oninput = (e) => setOpacity(modelRoot, parseFloat(e.target.value));
$('chkMarks').onchange = (e) => { markGroup.visible = e.target.checked; };

/* ───────────── Botones principales ───────────── */
$('btnUndo').onclick = () => {
  if (!collected.length) return;
  collected.pop(); measuredGroup.remove(measuredGroup.children[measuredGroup.children.length - 1]); renderPts();
};
$('btnApply').onclick = () => { try { applyCalibration(); } catch (e) { setStatus('Error: ' + e.message); } };
$('btnRecal').onclick = startCollect;
$('btnMin').onclick = () => {
  const p = $('panel'); p.classList.toggle('min'); $('btnMin').textContent = p.classList.contains('min') ? 'Mostrar panel ▴' : 'Ocultar panel ▾';
};
ui.addEventListener('beforexrselect', (e) => e.preventDefault()); // los toques en la UI no cuentan como "marca"

/* ───────────── Vista previa (escritorio / sin AR) ───────────── */
$('btnPreview').onclick = () => {
  show('secStart', false); startCollect(); show('btnSim');
};
// Clic en el suelo = marca (solo en vista previa)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downXY = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (xrSession || phase !== 'collect' || !downXY) return;
  if (Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(groundPlane)[0];
  if (hit) addMeasured(new THREE.Vector3(hit.point.x, 0, hit.point.z));
});
// Simula un terreno real: marcas puestas con un giro/offset desconocidos y ruido de ~3 cm
$('btnSim').onclick = () => {
  measuredGroup.clear(); collected = [];
  const truth = new THREE.Group();
  truth.rotation.y = THREE.MathUtils.degToRad(THREE.MathUtils.randFloat(-180, 180));
  truth.position.set(THREE.MathUtils.randFloat(-25, 25), 0, THREE.MathUtils.randFloat(-25, 25));
  truth.updateMatrixWorld(true);
  CP.forEach((p) => {
    const w = truth.localToWorld(new THREE.Vector3(p.x, 0, p.z));
    w.x += (Math.random() - 0.5) * 0.06; w.z += (Math.random() - 0.5) * 0.06;
    addMeasured(w);
  });
  const sol = applyCalibration();
  const real = ((rad2deg(truth.rotation.y) % 360) + 360) % 360, got = ((rad2deg(sol.yaw) % 360) + 360) % 360;
  $('report').innerHTML += `\n<small>Simulación: giro real ${real.toFixed(1)}° · recuperado ${got.toFixed(1)}°</small>`;
};

/* ───────────── AR (WebXR · Android/Chrome) ───────────── */
async function checkSupport() {
  const msg = $('startMsg').firstChild;
  if (cfg.usdz) { $('btnQL').href = cfg.usdz; show('btnQL'); }
  let ar = false;
  try { ar = !!(navigator.xr && await Promise.race([navigator.xr.isSessionSupported('immersive-ar'), new Promise((r) => setTimeout(() => r(false), 2000))])); } catch { /* ignore */ }
  if (ar) {
    show('btnAR');
    msg.textContent = 'Listo. En el terreno, pulsa «Iniciar AR». Necesitarás al menos 2 marcas colocadas en las esquinas del lote.';
    setStatus('AR disponible');
  } else {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    msg.textContent = ios
      ? 'iPhone/iPad: Safari no soporta WebXR AR. Usa el «Modo estación» (cámara + giroscopio, calibrado con marcas del terreno).' + (cfg.usdz ? ' También hay Quick Look (sin calibración por marcas).' : '')
      : 'Este navegador/dispositivo no ofrece WebXR AR. En Android usa Chrome (con ARCore). Puedes usar el «Modo estación» o la vista previa.';
    $('btnStation').classList.add('pri');
    setStatus('Sin AR en este dispositivo');
  }
}

$('btnAR').onclick = async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: ui },
    });
    xrSession = session;
    scene.background = null; previewGround.visible = false; controls.enabled = false;
    await renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    hitSource = await session.requestHitTestSource({ space: viewer });
    session.addEventListener('select', () => {
      if (phase === 'collect' && reticle.visible) addMeasured(new THREE.Vector3().setFromMatrixPosition(reticle.matrix));
    });
    session.addEventListener('end', () => {
      xrSession = null; hitSource = null; reticle.visible = false;
      scene.background = new THREE.Color(0xdfe8ef); previewGround.visible = true; controls.enabled = true;
      show('secEnd', false); show('secStart');
      setStatus('Sesión AR terminada');
    });
    show('secStart', false); show('secEnd');
    startCollect();
  } catch (e) {
    setStatus('No se pudo iniciar AR: ' + (e.message || e));
  }
};
$('btnExit').onclick = () => { if (xrSession) xrSession.end(); };

/* ───────────── Bucle de render ───────────── */
renderer.setAnimationLoop((t, frame) => {
  if (frame && hitSource) {
    const res = frame.getHitTestResults(hitSource);
    if (res.length) {
      const pose = res[0].getPose(renderer.xr.getReferenceSpace());
      reticle.visible = phase === 'collect';
      reticle.matrix.fromArray(pose.transform.matrix);
    } else reticle.visible = false;
  }
  if (!xrSession) controls.update();
  renderer.render(scene, camera);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

checkSupport();
renderPts();
// Exponer para pruebas
window.__visor = { anchor, applyCalibration, get phase() { return phase; } };
