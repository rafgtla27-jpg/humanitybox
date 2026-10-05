"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listRuns, loadRun, type RunRef } from "@/lib/data";
import { useLive } from "@/lib/live/useLive";
import { AGES, PX_N, PX_NX } from "@/lib/live/settlements";
import { ERAS, TECHS } from "@/lib/live/techs";
import { RAMPS, availableLayers, legendFor, type Layer, type RunData } from "@/lib/paint";

const Globe = dynamic(() => import("./Globe"), { ssr: false, loading: () => <div className="sim-loading" aria-hidden /> });

const FRAME_MS = 220;
const IDLE_MS = 3200;

type Menu = null | "layers" | "runs" | "techs";

const LIVE: RunRef = { key: "live", title: "Monde vivant — depuis −120 000 ans", detail: "la sortie d'Afrique, puis tout le reste ; clique sur le globe pour agir", manifestUrl: "", baseUrl: "" };
const LIVE_NEO: RunRef = { key: "live-12k", title: "Monde vivant — depuis −12 000 ans", detail: "monde déjà peuplé : villages, cités et royaumes arrivent vite", manifestUrl: "", baseUrl: "" };

type PowerId = "drought" | "bless" | "plague" | "spawn" | "cold" | "boats";
const POWERS: { id: PowerId; label: string; icon: string }[] = [
  { id: "bless", label: "Bénédiction de fertilité", icon: "🌾" },
  { id: "drought", label: "Sécheresse", icon: "☀️" },
  { id: "cold", label: "Grand froid", icon: "❄️" },
  { id: "plague", label: "Épidémie", icon: "☠️" },
  { id: "spawn", label: "Faire naître un peuple", icon: "👣" },
  { id: "boats", label: "Offrir les embarcations", icon: "⛵" },
];
const SPEEDS = [{ v: 200, l: "×1" }, { v: 800, l: "×4" }, { v: 2500, l: "×12" }];

