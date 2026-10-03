"""
Télécharge les données d'entrée dans sim/data/.

    python scripts/fetch_data.py            # relief ETOPO1 10' (~4,7 Mo, GitHub g2e/etopo10, MIT)
    python scripts/fetch_data.py --beyer    # + paléoclimat Beyer et al. 2020 (Zenodo 7388091, gros fichier)
"""
import argparse
import io
import time
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ETOPO_URL = "https://github.com/g2e/etopo10/archive/refs/heads/master.zip"
BEYER_URL = "https://zenodo.org/record/7388091/files/Beyer2020_annual_vars_v1.2.2.nc?download=1"
import os

DATA = Path(os.environ.get("WORLDSIM_DATA") or Path(__file__).resolve().parent.parent / "data")
WANTED = {"etopo10_ice_g_i2.bin", "etopo10_ice_g_i2.hdr", "LICENSE"}


def download(url: str, timeout: int = 120, tries: int = 5) -> bytes:
    """Téléchargement avec nouvelles tentatives (connexion Wi-Fi instable, DNS capricieux)."""
    for k in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "worldsim-fetch/0.1"})
            return urllib.request.urlopen(req, timeout=timeout).read()
        except OSError as e:
            if k == tries:
                raise SystemExit(f"Échec du téléchargement après {tries} essais : {url}\n{e}\n"
                                 "Vérifie la connexion Internet de cet ordinateur, ou ajoute les "
                                 "fichiers de données dans sim/data (voir docs/DECISIONS.md).")
            print(f"  essai {k} raté ({e}), nouvelle tentative dans {5 * k} s", flush=True)
            time.sleep(5 * k)


def etopo():
    if (DATA / "etopo10_ice_g_i2.bin").exists():
        print("ETOPO déjà présent")
        return
    print("téléchargement", ETOPO_URL)
    raw = download(ETOPO_URL)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            base = name.split("/")[-1]
            if base in WANTED:
                target = DATA / ("ETOPO10_LICENSE" if base == "LICENSE" else base)
                target.write_bytes(z.read(name))
                print("  ->", target.name)


def beyer():
    target = DATA / "Beyer2020_annual_vars_v1.2.2.nc"
    if target.exists() and target.stat().st_size > 1_000_000:
        print("Beyer2020 déjà présent")
        return
    print("téléchargement", BEYER_URL)
    tmp = target.with_suffix(".part")
    req = urllib.request.Request(BEYER_URL, headers={"User-Agent": "worldsim-fetch/0.1"})
    with urllib.request.urlopen(req, timeout=600) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
            if total:
                sys.stdout.write(f"\r  {done / 1e6:,.0f} / {total / 1e6:,.0f} Mo")
                sys.stdout.flush()
    print()
    shutil.move(tmp, target)
    print("  ->", target.name)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--beyer", action="store_true", help="télécharger aussi le paléoclimat Beyer et al. 2020")
    a = ap.parse_args()
    DATA.mkdir(exist_ok=True)
    etopo()
    if a.beyer:
        beyer()
