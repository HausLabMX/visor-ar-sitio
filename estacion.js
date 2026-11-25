// Modo estación: cámara + giroscopio, sin SLAM. Funciona en iPhone (Safari) y en cualquier móvil.
//
// Idea: el usuario se para sobre una marca conocida del terreno (la "estación") y apunta la mirilla
// a otra marca conocida. Como en el modelo conocemos la dirección entre ambas, esa visual da el
// rumbo absoluto. A partir de ahí el giroscopio mueve la cámara virtual (solo rotación, 3 grados
// de libertad); la posición queda fija en la estación (o donde marques en el minimapa).
import * as THREE from 'three';
import { loadCfg, buildMarks, buildDemoBuilding, loadModel, setOpacity, loadGlbFile, describeModel, childNames, buildUsdz, openQuickLook, supportsQuickLook } from './model.js';

const $ = (id) => document.getElementById(id);
const setStatus = (t) => { $('status').textContent = t; };
const params = new URLSearchParams(location.search);
const projectId = params.get('p') || 'demo';
const SIM = params.get('sim') === '1'; // pruebas de escritorio: sin cámara ni giroscopio, se arrastra para mirar

let cfg;
try { cfg = await loadCfg(projectId); }
catch (e) { setStatus('No se pudo cargar el proyecto. Sirve la carpeta por HTTPS (no abras el archivo directo).'); throw e; }
$('title').textContent = (cfg.name || projectId) + ' · estación';
const CP = cfg.controlPoints;
const byId = (id) => CP.find((p) => p.id === id);
const D2R = Math.PI / 180;

// ¿Hay WebGL? Sin él no se puede dibujar el 3D (típico: aceleración por hardware desactivada)
(function () {
  var c = document.createElement('canvas');
  if (!(c.getContext('webgl2') || c.getContext('webgl'))) {
    throw new Error('Este navegador no puede dibujar 3D (WebGL no disponible). En Chrome: Configuración → Sistema → activa «Usar aceleración por hardware», reinicia el navegador. O prueba directo en tu celular.');
  }
})();

/* ───────────── Escena ───────────── */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(30, 60, 20); scene.add(sun);

const modelRoot = new THREE.Group();
const markGroup = new THREE.Group();
scene.add(modelRoot, markGroup);
buildMarks(cfg, markGroup, { poleR: 0.1, capR: 0.35 }); // más gruesos: se ven desde lejos

function labelSprite(text) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ff8a1f'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
  g.fillStyle = '#1b1206'; g.font = 'bold 80px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 70);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(1.5, 1.5, 1);
  return s;
}
CP.forEach((p) => { const s = labelSprite(p.id); s.position.set(p.x, 4.2, p.z); markGroup.add(s); });

let toggleNames = cfg.toggles || [];
function buildToggles() {
  const box = $('toggles'); box.innerHTML = '';
  toggleNames.forEach((name) => {
    const l = document.createElement('label');
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = true;
    c.onchange = () => { const o = modelRoot.getObjectByName(name); if (o) o.visible = c.checked; };
    l.append(c, name); box.append(l);
  });
}
if (cfg.model) loadModel(cfg, modelRoot, buildToggles, (e) => setStatus('Error cargando el modelo: ' + (e.message || e)));
else toggleNames = buildDemoBuilding(cfg, modelRoot);
buildToggles();
$('glb').onchange = async (ev) => {
  const file = ev.target.files[0]; if (!file) return;
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
  if (modelRoot.children[0]) $('modelInfo').innerHTML = '<small>' + describeModel(modelRoot.children[0], u) + '</small>';
};

