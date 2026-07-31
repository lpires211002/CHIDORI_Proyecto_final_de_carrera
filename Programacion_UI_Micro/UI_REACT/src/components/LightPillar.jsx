import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';

/**
 * LightPillar (React Bits) · columna de luz raymarcheada, adaptada al proyecto.
 *
 * Fondo de la pantalla de preparación. Reemplaza al campo de partículas: una
 * columna vertical de luz lee mejor como "instrumento en reposo, esperando" y
 * deja el centro de la pantalla libre para el contenido.
 *
 * Cambios respecto del original:
 *   · Colores por defecto tomados de la marca (`--signal`, indigo eléctrico)
 *     en vez del violeta/rosa del ejemplo. THREE.Color no entiende oklch, así
 *     que van como hex ya convertidos.
 *   · `paused`: congela el bucle sin desmontar el contexto WebGL. La pantalla
 *     de inicio puede quedar abierta mucho rato antes de una sesión de 4 h y no
 *     tiene sentido gastar GPU si la pestaña está en segundo plano.
 *   · Respeta `prefers-reduced-motion`: rinde un solo cuadro y se detiene.
 *   · El shader se recompila solo si cambia la calidad; el resto de los props
 *     viajan por uniform.
 *
 * Sin WebGL devuelve null: es decoración, no puede romper la pantalla ni
 * mostrar un cartel de error.
 */
