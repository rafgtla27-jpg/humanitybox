"""Affiche la structure d'un fichier netCDF (dimensions, variables, unités, plage temporelle).
Utile si le lecteur Beyer échoue : colle la sortie dans la conversation.

    python scripts/inspect_netcdf.py data/Beyer2020_annual_vars_v1.2.2.nc
"""
import sys

import netCDF4
import numpy as np

with netCDF4.Dataset(sys.argv[1]) as ds:
    print("dimensions :", {k: len(v) for k, v in ds.dimensions.items()})
    for name, v in ds.variables.items():
        attrs = {a: getattr(v, a) for a in ("units", "long_name", "_FillValue") if hasattr(v, a)}
        print(f"  {name:<14} {v.dimensions} {v.dtype} {attrs}")
    for t in ("time", "latitude", "longitude", "lat", "lon"):
        if t in ds.variables:
            a = np.asarray(ds[t][:])
            print(f"{t}: {a[:3]} ... {a[-3:]} (n={a.size})")
