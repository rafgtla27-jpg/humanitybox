export type RegionRow = {
  region: string;
  model_bp: number | null;
  target: [number, number];
  verdict: string;
  note: string;
  box: [number, number, number, number];
};

export type Manifest = {
  id?: string;
  experiment_id: string;
  scenario: string;
  label: string;
  seed: number;
  climate_provider: string;
  engine_version: string;
  git_sha: string | null;
  start_year: number;
  end_year: number;
  grid: { ny: number; nx: number; res: number; lat_top: number; lon_left: number };
  frames: { years: number[]; layers: string[]; density_lo: number; density_hi: number; file: string };
  climate?: {
    file: string;
    layers: string[];
    temperature: ClimateSpec;
    precipitation: ClimateSpec;
    npp: ClimateSpec;
  } | null;
  extra?: { file: string; layers: ({ id: string; label: string } & ClimateSpec)[] } | null;
  regions: RegionRow[];
  events: { year: number; kind: string; region: string; data: Record<string, string> }[];
  series: { years: number[]; total: number[]; by_region: Record<string, number[]> };
  forcing: { years: number[]; sea_level: number[]; monsoon: number[] };
  peoples?: { id: number; name: string; color: [number, number, number] }[];
};

export type ClimateSpec = { min: number; max: number; scale: string; unit: string };

export type RunRef = { key: string; title: string; detail: string; manifestUrl: string; baseUrl: string; ensembleUrl?: string };

export type EnsembleRegion = {
  region: string;
  target: [number, number];
  arrivals: (number | null)[];
  p_reached: number;
  p_in_range: number;
  median: number | null;
};
export type Ensemble = { n_runs: number; engine_version: string; climate_provider: string; regions: EnsembleRegion[] };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const source: "supabase" | "demo" = SUPABASE_URL && ANON ? "supabase" : "demo";

async function listDemoRuns(): Promise<RunRef[]> {
  const res = await fetch("/demo/index.json");
  if (!res.ok) return [];
  const index: { dir: string; title: string; detail: string; ensemble?: string }[] = await res.json();
  return index.map((r) => ({
    key: `demo:${r.dir}`,
    title: r.title,
    detail: r.detail,
    manifestUrl: `/demo/${r.dir}/manifest.json`,
    baseUrl: `/demo/${r.dir}`,
    ensembleUrl: r.ensemble ? `/demo/${r.ensemble}` : undefined,
  }));
}

async function listSupabaseRuns(): Promise<RunRef[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/runs?select=id,scenario,label,seed,engine_version,climate_provider,created_at,storage_prefix` +
      `&has_frames=eq.true&storage_prefix=not.is.null&order=created_at.desc&limit=30`,
    { headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` } },
  );
  if (!res.ok) throw new Error(`Supabase a répondu ${res.status} en listant les runs.`);
  const rows: { id: string; scenario: string; label: string; seed: number; engine_version: string; climate_provider: string; created_at: string; storage_prefix: string }[] =
    await res.json();
  return rows.map((r) => {
    const base = `${SUPABASE_URL}/storage/v1/object/public/runs/${r.storage_prefix}`;
    const date = new Date(r.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return {
      key: r.id,
      title: `${r.scenario} — ${r.label}`,
      detail: `${r.climate_provider.startsWith("beyer") ? "climat Beyer 2020" : "climat provisoire"}, seed ${r.seed}, ${date}`,
      manifestUrl: `${base}/manifest.json`,
      baseUrl: base,
    };
  });
}

/** Runs publiés dans Supabase (s'il est configuré) PUIS runs de démonstration embarqués.
 *  Un Supabase vide ou en panne ne doit jamais laisser le globe sans rien à montrer. */
export async function listRuns(): Promise<RunRef[]> {
  const demo = await listDemoRuns().catch(() => []);
  if (source !== "supabase") return demo;
  const published = await listSupabaseRuns().catch(() => [] as RunRef[]);
  return [...demo, ...published];
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fichier introuvable (${res.status}) : ${url.split("/").pop()}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  // Certains hébergeurs décompressent déjà les .gz (Content-Encoding) : on vérifie l'en-tête gzip.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

export async function loadRun(
  ref: RunRef,
): Promise<{ manifest: Manifest; frames: Uint8Array; climate: Uint8Array | null; extra: Uint8Array | null }> {
  const res = await fetch(ref.manifestUrl);
  if (!res.ok) throw new Error(`Manifest introuvable (${res.status}).`);
  const manifest: Manifest = await res.json();
  const expected = manifest.frames.years.length * 3 * manifest.grid.ny * manifest.grid.nx;
  const optional = (file?: string) => (file ? fetchBinary(`${ref.baseUrl}/${file}`).catch(() => null) : Promise.resolve(null));
  const [frames, climate, extra] = await Promise.all([
    fetchBinary(`${ref.baseUrl}/${manifest.frames.file}`),
    optional(manifest.climate?.file),
    optional(manifest.extra?.file),
  ]);
  if (frames.length !== expected) throw new Error(`Frames corrompues : ${frames.length} octets au lieu de ${expected}.`);
  const extraExpected = (expected / 3) * (manifest.extra?.layers.length ?? 0);
  return {
    manifest,
    frames,
    climate: climate && climate.length === expected ? climate : null,
    extra: extra && extra.length === extraExpected ? extra : null,
  };
}

/** Toutes les seeds du même scénario, climat et moteur que le run affiché. */
export async function loadEnsemble(ref: RunRef, m: Manifest): Promise<Ensemble | null> {
  try {
    if (ref.ensembleUrl) {
      const res = await fetch(ref.ensembleUrl);
      return res.ok ? await res.json() : null;
    }
    if (source !== "supabase") return null;
    const h = { apikey: ANON!, Authorization: `Bearer ${ANON}` };
    const runs: { id: string }[] = await (await fetch(
      `${SUPABASE_URL}/rest/v1/runs?select=id&experiment_id=eq.${m.experiment_id}&scenario=eq.${m.scenario}` +
        `&climate_provider=eq.${encodeURIComponent(m.climate_provider)}&engine_version=eq.${m.engine_version}&limit=500`,
      { headers: h },
    )).json();
    if (runs.length < 2) return null;
    const rows: { run_id: string; region: string; model_bp: number | null }[] = await (await fetch(
      `${SUPABASE_URL}/rest/v1/region_results?select=run_id,region,model_bp&run_id=in.(${runs.map((r) => r.id).join(",")})`,
      { headers: h },
    )).json();
    const regions = m.regions.map((r) => {
      const arrivals = rows.filter((x) => x.region === r.region).map((x) => x.model_bp);
      const reached = arrivals.filter((a): a is number => a !== null).sort((a, b) => a - b);
      const inRange = reached.filter((a) => a <= r.target[0] && a >= r.target[1]).length;
      return {
        region: r.region, target: r.target, arrivals,
        p_reached: reached.length / Math.max(1, arrivals.length),
        p_in_range: inRange / Math.max(1, arrivals.length),
        median: reached.length ? reached[Math.floor(reached.length / 2)] : null,
      };
    });
    return { n_runs: runs.length, engine_version: m.engine_version, climate_provider: m.climate_provider, regions };
  } catch {
    return null;
  }
}

export const bp = (year: number) => `${Math.round(-year / 1000)} 000`.replace(/^0 000$/, "0");
