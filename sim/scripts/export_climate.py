"""Produit data/beyer2020_1deg.npz : le climat Beyer 2020 déjà agrégé à 1° (~20 Mo).
Sert à travailler sans le netCDF de 323 Mo (et à l'envoyer pour un diagnostic hors GitHub).

    python scripts/fetch_data.py --beyer
    python scripts/export_climate.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from worldsim.beyer import BEYER_NPZ, BeyerPaleoEarth  # noqa: E402
from worldsim.earth import Grid  # noqa: E402

e = BeyerPaleoEarth(Grid(1.0))
path = e.save_npz(BEYER_NPZ)
print(f"{path} : {path.stat().st_size / 1e6:.1f} Mo, {len(e.times)} tranches de {int(e.times[0])} à {int(e.times[-1])}")
