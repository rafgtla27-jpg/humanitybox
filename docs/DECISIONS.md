# Décisions de conception

**1. Toute cause doit être explicable ; toutes ne doivent pas être simulées.**
La température peut venir d'un jeu de données. Ce qui doit être simulé, c'est la chaîne
climat → ressources → capacité de charge → pression → migration.

**2. Les forçages viennent de reconstructions indépendantes, jamais réglés à la main.**
Ajuster le climat ou les glaces pour que les humains « arrivent à l'heure » rend la validation circulaire.
`ParametricPaleoEarth` est provisoire et sera remplacé par Beyer et al. 2020 (climat, végétation)
et ICE-6G (calottes), derrière la même interface `EarthProvider`.

**3. Calibrer sur un jeu d'observations, valider sur un autre.**
Exemple : calibrer `HumanParams` sur l'Eurasie, valider sur Sahul et les Amériques.

**4. Les cibles sont des fourchettes, les résultats des distributions.**
On ne cherche pas à rejouer notre histoire, mais à vérifier qu'elle appartient à l'ensemble
des histoires plausibles du moteur (vue SQL `scenario_summary`).

**5. Le seed ne crée pas de contingence à lui seul.**
Constat de l'Experiment #001 : les cohortes de milliers de personnes moyennent le bruit,
les seeds divergent de ~500 ans. La contingence doit venir de mécanismes explicites
(groupes fondateurs, événements rares, innovations).

**6. Un flux aléatoire par processus.**
Ajouter un processus ne change pas les tirages des autres : un seed reste comparable entre versions.

**7. Le moteur ne tourne jamais dans le navigateur ni sur Vercel.**
Le web lit des résultats ; il ne les produit pas.

## Journal des expériences

**#001 (v0.1.0)** — Monde vide : sortie d'Afrique ~116k, tout arrive 40 à 60 000 ans trop tôt.
Eurasie habitée (α 0.9/1.1) : Chine du Sud et Australie dans les fourchettes, Europe et Japon
trop tôt, Sibérie arctique et Amériques jamais atteintes. Le calendrier dépend surtout de α :
la question « pourquoi 60k et pas 120k » devient « qu'est-ce qui fait gagner sapiens », à faire
émerger de la couche culturelle plutôt que de fixer à la main.

**v0.2.0** — `BeyerPaleoEarth` : température, précipitations, NPP, glaces (biome 28), altitude,
rugosité et trait de côte de Beyer et al. 2020 (version pastclim, Zenodo 7388091), agrégés à 1°
et interpolés entre tranches. NPP convertie de gC en matière sèche (× 2,2) pour garder
`HumanParams` inchangé. Lecteur testé sur fichier synthétique ; à confirmer sur le vrai fichier
(`scripts/inspect_netcdf.py` affiche sa structure dans les logs du workflow).

**v0.2.1** — Premier run CI sur le vrai fichier Beyer : échec `(180,360)` vs `(150,360)`.
Le fichier ne couvre que −60°..90° (Antarctique absent). Le lecteur place désormais les données
sur une grille globale par coordonnées ; le test reproduit le format réel relevé par
`inspect_netcdf.py` (72 tranches, pas de 2 000 ans avant −22k puis 1 000 ans).
Leçon : l'étape d'inspection en CI a permis de diagnostiquer en une passe.
