"""Teste le lecteur Beyer2020 sur un fichier synthétique au format exact du vrai fichier
(relevé par scripts/inspect_netcdf.py en CI) : latitude -59.75..89.75 croissante, float32,
time int32, _FillValue -9e33, altitude/rugosity avec _FillValue -1.175494e38."""
import numpy as np
import pytest

netCDF4 = pytest.importorskip("netCDF4")

from worldsim.beyer import BeyerPaleoEarth, GC_TO_DRY_MATTER  # noqa: E402
from worldsim.earth import Grid  # noqa: E402

TIMES = [-120000, -21000, 0]


@pytest.fixture(scope="module")
def fake_beyer(tmp_path_factory):
    path = tmp_path_factory.mktemp("beyer") / "fake.nc"
    lat = np.arange(-59.75, 90, 0.5, dtype=np.float32)   # le vrai fichier s'arrête à -60°
    lon = np.arange(-179.75, 180, 0.5, dtype=np.float32)
    LON, LAT = np.meshgrid(lon, lat)
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("time", len(TIMES))
        ds.createDimension("latitude", len(lat))
        ds.createDimension("longitude", len(lon))
        ds.createVariable("time", "i4", ("time",))[:] = TIMES
        ds["time"].units = "years since 1950-01-01 00:00:00.0"
        ds.createVariable("latitude", "f4", ("latitude",))[:] = lat
        ds.createVariable("longitude", "f4", ("longitude",))[:] = lon
        land = (LAT > -40) & (LAT < 70) & (LON > -20) & (LON < 60)
        for name, val in {"bio01": 25 - 0.5 * np.abs(LAT), "bio12": np.full(LAT.shape, 800.0),
                          "npp": np.full(LAT.shape, 400.0), "altitude": np.full(LAT.shape, 300.0),
                          "rugosity": np.full(LAT.shape, 50.0)}.items():
            fill = np.float32(-1.175494e38) if name in ("altitude", "rugosity") else np.float32(-9e33)
            v = ds.createVariable(name, "f4", ("time", "latitude", "longitude"), fill_value=fill, zlib=True)
            for k, t in enumerate(TIMES):
                ice = land & (LAT > 50) & (t == -21000)
                v[k] = np.where(land & ~ice, val, fill)
        b = ds.createVariable("biome", "f4", ("time", "latitude", "longitude"), fill_value=np.float32(-9e33), zlib=True)
        for k, t in enumerate(TIMES):
            ice = land & (LAT > 50) & (t == -21000)
            b[k] = np.where(ice, 28, np.where(land, 8, -9e33))
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


def test_partial_latitude_coverage_maps_to_global_grid(fake_beyer):
    """Régression du run CI : (180,360) vs (150,360)."""
    g = Grid(1.0)
    s = BeyerPaleoEarth(g, fake_beyer).state(0)
    assert s.land_frac.shape == (g.ny, g.nx) == s.temperature.shape == s.npp.shape
    assert s.land_frac[g.LAT < -60].max() == 0          # au sud de -60° : océan
    assert s.land_frac[g.box(-35, -30, 0, 40)].min() == 1  # le bloc de terre est bien à sa place


def test_compact_npz_roundtrip(fake_beyer, tmp_path):
    g = Grid(1.0)
    full = BeyerPaleoEarth(g, fake_beyer)
    path = full.save_npz(tmp_path / "b.npz")
    small = BeyerPaleoEarth.from_npz(g, path)
    a, b = full.state(-21000), small.state(-21000)
    assert np.array_equal(a.ice, b.ice)
    assert np.allclose(a.temperature, b.temperature, atol=0.05)
    assert np.allclose(a.npp, b.npp, rtol=2e-3)
