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

**v0.2.2** — Runs Beyer A et B : la simulation passe (seed 1 en 9 s et 24 s sur les runners
GitHub), l'échec venait de la publication Supabase sans secrets. La publication est désormais
ignorée si les secrets manquent, et un échec de publication n'interrompt plus le run ; les
résultats s'affichent avant. Export de 3 calques climatiques (`climate.bin.gz`) et globe 3D
dans le viewer.

**#001 avec le climat Beyer 2020 (v0.2.2, runs GitHub A-6 et B-5)**

| Région | A · monde vide | B · Eurasie habitée | Cible |
|---|---|---|---|
| Levant | 116,5k ✓ | 113,5k ✓ | 130–50k |
| Asie du Sud | 113,5k | 85k | 80–45k |
| Chine du Sud | 107k | 65k ✓ | 80–40k |
| Europe | 114,5k | 101,5k | 55–42k |
| Australie | 95k | 33,5k (trop tard) | 65–45k |
| Japon | 100,5k | 49k | 40–30k |
| Arctique sibérien, Amériques | jamais | jamais | 45–12k |

Ce que le vrai climat a changé et n'a pas changé :
1. Le Sahara et l'Arabie restent franchissables dès 117k, même avec le climat réel : la sortie
   précoce d'Afrique ne venait donc pas seulement du climat provisoire. Le moteur ne connaît
   aucun seuil de viabilité en désert (eau douce, rayon de fourrage) : la capacité de charge
   descend linéairement avec la NPP sans jamais devenir nulle.
2. Avec les vraies calottes et les vraies températures, plus personne n'atteint la Sibérie
   arctique ni la Béringie, donc ni les Amériques. Cause : `t_min = -12 °C` (tolérance au froid
   sans technologie). Résultat attendu et instructif : franchir l'Arctique exige des vêtements
   cousus, du feu, des abris, c'est-à-dire la couche culturelle (V0.4), pas un réglage.
3. En B, l'Australie devient trop tardive (33k) : la ceinture archaïque d'Asie du Sud-Est
   ralentit trop la traversée de Wallacea.
4. Les seeds restent quasi identiques (±500 ans) : la contingence explicite reste à construire.

Priorités moteur qui en découlent (V0.3) : seuil de viabilité aride lié à l'eau douce ;
tolérance au froid portée par une capacité culturelle plutôt qu'une constante ; α remplacé par
un avantage émergent (V0.4).

**Viewer v0.3.0** — `/` devient le simulateur plein écran (globe sur fond spatial, interface
qui s'efface après 3 s d'inactivité, lecture automatique) ; l'ancienne page détaillée passe sur
`/labo`. Le globe gère l'absence de WebGL (message clair, repli sur la carte dans `/labo`) au
lieu de faire planter toute la page. Les runs de démo sont désormais les vrais runs Beyer.

**v0.3.0 — eau douce, rivières émergentes, adaptation culturelle au froid**

1. *Rivières* (`hydrology.py`) : réseau de drainage calculé une fois sur le relief réel
   (priority-flood, Barnes et al. 2014), ruissellement par Budyko-Fu (ω = 2,6), débit par
   accumulation. Aucune rivière n'est dessinée à la main : le Nil sort du lac Victoria et
   remonte jusqu'en Égypte, l'Amazone dépasse 10 000 m³/s (tests). Limites : bassins
   endoréiques comblés, pas de lacs ni de nappes, ETP linéaire en température.
2. *Eau disponible* = max(pluie suffisante, accès à un fleuve). Seuils d'aridité UNEP
   (P/ETP : 0 sous 0,05, plein au-dessus de 0,2) ; fleuve plein au-dessus de 500 m³/s, nul
   sous 20 m³/s ; sur la côte, plancher de 0,25 (sources, estuaires). Hypothèses, pas réglages.
3. *Adaptation au froid* : premier trait culturel, porté par les cohortes et transporté par
   la migration (moyenne pondérée, masse conservée, testé). Il progresse sous contrainte de
   froid si le voisinage 3×3 compte au moins 2 000 personnes, et se perd quand le réseau est trop
   petit (effet « Tasmanie », Henrich 2004). À adaptation complète, la limite de froid passe de
   −12 °C à −34 °C de moyenne annuelle. Archaïques : adaptation fixe à 0,4 (hypothèse).
   **Paramètres non calibrés.** Plan : calibrer gain/perte sur Europe + Sibérie (Yana ~32k),
   valider sur les Amériques, jamais l'inverse.
4. Aperçu en climat provisoire (scénario A) : la Sibérie arctique est atteinte vers 97k et les
   Amériques vers 73k, beaucoup trop tôt ; avec ces valeurs, la culture du froid n'est pas le
   facteur limitant. Le vrai test est le run Beyer v0.3.
5. Coût : ~50 s par run (contre ~30 s), surtout la migration du trait culturel.

Viewer : rivières dessinées sur tous les calques (seuil d'affichage ~500 m³/s), calque
« Adaptation au froid », run d'aperçu « A — aperçu moteur 0.3 » en démo.