/* ───────────── Quick Look (caminar en iPhone/iPad) ───────────── */
$('qlOrigin').innerHTML = CP.map((p) => `<option value="${p.id}">${p.id} · ${p.label}</option>`).join('');
function qlHelp() {
  const o = $('qlOrigin').value, other = CP.find((p) => p.id !== o).id;
  $('qlHelp').innerHTML = `<small>1) Párate cerca de la estaca <b>${o}</b> y mueve el iPhone apuntando al piso hasta que detecte el suelo. ` +
    `2) Toca el piso <b>justo en la estaca ${o}</b> (ahí queda el poste grande). 3) Con dos dedos gira el modelo hasta que el poste <b>${other}</b> caiga sobre su estaca. ` +
    `4) Camina: el edificio se queda en su lugar.</small>`;
}
$('qlOrigin').onchange = qlHelp; qlHelp();
if (!supportsQuickLook()) $('qlHelp').innerHTML += '<br><small>⚠ Este navegador no tiene Quick Look (solo Safari en iPhone/iPad).</small>';
$('btnQL').onclick = async () => {
  const b = $('btnQL'); b.disabled = true; b.textContent = 'Preparando modelo…';
  try {
    const blob = await buildUsdz(cfg, modelRoot, $('qlOrigin').value);
    window.__lastUsdz = blob;
    if (supportsQuickLook()) openQuickLook(blob);
    else setStatus('USDZ generado (' + (blob.size / 1e6).toFixed(1) + ' MB), pero Quick Look solo existe en Safari de iPhone/iPad');
  } catch (err) { setStatus('⚠ No se pudo preparar el AR: ' + (err.message || err)); }
  b.disabled = false; b.textContent = 'Ver en AR caminando';
};

/* ───────────── Estado ───────────── */
const viewer = { x: CP[0].x, z: CP[0].z };
let freeMode = false;      // true = posición puesta tocando el minimapa
let aligned = false;
let theta = 0;             // corrección de rumbo (rad, alrededor de Y) que sale de la alineación
let fov = 60;              // campo de visión VERTICAL (°)
let eye = 1.6;             // altura de ojos (m)
modelRoot.visible = markGroup.visible = false;

/* ───────────── Orientación del dispositivo ───────────── */
const q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // la cámara mira por detrás del teléfono
const q0 = new THREE.Quaternion(), zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler();
const qDev = new THREE.Quaternion();   // orientación suavizada del teléfono (marco arbitrario del sensor)
let gotOrient = false, dragMode = SIM, simYaw = 0, simPitch = 0;
const simOffset = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2); // marco "desconocido" simulado

function screenAngle() { return D2R * ((screen.orientation && screen.orientation.angle) || window.orientation || 0); }
function onOrient(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const q = new THREE.Quaternion();
  euler.set(e.beta * D2R, e.alpha * D2R, -e.gamma * D2R, 'YXZ');
  q.setFromEuler(euler).multiply(q1).multiply(q0.setFromAxisAngle(zee, -screenAngle()));
  if (!gotOrient) { qDev.copy(q); gotOrient = true; } else qDev.slerp(q, 0.6); // suavizado ligero
}
function currentDeviceQuat() {
  if (dragMode) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(simPitch, simYaw, 0, 'YXZ'));
    return SIM ? q.premultiply(simOffset) : q;
  }
  return qDev;
}
// Arrastrar para mirar (solo cuando no hay giroscopio, o en modo de prueba)
let drag = null;
$('stage').addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag || !dragMode) return;
  simYaw += (e.clientX - drag[0]) * 0.25 * D2R; simPitch = THREE.MathUtils.clamp(simPitch + (e.clientY - drag[1]) * 0.25 * D2R, -1.4, 1.4);
  drag = [e.clientX, e.clientY];
});

/* ───────────── Alineación ───────────── */
const phi = (x, z) => Math.atan2(-z, x); // ángulo horizontal; rotar el grupo en Y por θ suma θ (misma convención que calibrate.js)

