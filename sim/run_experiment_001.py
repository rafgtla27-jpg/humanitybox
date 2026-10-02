"""
WORLD_SIM — Experiment #001 : dispersion d'Homo sapiens, 120 000 → 10 000 BP

    python run_experiment_001.py --scenario A --seeds 1,2,3            # local
    python run_experiment_001.py --scenario B --seeds 1 --gif          # + GIF
    python run_experiment_001.py --scenario B --climate beyer          # paléoclimat réel (fetch_data.py --beyer)
    python run_experiment_001.py --scenario B --seeds 1,2,3 --publish  # + Supabase (CI)
    python run_experiment_001.py --chart                               # graphique depuis outputs/

Seul le premier seed exporte les frames (les autres : rapport + événements).
"""
import argparse
import dataclasses
import json
import time
from pathlib import Path

from worldsim.earth import Grid, ParametricPaleoEarth
from worldsim.experiment import run
from worldsim.export import export_run
from worldsim.humans import HumanParams

EXPERIMENT = "exp-001-dispersal"
OUT = Path("outputs")
SCENARIOS = {
    "A": ("Monde vide", dict(archaics=False)),
    "B": ("Eurasie habitée (α 0.9 / 1.1)", dict(archaics=True, alpha_sa=0.9, alpha_as=1.1)),
    "C": ("Eurasie habitée, avantage culturel émergent", dict(archaics=True, complexity=True)),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", choices=SCENARIOS, default="A")
    ap.add_argument("--seeds", default="1")
    ap.add_argument("--gif", action="store_true")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--chart", action="store_true")
    ap.add_argument("--climate", choices=["parametric", "beyer"], default="parametric")
    ap.add_argument("--no-frames", action="store_true", help="aucune frame (seeds d'ensemble au-delà de la première)")
    ap.add_argument("--summary", action="store_true", help="résume tous les runs de outputs/ en distributions")
    ap.add_argument("--set", action="append", default=[], metavar="CLÉ=VALEUR",
                    help="surcharge un paramètre (ex. cold_ncrit=500, advantage=0.05) — calibration")
    ap.add_argument("--variant", default="", help="nom de la variante (calibration), stocké dans le manifest")
    a = ap.parse_args()

    if a.summary:
        return summary()
    if a.chart:
        return chart()

    grid = Grid(1.0)
    if a.climate == "beyer":
        from worldsim.beyer import BeyerPaleoEarth
        earth = BeyerPaleoEarth(grid)
    else:
        earth = ParametricPaleoEarth(grid)
    label, kw = SCENARIOS[a.scenario]
    kw = dict(kw)
    overrides = {}
    for item in a.set:
        key, _, value = item.partition("=")
        overrides[key.strip()] = float(value)
    archaic_C = overrides.pop("archaic_C", None)
    if archaic_C is not None:
        kw["archaic_C"] = archaic_C
    adv = overrides.pop("advantage", None)
    if adv is not None:
        # Avantage compétitif de sapiens, symétrique : α_sa = 1 − a, α_as = 1 + a
        kw.update(archaics=True, alpha_sa=1 - adv, alpha_as=1 + adv)
        label = f"Eurasie habitée (a = {adv:g})"
    params = HumanParams(**{k: (int(v) if k == "net_radius" else v) for k, v in overrides.items()})
    seeds = [int(s) for s in a.seeds.split(",")]
    for i, seed in enumerate(seeds):
        t = time.time()
        r = run(seed=seed, grid=grid, earth=earth, snapshot_every=2000 if i == 0 and not a.no_frames else None, params=params, **kw)
        print(f"[{a.scenario}] {label} seed={seed}  {time.time() - t:.0f}s")
        out = OUT / (f"{a.scenario}_{a.climate}_{a.variant}_seed{seed}" if a.variant else f"{a.scenario}_{a.climate}_seed{seed}")
        meta = {
            "experiment_id": EXPERIMENT, "scenario": a.scenario, "label": label, "seed": seed,
            "params": {**dataclasses.asdict(params), **kw}, "climate_provider": earth.name,
            "variant": a.variant,
            "start_year": -120_000, "end_year": -10_000,
        }
        manifest = export_run(r, grid, out, meta)
        if a.gif and i == 0:
            from worldsim.render import make_gif
            make_gif(grid, r.snapshots, str(OUT / f"experiment_001_{a.scenario}_{a.climate}.gif"), f"WORLD_SIM #001 · {label} · {earth.name}")
        for row in manifest["regions"]:
            print(f"    {row['region'][:34]:<36} {str(row['model_bp']):>8}  {row['verdict']}")
        if a.publish:
            from worldsim.publish import SupabaseError, configured, publish_run
            if not configured():
                print("  publication ignorée : secrets SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absents")
            else:
                try:
                    print("  publié :", publish_run(out, manifest))
                except SupabaseError as e:
                    print("  ÉCHEC de publication (résultats conservés dans outputs/) :", e)


def summary():
    from worldsim.ensemble import load_manifests, summarize
    sums = summarize(load_manifests(OUT))
    for sm in sums:
        name = f"ensemble_{sm['scenario']}_{sm['climate_provider']}_{sm['engine_version']}{'_' + sm['variant'] if sm['variant'] else ''}.json"
        (OUT / name).write_text(json.dumps(sm, ensure_ascii=False, indent=1))
        print(f"\n{sm['scenario']} · {sm['label']} · {sm['climate_provider']} · moteur {sm['engine_version']} · {sm['n_runs']} runs")
        for r in sm["regions"]:
            med = "jamais" if r["median"] is None else f"{r['median'] / 1000:.1f}k [{r['p10'] / 1000:.1f}–{r['p90'] / 1000:.1f}]"
            print(f"  {r['region'][:34]:<36} atteinte {r['p_reached']:>5.0%}  dans la fourchette {r['p_in_range']:>5.0%}  {med}")
        print("  ->", OUT / name)


def chart():
    from worldsim.render import validation_chart
    results = {}
    for m in sorted(OUT.glob("*_seed*/manifest.json")):
        d = json.loads(m.read_text())
        results.setdefault(f"{d['scenario']} · {d['label']} · {d['climate_provider']}", []).append(
            [{**r, "target": tuple(r["target"])} for r in d["regions"]])
    validation_chart(results, str(OUT / "experiment_001_validation.png"))
    print("->", OUT / "experiment_001_validation.png")


if __name__ == "__main__":
    main()
