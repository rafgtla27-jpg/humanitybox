"""
WORLD_SIM — export d'un run vers un format lisible par le viewer web.

    manifest.json   métadonnées, rapport de validation, événements, séries
    frames.bin.gz   pour chaque frame, 3 couches uint8 de ny*nx octets :
                      base     bit0 = terre émergée, bit1 = glace
                      sapiens  densité log-quantifiée (0 = personne)
                      archaic  idem (zéros si absent)
    layers.bin.gz   pour chaque frame, une couche uint8 par calque listé dans manifest.extra :
                      rivers  débit log10 entre Q_RANGE (0 = pas de cours d'eau notable)
                      cold    adaptation culturelle au froid 0..1 (0 = inhabité)
    climate.bin.gz  pour chaque frame, 3 couches uint8 (0 = pas de donnée / mer) :
                      temperature    linéaire entre T_RANGE
                      precipitation  log10 entre P_RANGE
                      npp            racine carrée entre 0 et NPP_MAX

Densité quantifiée : q = 1 + 254 * (log10(d) - log10(lo)) / (log10(hi) - log10(lo))
"""
from __future__ import annotations

import gzip
import json
import subprocess
from pathlib import Path

import numpy as np

from .earth import Grid, monsoon_index, sea_level

ENGINE_VERSION = "0.4.0"
LO, HI = 1e-3, 0.5  # hab/km²
T_RANGE = (-40.0, 35.0)    # °C
P_RANGE = (10.0, 4000.0)   # mm/an
NPP_MAX = 3000.0           # g matière sèche / m² / an
Q_RANGE = (10.0, 1e5)      # m³/s
EXTRA_SPECS = {
    "rivers": {"label": "Rivières", "min": Q_RANGE[0], "max": Q_RANGE[1], "scale": "log10", "unit": "m³/s"},
    "cold": {"label": "Adaptation au froid", "min": 0, "max": 1, "scale": "linear", "unit": ""},
    "complexity": {"label": "Complexité culturelle", "min": 0, "max": 1, "scale": "linear", "unit": ""},
}


def encode_extra(name: str, a: np.ndarray, land: np.ndarray) -> np.ndarray:
    if name == "rivers":
        t = (np.log10(np.maximum(a, 1e-9)) - np.log10(Q_RANGE[0])) / (np.log10(Q_RANGE[1]) - np.log10(Q_RANGE[0]))
        return _q(t, land & (a >= Q_RANGE[0]))
    if name in ("cold", "complexity"):
        return _q(a, land & np.isfinite(a))
    raise KeyError(name)


def quantize(density: np.ndarray) -> np.ndarray:
    d = np.maximum(density, 0)
    with np.errstate(divide="ignore"):
        t = (np.log10(np.maximum(d, 1e-12)) - np.log10(LO)) / (np.log10(HI) - np.log10(LO))
    q = 1 + np.round(254 * np.clip(t, 0, 1))
    return np.where(d >= LO * 0.5, q, 0).astype(np.uint8)


def _q(x: np.ndarray, mask: np.ndarray) -> np.ndarray:
    q = 1 + np.round(254 * np.clip(np.nan_to_num(x), 0, 1))
    return np.where(mask, q, 0).astype(np.uint8)


def encode_climate(t, p, npp, land) -> list[np.ndarray]:
    return [
        _q((t - T_RANGE[0]) / (T_RANGE[1] - T_RANGE[0]), land),
        _q((np.log10(np.maximum(p, P_RANGE[0])) - np.log10(P_RANGE[0])) / (np.log10(P_RANGE[1]) - np.log10(P_RANGE[0])), land),
        _q(np.sqrt(np.maximum(npp, 0) / NPP_MAX), land),
    ]


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

    has_climate = bool(getattr(result, "climate", None)) and all(y in result.climate for y in years)
    if has_climate:
        cl = []
        for y in years:
            t, p, npp = result.climate[y]
            land = result.snapshots[y][3] > 0.3
            cl += encode_climate(t, p, npp, land)
        cblob = np.concatenate([c.ravel() for c in cl])
        (out_dir / "climate.bin.gz").write_bytes(gzip.compress(cblob.tobytes(), compresslevel=9))

    extra_names = []
    ex = getattr(result, "extra", None) or {}
    if ex and all(y in ex for y in years):
        extra_names = [k for k in EXTRA_SPECS if all(k in ex[y] for y in years)]
    if extra_names:
        el = []
        for y in years:
            land = result.snapshots[y][3] > 0.3
            el += [encode_extra(k, ex[y][k], land) for k in extra_names]
        eblob = np.concatenate([c.ravel() for c in el])
        (out_dir / "layers.bin.gz").write_bytes(gzip.compress(eblob.tobytes(), compresslevel=9))

    t = result.tracker
    curve_years = list(range(meta["start_year"], meta["end_year"] + 1, 500))
    manifest = {
        **meta,
        "engine_version": ENGINE_VERSION,
        "git_sha": git_sha(),
        "grid": {"ny": grid.ny, "nx": grid.nx, "res": grid.res, "lat_top": 90, "lon_left": -180},
        "frames": {"years": years, "layers": ["base", "sapiens", "archaic"], "encoding": "uint8-gzip",
                   "density_lo": LO, "density_hi": HI, "file": "frames.bin.gz"},
        "climate": None if not has_climate else {
            "file": "climate.bin.gz", "layers": ["temperature", "precipitation", "npp"],
            "temperature": {"min": T_RANGE[0], "max": T_RANGE[1], "scale": "linear", "unit": "°C"},
            "precipitation": {"min": P_RANGE[0], "max": P_RANGE[1], "scale": "log10", "unit": "mm/an"},
            "npp": {"min": 0, "max": NPP_MAX, "scale": "sqrt", "unit": "g/m²/an"}},
        "extra": None if not extra_names else {
            "file": "layers.bin.gz", "layers": [{"id": k, **EXTRA_SPECS[k]} for k in extra_names]},
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