export default function Simulator() {
  const [runs, setRuns] = useState<RunRef[]>([]);
  const [active, setActive] = useState<string | null>("live-12k");
  const [power, setPower] = useState<PowerId | null>(null);
  const [layer, setLayer] = useState<Layer>("humans");
  const [selected, setSelected] = useState<number | null>(null);
  const [favorite, setFavorite] = useState<number | null>(null);
  const [place, setPlace] = useState<number | null>(null);        // village sélectionné
  const [hearts, setHearts] = useState<number[]>([]);             // villages de cœur (plusieurs)
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; key: number } | undefined>(undefined);
  const isLive = active === "live" || active === "live-12k";
  const live = useLive(isLive, active === "live-12k" ? -12_000 : -120_000);
  const world = live.world;
  const byId = useMemo(() => new Map(world.settlements.map((x, n) => [x.id, { s: x, n }])), [world]);
  const polById = useMemo(() => new Map(world.polities.map((p) => [p.id, p])), [world]);
  // Territoires de l'échelon affiché → identifiant compact par parcelle + palette
  const territory = useMemo(() => {
    if (!isLive || !world.owner.length || !["villages", "groups", "realms"].includes(layer)) return undefined;
    const key = new Map<number, number>();
    const palette = new Uint8Array(2048 * 4);
    const codeOf = (sIdx: number) => {
      const st = world.settlements[sIdx];
      if (!st) return 0;
      const id = layer === "villages" ? st.id : layer === "groups" ? st.group : st.realm;
      let c = key.get(id);
      if (c === undefined) {
        c = key.size + 1;
        key.set(id, c);
        const col = layer === "villages" ? st.color : polById.get(id)?.color ?? st.color;
        palette.set([col[0], col[1], col[2], 255], (c % 2048) * 4);
      }
      return c;
    };
    const index = new Uint16Array(PX_N);
    for (let k = 0; k < PX_N; k++) { const o = world.owner[k]; if (o) index[k] = codeOf(o - 1); }
    return { index, palette, key: `${layer}-${live.status?.year}` };
  }, [world, layer, isLive, polById, live.status?.year]);
  // Noms : royaumes (loin), échelon 2, puis villages en s'approchant ; les villages de cœur toujours
  const labels = useMemo(() => {
    if (!isLive) return undefined;
    const out: { lat: number; lon: number; text: string; weight: number; id: number; heart?: boolean }[] = [];
    for (const p of world.polities) if ((p.level === 3 && p.pop > 30000) || (p.level === 2 && p.pop > 15000)) {
      out.push({ lat: p.lat - (p.level === 3 ? 0.8 : 0.4), lon: p.lon, text: `${p.title} ${p.title.match(/^[aeiouéâ]/i) ? "d'" : "de "}${p.name}`, weight: p.level === 3 ? 3 + p.pop / 1e8 : 2 + p.pop / 1e8, id: 1e7 + p.id });
    }
    for (const st of world.settlements) if (st.alive) out.push({ lat: st.lat, lon: st.lon, text: st.name, weight: 1 + Math.min(0.49, st.pop / 40000), id: st.id, heart: hearts.includes(st.id) });
    return out;
  }, [world, hearts, isLive]);
  const [data, setData] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [awake, setAwake] = useState(true);
  const [perSprite, setPerSprite] = useState<number | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Chargement de la liste des runs puis du run choisi
  useEffect(() => {
    listRuns()
      .then((r) => {
        setRuns([LIVE_NEO, LIVE, ...r]);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    const ref = runs.find((r) => r.key === active);
    if (!ref || ref.key.startsWith("live")) return;
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
  const visible = awake || menu !== null || !(isLive ? live.data : data) || power !== null || selected !== null || place !== null;

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

  const shown = isLive ? live.data : data;
  const shownFrame = isLive ? 0 : frame;
  const year = shown?.manifest.frames.years[shownFrame];

  return (
    <main className="sim" onPointerMove={wake} onPointerDown={wake} onKeyDown={onKey} tabIndex={-1}>
      {shown && !error && (
        <Globe
          data={shown!} frame={shownFrame} layer={layer} space sprites onSpriteScale={setPerSprite} className="sim-globe" onError={setError}
          sceneKey={isLive ? active! : undefined}
          flyTo={flyTo}
          territory={territory}
          labels={labels}
          onLabel={(id) => {
            const target = id >= 1e7 ? polById.get(id - 1e7)?.capital : id;
            const st = target !== undefined ? byId.get(target)?.s : undefined;
            if (st) { setPlace(st.id); setSelected(null); setFlyTo({ lat: st.lat, lon: st.lon, key: Date.now() }); }
          }}
          onPick={isLive ? (lat, lon) => {
            if (power) { live.send({ type: "power", kind: power, lat, lon }); return; }
            // sans pouvoir choisi : un clic désigne le village dont c'est le territoire, sinon le peuple
            const y2 = Math.min(359, Math.floor((90 - lat) * 2)), x2 = ((Math.floor((lon + 180) * 2) % PX_NX) + PX_NX) % PX_NX;
            const own = world.owner[y2 * PX_NX + x2];
            if (own && world.settlements[own - 1]) { setPlace(world.settlements[own - 1].id); setSelected(null); return; }
            setPlace(null);
            const d = live.data;
            if (!d?.extra) return;
            const k = Math.min(179, Math.floor(90 - lat)) * 360 + ((Math.floor(lon + 180) % 360) + 360) % 360;
            const idx = d.extra[5 * 64800 + k];
            setSelected(idx ? d.manifest.peoples?.[idx - 1]?.id ?? null : null);
          } : undefined}
        />
      )}
      {!shown && !error && <div className="sim-loading" aria-label="Chargement" />}
      {error && <p className="sim-error" role="alert">{error}</p>}

      <div className={`hud ${visible ? "" : "hud-hidden"}`}>
        <nav className="hud-top" aria-label="Options">
          {isLive && (
            <IconButton label="Arbre des savoirs" active={menu === "techs"} onClick={() => setMenu(menu === "techs" ? null : "techs")}>
              <circle cx="12" cy="5" r="2.2" /><circle cx="6" cy="13" r="2.2" /><circle cx="18" cy="13" r="2.2" /><circle cx="12" cy="20" r="2.2" />
              <path d="M12 7v11M12 9l-5 2.5M12 9l5 2.5" />
            </IconButton>
          )}
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
              {(shown ? availableLayers(shown) : []).map((l) => (
                <button key={l.id} role="menuitemradio" aria-checked={layer === l.id} onClick={() => { setLayer(l.id); setMenu(null); }}>
                  {l.label}
                </button>
              ))}
              {layer === "humans" && perSprite && (
                <p className="popover-note">1 silhouette ≈ {perSprite.toLocaleString("fr-FR")} personnes. Zoomez pour les voir de près.</p>
              )}
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

        {isLive && menu === "techs" && (() => {
          const st = place !== null ? byId.get(place)?.s : undefined;
          const mine = new Set(st?.techs ?? []);
          const status = new Map(live.techStatus.map((t) => [t.id, t]));
          return (
            <section className="tech-tree" aria-label="Arbre des savoirs">
              <header>
                <h2>Arbre des savoirs</h2>
                <p>{st ? <>Savoirs de <b>{st.name}</b> : {mine.size} sur {TECHS.length}</> : "Clique sur un village pour voir ses savoirs. Un savoir apparaît là où ses préalables sont maîtrisés, où le milieu s'y prête et où le besoin se fait sentir ; il se transmet entre voisins et se perd dans les groupes trop isolés."}</p>
                <button className="close" aria-label="Fermer" onClick={() => setMenu(null)}>×</button>
              </header>
              <div className="eras">
                {ERAS.map((era, ei) => (
                  <div key={era} className="era">
                    <h3>{era}</h3>
                    {TECHS.filter((t) => t.era === ei).map((t) => {
                      const ts = status.get(t.id);
                      const known = (ts?.share ?? 0) > 0.001 || t.rate === 0;
                      return (
                        <div key={t.id} className={`tech ${mine.has(t.id) ? "mine" : ""} ${known ? "known" : ""}`} title={t.desc}>
                          <div className="tname">{mine.has(t.id) && "✓ "}{t.name}</div>
                          {t.pre.length > 0 && <div className="tpre">← {t.pre.map((id) => TECHS.find((x) => x.id === id)?.name).join(", ")}</div>}
                          <div className="tstat">
                            {t.id === "agri" ? "Naît du milieu et du climat stable"
                              : ts?.first ? `Inventé il y a ${Math.abs(Math.round(ts.first.year)).toLocaleString("fr-FR")} ans (${ts.first.where})${known ? "" : ", puis oublié"}`
                              : t.rate === 0 ? "Connu dès le départ" : "Pas encore inventé"}
                            {known && <> · <b>{Math.round((ts?.share ?? 0) * 100)} %</b> de l'humanité</>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          );
        })()}
        {isLive && live.status && (
          <>
            <div className="powers" role="toolbar" aria-label="Pouvoirs divins">
              {POWERS.map((p) => (
                <button key={p.id} className="power" aria-pressed={power === p.id} title={p.label} aria-label={p.label}
                  onClick={() => setPower(power === p.id ? null : p.id)}>
                  <span aria-hidden>{p.icon}</span>
                </button>
              ))}
              {power ? <p className="power-hint">{POWERS.find((p) => p.id === power)?.label} : clique sur le globe</p>
                : <p className="power-hint muted">Clique sur un village ou un nom pour le découvrir</p>}
            </div>
            <div className="hud-bottom hud-live">
              <button className="play-btn" aria-label={live.status.playing ? "Pause" : "Lecture"}
                onClick={() => live.send({ type: live.status!.playing ? "pause" : "play" })}>
                <svg viewBox="0 0 20 20" aria-hidden>
                  {live.status.playing ? <><rect x="5" y="4" width="3.5" height="12" /><rect x="11.5" y="4" width="3.5" height="12" /></> : <path d="M6 4l10 6-10 6z" />}
                </svg>
              </button>
              <div className="hud-year" aria-live="off">
                {Math.abs(Math.round(live.status.year)).toLocaleString("fr-FR")} <span>ans avant nous</span>
              </div>
              <div className="speeds" role="group" aria-label="Vitesse">
                {SPEEDS.map((sp) => (
                  <button key={sp.v} aria-pressed={live.status!.yearsPerSecond === sp.v} onClick={() => live.send({ type: "speed", value: sp.v })}>{sp.l}</button>
                ))}
              </div>
              <div className="hud-pop">{(live.status.sapiens / 1e6).toFixed(2).replace(".", ",")} M humains</div>
            </div>
            
            {hearts.length > 0 && (
              <div className="hearts">
                {hearts.map((id) => {
                  const st = byId.get(id)?.s;
                  return (
                    <button key={id} className="fav-chip" onClick={() => { if (st) { setPlace(id); setFlyTo({ lat: st.lat, lon: st.lon, key: Date.now() }); } }}>
                      <span aria-hidden>♥</span> {st ? `${st.name} · ${Math.round(st.pop).toLocaleString("fr-FR")}` : "village disparu"}
                    </button>
                  );
                })}
              </div>
            )}
            {place !== null && (() => {
              const st = byId.get(place)?.s;
              if (!st) return null;
              const grp = polById.get(st.group), realm = polById.get(st.realm);
              const ppl = live.peoples.find((q) => q.id === st.people);
              const story = live.events.filter((e) => e.settlement === st.id || (realm && e.settlement === realm.capital && e.text.includes("entre dans"))).slice(-6).reverse();
              const heart = hearts.includes(st.id);
              const of = (t: string, n: string) => `${t} ${/^[aeiouéâ]/i.test(t) ? "d'" : "de "}${n}`;
              return (
                <aside className="people-panel" aria-label={st.name}>
                  <button className="close" aria-label="Fermer" onClick={() => setPlace(null)}>×</button>
                  <h2><i style={{ background: `rgb(${st.color.join(",")})` }} />{st.name}</h2>
                  <p className="sub">{st.kind.charAt(0).toUpperCase() + st.kind.slice(1)} · {AGES[st.age]} · fondé il y a {Math.abs(Math.round(st.founded)).toLocaleString("fr-FR")} ans</p>
                  <dl>
                    <div><dt>Habitants</dt><dd>{Math.round(st.pop).toLocaleString("fr-FR")}</dd></div>
                    <div><dt>Peuple</dt><dd>{ppl?.name ?? "—"}</dd></div>
                    {grp && grp.capital !== st.id && <div><dt>Rattaché à</dt><dd>{of(grp.title, grp.name)}</dd></div>}
                    {grp && grp.capital === st.id && <div><dt>Chef-lieu</dt><dd>{of(grp.title, grp.name)}</dd></div>}
                    {realm && <div><dt>{realm.capital === st.id ? "Capitale" : "Dans"}</dt><dd>{of(realm.title, realm.name)}</dd></div>}
                    <div><dt>Savoirs</dt><dd>{(st.techs ?? []).length} / {TECHS.length}</dd></div>
                  </dl>
                  {(st.techs ?? []).length > 0 && (
                    <p className="techs-line">
                      {TECHS.filter((t) => st.techs?.includes(t.id) && t.rate > 0).sort((a, b) => b.era - a.era).slice(0, 6).map((t) => <span key={t.id}>{t.name}</span>)}
                      <button className="link" onClick={() => setMenu("techs")}>Voir l'arbre →</button>
                    </p>
                  )}
                  <div className="actions">
                    <button className={heart ? "on" : ""} onClick={() => setHearts(heart ? hearts.filter((h) => h !== st.id) : [...hearts, st.id])}>
                      ♥ {heart ? "Village de cœur" : "Prendre ce village à cœur"}
                    </button>
                    <button onClick={() => setFlyTo({ lat: st.lat, lon: st.lon, key: Date.now() })}>Aller voir</button>
                  </div>
                  {story.length > 0 && <ol className="story">{story.map((e, i) => <li key={i}><b>{Math.abs(Math.round(e.year)).toLocaleString("fr-FR")}</b> {e.text}</li>)}</ol>}
                </aside>
              );
            })()}
            {selected !== null && place === null && (() => {
              const p = live.peoples.find((q) => q.id === selected);
              if (!p) return null;
              const parent = live.events.find((e) => e.people === p.id && e.text.includes("se séparent"));
              const story = live.events.filter((e) => e.people === p.id).slice(-6).reverse();
              return (
                <aside className="people-panel" aria-label={`Peuple ${p.name}`}>
                  <button className="close" aria-label="Fermer" onClick={() => setSelected(null)}>×</button>
                  <h2><i style={{ background: `rgb(${p.color.join(",")})` }} />{p.name}</h2>
                  <p className="sub">{parent ? parent.text.replace(`Les ${p.name} se séparent des `, "Issus des ") : "Peuple fondateur"}, depuis {Math.abs(Math.round(p.born)).toLocaleString("fr-FR")} ans</p>
                  <dl>
                    <div><dt>Population</dt><dd>{Math.round(p.pop).toLocaleString("fr-FR")}</dd></div>
                    <div><dt>Territoire</dt><dd>{(p.cells * 9000).toLocaleString("fr-FR")} km²</dd></div>
                    <div><dt>Savoir-faire</dt><dd>{Math.round(p.C * 100)} %</dd></div>
                    <div><dt>Agriculture</dt><dd>{Math.round(p.agri * 100)} %</dd></div>
                    <div><dt>Navigation</dt><dd>{Math.round(p.sea * 100)} %</dd></div>
                  </dl>
                  <div className="actions">
                    <button onClick={() => setFlyTo({ lat: p.lat, lon: p.lon, key: Date.now() })}>Aller voir</button>
                  </div>
                  {story.length > 0 && <ol className="story">{story.map((e, i) => <li key={i}><b>{Math.abs(Math.round(e.year)).toLocaleString("fr-FR")}</b> {e.text}</li>)}</ol>}
                </aside>
              );
            })()}
            {live.events.length > 0 && (
              <ol className="chronicle" aria-label="Chronique">
                {live.events.slice(-5).map((e, i) => (
                  <li key={`${e.year}-${i}`} className={e.settlement !== undefined && hearts.includes(e.settlement) ? "fav" : ""}>
                    <b>{Math.abs(Math.round(e.year)).toLocaleString("fr-FR")}</b> {e.settlement !== undefined && hearts.includes(e.settlement) ? "♥ " : ""}{e.text}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
        {!isLive && data && year !== undefined && (
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
  if (layer === "peoples" || layer === "villages" || layer === "groups" || layer === "realms") return null;
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
