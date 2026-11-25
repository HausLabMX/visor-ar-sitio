// Prueba independiente: usa Object3D de three.js como "verdad" y comprueba que el solver la recupera.
// Uso: node test/test-calibrate.mjs
import * as THREE from '../vendor/three.module.js';
import { solveCalibration } from '../calibrate.js';

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FALLA:', msg); } };
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = (s) => s * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

const marks = [
  { id: 'A', model: { x: 0, z: 0 } },
  { id: 'B', model: { x: 20, z: 0 } },
  { id: 'C', model: { x: 20, z: 30 } },
  { id: 'D', model: { x: 0, z: 30 } },
];

function trial({ n, noise, sc = 1, fitScale = false }) {
  const truth = new THREE.Group();
  truth.rotation.y = rnd(-Math.PI, Math.PI);
  truth.position.set(rnd(-50, 50), rnd(-2, 2), rnd(-50, 50));
  truth.scale.setScalar(sc);
  truth.updateMatrixWorld(true);
  const pairs = marks.slice(0, n).map((m) => {
    const w = truth.localToWorld(new THREE.Vector3(m.model.x, 0, m.model.z));
    return { id: m.id, model: m.model, world: { x: w.x + gauss(noise), y: w.y + gauss(noise), z: w.z + gauss(noise) } };
  });
  const sol = solveCalibration(pairs, { fitScale });

  // Aplicar la solución a un grupo nuevo y comparar dónde caen puntos de prueba del modelo
  const g = new THREE.Group();
  g.rotation.y = sol.yaw; g.position.set(sol.tx, sol.ty, sol.tz); g.scale.setScalar(sol.scale);
  g.updateMatrixWorld(true);
  let worst = 0;
  for (const q of [[0, 0], [20, 30], [10, 15], [5, 25], [-8, 40]]) {
    const a = truth.localToWorld(new THREE.Vector3(q[0], 0, q[1]));
    const b = g.localToWorld(new THREE.Vector3(q[0], 0, q[1]));
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.z - b.z));
  }
  return { worst, sol };
}

// 1) Sin ruido: debe ser exacto con 2, 3 y 4 marcas
for (const n of [2, 3, 4]) for (let i = 0; i < 200; i++) {
  const { worst } = trial({ n, noise: 0 });
  ok(worst < 1e-6, `sin ruido n=${n}: error ${worst}`);
}
// 2) Con escala distinta y fitScale
for (let i = 0; i < 100; i++) {
  const { worst, sol } = trial({ n: 3, noise: 0, sc: 1.02, fitScale: true });
  ok(worst < 1e-6 && Math.abs(sol.scaleRatio - 1.02) < 1e-9, `escala: ${worst} ${sol.scaleRatio}`);
}
// 3) Con ruido de 3 cm por eje: el error en el edificio debe ser del orden de centímetros
for (const n of [2, 4]) {
  let acc = 0; const N = 500;
  for (let i = 0; i < N; i++) acc += trial({ n, noise: 0.03 }).worst;
  console.log(`ruido 3 cm, ${n} marcas (lote 20x30 m): error promedio en puntos del edificio = ${(acc / N * 100).toFixed(1)} cm`);
  ok(acc / N < 0.15, `ruido n=${n} demasiado alto`);
}
// 4) Modelo espejado: con 4 marcas los residuos deben delatarlo
{
  const mirrored = marks.map((m) => ({ id: m.id, model: m.model, world: { x: -m.model.x, y: 0, z: m.model.z } }));
  const sol = solveCalibration(mirrored);
  const maxErr = Math.max(...sol.residuals.map((r) => r.err));
  console.log(`espejo: residuo máximo = ${maxErr.toFixed(2)} m (debe ser grande)`);
  ok(maxErr > 1, 'el espejo no se detecta');
}

console.log(fail ? `\n${fail} falla(s)` : '\nTodas las pruebas pasaron');
process.exit(fail ? 1 : 0);
