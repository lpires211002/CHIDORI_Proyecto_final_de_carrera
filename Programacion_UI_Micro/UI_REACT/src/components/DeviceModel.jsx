import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
// La placa exportada de KiCad (Archivo → Exportar → GLB, con cobre, máscara y
// serigrafía) y pasada por scripts/optimizar-pcb.mjs: une las mallas por
// material (de ~6600 dibujos por cuadro a 18), comprime con meshopt (5,8 MB →
// ~0,8 MB) y nombra las capas de la placa (pcb-copper, pcb-mask, pcb-silk,
// pcb-core). Va embebida en el chunk como data URL: el ejecutable de Electron
// carga por file:// y un fetch a otro archivo local no siempre está permitido.
// Este módulo se carga en diferido, solo en la pantalla de inicio.
import pcbDataUrl from '../assets/chidori-pcb.glb?inline';

/**
 * DeviceModel · la placa del Chidori en 3D, girando despacio en la pantalla
 * de inicio.
 *
 * Gira como una moneda parada (eje vertical), así se ven las dos caras: arriba
 * el buzzer, el pulsador y los conectores; abajo el frente analógico (U1, U3,
 * U4, U5). Sigue un poco al cursor.
 *
 * `linked` · con el equipo enlazado la luz sube a pleno; sin enlace la placa
 * queda en penumbra. Es el mismo dato que la fila "Dispositivo" de al lado,
 * contado con luz.
 *
 * Es decoración: sin WebGL, o si el modelo no carga, no dibuja nada.
 */

/* Materiales · el exportador de KiCad solo trae el color base, y en glTF la
 * metalicidad por omisión es 1: todo se veía como metal oscuro. Se corrige:
 *   capas de la placa (por nombre, los pone scripts/optimizar-pcb.mjs)
 *   componentes (por índice de material del exportador):
 *     metal  → pines, terminales y contactos
 *     vidrio → el cuerpo de los diodos DO-35
 *     resto  → plásticos y epoxi */
const METAL = new Set(['mat_1', 'mat_3', 'mat_5', 'mat_9']);
const GLASS = new Set(['mat_8']);

