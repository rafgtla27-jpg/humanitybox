"use client";
/** Branche le moteur en direct (Web Worker) sur l'interface : renvoie un RunData qui se met à jour. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Manifest } from "../data";
import type { RunData } from "../paint";

export type LiveStatus = { year: number; sapiens: number; archaic: number; playing: boolean; yearsPerSecond: number };

const EXTRA = [
  { id: "rivers", label: "Rivières", min: 10, max: 1e5, scale: "log10", unit: "m³/s" },
  { id: "cold", label: "Adaptation au froid", min: 0, max: 1, scale: "linear", unit: "" },
  { id: "complexity", label: "Complexité culturelle", min: 0, max: 1, scale: "linear", unit: "" },
  { id: "sea", label: "Savoir maritime", min: 0, max: 1, scale: "linear", unit: "" },
  { id: "agri", label: "Agriculture", min: 0, max: 1, scale: "linear", unit: "" },
  { id: "people", label: "Peuples", min: 0, max: 255, scale: "index", unit: "" },
  { id: "age", label: "Âge", min: 0, max: 4, scale: "index", unit: "" },
  { id: "tech", label: "Niveau technique", min: 0, max: 1, scale: "linear", unit: "" },
];

import type { People } from "./engine";
import type { Polity, Settlement } from "./settlements";
export type { People, Polity, Settlement };

function manifest(year: number, sea: number, peoples: People[], settlements: Settlement[]): Manifest {
  return {
    experiment_id: "live", scenario: "live", label: "Monde vivant", seed: 0, climate_provider: "beyer2020-v1.2.2",
    engine_version: "live-0.7.0", git_sha: null, start_year: -120000, end_year: 0,
    grid: { ny: 180, nx: 360, res: 1, lat_top: 90, lon_left: -180 },
    frames: { years: [year], layers: ["base", "sapiens", "archaic"], density_lo: 1e-3, density_hi: 0.5, file: "" },
    climate: {
      file: "", layers: ["temperature", "precipitation", "npp"],
      temperature: { min: -40, max: 35, scale: "linear", unit: "°C" },
      precipitation: { min: 10, max: 4000, scale: "log10", unit: "mm/an" },
      npp: { min: 0, max: 3000, scale: "sqrt", unit: "g/m²/an" },
    },
    extra: { file: "", layers: EXTRA },
    regions: [], events: [], series: { years: [], total: [], by_region: {} },
    forcing: { years: [year], sea_level: [sea], monsoon: [0] },
    peoples,
    settlements: settlements.filter((x) => x.alive).map((x) => ({ lat: x.lat, lon: x.lon, pop: x.pop, age: x.age, color: x.color, id: x.id })),
  } as Manifest;
}

export function useLive(enabled: boolean, startYear = -120_000) {
  const worker = useRef<Worker | null>(null);
  const lastSettlements = useRef<Settlement[]>([]);
  const [data, setData] = useState<RunData | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [events, setEvents] = useState<{ year: number; text: string; people?: number; settlement?: number }[]>([]);
  const [peoples, setPeoples] = useState<People[]>([]);
  const [world, setWorld] = useState<{ owner: Uint16Array; settlements: (Settlement & { techs?: string[] })[]; polities: Polity[] }>({ owner: new Uint16Array(0), settlements: [], polities: [] });
  const [techStatus, setTechStatus] = useState<{ id: string; first: { year: number; where: string } | null; share: number }[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const w = new Worker(new URL("./worker.ts", import.meta.url));
    worker.current = w;
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type !== "snapshot") return;
      if (m.world) { lastSettlements.current = m.world.settlements; setWorld({ owner: m.world.owner, settlements: m.world.settlements, polities: m.world.polities }); }
      setData({ manifest: manifest(m.year, m.sea, m.peoples, lastSettlements.current), frames: m.frames, climate: m.climate, extra: m.extra });
      setPeoples(m.peoples);
      if (m.techStatus) setTechStatus(m.techStatus);
      setStatus({ year: m.year, sapiens: m.totals.sapiens, archaic: m.totals.archaic, playing: m.playing, yearsPerSecond: m.yearsPerSecond });
      if (m.events.length) setEvents((e) => [...e, ...m.events].slice(-300));
    };
    w.postMessage({ type: "init", startYear });
    return () => { w.terminate(); worker.current = null; };
  }, [enabled, startYear]);
  const send = useCallback((msg: object) => worker.current?.postMessage(msg), []);
  return { data, status, events, peoples, world, techStatus, send };
}
