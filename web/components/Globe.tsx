"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { paintFrame, type Layer, type RunData } from "@/lib/paint";

type Props = { data: RunData; frame: number; layer: Layer };

// Point de vue initial : Afrique de l'Est, berceau de l'expérience
const START_LON = 35;
const START_LAT = 12;

function directionFor(lonDeg: number, latDeg: number) {
  // SphereGeometry de three.js : longitude 0 sur +X, 90°E vers −Z
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

export default function Globe({ data, frame, layer }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const paintRef = useRef<{ canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; render: () => void } | null>(null);

  // Scène créée une fois par run
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const { nx, ny } = data.manifest.grid;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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

    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 128), new THREE.MeshBasicMaterial({ map: texture }));
    scene.add(globe);

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
      render();
    };
    loop();

    let framed = false;
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      if (!framed && w > 0 && h > 0) {
        // Distance qui fait tenir le globe entier, avec une marge, quelle que soit la forme de l'écran
        const v = (camera.fov * Math.PI) / 180;
        const hz = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
        const d = 1.18 / Math.sin(Math.min(v, hz) / 2);
        camera.position.setLength(d);
        controls.maxDistance = d * 1.5;
        framed = true;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    paintRef.current = { canvas, texture, render };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      texture.dispose();
      globe.geometry.dispose();
      (globe.material as THREE.Material).dispose();
      atmosphere.geometry.dispose();
      (atmosphere.material as THREE.Material).dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      paintRef.current = null;
    };
  }, [data]);

  // Mise à jour de la texture quand la frame ou le calque change
  useEffect(() => {
    const p = paintRef.current;
    if (!p) return;
    const { nx, ny } = data.manifest.grid;
    const ctx = p.canvas.getContext("2d")!;
    const img = ctx.createImageData(nx, ny);
    paintFrame(data, frame, layer, img.data);
    ctx.putImageData(img, 0, 0);
    p.texture.needsUpdate = true;
  }, [data, frame, layer]);

  return (
    <figure className="globe" ref={mountRef} role="img" aria-label="Globe : faites glisser pour tourner, molette ou pincement pour zoomer" />
  );
}
