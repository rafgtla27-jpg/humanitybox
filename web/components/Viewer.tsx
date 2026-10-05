"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bp, listRuns, loadEnsemble, loadRun, source, type Ensemble, type RunRef } from "@/lib/data";
import { RAMPS, availableLayers, legendFor, paintFrame, type Layer, type RunData } from "@/lib/paint";

const Globe = dynamic(() => import("./Globe"), {
  ssr: false,
  loading: () => <div className="globe globe-loading">Préparation du globe…</div>,
});
// Bande de latitudes affichée (les pôles n'apportent rien ici)
const LAT_TOP = 80;
const LAT_BOTTOM = -60;
const LABEL_W = 250;

type Loaded = RunData;
type View = "globe" | "map";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export default function Viewer() {
  const [runs, setRuns] = useState<RunRef[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>("globe");
  const [layer, setLayer] = useState<Layer>("humans");
  const [ensemble, setEnsemble] = useState<Ensemble | null>(null);

  useEffect(() => {
    listRuns()
      .then((r) => {
        setRuns(r);
        if (r.length) setActive(r[0].key);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    const ref = runs?.find((r) => r.key === active);
    if (!ref) return;
    setData(null);
    setPlaying(false);
    setEnsemble(null);
    loadRun(ref)
      .then((d) => {
        setData(d);
        setFrame(0);
        loadEnsemble(ref, d.manifest).then(setEnsemble);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [active, runs]);

  const nFrames = data?.manifest.frames.years.length ?? 0;

  useEffect(() => {
    if (!playing || !nFrames) return;
    const id = setInterval(() => {
      setFrame((f) => {
        if (f >= nFrames - 1) {
          setPlaying(false);
          return f;
        }
        return f + 1;
      });
    }, 170);
    return () => clearInterval(id);
  }, [playing, nFrames]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (!nFrames) return;
      if (e.key === "ArrowRight") setFrame((f) => Math.min(nFrames - 1, f + 1));
      else if (e.key === "ArrowLeft") setFrame((f) => Math.max(0, f - 1));
      else if (e.key === " ") {
        e.preventDefault();
        if (frame >= nFrames - 1) setFrame(0);
        setPlaying((p) => !p);
      } else return;
      e.preventDefault();
    },
    [nFrames, frame],
  );

  if (error)
    return (
      <main className="shell">
        <p className="error">Impossible de charger les runs : {error}</p>
      </main>
    );

  return (
    <main className="shell" onKeyDown={onKey}>
      <header className="masthead">
        <a className="wordmark" href="/">WORLD_SIM</a>
        <h1>Des humains sans technologie se dispersent-ils de façon crédible sur une Terre qui change&nbsp;?</h1>
        <p className="lede">
          Experiment #001, de 120&nbsp;000 à 10&nbsp;000 ans avant le présent. Relief réel, niveau marin reconstruit,{" "}
          {data?.manifest.climate_provider.startsWith("beyer")
            ? "climat reconstruit (Beyer et al. 2020)."
            : "climat encore provisoire."}
        </p>
        <nav className="runs" aria-label="Choisir un run">
          {runs === null && <span className="muted">Chargement des runs…</span>}
          {runs?.length === 0 && (
            <span className="muted">Aucun run publié. Lancez le workflow « simulate » depuis GitHub Actions.</span>
          )}
          {runs?.map((r) => (
            <button key={r.key} className="run" aria-pressed={r.key === active} onClick={() => setActive(r.key)}>
              <span className="run-title">{r.title}</span>
              <span className="run-detail">{r.detail}</span>
            </button>
          ))}
        </nav>
      </header>

      {data ? (
        <>
          <Controls data={data} view={view} setView={setView} layer={layer} setLayer={setLayer} />
          {view === "globe" ? <Globe data={data} frame={frame} layer={layer} onError={() => setView("map")} /> : <MapCanvas data={data} frame={frame} layer={layer} />}
          <Readout
            data={data}
            frame={frame}
            playing={playing}
            onToggle={() => {
              if (frame >= nFrames - 1) setFrame(0);
              setPlaying((p) => !p);
            }}
          />
          <Timeline data={data} frame={frame} ensemble={ensemble} onScrub={(f) => { setPlaying(false); setFrame(f); }} />
          <Events data={data} frame={frame} />
          <footer className="colophon">
            Climat : {data.manifest.climate_provider}
            {data.manifest.climate_provider.startsWith("parametric") &&
              " (provisoire, à remplacer par les reconstructions de Beyer et al. 2020)"}
            . Moteur {data.manifest.engine_version}
            {data.manifest.git_sha ? `, commit ${data.manifest.git_sha}` : ""}. Source des runs :{" "}
            {source === "supabase" ? "Supabase" : "démo embarquée"}. Clavier : ← → pour avancer, espace pour lire.
          </footer>
        </>
      ) : (
        <div className="map-placeholder">Chargement du monde…</div>
      )}
    </main>
  );
}

function MapCanvas({ data, frame, layer }: { data: Loaded; frame: number; layer: Layer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { nx } = data.manifest.grid;
  const row0 = Math.round(90 - LAT_TOP);
  const rows = Math.round(LAT_TOP - LAT_BOTTOM);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const small = document.createElement("canvas");
    small.width = nx;
    small.height = rows;
    const sctx = small.getContext("2d")!;
    const img = sctx.createImageData(nx, rows);
    paintFrame(data, frame, layer, img.data, row0, rows);
    sctx.putImageData(img, 0, 0);

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = (w * rows) / nx;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  }, [data, frame, layer, nx, row0, rows]);

  return (
    <figure className="map">
      <canvas
        ref={ref}
        style={{ aspectRatio: `${nx} / ${rows}` }}
        role="img"
        aria-label={`Carte en ${bp(data.manifest.frames.years[frame])} avant le présent`}
      />
    </figure>
  );
}

function Controls({ data, view, setView, layer, setLayer }: {
  data: Loaded; view: View; setView: (v: View) => void; layer: Layer; setLayer: (l: Layer) => void;
}) {
  const available = availableLayers(data);
  return (
    <div className="controls">
      <div className="seg" role="group" aria-label="Vue">
        <button aria-pressed={view === "globe"} onClick={() => setView("globe")}>Globe</button>
        <button aria-pressed={view === "map"} onClick={() => setView("map")}>Carte</button>
      </div>
      <div className="seg" role="group" aria-label="Calque affiché">
        {available.map((l) => (
          <button key={l.id} aria-pressed={layer === l.id} onClick={() => setLayer(l.id)}>{l.label}</button>
        ))}
      </div>
      <Legend data={data} layer={layer} />
    </div>
  );
}

function Legend({ data, layer }: { data: Loaded; layer: Layer }) {
  if (layer === "peoples") return null;
  if (layer === "humans") {
    return (
      <p className="layer-legend">
        <span className="dot dot-sapiens" /> Sapiens <span className="dot dot-archaic" /> Autres humains
        <span className="dot dot-ice" /> Glace
      </p>
    );
  }
  const { min, max, unit } = legendFor(data.manifest, layer);
  const stops = RAMPS[layer].map(([p, c]) => `${c} ${p * 100}%`).join(", ");
  return (
    <p className="layer-legend">
      <span>{min}</span>
      <span className="ramp" style={{ background: `linear-gradient(90deg, ${stops})` }} />
      <span>{max} {unit}</span>
    </p>
  );
}

function Readout({ data, frame, playing, onToggle }: { data: Loaded; frame: number; playing: boolean; onToggle: () => void }) {
  const m = data.manifest;
  const year = m.frames.years[frame];
  const { ny, nx } = m.grid;
  const plane = ny * nx;
  const off = frame * 3 * plane;
  const sea = interp(m.forcing.years, m.forcing.sea_level, year);
  const total = interp(m.series.years, m.series.total, year);
  const hasArchaic = useMemo(() => data.frames.subarray(off + 2 * plane, off + 3 * plane).some((v) => v > 0), [data, off, plane]);
  return (
    <div className="readout">
      <button className="play" onClick={onToggle} aria-label={playing ? "Mettre en pause" : "Lire la simulation"}>
        {playing ? (
          <svg viewBox="0 0 20 20" aria-hidden><rect x="4" y="3" width="4" height="14" /><rect x="12" y="3" width="4" height="14" /></svg>
        ) : (
          <svg viewBox="0 0 20 20" aria-hidden><path d="M5 3l12 7-12 7z" /></svg>
        )}
      </button>
      <div className="year">
        <span className="year-num">{bp(year)}</span>
        <span className="year-unit">ans avant le présent</span>
      </div>
      <dl className="stats">
        <div><dt>Sapiens</dt><dd className="sw-sapiens">{fmtPeople(total)}</dd></div>
        <div><dt>Niveau marin</dt><dd>{sea > 0 ? "+" : ""}{Math.round(sea)} m</dd></div>
        {hasArchaic && <div><dt>Autres humains</dt><dd className="sw-archaic">présents</dd></div>}
      </dl>
    </div>
  );
}

function Timeline({ data, frame, ensemble, onScrub }: { data: Loaded; frame: number; ensemble: Ensemble | null; onScrub: (f: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const m = data.manifest;
  const years = m.frames.years;
  const narrow = width < 640;
  const labelW = narrow ? 0 : LABEL_W;
  const trackW = width - labelW;
  const x = (year: number) => labelW + ((year - m.start_year) / (m.end_year - m.start_year)) * trackW;
  const curveH = 70;
  const rowH = narrow ? 34 : 28;
  const top = curveH + 18;
  const height = top + m.regions.length * rowH + 22;
  const cursor = x(years[frame]);

  const seaPath = m.forcing.years
    .map((y, i) => `${i ? "L" : "M"}${x(y).toFixed(1)},${(8 + ((6 - m.forcing.sea_level[i]) / 136) * (curveH - 12)).toFixed(1)}`)
    .join("");

  const scrub = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    const t = (clientX - rect.left - labelW) / trackW;
    const year = m.start_year + Math.min(1, Math.max(0, t)) * (m.end_year - m.start_year);
    let best = 0;
    years.forEach((y, i) => { if (Math.abs(y - year) < Math.abs(years[best] - year)) best = i; });
    onScrub(best);
  };

  return (
    <section className="timeline" ref={ref} aria-label="Frise : niveau marin et arrivées par région">
      <svg
        width={width}
        height={height}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); scrub(e.clientX, e.currentTarget); }}
        onPointerMove={(e) => { if (e.buttons) scrub(e.clientX, e.currentTarget); }}
      >
        {!narrow && <text x={0} y={22} className="t-label">Niveau marin</text>}
        {!narrow && <text x={0} y={38} className="t-sub">0 à −130 m</text>}
        <path d={`${seaPath}L${x(m.end_year)},${curveH}L${x(m.start_year)},${curveH}Z`} className="sea-fill" />
        <path d={seaPath} className="sea-line" />

        {[-120000, -100000, -80000, -60000, -40000].map((y) => (
          <g key={y}>
            <line x1={x(y)} x2={x(y)} y1={curveH} y2={height - 18} className="grid" />
            <text x={x(y) + 3} y={height - 4} className="t-tick">{bp(y)}</text>
          </g>
        ))}

        {m.regions.map((r, i) => {
          const y0 = top + i * rowH;
          const series = m.series.by_region[r.region] ?? [];
          const peak = Math.max(1, ...series);
          const spark = m.series.years
            .map((yr, k) => `${k ? "L" : "M"}${x(yr).toFixed(1)},${(y0 + rowH - 6 - (series[k] / peak) * (rowH - 12)).toFixed(1)}`)
            .join("");
          const reached = r.model_bp !== null;
          const ens = ensemble?.regions.find((e) => e.region === r.region);
          return (
            <g key={r.region}>
              {narrow ? (
                <text x={4} y={y0 + 10} className="t-label t-small">{r.region}</text>
              ) : (
                <text x={0} y={y0 + rowH / 2 + 4} className="t-label">{r.region}</text>
              )}
              <rect x={Math.max(labelW, x(-r.target[0]))} width={x(-r.target[1]) - Math.max(labelW, x(-r.target[0]))} y={y0 + 4} height={rowH - 8} className={`band v-${r.verdict === "OK" ? "ok" : "off"}`} />
              <path d={`${spark}L${x(m.end_year)},${y0 + rowH - 6}L${x(m.start_year)},${y0 + rowH - 6}Z`} className="spark" />
              {ens && ens.arrivals.map((a, k) => a !== null && (
                <circle key={k} cx={x(-a)} cy={y0 + rowH / 2 + (((k * 37) % 9) - 4) * 0.9} r={2.2} className="ens-dot" />
              ))}
              {ens && !narrow && (
                <text x={labelW - 8} y={y0 + rowH / 2 + 4} textAnchor="end" className={`t-prob ${ens.p_in_range >= 0.5 ? "p-ok" : ""}`}>
                  {Math.round(ens.p_in_range * 100)}&nbsp;%
                </text>
              )}
              {reached ? (
                <line x1={x(-r.model_bp!)} x2={x(-r.model_bp!)} y1={y0 + 2} y2={y0 + rowH - 2} className="arrival" />
              ) : (
                <text x={labelW + 6} y={narrow ? y0 + 26 : y0 + rowH / 2 + 4} className="t-sub">jamais atteinte</text>
              )}
            </g>
          );
        })}
        <line x1={cursor} x2={cursor} y1={0} y2={height - 18} className="cursor" />
      </svg>
      <p className="legend">
        {ensemble && (
          <>
            <span className="key key-ens" /> {ensemble.n_runs} mondes (seeds) ; % = part des mondes dans la fourchette{" "}
          </>
        )}
        <span className="key key-band" /> fourchette archéologique{" "}
        <span className="key key-arrival" /> arrivée simulée{" "}
        <span className="key key-spark" /> population de la région
      </p>
    </section>
  );
}

function Events({ data, frame }: { data: Loaded; frame: number }) {
  const year = data.manifest.frames.years[frame];
  const past = data.manifest.events.filter((e) => e.year <= year);
  if (!past.length) return null;
  return (
    <section className="events" aria-label="Journal">
      <h2>Journal du run</h2>
      <ol>
        {past.slice(-8).reverse().map((e, i) => (
          <li key={`${e.year}-${e.region}-${i}`}>
            <span className="ev-year">{bp(e.year)}</span>
            <span>
              {e.kind === "ARRIVÉE" ? "Arrivée" : "Effondrement"} : {e.region}
              <span className="muted"> ({Object.entries(e.data).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ")})</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function interp(xs: number[], ys: number[], x: number) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

function fmtPeople(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(".", ",")} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(Math.round(n));
}
