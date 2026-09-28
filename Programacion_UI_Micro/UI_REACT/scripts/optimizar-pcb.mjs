/**
 * Prepara el modelo 3D de la placa para la pantalla de inicio.
 *
 *   node scripts/optimizar-pcb.mjs "../../PCB PFC/PCB PFC.glb" src/assets/chidori-pcb.glb
 *
 * Qué hace con el GLB que exporta KiCad (Archivo → Exportar → GLB, con cobre,
 * máscara y serigrafía tildados):
 *   1. Nombra los materiales de la placa por capa (pcb-copper, pcb-mask,
 *      pcb-silk, pcb-core). DeviceModel.jsx los ajusta por ese nombre.
 *   2. Une las mallas por material: de miles de dibujos por cuadro a ~18.
 *   3. Suelda vértices, cuantiza y comprime con meshopt (5,8 MB → ~0,8 MB).
 *
 * No es una dependencia de la app: para correrlo, instalar una vez
 *   npm i -D @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, prune, reorder, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) {
  console.error('Uso: node scripts/optimizar-pcb.mjs <entrada.glb> <salida.glb>');
  process.exit(1);
}

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(IN);
const root = doc.getRoot();

// KiCad nombra las mallas de la placa "<proyecto>_copper", "_silkscreen", etc.
const ROLES = { _copper: 'pcb-copper', _silkscreen: 'pcb-silk', _soldermask: 'pcb-mask', _PCB: 'pcb-core' };
for (const mesh of root.listMeshes()) {
  const name = mesh.getName() || '';
  for (const [suffix, role] of Object.entries(ROLES)) {
    if (name.endsWith(suffix)) mesh.listPrimitives().forEach((p) => p.getMaterial()?.setName(role));
  }
}

await doc.transform(
  dedup(),
  flatten(),
  join({ keepNamed: false }),
  weld(),
  prune(),
  reorder({ encoder: MeshoptEncoder }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(OUT, doc);
console.log('Listo:', OUT, '·', root.listMaterials().map((m) => m.getName()).join(', '));
