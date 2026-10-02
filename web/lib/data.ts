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
  regions: RegionRow[];
  events: { year: number; kind: string; region: string; data: Record<string, string> }[];
  series: { years: number[]; total: number[]; by_region: Record<string, number[]> };
  forcing: { years: number[]; sea_level: number[]; monsoon: number[] };
};

export type RunRef = { key: string; title: string; detail: string; manifestUrl: string; baseUrl: string };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const source: "supabase" | "demo" = SUPABASE_URL && ANON ? "supabase" : "demo";

export async function listRuns(): Promise<RunRef[]> {
  if (source === "demo") {
    const index: { dir: string; title: string; detail: string }[] = await (await fetch("/demo/index.json")).json();
    return index.map((r) => ({
      key: r.dir,
      title: r.title,
      detail: r.detail,
      manifestUrl: `/demo/${r.dir}/manifest.json`,
      baseUrl: `/demo/${r.dir}`,
    }));
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/runs?select=id,scenario,label,seed,engine_version,created_at,storage_prefix` +
      `&has_frames=eq.true&storage_prefix=not.is.null&order=created_at.desc&limit=30`,
    { headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` } },
  );
  if (!res.ok) throw new Error(`Supabase a répondu ${res.status} en listant les runs.`);
  const rows: { id: string; scenario: string; label: string; seed: number; engine_version: string; created_at: string; storage_prefix: string }[] =
    await res.json();
  return rows.map((r) => {
    const base = `${SUPABASE_URL}/storage/v1/object/public/runs/${r.storage_prefix}`;
    const date = new Date(r.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return {
      key: r.id,
      title: `${r.scenario} — ${r.label}`,
      detail: `seed ${r.seed}, moteur ${r.engine_version}, ${date}`,
      manifestUrl: `${base}/manifest.json`,
      baseUrl: base,
    };
  });
}

export async function loadRun(ref: RunRef): Promise<{ manifest: Manifest; frames: Uint8Array }> {
  const manifest: Manifest = await (await fetch(ref.manifestUrl)).json();
  const res = await fetch(`${ref.baseUrl}/${manifest.frames.file}`);
  if (!res.ok) throw new Error(`Frames introuvables (${res.status}).`);
  let frames = new Uint8Array(await res.arrayBuffer());
  // Certains hébergeurs décompressent déjà les .gz (Content-Encoding) : on vérifie l'en-tête gzip.
  if (frames[0] === 0x1f && frames[1] === 0x8b) {
    const stream = new Blob([frames]).stream().pipeThrough(new DecompressionStream("gzip"));
    frames = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const expected = manifest.frames.years.length * 3 * manifest.grid.ny * manifest.grid.nx;
  if (frames.length !== expected) throw new Error(`Frames corrompues : ${frames.length} octets au lieu de ${expected}.`);
  return { manifest, frames };
}

export const bp = (year: number) => `${Math.round(-year / 1000)} 000`.replace(/^0 000$/, "0");
