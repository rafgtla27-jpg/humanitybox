"""
Pré-calcule (« cuit ») l'environnement pour le moteur en direct du navigateur (piste G1).
Le climat, l'eau, les glaces, les passages et le potentiel agricole ne dépendent pas des humains :
on les calcule une fois ici, avec le moteur Python de référence, et le navigateur n'a plus qu'à
simuler les humains.

    python scripts/bake_live.py  →  ../web/public/live/env.bin.gz + env.json
Par tranche (pas de 2 000 ans avant −12 000, puis de 1 000 ans) et par cellule de 1°, 9 octets :
K (capacité de base, log), T, P, NPP (comme climate.bin), potentiel agricole, part de terre,
drapeaux (bit0 franchissable, bit1 glace), liens à pied (8 bits), fleuves (log débit).
"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from worldsim.beyer import BeyerPaleoEarth  # noqa: E402
from worldsim.earth import Grid, sea_level  # noqa: E402
from worldsim.export import encode_climate, encode_extra  # noqa: E402
from worldsim.humans import HumanParams, Ecology  # noqa: E402
from worldsim.kernel import Simulation  # noqa: E402

DIRS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
K_LO, K_SPAN = -1.0, 7.0  # log10(K) de 0,1 à 1 000 000 personnes par cellule

grid = Grid(1.0)
earth = BeyerPaleoEarth.load(grid)
eco = Ecology(earth, grid, HumanParams(maritime=True, agriculture=True))
years = list(range(-120_000, -12_000, 2_000)) + list(range(-12_000, 1, 1_000))
sim = Simulation(-120_000, 0, 10, 1)
planes = []
for y in years:
    sim.state["_T_hist"] = []
    eco.step(sim, y, 0)
    s = sim.state["earth"]
    # capacité sans le bruit aléatoire
    K = eco.carrying_capacity(s, sim.state.get("water"), eco.hydro.river_access(sim.state["discharge"]))
    lk = np.where(K > 0.1, 1 + np.round(254 * np.clip((np.log10(np.maximum(K, 1e-9)) - K_LO) / K_SPAN, 0, 1)), 0).astype(np.uint8)
    land = s.land_frac > 0.3
    t, p, npp = encode_climate(s.temperature, s.precipitation, s.npp, land | (s.land_frac > 0.02))
    pot = np.round(np.clip(sim.state["plant_pot"], 0, 1) * 255).astype(np.uint8)
    lf = np.round(np.clip(s.land_frac, 0, 1) * 255).astype(np.uint8)
    flags = (sim.state["passable"].astype(np.uint8) | (s.ice.astype(np.uint8) << 1))
    conn = np.zeros(lk.shape, np.uint8)
    for b, d in enumerate(DIRS):
        conn |= (sim.state["conn"][d].astype(np.uint8) << b)
    riv = encode_extra("rivers", sim.state["discharge"], land)
    planes.append(np.stack([lk, t, p, npp, pot, lf, flags, conn, riv]))
    print(y, end=" ", flush=True)
arr = np.stack(planes).astype(np.uint8)  # (tranches, 9, 180, 360)
out = ROOT.parent / "web" / "public" / "live"
out.mkdir(parents=True, exist_ok=True)
(out / "env.bin.gz").write_bytes(gzip.compress(arr.tobytes(), 9))
rough = np.round(np.clip(sim.state["rough_cost"], 0, 1) * 255).astype(np.uint8)
(out / "rough.bin.gz").write_bytes(gzip.compress(rough.tobytes(), 9))
meta = {"years": years, "sea_level": [round(sea_level(y), 1) for y in years], "fields": ["K", "T", "P", "NPP", "pot", "landfrac", "flags", "conn", "rivers"],
        "K_log": [K_LO, K_SPAN], "dirs": DIRS, "grid": {"ny": 180, "nx": 360, "res": 1.0}}
(out / "env.json").write_text(json.dumps(meta))
print("\n", arr.shape, round((out / "env.bin.gz").stat().st_size / 1e6, 1), "Mo")
