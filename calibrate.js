// Calibración por marcas físicas en el terreno.
//
// Convención del modelo (planta vista desde arriba): X a la derecha, Z hacia abajo, Y arriba.
// Es la misma convención de three.js / glTF, y es consistente con el mundo real (mano derecha).
//
// Entrada: pares { id, model:{x,z[,y]}, world:{x,y,z} }
//   model = coordenadas de la marca en el modelo (metros)
//   world = posición medida en AR (marco local de la sesión, metros)
//
// Salida: la transformación (yaw, tx, ty, tz, scale) para aplicar al grupo ancla del modelo:
//   anchor.rotation.y = yaw; anchor.position.set(tx, ty, tz); anchor.scale.setScalar(scale)
// Con 2 marcas se resuelve rotación + posición. Con 3 o más, mínimos cuadrados (Procrustes 2D)
// y los residuos revelan marcas mal puestas, deriva del tracking o un modelo espejado.

export function solveCalibration(pairs, { fitScale = false } = {}) {
  const n = pairs.length;
  if (n < 2) throw new Error('Se necesitan al menos 2 marcas');

  // Centroides (plano XZ para posición/rotación; Y aparte)
  let pcx = 0, pcz = 0, wcx = 0, wcz = 0, wcy = 0, pcy = 0;
  for (const p of pairs) {
    pcx += p.model.x; pcz += p.model.z; pcy += p.model.y ?? 0;
    wcx += p.world.x; wcz += p.world.z; wcy += p.world.y;
  }
  pcx /= n; pcz /= n; pcy /= n; wcx /= n; wcz /= n; wcy /= n;

  // Vectores 2D estándar (x, -z) para que el ángulo coincida con rotation.y de three.js
  let sumDot = 0, sumCross = 0, sumP2 = 0;
  for (const p of pairs) {
    const px = p.model.x - pcx, py = -(p.model.z - pcz);
    const wx = p.world.x - wcx, wy = -(p.world.z - wcz);
    sumDot += px * wx + py * wy;
    sumCross += px * wy - py * wx;
    sumP2 += px * px + py * py;
  }
  if (sumP2 < 1e-9) throw new Error('Las marcas del modelo coinciden entre sí');
  const yaw = Math.atan2(sumCross, sumDot);
  const scaleRatio = Math.hypot(sumDot, sumCross) / sumP2; // medido / modelo (ideal 1.000)
  const scale = fitScale ? scaleRatio : 1;

  const c = Math.cos(yaw), s = Math.sin(yaw);
  // x' = s*(x c + z s) + tx ;  z' = s*(-x s + z c) + tz
  const tx = wcx - scale * (pcx * c + pcz * s);
  const tz = wcz - scale * (-pcx * s + pcz * c);
  const ty = wcy - scale * pcy;

  const residuals = pairs.map((p) => {
    const x = p.model.x, z = p.model.z;
    const ex = scale * (x * c + z * s) + tx - p.world.x;
    const ez = scale * (-x * s + z * c) + tz - p.world.z;
    return { id: p.id, err: Math.hypot(ex, ez) };
  });

  // Distancia entre las dos marcas más alejadas: medida vs modelo
  let best = null;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dm = Math.hypot(pairs[i].model.x - pairs[j].model.x, pairs[i].model.z - pairs[j].model.z);
    if (!best || dm > best.model) {
      best = {
        a: pairs[i].id, b: pairs[j].id, model: dm,
        measured: Math.hypot(pairs[i].world.x - pairs[j].world.x, pairs[i].world.z - pairs[j].world.z),
      };
    }
  }

  return { yaw, tx, ty, tz, scale, scaleRatio, residuals, baseline: best };
}

export const rad2deg = (r) => (r * 180) / Math.PI;
