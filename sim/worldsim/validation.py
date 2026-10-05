"""
WORLD_SIM — Validation contre la Terre réelle

Cibles = FOURCHETTES (années BP), car les dates d'arrivée sont débattues.
Le but n'est pas de reproduire une date, mais de vérifier que notre
histoire appartient à l'ensemble des histoires plausibles du moteur.

Les fourchettes ci-dessous sont des ordres de grandeur volontairement larges,
à affiner avec la littérature avant toute conclusion.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .earth import Grid
from .kernel import Simulation


@dataclass
class Region:
    name: str
    box: tuple[float, float, float, float]  # lat0, lat1, lon0, lon1
    target: tuple[int, int]                  # (plus ancien, plus récent) en BP
    note: str


REGIONS = [
    Region("Levant", (30, 36, 34, 40), (130_000, 50_000), "sorties précoces dès ~120-90k, occupation durable ~50k"),
    Region("Asie du Sud", (8, 30, 68, 90), (80_000, 45_000), "dates anciennes débattues"),
    Region("Chine du Sud", (22, 32, 100, 120), (80_000, 40_000), "dates > 70k débattues"),
    Region("Europe", (40, 55, -5, 30), (55_000, 42_000), "~54k (Mandrin) à ~45k"),
    Region("Australie", (-39, -12, 114, 153), (65_000, 45_000), "65k débattu, consensus ~50-47k"),
    Region("Japon", (31, 45, 130.5, 146), (40_000, 30_000), "traversée maritime nécessaire"),
    Region("Arctique sibérien", (65, 75, 100, 160), (45_000, 28_000), "Yana ~32k"),
    Region("Amérique du Nord (sud des glaces)", (25, 40, -125, -75), (24_000, 13_000), "White Sands ~21-23k débattu"),
    Region("Amérique du Sud", (-40, 0, -80, -35), (20_000, 12_000), "Monte Verde ~14.5k"),
]


class RegionTracker:
    """Observateur : arrivées, effondrements régionaux, et leurs causes climatiques."""

    def __init__(self, grid: Grid, threshold_people: float = 500.0):
        self.grid = grid
        self.threshold = threshold_people
        self.masks = {r.name: grid.box(*r.box) for r in REGIONS}
        self.arrival: dict[str, int | None] = {r.name: None for r in REGIONS}
        self.series: dict[str, list[float]] = {r.name: [] for r in REGIONS}
        self.years: list[int] = []
        self.total: list[float] = []
        self._peak: dict[str, float] = {r.name: 0.0 for r in REGIONS}
        self._climate_at_peak: dict[str, tuple] = {}
        self.share_max: dict[str, float] = {r.name: 0.0 for r in REGIONS}  # diagnostic : part max de sapiens

    def _regional_climate(self, s, m):
        land = m & (s.land_frac > 0.02)
        if not land.any():
            return (s.sea_level, np.nan, np.nan, np.nan)
        return (s.sea_level, float(s.temperature[land].mean()), float(s.precipitation[land].mean()),
                float(s.ice[land].mean()))

    def __call__(self, sim: Simulation, year: int) -> None:
        N, s = sim.state["N"], sim.state["earth"]
        A = sim.state.get("A")
        self.years.append(year)
        self.total.append(float(N.sum()))
        for name, m in self.masks.items():
            pop = float(N[m].sum())
            self.series[name].append(pop)
            others = 0.0 if A is None else float(A[m].sum())
            if pop + others > 0:
                self.share_max[name] = max(self.share_max[name], pop / (pop + others))
            # Arrivée = présence significative ET au moins 10 % des humains de la région
            if self.arrival[name] is None and pop >= self.threshold and pop >= 0.1 * (pop + others):
                self.arrival[name] = year
                sim.log.emit(year, "ARRIVÉE", name, population=int(pop), niveau_marin=f"{s.sea_level:.0f} m")
            if pop > self._peak[name]:
                self._peak[name] = pop
                self._climate_at_peak[name] = self._regional_climate(s, m)
            elif self._peak[name] > 5 * self.threshold and pop < 0.4 * self._peak[name]:
                # Effondrement : on journalise les deltas climatiques depuis le pic
                sl0, t0, p0, i0 = self._climate_at_peak[name]
                sl1, t1, p1, i1 = self._regional_climate(s, m)
                sim.log.emit(year, "EFFONDREMENT", name,
                             pop=f"{int(self._peak[name])}→{int(pop)}",
                             dT=f"{t1 - t0:+.1f}°C", dP=f"{100 * (p1 - p0) / max(p0, 1):+.0f}%",
                             d_glace=f"{100 * (i1 - i0):+.0f} pts", d_mer=f"{sl1 - sl0:+.0f} m")
                self._peak[name] = pop
                self._climate_at_peak[name] = (sl1, t1, p1, i1)

    def report(self) -> list[dict]:
        rows = []
        for r in REGIONS:
            a = self.arrival[r.name]
            bp = None if a is None else -a
            ok = bp is not None and r.target[1] <= bp <= r.target[0]
            verdict = "OK" if ok else ("jamais" if bp is None else ("trop tôt" if bp > r.target[0] else "trop tard"))
            rows.append({"region": r.name, "model_bp": bp, "target": r.target, "verdict": verdict, "note": r.note,
                         "share_max": round(self.share_max[r.name], 3)})
        return rows


# --- V0.5 : foyers agricoles (indicatifs : on vérifie une logique, pas une date au siècle près)
AGRI_FOCI = [
    ("Croissant fertile", (30, 38, 35, 48), (11_500, 9_500)),
    ("Chine (Fleuve Jaune / Yangtsé)", (27, 40, 105, 122), (10_000, 7_500)),
    ("Nouvelle-Guinée", (-8, -3, 138, 150), (10_000, 6_500)),
    ("Mésoamérique", (14, 22, -105, -88), (10_000, 6_000)),
    ("Andes", (-18, -5, -80, -65), (9_000, 5_000)),
    ("Sahel / Afrique de l'Ouest", (8, 16, -10, 20), (5_000, 3_000)),
    ("Inde (Gange)", (22, 30, 75, 90), (9_000, 5_000)),
]


class AgriTracker:
    """Première date où l'agriculture dépasse 0,3 dans au moins 3 cellules de chaque foyer."""

    def __init__(self, grid):
        self.masks = {n: grid.box(*b) for n, b, _ in AGRI_FOCI}
        self.first: dict[str, int | None] = {n: None for n, _, _ in AGRI_FOCI}

    def __call__(self, sim, year):
        A = sim.state.get("agri:N")
        if A is None:
            return
        for n, m in self.masks.items():
            if self.first[n] is None and int(((A > 0.3) & m).sum()) >= 3:
                self.first[n] = year

    def report(self):
        out = []
        for n, _, (old, young) in AGRI_FOCI:
            y = self.first[n]
            bp = None if y is None else -y
            out.append({"focus": n, "model_bp": bp, "reference": [old, young],
                        "verdict": "jamais" if bp is None else ("OK" if young <= bp <= old else ("trop tôt" if bp > old else "trop tard"))})
        return out
