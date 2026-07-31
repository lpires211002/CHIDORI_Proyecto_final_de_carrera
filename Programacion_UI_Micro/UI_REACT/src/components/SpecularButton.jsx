import React, { useRef, useEffect, useState } from 'react';
import { Renderer, Program, Mesh, Triangle, Color } from 'ogl';

/**
 * SpecularButton (React Bits) · botón con reflejo especular en el borde,
 * adaptado al proyecto.
 *
 * Un shader dibuja una línea de luz sobre el contorno redondeado del botón,
 * calculado con una SDF, y la orienta hacia el cursor. Se usa en el botón que
 * arranca la medición: es la acción principal de la pantalla de inicio y así
 * responde antes de que la toques.
 *
 * Cambios respecto del original:
 *   · Se le puede pasar `className`, así conserva el estilo de botón del
 *     proyecto (relleno, tipografía, alto) en vez de traer el suyo. El
 *     componente aporta solo el canvas del reflejo.
 *   · Sin WebGL renderiza un botón normal. Es la acción principal de la
 *     pantalla: no puede depender de que el shader compile.
 *   · El bucle rAF se duerme cuando el reflejo está apagado y quieto, y
 *     despierta con el puntero. El original deja un requestAnimationFrame
 *     corriendo para siempre, y esta pantalla puede quedar abierta mucho rato
 *     antes de una sesión de 4 h.
 *   · Respeta `prefers-reduced-motion`: sin animación no monta el canvas.
 */

const PAD = 20;   // el canvas se pasa del botón para que el brillo desborde

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uRadius;
uniform float uAngle;
uniform float uPx;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform float uShineSize;
uniform float uShineFade;
uniform float uThickness;
uniform float uBaseWidth;
out vec4 fragColor;

float sdRoundedRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float shapeSDF(vec2 p) { return sdRoundedRect(p, uHalfSize, uRadius); }

