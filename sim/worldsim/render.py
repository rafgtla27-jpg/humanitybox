"""WORLD_SIM — rendu 2D minimal (le rendu 3D/voxels viendra beaucoup plus tard)."""
from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

from .earth import Grid, monsoon_index, sea_level
from .validation import REGIONS

OCEAN = np.array([0.06, 0.10, 0.18])
LAND = np.array([0.30, 0.30, 0.27])
ICE = np.array([0.92, 0.95, 1.0])
SAPIENS = np.array([1.0, 0.62, 0.15])
ARCHAIC = np.array([0.62, 0.45, 0.95])


def _layer(rgb, density, color, lo=0.002, hi=0.3):
    with np.errstate(divide="ignore"):
        t = np.clip((np.log10(np.maximum(density, 1e-12)) - np.log10(lo)) / (np.log10(hi) - np.log10(lo)), 0, 1)
    t = t[..., None] * 0.95
    return rgb * (1 - t) + color * t


def frame_image(grid: Grid, year: int, N, A, ice, land_frac, title: str) -> np.ndarray:
    area = grid.cell_area_km2 * np.maximum(land_frac, 1e-3)
    rgb = np.where(land_frac[..., None] > 0.3, LAND, OCEAN)
    rgb = np.where(ice[..., None], ICE, rgb)
    if A is not None:
        rgb = _layer(rgb, A / area, ARCHAIC)
    rgb = _layer(rgb, N / area, SAPIENS)

    fig = plt.figure(figsize=(10, 6.2), dpi=90, facecolor="#0b0f17")
    ax = fig.add_axes([0.01, 0.25, 0.98, 0.68])
    ax.imshow(rgb, extent=[-180, 180, -90, 90], interpolation="nearest")
    ax.set_ylim(-60, 80)
    ax.axis("off")
    total = N.sum() + (0 if A is None else A.sum())
    fig.text(0.02, 0.95, title, color="w", fontsize=12, weight="bold")
    fig.text(0.98, 0.95, f"{-year:,} BP".replace(",", " "), color="w", fontsize=16, ha="right", weight="bold")
    fig.text(0.02, 0.215, f"■ Sapiens {N.sum() / 1e6:.2f} M", color="#ffb347", fontsize=10)
    if A is not None:
        fig.text(0.22, 0.215, f"■ Archaïques {A.sum() / 1e6:.2f} M", color="#b48cff", fontsize=10)
    fig.text(0.98, 0.215, "□ glace", color="#e8f0ff", fontsize=10, ha="right")

    ax2 = fig.add_axes([0.06, 0.04, 0.88, 0.14], facecolor="#0b0f17")
    yrs = np.arange(-120_000, -9_000, 250)
    ax2.plot(-yrs / 1000, [sea_level(y) for y in yrs], color="#5aa0ff", lw=1.2)
    ax2b = ax2.twinx()
    ax2b.plot(-yrs / 1000, [monsoon_index(y) for y in yrs], color="#7fd17f", lw=0.8, alpha=0.7)
    ax2.axvline(-year / 1000, color="w", lw=1)
    ax2.set_xlim(120, 10)
    for a in (ax2, ax2b):
        a.tick_params(colors="#aaa", labelsize=7)
        for sp in a.spines.values():
            sp.set_color("#333")
    ax2.set_ylabel("mer (m)", color="#5aa0ff", fontsize=7)
    ax2b.set_ylabel("mousson", color="#7fd17f", fontsize=7)
    ax2.set_xlabel("milliers d'années BP", color="#aaa", fontsize=7)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    return np.array(Image.open(buf).convert("RGB"))


def make_gif(grid: Grid, snapshots: dict, path: str, title: str, ms: int = 160) -> None:
    frames = []
    for year in sorted(snapshots):
        N, A, ice, lf = snapshots[year]
        frames.append(Image.fromarray(frame_image(grid, year, N, A, ice, lf, title)))
    frames += [frames[-1]] * 8
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=ms, loop=0, optimize=True)


def validation_chart(results: dict[str, list[list[dict]]], path: str) -> None:
    """results: scénario -> liste (une par seed) de rapports."""
    names = [r.name for r in REGIONS]
    fig, ax = plt.subplots(figsize=(10, 5.5), dpi=110)
    y = np.arange(len(names))
    for i, r in enumerate(REGIONS):
        ax.plot([r.target[0] / 1000, r.target[1] / 1000], [i, i], color="#2e7d32", lw=9, alpha=0.35, solid_capstyle="butt")
    markers = ["o", "s", "^", "D"]
    colors = ["#d62728", "#ff7f0e", "#1f77b4", "#9467bd"]
    for k, (scen, runs) in enumerate(results.items()):
        off = (k - (len(results) - 1) / 2) * 0.22
        first = True
        for rows in runs:
            for i, row in enumerate(rows):
                bp = row["model_bp"]
                x = 3 if bp is None else bp / 1000
                ax.scatter(x, i + off, marker=markers[k] if bp else "x", color=colors[k], s=26, alpha=0.75,
                           label=scen if first else None, zorder=3)
                first = False
    ax.set_yticks(y)
    ax.set_yticklabels(names, fontsize=9)
    ax.set_xlim(125, 0)
    ax.invert_yaxis()
    ax.set_xlabel("Arrivée (milliers d'années BP)   —   bande verte = fourchette archéologique   —   × = jamais atteint")
    ax.grid(axis="x", alpha=0.3)
    ax.legend(loc="lower left", fontsize=8)
    ax.set_title("WORLD_SIM Experiment #001 — dates d'arrivée simulées vs archéologie")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
