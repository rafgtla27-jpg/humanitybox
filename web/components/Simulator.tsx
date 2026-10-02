"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { listRuns, loadRun, type RunRef } from "@/lib/data";
import { RAMPS, availableLayers, legendFor, type Layer, type RunData } from "@/lib/paint";

const Globe = dynamic(() => import("./Globe"), { ssr: false, loading: () => <div className="sim-loading" aria-hidden /> });

const FRAME_MS = 220;
const IDLE_MS = 3200;

type Menu = null | "layers" | "runs";

export default function Simulator() {
  const [runs, setRuns] = useState<RunRef[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [data, setData] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layer, setLayer] = useState<Layer>("humans");
  const [menu, setMenu] = useState<Menu>(null);
  const [awake, setAwake] = useState(true);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Chargement de la liste des runs puis du run choisi
  useEffect(() => {
    listRuns()
      .then((r) => {
        setRuns(r);
        if (r.length) setActive(r[0].key);
        else setError("Aucun run disponible.");
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    const ref = runs.find((r) => r.key === active);
    if (!ref) return;
    setData(null);
    setPlaying(false);
    loadRun(ref)
      .then((d) => {
        setData(d);
        setFrame(0);
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reduced) setPlaying(true);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [active, runs]);

  const n = data?.manifest.frames.years.length ?? 0;

  useEffect(() => {
    if (!playing || !n) return;
    const id = setInterval(() => {
      setFrame((f) => {
        if (f >= n - 1) {
          setPlaying(false);
          return f;
        }
        return f + 1;
      });
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [playing, n]);

  // L'interface s'efface quand on ne touche à rien : il ne reste que le globe
  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setAwake(false), IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => clearTimeout(idle.current);
  }, [wake]);
  const visible = awake || menu !== null || !data;

  const toggle = useCallback(() => {
    if (!n) return;
    if (frame >= n - 1) setFrame(0);
    setPlaying((p) => !p);
  }, [frame, n]);

  const onKey = (e: React.KeyboardEvent) => {
    wake();
    if (!n) return;
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") {
      setPlaying(false);
      setFrame((f) => Math.min(n - 1, f + 1));
    } else if (e.key === "ArrowLeft") {
      setPlaying(false);
      setFrame((f) => Math.max(0, f - 1));
    } else if (e.key === "Escape") setMenu(null);
  };

  const year = data?.manifest.frames.years[frame];

  return (
    <main className="sim" onPointerMove={wake} onPointerDown={wake} onKeyDown={onKey} tabIndex={-1}>
      {data && !error && <Globe data={data} frame={frame} layer={layer} space className="sim-globe" onError={setError} />}
      {!data && !error && <div className="sim-loading" aria-label="Chargement" />}
      {error && <p className="sim-error" role="alert">{error}</p>}

      <div className={`hud ${visible ? "" : "hud-hidden"}`}>
        <nav className="hud-top" aria-label="Options">
          <IconButton label="Calques" active={menu === "layers"} onClick={() => setMenu(menu === "layers" ? null : "layers")}>
            <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
          </IconButton>
          {runs.length > 1 && (
            <IconButton label="Simulations" active={menu === "runs"} onClick={() => setMenu(menu === "runs" ? null : "runs")}>
              <circle cx="8" cy="12" r="4.5" /><circle cx="16" cy="12" r="4.5" />
            </IconButton>
          )}
          <Link className="icon-btn" href="/labo" aria-label="Laboratoire : validation et journal" title="Laboratoire">
            <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.5" r="0.6" /></svg>
          </Link>

          {menu === "layers" && (
            <div className="popover" role="menu">
              {(data ? availableLayers(data) : []).map((l) => (
                <button key={l.id} role="menuitemradio" aria-checked={layer === l.id} onClick={() => { setLayer(l.id); setMenu(null); }}>
                  {l.label}
                </button>
              ))}
            </div>
          )}
          {menu === "runs" && (
            <div className="popover" role="menu">
              {runs.map((r) => (
                <button key={r.key} role="menuitemradio" aria-checked={active === r.key} onClick={() => { setActive(r.key); setMenu(null); }}>
                  <span>{r.title}</span>
                  <small>{r.detail}</small>
                </button>
              ))}
            </div>
          )}
        </nav>

        {data && year !== undefined && (
          <div className="hud-bottom">
            <button className="play-btn" onClick={toggle} aria-label={playing ? "Pause" : "Lecture"}>
              <svg viewBox="0 0 20 20" aria-hidden>
                {playing ? <><rect x="5" y="4" width="3.5" height="12" /><rect x="11.5" y="4" width="3.5" height="12" /></> : <path d="M6 4l10 6-10 6z" />}
              </svg>
            </button>
            <div className="hud-year" aria-live="off">
              {Math.round(-year / 1000)}&thinsp;000 <span>ans</span>
            </div>
            <input
              className="scrub"
              type="range"
              min={0}
              max={n - 1}
              value={frame}
              aria-label="Position dans le temps"
              onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
            />
            {layer !== "humans" && <LayerRamp data={data} layer={layer} />}
          </div>
        )}
      </div>
    </main>
  );
}

function IconButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="icon-btn" aria-label={label} title={label} aria-expanded={active} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden>{children}</svg>
    </button>
  );
}

function LayerRamp({ data, layer }: { data: RunData; layer: Exclude<Layer, "humans"> }) {
  const { min, max, unit } = legendFor(data.manifest, layer);
  const stops = RAMPS[layer].map(([p, c]) => `${c} ${p * 100}%`).join(", ");
  return (
    <div className="hud-ramp">
      <span>{min}</span>
      <i style={{ background: `linear-gradient(90deg, ${stops})` }} />
      <span>{max} {unit}</span>
    </div>
  );
}