float gaussianLine(float d, float sigma) {
  float x = d / (sigma + 1e-6);
  float k = mix(1.0, 1.6, smoothstep(0.0, 1.5, x));
  return exp(-k * x * x);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = shapeSDF(p);
  vec2 L = vec2(cos(uAngle), sin(uAngle));

  // Trazo base oscuro pegado al borde · da sensación de espesor
  float base = (1.0 - smoothstep(0.0, uBaseWidth, abs(d))) * 0.45;

  // Especular simétrico: los bordes que miran hacia la luz y en contra
  // reciben su reflejo. La ventana angular se mide con una normal elíptica,
  // para que varíe de forma continua a lo largo de los lados rectos.
  vec2 nEll = normalize(p / (uHalfSize * uHalfSize) + 1e-6);
  float phi = acos(clamp(abs(dot(nEll, L)), 0.0, 1.0));
  float rim = 1.0 - smoothstep(uShineSize - uShineFade, uShineSize + uShineFade + 1e-4, phi);

  float line = gaussianLine(d, uThickness);
  float edgeClamp = 1.0 - smoothstep(0.5 * uPx, 3.0 * uPx, abs(d));
  float hi = line * rim * edgeClamp * uIntensity;

  vec3 col = uBaseColor * base + uLineColor * hi;
  float a = clamp(base + hi, 0.0, 1.0);
  fragColor = vec4(col, a);
}
`;

export default function SpecularButton({
  children,
  radius = 10,
  lineColor = '#ffffff',
  baseColor = '#525252',
  intensity = 1,
  shineSize = 10,
  shineFade = 40,
  thickness = 1,
  speed = 0.35,
  followMouse = true,
  proximity = 250,
  autoAnimate = false,
  disabled = false,
  onClick,
  className = '',
  type = 'button',
  ...rest
}) {
  const btnRef = useRef(null);
  const fxRef  = useRef(null);
  const propsRef = useRef({});
  const [conShader, setConShader] = useState(true);

  propsRef.current = {
    radius, lineColor, baseColor, intensity,
    shineSize, shineFade, thickness, speed,
    followMouse, proximity, autoAnimate,
  };

  useEffect(() => {
    const btn = btnRef.current;
    const fx  = fxRef.current;
    if (!btn || !fx) return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setConShader(false);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    let renderer;
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true, dpr });
    } catch {
      setConShader(false);
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) delete geometry.attributes.uv;

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uCenter:    { value: [0, 0] },
        uHalfSize:  { value: [1, 1] },
        uRadius:    { value: 0 },
        uAngle:     { value: 2.4 },
        uPx:        { value: dpr },
        uLineColor: { value: [1, 1, 1] },
        uBaseColor: { value: [0.32, 0.32, 0.32] },
        uIntensity: { value: 1 },
        uShineSize: { value: 0.17 },
        uShineFade: { value: 0.7 },
        uThickness: { value: 1 },
        uBaseWidth: { value: dpr },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });
    fx.appendChild(gl.canvas);

    const sizeRef = { w: 1, h: 1 };
    const resize = () => {
      // Medidas fraccionarias + centro explícito mantienen la SDF pegada al
      // borde CSS exacto; con offsetWidth se corre hasta un píxel.
      const rect = btn.getBoundingClientRect();
      sizeRef.w = rect.width;
      sizeRef.h = rect.height;
      renderer.setSize(rect.width + PAD * 2, rect.height + PAD * 2);
      program.uniforms.uCenter.value   = [(PAD + rect.width / 2) * dpr, (PAD + rect.height / 2) * dpr];
      program.uniforms.uHalfSize.value = [(rect.width / 2) * dpr, (rect.height / 2) * dpr];
      despertar();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(btn);

    /* ── Estado del reflejo ──────────────────────────────────────────── */
    let pointerAngle = null;
    let proximityT = 0;
    let angle = 2.4;
    let idleAngle = 2.4;
    let bright = 0;
    let last = performance.now();
    let raf = null;

    const lineC = new Color();
    const baseC = new Color();

    const despertar = () => {
      if (raf != null) return;
      last = performance.now();
      raf = requestAnimationFrame(update);
    };

    const onPointerMove = (e) => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
      const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
      const dist = Math.hypot(dx, dy);

      // Sobre el botón la luz se apoya en la diagonal (encuadra las esquinas)
      // y oscila apenas con la posición del cursor dentro del botón.
      if (dist === 0) {
        const nx = (e.clientX - cx) / (rect.width / 2);
        const ny = (cy - e.clientY) / (rect.height / 2);
        pointerAngle = Math.atan2(2 / rect.height, -2 / rect.width) + nx * 0.3 + ny * 0.15;
      } else {
        pointerAngle = Math.atan2(cy - e.clientY, e.clientX - cx);
      }

      const t = Math.max(0, 1 - dist / Math.max(propsRef.current.proximity, 1));
      proximityT = t * t * (3 - 2 * t);
      if (proximityT > 0 || bright > 0.001) despertar();
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const update = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const p = propsRef.current;

      idleAngle += p.speed * dt;
      const steer = p.followMouse && pointerAngle != null && (!p.autoAnimate || proximityT > 0);
      const target = steer ? pointerAngle : idleAngle;
      const diff = ((target - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      angle += diff * (1 - Math.exp(-dt * 7));

      const brightTarget = p.autoAnimate ? 1 : proximityT;
      bright += (brightTarget - bright) * (1 - Math.exp(-dt * 8));

      lineC.set(p.lineColor);
      baseC.set(p.baseColor);
      program.uniforms.uAngle.value     = angle;
      program.uniforms.uRadius.value    = Math.min(p.radius, Math.min(sizeRef.w, sizeRef.h) / 2) * dpr;
      program.uniforms.uLineColor.value = [lineC.r, lineC.g, lineC.b];
      program.uniforms.uBaseColor.value = [baseC.r, baseC.g, baseC.b];
      program.uniforms.uIntensity.value = p.intensity * bright;
      program.uniforms.uShineSize.value = (p.shineSize * Math.PI) / 180;
      program.uniforms.uShineFade.value = (p.shineFade * Math.PI) / 180;
      program.uniforms.uThickness.value = p.thickness * dpr;
      renderer.render({ scene: mesh });

      // Apagado y quieto: se suelta el bucle hasta que se mueva el puntero.
      // Con autoAnimate el barrido nunca para, así que sigue.
      const dormido = !p.autoAnimate && bright < 0.002 && Math.abs(diff) < 0.001;
      raf = dormido ? null : requestAnimationFrame(update);
    };
    resize();

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      if (gl.canvas.parentNode === fx) fx.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <button
      ref={btnRef}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`specular-button ${className}`}
      {...rest}
    >
      {conShader && <span ref={fxRef} className="specular-button__fx" aria-hidden="true" />}
      <span className="specular-button__label">{children}</span>
    </button>
  );
}
