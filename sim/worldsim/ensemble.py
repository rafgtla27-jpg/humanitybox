"""
WORLD_SIM — Ensembles : on ne juge jamais un monde, on juge une distribution de mondes.

Lit les manifests d'un même scénario (seeds différentes) et produit, par région :
  - la liste des dates d'arrivée (None = jamais atteinte),
  - P(atteinte), P(dans la fourchette archéologique),
  - médiane et intervalle 10–90 %.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np


def load_manifests(root: Path) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(root.glob("**/manifest.json"))]


def summarize(manifests: list[dict]) -> list[dict]:
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for m in manifests:
        groups[(m["experiment_id"], m["scenario"], m["climate_provider"], m["engine_version"])].append(m)
    out = []
    for (exp, scen, climate, engine), ms in sorted(groups.items()):
        regions = []
        for k, row in enumerate(ms[0]["regions"]):
            arrivals = [m["regions"][k]["model_bp"] for m in ms]
            reached = [a for a in arrivals if a is not None]
            lo, hi = row["target"][1], row["target"][0]
            q = np.percentile(reached, [10, 50, 90]).tolist() if reached else [None, None, None]
            regions.append({
                "region": row["region"], "target": row["target"], "arrivals": arrivals,
                "p_reached": round(len(reached) / len(arrivals), 3),
                "p_in_range": round(sum(1 for a in reached if lo <= a <= hi) / len(arrivals), 3),
                "p10": q[0], "median": q[1], "p90": q[2],
            })
        out.append({"experiment_id": exp, "scenario": scen, "label": ms[0]["label"], "climate_provider": climate,
                    "engine_version": engine, "n_runs": len(ms), "seeds": sorted(m["seed"] for m in ms),
                    "regions": regions})
    return out


def score(summary: dict, regions: list[str] | None = None) -> float:
    """Score de validation : moyenne de P(dans la fourchette) sur les régions choisies (0..1)."""
    rows = [r for r in summary["regions"] if regions is None or r["region"] in regions]
    return float(np.mean([r["p_in_range"] for r in rows])) if rows else 0.0
