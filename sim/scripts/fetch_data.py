"""Télécharge le relief ETOPO1 dégradé à 10' (g2e/etopo10, licence MIT, données NOAA)."""
import io
import urllib.request
import zipfile
from pathlib import Path

URL = "https://github.com/g2e/etopo10/archive/refs/heads/master.zip"
DATA = Path(__file__).resolve().parent.parent / "data"
WANTED = {"etopo10_ice_g_i2.bin", "etopo10_ice_g_i2.hdr", "LICENSE"}


def main():
    DATA.mkdir(exist_ok=True)
    if (DATA / "etopo10_ice_g_i2.bin").exists():
        print("data/ déjà présent")
        return
    print("téléchargement", URL)
    raw = urllib.request.urlopen(URL, timeout=120).read()
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in z.namelist():
            base = name.split("/")[-1]
            if base in WANTED:
                target = DATA / ("ETOPO10_LICENSE" if base == "LICENSE" else base)
                target.write_bytes(z.read(name))
                print("  ->", target.name)


if __name__ == "__main__":
    main()