function station() { return freeMode ? { x: viewer.x, z: viewer.z } : byId($('selStation').value); }
function align() {
  const st = station(), tg = byId($('selTarget').value);
  const dx = tg.x - st.x, dz = tg.z - st.z;
  if (Math.hypot(dx, dz) < 0.5) { setStatus('Elige una marca distinta a donde estás parado'); return; }
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(currentDeviceQuat());
  if (Math.hypot(f.x, f.z) < 0.2) { setStatus('Baja la mirada: apunta más horizontal para alinear'); return; }
  theta = phi(dx, dz) - phi(f.x, f.z);
  aligned = true;
  modelRoot.visible = markGroup.visible = true;
  $('secFine').classList.remove('hide');
  setStatus(`Alineado a ${tg.id}. Revisa que los postes caigan sobre las otras marcas.`);
}
function updateInstr() {
  const st = $('selStation').value, tg = $('selTarget').value;
  $('instr').innerHTML = freeMode
    ? `Posición libre (la pusiste en el minimapa). Apunta la mirilla <b>+</b> a la base de la marca <b>${tg}</b> y pulsa Alinear.`
    : `Párate <b>sobre la marca ${st}</b>. Apunta la mirilla <b>+</b> a la base de la marca <b>${tg}</b> y pulsa Alinear.`;
}
function fillSelects() {
  $('selStation').innerHTML = CP.map((p) => `<option value="${p.id}">${p.id} · ${p.label}</option>`).join('') + '<option value="__free">Otra posición (toca el minimapa)</option>';
  $('selTarget').innerHTML = CP.map((p) => `<option value="${p.id}">${p.id}</option>`).join('');
  $('selTarget').value = CP[1] ? CP[1].id : CP[0].id;
}
function onStationChange() {
  const v = $('selStation').value;
  if (v === '__free') { freeMode = true; setStatus('Toca el minimapa donde estás parado'); }
  else {
    freeMode = false; const p = byId(v); viewer.x = p.x; viewer.z = p.z;
    if ($('selTarget').value === v) $('selTarget').value = CP.find((q) => q.id !== v).id;
  }
  aligned = false; modelRoot.visible = markGroup.visible = false; $('secFine').classList.add('hide');
  updateInstr();
}
fillSelects();
$('selStation').onchange = onStationChange;
$('selTarget').onchange = () => { aligned = false; modelRoot.visible = markGroup.visible = false; $('secFine').classList.add('hide'); updateInstr(); };
$('btnAlign').onclick = align;
updateInstr();

/* ───────────── Ajustes ───────────── */
document.querySelectorAll('[data-yaw]').forEach((b) => b.onclick = () => { theta += D2R * parseFloat($('ystep').value) * parseFloat(b.dataset.yaw); });
$('fov').oninput = (e) => { fov = parseFloat(e.target.value); $('fovv').textContent = fov.toFixed(1) + '°'; };
$('eye').oninput = (e) => { eye = parseFloat(e.target.value); $('eyev').textContent = eye.toFixed(2) + ' m'; };
$('opacity').oninput = (e) => setOpacity(modelRoot, parseFloat(e.target.value));
$('chkMarks').onchange = (e) => { markGroup.visible = e.target.checked && aligned; };
$('btnMin').onclick = () => {
  const p = $('panel'); p.classList.toggle('min'); $('btnMin').textContent = p.classList.contains('min') ? 'Mostrar panel ▴' : 'Ocultar panel ▾';
};

/* ───────────── Minimapa ───────────── */
const mini = $('mini'), mc = mini.getContext('2d');
const xs = CP.map((p) => p.x), zs = CP.map((p) => p.z);
const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
const span = Math.max(maxX - minX, maxZ - minZ, 5) * 1.5;
const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, SZ = mini.width, sc = SZ / span;
const m2s = (x, z) => [(x - cx) * sc + SZ / 2, (z - cz) * sc + SZ / 2];
const s2m = (px, pz) => [(px - SZ / 2) / sc + cx, (pz - SZ / 2) / sc + cz];
mini.addEventListener('pointerdown', (e) => {
  const r = mini.getBoundingClientRect();
  const [x, z] = s2m(((e.clientX - r.left) / r.width) * SZ, ((e.clientY - r.top) / r.height) * SZ);
  viewer.x = x; viewer.z = z; freeMode = true; $('selStation').value = '__free';
  aligned = false; modelRoot.visible = markGroup.visible = false; $('secFine').classList.add('hide');
  updateInstr(); setStatus('Posición puesta. Apunta a una marca y pulsa Alinear');
  e.stopPropagation();
});
function drawMini() {
  mc.clearRect(0, 0, SZ, SZ);
  if (CP.length >= 3) {
    mc.beginPath(); CP.forEach((p, i) => { const [x, y] = m2s(p.x, p.z); i ? mc.lineTo(x, y) : mc.moveTo(x, y); }); mc.closePath();
    mc.fillStyle = 'rgba(255,138,31,.15)'; mc.fill(); mc.strokeStyle = '#ff8a1f'; mc.lineWidth = 3; mc.stroke();
  }
  mc.font = 'bold 28px system-ui'; mc.textAlign = 'center'; mc.textBaseline = 'middle';
  CP.forEach((p) => {
    const [x, y] = m2s(p.x, p.z);
    mc.fillStyle = '#ff8a1f'; mc.beginPath(); mc.arc(x, y, 15, 0, 7); mc.fill();
    mc.fillStyle = '#1b1206'; mc.fillText(p.id, x, y + 1);
  });
  const [vx, vy] = m2s(viewer.x, viewer.z);
  const f = new THREE.Vector3(); camera.getWorldDirection(f);
  const h = Math.hypot(f.x, f.z) || 1;
  mc.strokeStyle = '#4db3ff'; mc.lineWidth = 5; mc.beginPath(); mc.moveTo(vx, vy); mc.lineTo(vx + (f.x / h) * 70, vy + (f.z / h) * 70); mc.stroke();
  mc.fillStyle = '#4db3ff'; mc.beginPath(); mc.arc(vx, vy, 11, 0, 7); mc.fill();
}

