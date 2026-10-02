# WORLD_SIM

Laboratoire d'émergence historique : des humains simulés sur une Terre réelle qui change,
puis, plus tard, sur des planètes procédurales.

```
sim/        moteur Python (numpy) : kernel, EarthState(t), cohortes humaines, validation, export
supabase/   schéma Postgres + bucket Storage « runs »
web/        viewer Next.js (Vercel) : carte animée, frise niveau marin / arrivées par région
.github/    ci.yml (tests + build) et simulate.yml (lance des runs et publie dans Supabase)
```

## Qui fait quoi

| Brique | Rôle | Ce qu'elle ne fait pas |
|---|---|---|
| GitHub | code, revue, **calcul** via Actions (jobs jusqu'à 6 h) | — |
| Supabase | métadonnées des runs (Postgres), frames et manifests (Storage) | aucun calcul |
| Vercel | sert le viewer, lit Supabase avec la clé anon | **aucune simulation** : les fonctions serverless ont des limites de durée et de mémoire incompatibles |

Un run de 110 000 ans à 1° prend 30 à 50 s sur un CPU. Les ensembles (dizaines de seeds,
balayages de paramètres) tournent dans Actions ou sur ta machine, jamais sur Vercel.

## Mettre le projet sur GitHub (première fois)

Le dossier `.git` ne s'envoie pas à la main : c'est l'historique local, `git push` s'en charge.
Ce zip n'en contient pas, tu crées le tien :

```bash
cd world-sim                      # le dossier qui contient README.md, sim/, web/
git init
git add .
git commit -m "WORLD_SIM v0.1"
git branch -M main
git remote add origin https://github.com/TON_COMPTE/world-sim.git
git push -u origin main
```

Le dépôt GitHub doit être créé **vide** (sans README, .gitignore ni licence).

## Démarrer en local

```bash
cd sim
pip install -e ".[dev]"
python scripts/fetch_data.py          # relief ETOPO1 10' (~4,7 Mo)
python -m pytest -q
python run_experiment_001.py --scenario B --seeds 1,2,3 --gif
python scripts/fetch_data.py --beyer  # paléoclimat Beyer et al. 2020 (gros fichier, Zenodo)
python run_experiment_001.py --scenario B --climate beyer --gif
python run_experiment_001.py --chart

cd ../web
npm install
npm run dev                            # sans variables d'env : runs de démo dans public/demo
```

## Brancher Supabase, GitHub et Vercel

1. **Supabase** : créer un projet, puis `supabase link` et `supabase db push`
   (ou coller `supabase/migrations/*.sql` dans l'éditeur SQL). Le bucket public `runs` est créé par la migration.
2. **GitHub** : Settings → Secrets → Actions : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   Puis Actions → simulate → Run workflow.
3. **Vercel** : importer le repo, *Root Directory* = `web`, variables
   `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

La clé `service_role` ne va **que** dans les secrets GitHub. Le viewer n'utilise que la clé anon,
et RLS n'autorise que la lecture.

## Roadmap et règles du laboratoire

- [`docs/ROADMAP.md`](docs/ROADMAP.md) : vision, versions, piste visuelle, registre complet des idées.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) : principes et journal des expériences.
