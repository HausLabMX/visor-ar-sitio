# Visor AR en sitio (prototipo)

Muestra un edificio a escala 1:1 sobre el terreno real, calibrado con **marcas físicas** (2 o más estacas/conos en puntos conocidos del lote). Dos modos:

| Modo | Dispositivos | Cómo funciona |
|---|---|---|
| **Estación** (`estacion.html`) | iPhone, y cualquier móvil | Cámara + giroscopio. Te paras sobre una marca y apuntas a otra para fijar el rumbo. Solo rotación: la posición queda fija en la estación. |
| **AR con seguimiento** (`index.html`) | Android + Chrome (ARCore) | WebXR: el modelo queda anclado al terreno y puedes caminar alrededor. |

## Modo estación (iPhone) — paso a paso

1. Abre `https://tu-sitio/estacion.html?p=demo` en **Safari** (iPhone), con el teléfono **en vertical**.
2. Pulsa «Iniciar cámara y sensores». Acepta el permiso de **movimiento y orientación** y el de **cámara**.
3. Párate **sobre la marca A** (la base de la estaca bajo tus pies o junto a ella). En «Estoy en» elige A.
4. En «Apunto a» elige otra marca (ej. B). Apunta la mirilla **+** a la **base** de la marca B, con el teléfono quieto, y pulsa **Alinear ahora**.
5. Aparece el modelo y los **postes naranjas con letra** en cada marca. Gira el teléfono hacia las otras marcas: los postes deben caer sobre las estacas reales.
6. Afina: si todos los postes se corren parejo hacia un lado → botones de **Giro**. Si el error crece hacia los bordes de la pantalla → **Campo de visión**. Si el horizonte no cuadra en altura → **Altura de ojos**.
7. Para ver desde otro punto: elige otra marca en «Estoy en» (y alinea de nuevo), o «Otra posición» y toca el minimapa donde estás.
8. El giroscopio deriva con el tiempo: si se desalinea, pulsa «Alinear ahora» otra vez apuntando a la marca.

### Caminar alrededor en iPhone/iPad (Quick Look)
En `estacion.html`, sección «Caminar alrededor»: elige la marca de origen y pulsa «Ver en AR caminando». Se abre el AR nativo de Apple, que sí sigue tu movimiento. Toca el piso justo en la estaca de origen y gira el modelo con dos dedos hasta que el poste de la otra marca caiga sobre su estaca. La escala queda fija en 1:1.

Límites del modo estación: no hay seguimiento de movimiento (si caminas, el modelo no se entera; vuelve a fijar posición con el minimapa o una marca). La precisión depende de qué tan bien apuntes a la marca y de que el campo de visión esté ajustado; hay que medirla en sitio.

## Probar el modo AR (Android)

1. Sube la carpeta completa a un hosting **HTTPS** (GitHub Pages, Netlify…). WebXR no funciona en HTTP ni abriendo el archivo directo.
2. Abre `https://tu-sitio/index.html?p=demo`.
   - **Vista previa** (cualquier navegador): botón «Vista previa» → «Simular terreno» recrea un terreno con giro desconocido y ruido de ~3 cm, y muestra cómo se recupera la calibración. También puedes hacer clic en el suelo para poner marcas a mano.
   - **AR real**: Android + Chrome (ARCore). iPhone no soporta WebXR AR en Safari; si el proyecto trae `usdz` se ofrece Quick Look (sin calibración por marcas).

## Cómo calibrar en el terreno

1. Coloca **2 marcas mínimo** (ideal 3–4) en puntos de los que conozcas las coordenadas en el modelo: esquinas del lote, ejes, mojoneras. Puede ser cono, estaca con listón, o una X con pintura. Marca el **punto exacto** en el suelo.
2. En la app: «Iniciar AR». Para cada marca (A, B, C…): párate cerca, apunta el círculo naranja a la base de la marca y toca la pantalla.
3. «Aplicar». El modelo se coloca con la posición, rotación (y opcionalmente escala) resueltas.
4. **Verifica**: los postes naranjas del modelo deben caer sobre tus marcas reales. El informe da el error por marca y la diferencia de distancia medida vs modelo.
5. Afina con las flechas (relativas a la cámara), giro y altura si hace falta.

### Consejos de precisión
- **Separación**: el error angular ≈ error de toque ÷ distancia entre marcas. Con 3 cm de error y marcas a 20 m: ~0.1°, o ~5 cm en el extremo opuesto de un edificio de 30 m. Marcas muy juntas = giro impreciso.
- **Deriva**: el tracking de AR acumula ~0.5–1 % al caminar. Toma las marcas seguido, caminando directo de una a otra, sin escanear de más. Si la distancia medida difiere más de ~1 % del modelo, repite.
- **3+ marcas** → mínimos cuadrados y residuos: delatan una marca mal tomada o un modelo espejado.
- **Escala**: déjala fija en 1:1 (modelo en metros). «Ajustar escala con las marcas» solo sirve para diagnosticar deriva.
- Mide las coordenadas de las marcas con cinta/estación total, o toma las esquinas del lote del plano topográfico.

## Marcas dentro del modelo (Blender, SketchUp, Revit…)

Si el GLB trae objetos o *empties* llamados `MARCA_A`, `MARCA_B`, `MARCA_C`… el visor los lee solo al cargar el archivo (botón «Cargar mi modelo»). En Blender: Add → Empty → Plain Axes en cada punto del terreno donde pondrás una estaca, renómbralo `MARCA_A`, etc., y exporta a glTF 2.0 (.glb) con «+Y Up» activado.

## Tu propio proyecto

1. Exporta el modelo a **GLB** en **metros**, Y arriba. Optimiza (Draco/meshopt, texturas KTX2, < 20–30 MB).
2. Coordenadas del modelo para las marcas: planta vista desde arriba, **X a la derecha, Z hacia abajo**, en metros, respecto al origen del modelo.
3. Crea `projects/mi-proyecto.json`:

```json
{
  "name": "Torre Norte",
  "model": "models/torre-norte.glb",
  "usdz": "models/torre-norte.usdz",
  "controlPoints": [
    { "id": "A", "label": "esquina suroeste", "x": 0,  "z": 0 },
    { "id": "B", "label": "esquina sureste",  "x": 22.5, "z": 0 },
    { "id": "C", "label": "esquina noreste",  "x": 22.5, "z": 41 }
  ],
  "toggles": ["Planta1", "Planta2", "Azotea"]
}
```
`toggles` = nombres de nodos del GLB que se podrán prender/apagar. Abre con `?p=mi-proyecto`.

## Desde 3DVista

- **Hotspot → abrir URL** (pestaña nueva): lo más fiable en móvil.
- **QR** dentro del tour para pasar de escritorio al teléfono.
- **Web frame/iframe**: requiere `allow="camera; xr-spatial-tracking; geolocation; accelerometer; gyroscope"`; pruébalo antes de depender de esto.

## Archivos

- `calibrate.js` — solver (posición + rotación + escala desde N marcas). Prueba: `node test/test-calibrate.mjs`
- `app.js` — modo AR con WebXR (hit-test, vista previa, ajuste fino, UI)
- `estacion.html` / `estacion.js` — modo estación (cámara + giroscopio, iPhone)
- `model.js` — código común (marcas, edificio demo, carga de GLB)
- `vendor/` — three.js r160 incluido (sin depender de CDN)