function dataUrlToArrayBuffer(url) {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function tuneMaterial(mat) {
  if (!mat || !mat.isMeshStandardMaterial) return;
  switch (mat.name) {
    case 'pcb-copper':                           // pistas y pads (oro, ENIG)
      mat.metalness = 1;
      mat.roughness = 0.3;
      mat.envMapIntensity = 1.8;
      return;
    case 'pcb-mask':                             // máscara verde, semitransparente
      // Deja ver las pistas debajo, como en la placa real. Brillante.
      // KiCad escribe el color en sRGB aunque glTF lo pide lineal: sin
      // convertir, la máscara salía verde agua.
      mat.color.convertSRGBToLinear();
      mat.metalness = 0;
      mat.roughness = 0.5;
      mat.transparent = true;
      mat.opacity = 0.9;
      mat.depthWrite = false;
      mat.envMapIntensity = 0.3;
      return;
    case 'pcb-silk':                             // serigrafía: opaca, así no pelea con la máscara
      mat.transparent = false;
      mat.opacity = 1;
      // Está casi al ras de la máscara: se la adelanta un pelo en profundidad
      // para que no parpadee (z-fighting) mientras gira.
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
      mat.metalness = 0;
      mat.roughness = 0.8;
      return;
    case 'pcb-core':                             // canto de FR4
      mat.color.setRGB(0.32, 0.26, 0.12).convertSRGBToLinear();
      mat.metalness = 0;
      mat.roughness = 0.7;
      return;
    default:
      break;
  }
  if (METAL.has(mat.name)) {
    mat.metalness = 1;
    mat.roughness = 0.32;
    mat.envMapIntensity = 2.2;                   // el metal vive del reflejo del ambiente
    return;
  }
  mat.metalness = 0;
  mat.roughness = GLASS.has(mat.name) ? 0.12 : 0.55;
  mat.envMapIntensity = 0.9;
}

export default function DeviceModel({ linked = false, className = '' }) {
  const hostRef   = useRef(null);
  const linkedRef = useRef(linked);
  const kickRef   = useRef(null);                // redibujar a demanda (movimiento reducido)
  const [ready, setReady] = useState(false);

  useEffect(() => {
    linkedRef.current = linked;
    kickRef.current?.();
  }, [linked]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return undefined;                          // sin WebGL: no hay placa, y está bien
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let disposed = false;
    let raf = null;
    let visible = true;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'device-canvas';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(26, 1, 0.005, 10);

    // Luz · clave blanca desde arriba a la izquierda, contraluz índigo (el
    // color del pilar de fondo) para recortar el borde de la placa.
    const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x1a1640, 0.7);
    const key  = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.6, 0.9, 1.0);
    const rim  = new THREE.DirectionalLight(0x7d7bff, 3.2);
    rim.position.set(0.8, 0.3, -1.0);
    scene.add(hemi, key, rim);

    // pivot · inclinación y seguimiento del cursor; spin · el giro continuo.
    const pivot = new THREE.Group();
    const spin  = new THREE.Group();
    pivot.add(spin);
    scene.add(pivot);

    let radius = 0.06;

    const fit = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Distancia para que la placa entre entera en el lado más corto
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const fitH = radius / Math.sin(vFov / 2);
      const fitW = fitH / Math.min(1, camera.aspect);
      camera.position.set(0, 0, Math.max(fitH, fitW) * 1.02);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e) => {
      pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };

    let light = linkedRef.current ? 1 : 0.5;
    let angle = 0.55;                            // arranca mostrando la cara de arriba en escorzo
    let last = performance.now();
    let t = 0;

    const draw = () => {
      renderer.render(scene, camera);
    };

    const frame = (now) => {
      raf = null;
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;

      angle += dt * 0.26;                        // una vuelta cada ~24 s
      spin.rotation.y = angle;

      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      pivot.rotation.x = -0.16 + pointer.y * 0.12;
      pivot.rotation.z = 0.06 - pointer.x * 0.05;
      pivot.position.y = Math.sin(t * 0.8) * radius * 0.025;

      const target = linkedRef.current ? 1 : 0.5;
      light += (target - light) * 0.05;
      key.intensity = 2.2 * light;
      rim.intensity = 3.2 * (0.6 + 0.4 * light);
      hemi.intensity = 0.7 * light;
      scene.environmentIntensity = 0.12 + 0.28 * light;

      draw();
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (reduced || raf || disposed || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    // Movimiento reducido: pose fija, se redibuja solo cuando algo cambia
    const kick = () => {
      if (!reduced || disposed) return;
      light = linkedRef.current ? 1 : 0.5;
      key.intensity = 2.2 * light;
      hemi.intensity = 0.7 * light;
      scene.environmentIntensity = 0.12 + 0.28 * light;
      draw();
    };
    kickRef.current = kick;

    const ro = new ResizeObserver(() => { fit(); if (reduced) draw(); });
    ro.observe(host);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    io.observe(host);

    const onVis = () => { if (!document.hidden) start(); };
    document.addEventListener('visibilitychange', onVis);
    if (!reduced) window.addEventListener('pointermove', onMove, { passive: true });

    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(
      dataUrlToArrayBuffer(pcbDataUrl),
      '',
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        const tuned = new Set();                 // un material puede repetirse entre mallas
        model.traverse((o) => {
          if (!o.isMesh) return;
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (tuned.has(m)) return;
            tuned.add(m);
            tuneMaterial(m);
          });
        });

        // Centrado: KiCad exporta en coordenadas de la hoja, no del origen
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        radius = box.getSize(new THREE.Vector3()).length() / 2;

        // Parada de canto: la cara de arriba (+Y en el GLB) mira a la cámara
        // y el borde superior del PCB queda arriba en pantalla.
        const stand = new THREE.Group();
        stand.rotation.x = Math.PI / 2;
        stand.add(model);
        spin.add(stand);
        spin.rotation.y = angle;
        pivot.rotation.x = -0.16;
        pivot.rotation.z = 0.06;

        fit();
        draw();
        setReady(true);
        if (reduced) kick(); else start();
      },
      () => { /* sin modelo no hay placa: es decoración */ },
    );

    return () => {
      disposed = true;
      kickRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      scene.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose());
      });
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className={`device-model ${ready ? 'is-ready' : ''} ${className}`} aria-hidden="true" />;
}
