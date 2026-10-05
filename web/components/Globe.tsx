"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Bands } from "@/lib/bands";
import { paintFrame, type Layer, type RunData } from "@/lib/paint";

type Props = {
  data: RunData;
  frame: number;
  layer: Layer;
  /** Fond spatial : étoiles + léger ombrage, style « vue depuis l'espace » */
  space?: boolean;
  className?: string;
  onError?: (message: string) => void;
  /** Silhouettes de groupes humains (calque Humains uniquement) */
  sprites?: boolean;
  onSpriteScale?: (peoplePerSprite: number) => void;
};

/** Champ d'étoiles fixe (générateur pseudo-aléatoire déterministe). */
function makeStars(): THREE.Points {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = 1800;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const r = 40 + rnd() * 20;
    const k = Math.sqrt(1 - u * u);
    pos.set([r * k * Math.cos(t), r * u, r * k * Math.sin(t)], i * 3);
    const b = 0.25 + 0.75 * rnd() ** 3;
    col.set([b, b, b * (0.92 + 0.08 * rnd())], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
}

// Point de vue initial : Afrique de l'Est, berceau de l'expérience
const START_LON = 35;
const START_LAT = 12;

function directionFor(lonDeg: number, latDeg: number) {
  // SphereGeometry de three.js : longitude 0 sur +X, 90°E vers −Z
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

export default function Globe({ data, frame, layer, space = false, className = "globe", onError, sprites = false, onSpriteScale }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const paintRef = useRef<{ canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; render: () => void; bands: Bands | null } | null>(null);
  const showBands = useRef(layer === "humans");
  showBands.current = layer === "humans";

  // Scène créée une fois par run
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const { nx, ny } = data.manifest.grid;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !space });
    } catch {
      onError?.("WebGL est indisponible dans ce navigateur. Activez l'accélération matérielle ou essayez un autre navigateur.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.copy(directionFor(START_LON, START_LAT).multiplyScalar(3.6));

    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.magFilter = THREE.NearestFilter;

    const material = space ? new THREE.MeshLambertMaterial({ map: texture }) : new THREE.MeshBasicMaterial({ map: texture });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 128), material);
    scene.add(globe);
    let stars: THREE.Points | null = null;
    if (space) {
      scene.background = new THREE.Color("#000000");
      stars = makeStars();
      scene.add(stars);
      // Lumière attachée à la caméra : relief sans face nocturne qui cacherait les données
      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(-2, 1.5, 3);
      camera.add(key);
      scene.add(camera);
    }

    // Liseré d'atmosphère (Fresnel), purement décoratif et discret
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.045, 96, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: { color: { value: new THREE.Color("#6fb3d9") } },
        vertexShader: `varying vec3 vNormal; varying vec3 vView;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
          vNormal = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 color; varying vec3 vNormal; varying vec3 vView;
          void main(){ float f = pow(1.0 - abs(dot(vNormal, vView)), 3.0);
          gl_FragColor = vec4(color, f * 0.55); }`,
      }),
    );
    scene.add(atmosphere);

    const bands = sprites ? new Bands(renderer.getPixelRatio()) : null;
    if (bands) {
      scene.add(bands.points);
      scene.add(bands.huts);
    }
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 1.35;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.6;

    let raf = 0;
    const render = () => renderer.render(scene, camera);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // Rotation plus lente quand on est proche de la surface
      controls.rotateSpeed = 0.15 + 0.35 * Math.min(1, (camera.position.length() - 1) / 2.5);
      controls.update();
      bands?.tick(clock.getElapsedTime(), camera.position.length(), showBands.current, animate);
      render();
    };
    loop();

    // Recadrage automatique tant que l'utilisateur n'a pas zoomé lui-même
    let userMoved = false;
    controls.addEventListener("start", () => (userMoved = true));
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      if (!userMoved && w > 0 && h > 0) {
        // Distance qui fait tenir le globe entier, avec une marge, quelle que soit la forme de l'écran
        const v = (camera.fov * Math.PI) / 180;
        const hz = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
        const d = (space ? 1.32 : 1.18) / Math.sin(Math.min(v, hz) / 2);
        camera.position.setLength(d);
        controls.maxDistance = d * 1.5;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    paintRef.current = { canvas, texture, render, bands };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      texture.dispose();
      globe.geometry.dispose();
      (globe.material as THREE.Material).dispose();
      bands?.dispose();
      atmosphere.geometry.dispose();
      if (stars) {
        stars.geometry.dispose();
        (stars.material as THREE.Material).dispose();
      }
      (atmosphere.material as THREE.Material).dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      paintRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, space, sprites]);

  // Mise à jour de la texture quand la frame ou le calque change
  useEffect(() => {
    const p = paintRef.current;
    if (!p) return;
    const { nx, ny } = data.manifest.grid;
    const ctx = p.canvas.getContext("2d")!;
    const img = ctx.createImageData(nx, ny);
    paintFrame(data, frame, layer, img.data, 0, undefined, { naturalGround: !!p.bands });
    ctx.putImageData(img, 0, 0);
    p.texture.needsUpdate = true;
    if (p.bands) onSpriteScale?.(p.bands.update(data, frame));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, frame, layer]);

  return (
    <figure className={className} ref={mountRef} role="img" aria-label="Globe : faites glisser pour tourner, molette ou pincement pour zoomer" />
  );
}
