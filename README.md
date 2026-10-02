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

## Démarrer en local

```bash
cd sim
pip install -e ".[dev]"
python scripts/fetch_data.py          # relief ETOPO1 10' (~4,7 Mo)
python -m pytest -q
python run_experiment_001.py --scenario B --seeds 1,2,3 --gif
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

## Règles du laboratoire

Voir [`docs/DECISIONS.md`](docs/DECISIONS.md).
