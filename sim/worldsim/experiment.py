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
    snapshots: dict = field(default_factory=dict)  # year -> (N, A, ice, land_frac)
    climate: dict = field(default_factory=dict)    # year -> (temperature, precipitation, npp)
    extra: dict = field(default_factory=dict)      # year -> {"rivers", "cold", "complexity"}


ARCHAIC = HumanParams(p_sea=0.0, c_fixed=0.4, C_fixed=0.35)  # mobiles mais confinés à une aire imposée ; adaptation au froid fixe (Néandertaliens)


def run(seed: int = 1, start: int = -120_000, end: int = -10_000, params: HumanParams | None = None,
        archaics: bool = False, alpha_sa: float = 1.0, alpha_as: float = 1.0,
        complexity: bool = False, maritime: bool = False, archaic_C: float | None = None, neanderthal_C: float | None = None,
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
    if complexity:
        import dataclasses as _dc
        params = _dc.replace(params, complexity=True, maritime=maritime or params.maritime)
    sim.state["populations"] = {"N": params}
    if archaics:
        # Néandertaliens / Dénisoviens / autres : Eurasie hors Sahul, Japon, Amériques
        eurasia = grid.box(-11, 55, -12, 145) & ~grid.box(-90, 90, 129.5, 146) & ~africa
        eurasia &= ~grid.box(-90, 33, -20, 33)  # Afrique du Nord exclue
        sim.state["A"] = np.where(eurasia, 0.6 * sim.state["K"], 0.0).astype(np.float32)
        arch = ARCHAIC
        if complexity:
            import dataclasses as _dc
            # Mêmes règles pour tous les humains : le répertoire des archaïques dépend aussi de leur
            # réseau social ; archaic_C est leur plafond (capacité d'apprentissage social).
            arch = _dc.replace(ARCHAIC, adv_max=params.adv_max, complexity=True, C_fixed=None,
                               cx_n0=params.cx_n0, cx_span=params.cx_span, net_sigma=params.net_sigma,
                               cx_ceiling=ARCHAIC.C_fixed if archaic_C is None else archaic_C)
        sim.state["populations"]["A"] = arch
        sim.state["range:A"] = eurasia.astype(np.float32)
        if complexity and neanderthal_C is not None:
            # Deux mondes archaïques, d'après la répartition des sites : Néandertaliens au nord de
            # 30° N et à l'ouest de 90° E (Europe, Levant, Anatolie, Caucase, Zagros, Asie centrale
            # jusqu'à l'Altaï ; outillage moustérien, adaptation au froid). Ailleurs (Arabie, Inde,
            # Asie orientale et du Sud-Est) : Dénisoviens et autres lignées (H. floresiensis,
            # H. luzonensis, H. erectus tardif).
            west = (grid.LAT >= 30) & (grid.LON < 90)
            sim.state["ceiling:A"] = np.where(west, neanderthal_C, arch.cx_ceiling).astype(np.float32)
        # alpha[(i, j)] = effet de j sur i
        sim.state["alpha"] = {("N", "A"): alpha_sa, ("A", "N"): alpha_as}

    tracker = RegionTracker(grid)
    sim.observe(500, tracker)
    snaps: dict = {}
    clim: dict = {}
    extra: dict = {}
    if snapshot_every:
        def snap(s: Simulation, year: int):
            e = s.state["earth"]
            A = s.state.get("A")
            snaps[year] = (s.state["N"].copy(), None if A is None else A.copy(), e.ice.copy(), e.land_frac.copy())
            clim[year] = (e.temperature.astype(np.float32), e.precipitation.astype(np.float32), e.npp.astype(np.float32))
            layers = {}
            if "discharge" in s.state:
                layers["rivers"] = s.state["discharge"].copy()
            if "culture:N" in s.state:
                layers["cold"] = np.where(s.state["N"] > 0, s.state["culture:N"], np.nan).astype(np.float32)
            if "sea:N" in s.state:
                layers["sea"] = np.where(s.state["N"] > 0, s.state["sea:N"], np.nan).astype(np.float32)
            if "complexity:N" in s.state:
                layers["complexity"] = np.where(s.state["N"] > 0, s.state["complexity:N"], np.nan).astype(np.float32)
            extra[year] = layers
        sim.observe(snapshot_every, snap)

    sim.run(progress=progress)
    return RunResult(seed, tracker, sim.log.events, snaps, clim, extra)
