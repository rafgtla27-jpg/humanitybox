"""Teste le lecteur Beyer2020 sur un fichier synthétique au même format que la version pastclim."""
import numpy as np
import pytest

netCDF4 = pytest.importorskip("netCDF4")

from worldsim.beyer import BeyerPaleoEarth, GC_TO_DRY_MATTER  # noqa: E402
from worldsim.earth import Grid  # noqa: E402

TIMES = [-120000, -21000, 0]


@pytest.fixture(scope="module")
def fake_beyer(tmp_path_factory):
    path = tmp_path_factory.mktemp("beyer") / "fake.nc"
    lat = np.arange(-89.75, 90, 0.5)          # croissant, comme souvent en netCDF
    lon = np.arange(-179.75, 180, 0.5)
    LON, LAT = np.meshgrid(lon, lat)
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("time", len(TIMES))
        ds.createDimension("latitude", len(lat))
        ds.createDimension("longitude", len(lon))
        ds.createVariable("time", "f8", ("time",))[:] = TIMES
        ds["time"].units = "years since 1950-01-01 00:00:00.0"
        ds.createVariable("latitude", "f8", ("latitude",))[:] = lat
        ds.createVariable("longitude", "f8", ("longitude",))[:] = lon
        land = (LAT > -40) & (LAT < 70) & (LON > -20) & (LON < 60)
        for name, val in {"bio01": 25 - 0.5 * np.abs(LAT), "bio12": np.full(LAT.shape, 800.0),
                          "npp": np.full(LAT.shape, 400.0), "altitude": np.full(LAT.shape, 300.0),
                          "rugosity": np.full(LAT.shape, 50.0)}.items():
            v = ds.createVariable(name, "f4", ("time", "latitude", "longitude"), fill_value=np.float32(-9999), zlib=True)
            for k, t in enumerate(TIMES):
                ice = land & (LAT > 50) & (t == -21000)
                v[k] = np.where(land & ~ice, val, -9999)
        b = ds.createVariable("biome", "f4", ("time", "latitude", "longitude"), fill_value=np.float32(-9999), zlib=True)
        for k, t in enumerate(TIMES):
            ice = land & (LAT > 50) & (t == -21000)
            b[k] = np.where(ice, 28, np.where(land, 8, -9999))
    return path


def test_orientation_values_and_units(fake_beyer):
    g = Grid(1.0)
    e = BeyerPaleoEarth(g, fake_beyer)
    s = e.state(0)
    i = int(np.argmin(np.abs(g.lat - 10.5)))
    j = int(np.argmin(np.abs(g.lon - 20.5)))
    assert s.land_frac[i, j] == 1.0
    assert abs(s.temperature[i, j] - (25 - 0.5 * 10.5)) < 0.3          # nord en haut
    assert abs(s.npp[i, j] - 400 * GC_TO_DRY_MATTER) < 1e-3            # gC → matière sèche
    assert s.land_frac[int(np.argmin(np.abs(g.lat - 10.5))), int(np.argmin(np.abs(g.lon + 100.5)))] == 0


def test_ice_and_interpolation(fake_beyer):
    g = Grid(1.0)
    e = BeyerPaleoEarth(g, fake_beyer)
    north = g.box(55, 65, 0, 40)
    assert e.state(-21000).ice[north].all()
    assert not e.state(0).ice[north].any()
    assert e.state(-21000).npp[north].max() == 0
    assert e.span == (-120000, 0)
    mid = e.state(-10500)  # entre -21000 (glace) et 0 (pas de glace) : fraction 0,5
    assert np.isfinite(mid.temperature).all()


def test_simulation_runs_on_beyer(fake_beyer):
    from worldsim.experiment import run
    g = Grid(1.0)
    r = run(seed=1, start=-30000, end=-28000, grid=g, earth=BeyerPaleoEarth(g, fake_beyer))
    assert r.tracker.total[-1] > 0
