"""
WORLD_SIM Experiment #001 — Dispersion d'Homo sapiens sur la Terre réelle
START 120 000 BP · END 10 000 BP · population initiale : Afrique subsaharienne
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .earth import Grid, ParametricPaleoEarth
from .humans import Demography, Ecology, HumanParams
from .kernel import Simulation
from .validation import RegionTracker


@dataclass
class RunResult:
    seed: int
    tracker: RegionTracker
    log: list
    snapshots: dict = field(default_factory=dict)  # year -> (N, ice, land_frac)


ARCHAIC = HumanParams(p_sea=0.0)  # mobiles, mais confinés à une aire imposée par les données


def run(seed: int = 1, start: int = -120_000, end: int = -10_000, params: HumanParams | None = None,
        archaics: bool = False, alpha_sa: float = 1.0, alpha_as: float = 1.0,
        snapshot_every: int | None = None, earth=None, grid: Grid | None = None, progress=False, dt: int = 20) -> RunResult:
    grid = grid or Grid(1.0)
    earth = earth or ParametricPaleoEarth(grid)
    params = params or HumanParams()

    sim = Simulation(start, end, base_dt=dt, seed=seed)
    eco = Ecology(earth, grid, params, period=200)
    sim.add(eco)
    sim.add(Demography(params, period=dt))

    # Condition initiale : la première mise à jour écologique doit précéder N
    eco.step(sim, start, 0)
    africa = grid.box(-35, 12, -18, 52)
    sim.state["N"] = np.where(africa, 0.5 * sim.state["K"], 0.0).astype(np.float32)
    sim.state["populations"] = {"N": params}
    if archaics:
        # Néandertaliens / Dénisoviens / autres : Eurasie hors Sahul, Japon, Amériques
        eurasia = grid.box(-11, 55, -12, 145) & ~grid.box(-90, 90, 129.5, 146) & ~africa
        eurasia &= ~grid.box(-90, 33, -20, 33)  # Afrique du Nord exclue
        sim.state["A"] = np.where(eurasia, 0.6 * sim.state["K"], 0.0).astype(np.float32)
        sim.state["populations"]["A"] = ARCHAIC
        sim.state["range:A"] = eurasia.astype(np.float32)
        # alpha[(i, j)] = effet de j sur i
        sim.state["alpha"] = {("N", "A"): alpha_sa, ("A", "N"): alpha_as}

    tracker = RegionTracker(grid)
    sim.observe(500, tracker)
    snaps: dict = {}
    if snapshot_every:
        def snap(s: Simulation, year: int):
            e = s.state["earth"]
            A = s.state.get("A")
            snaps[year] = (s.state["N"].copy(), None if A is None else A.copy(), e.ice.copy(), e.land_frac.copy())
        sim.observe(snapshot_every, snap)

    sim.run(progress=progress)
    return RunResult(seed, tracker, sim.log.events, snaps)
