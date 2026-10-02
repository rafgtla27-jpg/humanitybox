"""
WORLD_SIM — export d'un run vers un format lisible par le viewer web.

    manifest.json   métadonnées, rapport de validation, événements, séries
    frames.bin.gz   pour chaque frame, 3 couches uint8 de ny*nx octets :
                      base     bit0 = terre émergée, bit1 = glace
                      sapiens  densité log-quantifiée (0 = personne)
                      archaic  idem (zéros si absent)

Densité quantifiée : q = 1 + 254 * (log10(d) - log10(lo)) / (log10(hi) - log10(lo))
"""
from __future__ import annotations

import gzip
import json
import subprocess
from pathlib import Path

import numpy as np

from .earth import Grid, monsoon_index, sea_level

ENGINE_VERSION = "0.1.0"
LO, HI = 1e-3, 0.5  # hab/km²


def quantize(density: np.ndarray) -> np.ndarray:
    d = np.maximum(density, 0)
    with np.errstate(divide="ignore"):
        t = (np.log10(np.maximum(d, 1e-12)) - np.log10(LO)) / (np.log10(HI) - np.log10(LO))
    q = 1 + np.round(254 * np.clip(t, 0, 1))
    return np.where(d >= LO * 0.5, q, 0).astype(np.uint8)


def git_sha() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return None


def export_run(result, grid: Grid, out_dir: Path, meta: dict) -> dict:
    """Écrit manifest.json + frames.bin.gz dans out_dir et renvoie le manifest."""
    out_dir.mkdir(parents=True, exist_ok=True)
    years = sorted(result.snapshots)
    chunks = []
    for y in years:
        N, A, ice, lf = result.snapshots[y]
        area = grid.cell_area_km2 * np.maximum(lf, 1e-3)
        base = ((lf > 0.3).astype(np.uint8) | (ice.astype(np.uint8) << 1))
        chunks += [base, quantize(N / area), quantize(A / area) if A is not None else np.zeros_like(base)]
    blob = np.concatenate([c.ravel() for c in chunks]) if chunks else np.zeros(0, np.uint8)
    (out_dir / "frames.bin.gz").write_bytes(gzip.compress(blob.tobytes(), compresslevel=9))

    t = result.tracker
    curve_years = list(range(meta["start_year"], meta["end_year"] + 1, 500))
    manifest = {
        **meta,
        "engine_version": ENGINE_VERSION,
        "git_sha": git_sha(),
        "grid": {"ny": grid.ny, "nx": grid.nx, "res": grid.res, "lat_top": 90, "lon_left": -180},
        "frames": {"years": years, "layers": ["base", "sapiens", "archaic"], "encoding": "uint8-gzip",
                   "density_lo": LO, "density_hi": HI, "file": "frames.bin.gz"},
        "regions": [{**row, "target": list(row["target"]), "box": None} for row in t.report()],
        "events": [{"year": e.year, "kind": e.kind, "region": e.where, "data": {k: str(v) for k, v in e.data.items()}}
                   for e in result.log],
        "series": {"years": t.years, "total": [round(x) for x in t.total],
                   "by_region": {k: [round(x) for x in v] for k, v in t.series.items()}},
        "forcing": {"years": curve_years,
                    "sea_level": [round(sea_level(y), 1) for y in curve_years],
                    "monsoon": [round(monsoon_index(y), 3) for y in curve_years]},
    }
    from .validation import REGIONS
    boxes = {r.name: list(r.box) for r in REGIONS}
    for row in manifest["regions"]:
        row["box"] = boxes[row["region"]]
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))
    return manifest