/* ───────────── Inicio: permisos, cámara, sensores ───────────── */
$('btnStart').onclick = async () => {
  const msg = $('startMsg').firstChild;
  try {
    if (!SIM) {
      // iOS exige pedir el permiso dentro del toque del usuario, antes de otros await
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') { msg.textContent = 'Permiso de movimiento denegado. Cierra la pestaña, vuelve a abrirla y acepta el permiso.'; return; }
      }
      addEventListener('deviceorientation', onOrient);
    }
    if (!SIM) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        $('cam').srcObject = stream; await $('cam').play();
      } catch (e) {
        $('warn').textContent = 'Sin cámara (' + (e.name || 'error') + '): verás el modelo sobre fondo gris. Revisa el permiso de cámara del navegador.';
      }
    }
    $('secStart').classList.add('hide'); $('secAlign').classList.remove('hide');
    $('cross').classList.remove('hide'); $('mini').classList.remove('hide');
    setStatus('Párate en la marca, apunta a otra y pulsa Alinear');
    if (!SIM) setTimeout(() => {
      if (!gotOrient) { dragMode = true; $('warn').textContent = 'Sin datos del giroscopio: arrastra el dedo para mirar. En iPhone revisa que Safari tenga permiso de «Movimiento y orientación».'; }
    }, 2000);
  } catch (e) {
    msg.textContent = 'No se pudo iniciar: ' + (e.message || e);
  }
};

setStatus('Listo. Pulsa «Iniciar cámara y sensores»');

/* ───────────── Bucle de render ───────────── */
let lastW = 0, lastH = 0, lastFov = 0;
function frame() {
  const w = innerWidth, h = innerHeight;
  if (w !== lastW || h !== lastH) { renderer.setSize(w, h); camera.aspect = w / h; lastW = w; lastH = h; camera.updateProjectionMatrix(); $('warn').dataset.land = w > h ? '1' : ''; }
  if (fov !== lastFov) { camera.fov = fov; camera.updateProjectionMatrix(); lastFov = fov; }
  camera.position.set(viewer.x, eye, viewer.z);
  camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta).multiply(currentDeviceQuat());
  renderer.render(scene, camera);
  if (!$('mini').classList.contains('hide')) drawMini();
}
renderer.setAnimationLoop(frame);
addEventListener('resize', () => { if (innerWidth > innerHeight && !SIM) $('warn').textContent = 'Gira el teléfono a vertical: el campo de visión solo cuadra en vertical.'; });

// Exponer para pruebas
window.__st = {
  setSim(yaw, pitch) { simYaw = yaw; simPitch = pitch; },
  align, get theta() { return theta; }, get aligned() { return aligned; },
  forward() { const f = new THREE.Vector3(); camera.getWorldDirection(f); return [f.x, f.y, f.z]; },
  project(x, y, z) { const v = new THREE.Vector3(x, y, z).project(camera); return [v.x, v.y, v.z]; },
};