const LightPillar = ({
  topColor = '#5e82f8',        // --signal
  bottomColor = '#5941c2',     // indigo más profundo, para el degradado
  intensity = 1.0,
  rotationSpeed = 0.3,
  interactive = false,
  className = '',
  glowAmount = 0.005,
  pillarWidth = 3.0,
  pillarHeight = 0.4,
  noiseIntensity = 0.5,
  mixBlendMode = 'screen',
  pillarRotation = 0,
  quality = 'high',
  paused = false,
}) => {
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const rendererRef = useRef(null);
  const materialRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const geometryRef = useRef(null);
  const mouseRef = useRef(new THREE.Vector2(0, 0));
  const timeRef = useRef(0);
  const rotationSpeedRef = useRef(rotationSpeed);
  const pausedRef = useRef(paused);
  const [webGLSupported, setWebGLSupported] = useState(true);

  useEffect(() => { rotationSpeedRef.current = rotationSpeed; }, [rotationSpeed]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) setWebGLSupported(false);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !webGLSupported) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const quieto = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    cameraRef.current = camera;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isLowEndDevice = isMobile || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    let effectiveQuality = quality;
    if (isLowEndDevice && quality === 'high') effectiveQuality = 'medium';
    if (isMobile && quality !== 'low') effectiveQuality = 'low';

    const qualitySettings = {
      low:    { iterations: 24, waveIterations: 1, pixelRatio: 0.5,  precision: 'mediump', stepMultiplier: 1.5 },
      medium: { iterations: 40, waveIterations: 2, pixelRatio: 0.65, precision: 'mediump', stepMultiplier: 1.2 },
      high:   {
        iterations: 80,
        waveIterations: 4,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        precision: 'highp',
        stepMultiplier: 1.0,
      },
    };
    const settings = qualitySettings[effectiveQuality] || qualitySettings.medium;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: effectiveQuality === 'high' ? 'high-performance' : 'low-power',
        precision: settings.precision,
        stencil: false,
        depth: false,
      });
    } catch {
      setWebGLSupported(false);
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(settings.pixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const parseColor = (hex) => {
      const color = new THREE.Color(hex);
      return new THREE.Vector3(color.r, color.g, color.b);
    };

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      precision ${settings.precision} float;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uMouse;
      uniform vec3 uTopColor;
      uniform vec3 uBottomColor;
      uniform float uIntensity;
      uniform bool uInteractive;
      uniform float uGlowAmount;
      uniform float uPillarWidth;
      uniform float uPillarHeight;
      uniform float uNoiseIntensity;
      uniform float uRotCos;
      uniform float uRotSin;
      uniform float uPillarRotCos;
      uniform float uPillarRotSin;
      uniform float uWaveSin;
      uniform float uWaveCos;
      varying vec2 vUv;

      const float STEP_MULT = ${settings.stepMultiplier.toFixed(1)};
      const int MAX_ITER = ${settings.iterations};
      const int WAVE_ITER = ${settings.waveIterations};

      void main() {
        vec2 uv = (vUv * 2.0 - 1.0) * vec2(uResolution.x / uResolution.y, 1.0);
        uv = vec2(uPillarRotCos * uv.x - uPillarRotSin * uv.y, uPillarRotSin * uv.x + uPillarRotCos * uv.y);

        vec3 ro = vec3(0.0, 0.0, -10.0);
        vec3 rd = normalize(vec3(uv, 1.0));

        float rotC = uRotCos;
        float rotS = uRotSin;
        if(uInteractive && (uMouse.x != 0.0 || uMouse.y != 0.0)) {
          float a = uMouse.x * 6.283185;
          rotC = cos(a);
          rotS = sin(a);
        }

        vec3 col = vec3(0.0);
        float t = 0.1;

        for(int i = 0; i < MAX_ITER; i++) {
          vec3 p = ro + rd * t;
          p.xz = vec2(rotC * p.x - rotS * p.z, rotS * p.x + rotC * p.z);
          vec3 q = p;
          q.y = p.y * uPillarHeight + uTime;

          float freq = 1.0;
          float amp = 1.0;
          for(int j = 0; j < WAVE_ITER; j++) {
            q.xz = vec2(uWaveCos * q.x - uWaveSin * q.z, uWaveSin * q.x + uWaveCos * q.z);
            q += cos(q.zxy * freq - uTime * float(j) * 2.0) * amp;
            freq *= 2.0;
            amp *= 0.5;
          }

          float d = length(cos(q.xz)) - 0.2;
          float bound = length(p.xz) - uPillarWidth;
          float k = 4.0;
          float h = max(k - abs(d - bound), 0.0);
          d = max(d, bound) + h * h * 0.0625 / k;
          d = abs(d) * 0.15 + 0.01;
          float grad = clamp((15.0 - p.y) / 30.0, 0.0, 1.0);
          col += mix(uBottomColor, uTopColor, grad) / d;
          t += d * STEP_MULT;
          if(t > 50.0) break;
        }

        float widthNorm = uPillarWidth / 3.0;
        col = tanh(col * uGlowAmount / widthNorm);
        col -= fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) / 15.0 * uNoiseIntensity;

        gl_FragColor = vec4(col * uIntensity, 1.0);
      }
    `;

    const pillarRotRad = (pillarRotation * Math.PI) / 180;
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime:          { value: 0 },
        uResolution:    { value: new THREE.Vector2(width, height) },
        uMouse:         { value: mouseRef.current },
        uTopColor:      { value: parseColor(topColor) },
        uBottomColor:   { value: parseColor(bottomColor) },
        uIntensity:     { value: intensity },
        uInteractive:   { value: interactive },
        uGlowAmount:    { value: glowAmount },
        uPillarWidth:   { value: pillarWidth },
        uPillarHeight:  { value: pillarHeight },
        uNoiseIntensity:{ value: noiseIntensity },
        uRotCos:        { value: 1.0 },
        uRotSin:        { value: 0.0 },
        uPillarRotCos:  { value: Math.cos(pillarRotRad) },
        uPillarRotSin:  { value: Math.sin(pillarRotRad) },
        uWaveSin:       { value: Math.sin(0.4) },
        uWaveCos:       { value: Math.cos(0.4) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    materialRef.current = material;

    const geometry = new THREE.PlaneGeometry(2, 2);
    geometryRef.current = geometry;
    scene.add(new THREE.Mesh(geometry, material));

    let mouseMoveTimeout = null;
    const handleMouseMove = (event) => {
      if (!interactive || mouseMoveTimeout) return;
      mouseMoveTimeout = window.setTimeout(() => { mouseMoveTimeout = null; }, 16);
      const rect = container.getBoundingClientRect();
      mouseRef.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    if (interactive) container.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Sin movimiento: un cuadro y listo. La imagen queda, la GPU se libera.
    if (quieto) {
      renderer.render(scene, camera);
    } else {
      let lastTime = performance.now();
      const targetFPS = effectiveQuality === 'low' ? 30 : 60;
      const frameTime = 1000 / targetFPS;

      const animate = (currentTime) => {
        if (!materialRef.current || !rendererRef.current) return;
        rafRef.current = requestAnimationFrame(animate);
        if (pausedRef.current) return;

        const deltaTime = currentTime - lastTime;
        if (deltaTime >= frameTime) {
          timeRef.current += 0.016 * rotationSpeedRef.current;
          const t = timeRef.current;
          materialRef.current.uniforms.uTime.value = t;
          materialRef.current.uniforms.uRotCos.value = Math.cos(t * 0.3);
          materialRef.current.uniforms.uRotSin.value = Math.sin(t * 0.3);
          rendererRef.current.render(sceneRef.current, cameraRef.current);
          lastTime = currentTime - (deltaTime % frameTime);
        }
      };
      rafRef.current = requestAnimationFrame(animate);
    }

    let resizeTimeout = null;
    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        if (!rendererRef.current || !materialRef.current || !containerRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        rendererRef.current.setSize(w, h);
        materialRef.current.uniforms.uResolution.value.set(w, h);
        if (quieto) rendererRef.current.render(sceneRef.current, cameraRef.current);
      }, 150);
    };
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      window.removeEventListener('resize', handleResize);
      if (interactive) container.removeEventListener('mousemove', handleMouseMove);
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current.forceContextLoss();
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
      }
      materialRef.current?.dispose();
      geometryRef.current?.dispose();
      rendererRef.current = null;
      materialRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      geometryRef.current = null;
      rafRef.current = null;
    };
    // El shader se compila con la calidad: solo se rearma si esa cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webGLSupported, quality]);

  /* Los demás props viajan por uniform, sin recompilar */
  const toVec = (hex) => {
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r, c.g, c.b);
  };
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uTopColor.value = toVec(topColor);
  }, [topColor]);
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uBottomColor.value = toVec(bottomColor);
  }, [bottomColor]);
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uIntensity.value = intensity;
  }, [intensity]);
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uInteractive.value = interactive;
  }, [interactive]);
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uGlowAmount.value = glowAmount;
  }, [glowAmount]);
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uPillarWidth.value = pillarWidth;
  }, [pillarWidth]);
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uPillarHeight.value = pillarHeight;
  }, [pillarHeight]);
  useEffect(() => {
    if (materialRef.current) materialRef.current.uniforms.uNoiseIntensity.value = noiseIntensity;
  }, [noiseIntensity]);
  useEffect(() => {
    if (!materialRef.current) return;
    const rad = (pillarRotation * Math.PI) / 180;
    materialRef.current.uniforms.uPillarRotCos.value = Math.cos(rad);
    materialRef.current.uniforms.uPillarRotSin.value = Math.sin(rad);
  }, [pillarRotation]);

  // Es decoración: sin WebGL no se muestra nada (el original pone un cartel de
  // error, que acá sería ruido en una pantalla clínica).
  if (!webGLSupported) return null;

  return <div ref={containerRef} className={`light-pillar ${className}`} style={{ mixBlendMode }} />;
};

export default LightPillar;
