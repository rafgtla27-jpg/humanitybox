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

**Viewer 0.3.2 — sprites, étape S1.** Les silhouettes représentent fidèlement les densités
simulées (une silhouette = S personnes, S ∈ {25, 50, … 10 000}, au plus 30 000), à positions
stables par cellule pour que la croissance et le déclin se voient comme des apparitions et des
disparitions. Le petit mouvement sur place est décoratif et le restera tant qu'il n'y a pas
d'agents (S3, V0.7–V0.8). Sous les humains, le sol montre la végétation (NPP atténuée) et la
densité devient un voile ocre : en vue d'ensemble on lit la dispersion, de près on voit les gens.

**Moteur 0.3.1 — contingence explicite et ensembles**

1. *Bruit démographique* : naissances et décès discrets, écart-type ∝ √N (taux 0,06/an).
   Négligeable pour une grande population, décisif pour un groupe pionnier.
2. *Dispersion lointaine* : de rares groupes de 30 personnes sautent de 300 à 900 km devant le
   front (taux ∝ pression démographique, trajet terrestre avec au plus une cellule d'eau).
   Leur survie dépend ensuite du bruit et du seuil d'extinction des petits groupes.
3. Constat (climat provisoire) : en monde vide (A), les seeds divergent toujours peu (±1 000 ans)
   car rien ne bloque le front ; en B, la contingence apparaît aux goulots : l'Australie est
   atteinte entre 39k et 42k selon le monde, pas atteinte à 40k dans une seed. La contingence
   naît des seuils, pas du hasard seul.
4. *Ensembles* : `ensemble.py` résume N mondes par région (P(atteinte), P(dans la fourchette),
   médiane, 10–90 %). Workflow GitHub `ensemble` : N seeds réparties sur plusieurs machines en
   parallèle, puis agrégation. Le viewer `/labo` affiche un point par monde et la probabilité.
5. Coût : ~90 s par run B sur un CPU de test. Un ensemble de 20 mondes sur 5 machines ≈ 8 min.

Prochaine étape V0.3 : calibration honnête des paramètres culturels (gain, perte, seuil) sur
Europe + Sibérie avec ensembles, validation sur Sahul et Amériques. Nécessite les runs Beyer.

**Ensembles Beyer, moteur 0.3.1 (20 mondes par scénario, 4 min sur GitHub)**

| Région | A · monde vide | B · Eurasie habitée (a = 0,1) | Cible |
|---|---|---|---|
| Levant | 100 % ✓ (115k) | 100 % ✓ (90–112k) | 130–50k |
| Asie du Sud | 0 % (112,5k) | 10 % (31,5–48k) | 80–45k |
| Chine du Sud | 0 % (106k) | 0 % (13,5–30k) | 80–40k |
| Europe | 0 % (112k) | 0 % (89–94k) | 55–42k |
| Australie | 0 % (94k) | jamais | 65–45k |
| Japon | 0 % (100k) | 5 % atteinte (11,5k) | 40–30k |
| Arctique, Amériques | jamais | jamais | 45–12k |

Lecture :
1. La contingence est réelle en B : selon le monde, l'Asie du Sud est atteinte entre 48k et 31,5k,
   la Chine entre 30k et 13,5k. En A, tout reste quasi déterministe (le front avance sans obstacle).
2. La vérité est entre A et B : A est 40 à 60 000 ans trop rapide, B trop lent vers l'est et
   pourtant trop rapide vers l'Europe. L'avantage compétitif a = 0,1 ne convient pas tel quel.
3. Europe trop tôt en B : sapiens apprend l'adaptation au froid (jusqu'à c ≈ 0,9) plus vite que la
   valeur fixée pour les Néandertaliens (0,4) et les remplace dès ~90k. `cold_gain` est trop fort.
4. Arctique jamais atteint, même en A. Diagnostic sur les frames : au-delà de 60° N, la densité est
   si faible que le voisinage 3×3 compte moins de 2 000 personnes ; l'adaptation s'y perd (effet
   Tasmanie) et le front recule (15 % des cellules de 65–72° N occupées à 80k, 0 % ensuite).
   `cold_ncrit` est trop exigeant pour des chasseurs arctiques très mobiles et très dispersés.

Décision : calibrer `advantage`, `cold_gain` et `cold_ncrit` sur une grille de 18 variantes
(workflow `calibrate`), classement sur Levant, Europe, Asie du Sud, Arctique sibérien uniquement ;
Chine, Australie, Japon et Amériques restent en test. `advantage` est un paramètre provisoire que la
V0.4 doit remplacer par un avantage culturel émergent.

**Calibration v0.3.4 (scénario B, 18 variantes × 6 mondes, Beyer)** — meilleure variante v12
(avantage 0,1 ; cold_gain 1/8000 ; cold_ncrit 500) : entraînement 38 %, test 17 % (Japon 67 %,
Chine 17 %, Australie et Amériques 0 %).

Lecture honnête :
1. L'optimum touche le bord de la grille (avantage max, gain max, seuil min) : la grille était
   trop étroite, mais surtout…
2. …Europe et Arctique sont à 0 % dans les 18 variantes. Aucun réglage ne les sauve : c'est la
   structure qui manque. Diagnostic sur les frames (B, seed 1) : sapiens s'infiltre dans l'Europe
   néandertalienne dès 100k et la remplace entre 92k et 80k, alors que sa culture du froid est
   encore quasi nulle. Un avantage CONSTANT dans le temps et l'espace ne peut pas à la fois laisser
   échouer les sorties précoces (~120–90k) et faire réussir celle de ~60–50k.
3. Fuite de test évitée : l'Australie (test) échoue, mais aucun mécanisme n'est ajouté pour elle
   (route côtière, navigation). Toute modification motivée par une région de test la ferait
   passer en entraînement.

**Moteur 0.4.0 — complexité culturelle émergente (début de la V0.4)**
Inspiré de Henrich (2004) et Powell, Shennan & Thomas (2009, Science) : la complexité culturelle
dépend de la taille du réseau social, donc de la densité et de la connectivité.
- Chaque cohorte porte un répertoire C ∈ [0, 1], transporté par la migration, qui tend (temps
  caractéristique 3 000 ans) vers C* = log(n_réseau / cx_n0) / log(cx_span), réseau = population
  dans un rayon de 2 cellules (~500 km).
- L'avantage compétitif n'est plus fixe : α = 1 ∓ adv_max × (C_sapiens − C_archaïques), cellule par
  cellule. Un groupe pionnier isolé (C érodé) perd face aux Néandertaliens ; une région dense le
  gagne. Les archaïques ont un C fixe (`archaic_C`).
- Coudre des vêtements exige un répertoire riche : le gain d'adaptation au froid est multiplié
  par C. Le réseau du froid utilise le même rayon de 2 cellules (correction motivée par l'Arctique,
  région d'entraînement).
- Premier essai (climat provisoire) : avec les valeurs par défaut, les pionniers atteignent le
  Levant mais y restent minoritaires (C ≈ 0,02–0,08 contre 0,35) pendant 60 000 ans ; dans le coin
  le plus favorable de la nouvelle grille, la sortie réussit trop tôt. L'optimum est donc à
  l'intérieur de la grille, contrairement à la calibration précédente.
- Nouvelle calibration (scénario C) : adv_max {0,2 ; 0,4} × cx_n0 {2 000 ; 6 000 ; 20 000} ×
  archaic_C {0,25 ; 0,4 ; 0,55}, mêmes régions d'entraînement et de test.

**Calibration C v0.4.0 : 0 % partout — pas de bug logiciel, un défaut de modèle**
Logs vérifiés (108 runs) : commandes, paramètres et variantes corrects, aucune erreur ; dans tous
les runs, sapiens n'atteint jamais 10 % de la population du Levant. Cause : le réseau social était
compté sur 5×5 cellules et uniquement autour de chaque cellule. Par construction, un front pionnier
qui entre en territoire néandertalien a un petit réseau local, donc un répertoire érodé, donc il
perd. Le mécanisme était **auto-bloquant** : aucun nouvel arrivant ne pouvait jamais gagner nulle part.
Mon test en climat provisoire passait seulement parce que le Sahara provisoire était peuplé et
formait un couloir dense ; avec le Sahara réel de Beyer, le couloir est mince.

Corrections (0.4.1), motivées par une région d'entraînement (Levant) :
1. Réseau social gaussien de portée σ = 3 cellules (~330 km), au lieu d'un carré 5×5 : le front
   reste relié à la population source qui le suit.
2. On oublie plus lentement qu'on n'apprend : temps caractéristique 2 000 ans pour s'enrichir,
   6 000 ans pour s'éroder.
3. Garde-fou : si aucune variante ne réussit une région d'entraînement, le rapport ne « choisit »
   rien et le dit. Diagnostic `part max sapiens` par région dans les logs de chaque run.
4. Grille élargie : cx_n0 {5 000 ; 20 000 ; 80 000}, archaic_C {0,15 ; 0,35 ; 0,55}.
   Vérifié en climat provisoire que la grille encadre le comportement : coin favorable → sortie
   et expansion (trop tôt) ; coin défavorable → blocage total ; points intermédiaires → sortie
   partielle (part max 27 % au Levant) ou blocage. La transition est abrupte, comme un seuil.

**Calibration C v0.4.1 : toujours presque rien (meilleur : 4 % d'entraînement, Levant 17 %)**
Indice décisif : avec archaic_C = 0,15, la variante à avantage faible (v00, adv 0,2) fait mieux que
celle à avantage fort (v09, adv 0,4 : 0 %). Un avantage plus fort ne pénalise sapiens que si son
répertoire au front est INFÉRIEUR à celui des archaïques. Donc, avec le climat réel, le front de
sapiens arrive au Levant avec un répertoire < 0,15, alors que le même réglage en climat provisoire
produit une expansion massive. Le climat réel rend le couloir de sortie (Sinaï, Nil, Arabie)
beaucoup plus pauvre en population, donc en réseau social.

Décision de méthode : arrêter les calibrations « à l'aveugle ». Je ne peux pas télécharger Beyer,
donc chaque hypothèse coûtait un aller-retour complet. Le workflow `export-climate` produit une
version compacte du climat (1°, ~20 Mo) ; avec elle, les diagnostics et les vérifications de
grille se font en local, sur le vrai climat, avant de relancer une calibration.

**Moteur 0.4.3 — premiers diagnostics sur le vrai climat (fichier compact Beyer reçu)**
Suivi de la population, du réseau social et du répertoire le long du couloir de sortie
(variante favorable adv 0,4 ; cx_n0 5 000 ; archaic_C 0,15) :
- Afrique de l'Est ~400 000 personnes, répertoire 0,85 ; vallée du Nil 1 000 à 3 000 personnes
  seulement ; Sinaï et Levant quasi vides de sapiens ; sud de l'Arabie peuplé dès 110k (~30 000,
  répertoire ~0,45, entrée par Bab-el-Mandeb).
Défauts de structure corrigés :
1. *Fleuves nourriciers* : un grand fleuve apporte une ressource propre (poisson, gibier, plaine
   d'inondation), indépendante de la végétation de la cellule, comme la côte. Le Nil n'était qu'un
   filet d'eau dans un désert.
2. *Mêmes règles pour tous les humains* : le répertoire des archaïques dépend aussi de leur réseau
   social ; `archaic_C` devient leur plafond (capacité d'apprentissage social).
3. *Faux ponts de terre* : à 1°, les cellules marocaine et espagnole se touchent, et sapiens entrait
   en Europe à pied par Gibraltar vers 100k (trajet tracé dans les frames). Les liens à pied entre
   cellules sont désormais calculés à 10′ ; les trois détroits du couloir de sortie, jamais émergés
   (Gibraltar ≈ −284 m, Bab-el-Mandeb ≈ −137 m, canal de Sicile ≥ −300 m), sont déclarés bras de mer
   d'après leur bathymétrie. Testé : Gibraltar fermé ; Béringie et Manche praticables au LGM.
   Les autres détroits (Wallacea, Corée) relèvent de régions de test : non touchés.
4. *Embarcations* : traverser un bras de mer exige un répertoire ≥ `boat_C` (0,5).
Conséquence : sans la porte de Gibraltar, la zone utile des paramètres s'est déplacée. Essais
locaux (seed 1, jusqu'à 30k) : archaic_C 0,25 → sapiens bloqué au Levant (6 %) ; 0,15–0,2 avec
cx_n0 3 000–5 000 → entrée au Levant (part max 11–18 %, arrivée 111k ou 58k selon le réglage)
mais ni Europe ni Asie du Sud. Le couloir aride Levant–Iran, tenu par des archaïques clairsemés,
reste la barrière. Nouvelle grille plus permissive : adv_max {0,4 ; 0,8} × cx_n0 {1 500 ;
3 000 ; 5 000} × archaic_C {0,05 ; 0,1 ; 0,15}.
Question ouverte (entraînement) : l'Asie du Sud n'est atteinte dans aucun essai.
Vérification de la grille sur le vrai climat (avant de lancer la calibration) : coin le plus
favorable (adv 0,8 ; cx_n0 1 500 ; archaic_C 0,05) → sortie et expansion trop précoces (Levant 113k,
Asie du Sud 90k, Europe 102k, Australie 67k) ; côté défavorable → blocage au Levant. La grille
encadre donc le comportement réel : la calibration peut trouver l'intérieur.

**Calibration C 0.4.3 : premier vrai résultat — entraînement 50 %, test 40 %**
Variante v00 (adv 0,4 ; cx_n0 1 500) sur 6 mondes : Levant 100 % (110k), Asie du Sud 100 % (56,8k),
et en TEST, jamais utilisées pour choisir : Chine du Sud 100 % (48,2k), Japon 83 % (39,2k),
Australie 17 % (32k). Premier signe que le modèle généralise au lieu d'apprendre par cœur.
Restent hors fourchette : Europe (91,5k, trop tôt), Arctique (jamais), Amériques (jamais).
Rejouée en local sur le vrai climat, v00 révèle deux défauts :
1. *Europe par la mer* : les sapiens du Maghreb (répertoire 0,56) franchissent Gibraltar et le
   canal de Sicile en bateau vers 100k, dès que le répertoire dépasse `boat_C` = 0,5 ; l'Anatolie
   et les Balkans ne sont atteintes que vers 80k. Aucun indice archéologique d'une telle traversée
   précoce : le seuil des embarcations devient un paramètre calibré.
2. **Bug** : une cellule vide était évaluée avec la culture de ses occupants, c'est-à-dire de
   personne (trait = 0). Pour des arrivants parfaitement adaptés au froid, une cellule arctique
   vide paraissait inhabitable (capacité × facteur de froid à culture nulle = 0) ; de même, en
   territoire archaïque, une cellule vide comptait comme « répertoire 0 » face aux Néandertaliens.
   Corrigé : on évalue une cellule avec le trait que porteraient les arrivants (max du local et de
   la moyenne du réseau voisin). Test de non-régression ajouté.
Aussi : le risque d'extinction des petits groupes dépend du réseau (≈ 150 personnes) et non de la
cellule, dont la surface fond aux hautes latitudes.
Essai local après corrections (v00 + boat_C 0,7, seed 1) : Levant 114k, Asie du Sud 73,5k, Chine
65k, Australie 48,5k, Japon 65k, Arctique 74k (atteint pour la première fois, trop tôt), Europe
90,5k (encore trop tôt), Amériques jamais. L'expansion est plus rapide : il faut recalibrer.
Amériques : régions de test, non diagnostiquées volontairement.
Nouvelle grille : adv_max {0,3 ; 0,5} × cx_n0 {1 500 ; 3 000 ; 6 000} × boat_C {0,6 ; 0,75 ; 0,9}.

Mise en garde méthodologique : les régions de test ont maintenant été regardées après plusieurs
calibrations successives. Pour garder une validation honnête, la version finale sera jugée sur des
critères encore jamais consultés (population mondiale vers 10k, ordre d'arrivée relatif des
régions, goulots génétiques), fixés AVANT de regarder les résultats.

**Calibration C 0.4.4 : entraînement 54 %, test 13 %**
v01 (adv 0,3 ; cx_n0 1 500 ; boat_C 0,75) : Levant 100 %, Asie du Sud 67 % (50,5k), Europe 33 %
(69k), Arctique 17 % (48k : atteint dans la fourchette pour la première fois). Test : Chine 50 %,
Japon 17 %, Australie 0 % (24k, trop tard). Les variantes au meilleur test (40 %) n'ont que 25 %
d'entraînement.
Lecture : la correction du bug des cellules vides a fait baisser le test de 40 % à 13 %. Le bug
ralentissait « par accident » une expansion trop rapide ; il ne faut pas regretter ce score.
Il y a une vraie tension : relever le seuil des embarcations ralentit l'Europe (Gibraltar) mais
aussi l'Australie (Wallacea). On ne règle pas l'Australie (test).
Hypothèse testée (0.4.5) : des Néandertaliens culturellement plus riches que les autres
archaïques, plafond `neanderthal_C` sur leur aire connue (≥ 30° N, < 90° E). Essais locaux :
0,1 → comme v01 ; 0,2 → sapiens bloqué au Levant (Asie du Sud seulement vers 10k) ; 0,4–0,5 →
blocage total. Seuil très abrupt, et surtout : dans le modèle, toute l'expansion vers l'Asie passe
par l'aire néandertalienne. La route sud (Arabie → côte iranienne → Indus), une hypothèse majeure
de la littérature, ne fonctionne pas : le sud de l'Arabie est peuplé dès 110k mais rien ne passe
au-delà. Prochain diagnostic (Asie du Sud = entraînement) : pourquoi la route sud échoue.
Calibration exploratoire en attendant : neanderthal_C {0,1 ; 0,13 ; 0,16} × boat_C {0,6 ; 0,75}
× cx_n0 {1 200 ; 1 500 ; 2 000}, bornes vérifiées en local.

**Diagnostic de la route du Sud (vrai climat, adv 0,3 ; cx_n0 1 500 ; boat_C 0,75 ; néandertaliens 0,1)**
Elle fonctionne, mais lentement : Yémen peuplé dès 110k (répertoire ~0,8) → Oman et fond du Golfe
(émergé, Ormuz franchissable à pied dès −22 m) vers 110–100k → côte du Makran vers 90–80k →
Indus vers 70–60k → Inde de l'Ouest vers 60–50k (Asie du Sud atteinte à ~56k, dans la fourchette).
Goulot : Oman et Makran, hyperarides (P ≈ 110 mm, eau 0,16–0,34), capacité ≈ 0,01 hab/km² ; les
réseaux y restent petits, le répertoire s'y érode (0,1–0,4) et la progression prend 40 000 ans.
Les ressources côtières (coquillages, poisson ; amas coquilliers d'Abdur, Érythrée, ~125k) sont au
cœur de l'hypothèse de la route du Sud : le paramètre `marine`, jamais calibré, entre dans
l'espace exploré. Effet de bord connu : il agit aussi sur l'Australie (test), mais il est motivé
par l'Asie du Sud (entraînement).
Le blocage observé avec un plafond néandertalien de 0,2 vient du nord (Mésopotamie, Zagros) : la
route du Sud seule est trop lente pour atteindre l'Inde avant la fin.

**Calibration v2 (méthode)** — les grilles 3×3×2 à 6 mondes avaient trois défauts : optimum au bord,
seuils abrupts mal échantillonnés, trop de hasard avec 6 mondes. Nouvelle méthode, automatique :
1. exploration : 30 points en hypercube latin sur 5 paramètres (adv_max, cx_n0, boat_C,
   neanderthal_C, marine), 5 mondes chacun ;
2. robustesse : les 5 meilleurs sur l'entraînement rejoués sur 15 mondes de plus ; choix final sur
   20 mondes, toujours sur l'entraînement.

**Validation finale pré-enregistrée** (`sim/worldsim/final_validation.py`, fixée le 3 octobre 2026
avant tout résultat la concernant, jamais utilisée pour choisir) : population mondiale de sapiens
à 10k entre 1 et 10 millions ; ordre d'arrivée corrélé à la référence (Kendall ≥ 0,6) ; pas de sortie
générale avant 90k dans plus de 20 % des mondes. À évaluer une seule fois, sur au moins 50 mondes
neufs, quand la V0.3–V0.4 sera figée.

**Calibration v2, tour 1 (0.4.6) — meilleur résultat du projet : entraînement 60 % sur 20 mondes**
Grille resserrée 0.4.5 (pour mémoire) : plafond à 50 % d'entraînement, l'Europe à 92k dans toutes les
variantes ; confirme que le levier néandertalien seul, dans 0,1–0,16, ne suffit pas.
Calibration v2, choix s25 (adv 0,252 ; cx_n0 1 080 ; boat_C 0,845 ; neanderthal_C 0,178 ;
marine 0,073), 20 mondes : Levant 100 %, Asie du Sud 75 % (52,5k), Europe 30 % (56,5k), Arctique 35 %
(45,5k). Test : Chine 55 % (42k), Japon 30 % (37k), Australie 0 % (atteinte dans 75 % des mondes,
mais vers 23k), Amériques jamais. Entraînement 60 %, test 17 %.
Pour la première fois, Europe et Arctique ont des médianes proches de leurs fourchettes, et la
sortie d'Afrique se fait sans date imposée. D'autres variantes ont un meilleur test (s06 : 50 % / 37 %),
mais on choisit sur l'entraînement, sans exception.
Bords touchés : cx_n0 (1 080 pour un minimum de 1 000) et neanderthal_C (0,178 pour 0,18). Tour 2 :
espace élargi dans ces directions (cx_n0 600–1 800, neanderthal_C 0,13–0,28, boat_C 0,7–0,95,
adv_max 0,18–0,4, marine 0,04–0,12). Les valeurs de s25 deviennent les valeurs par défaut du scénario C.

**Australie (test) : tension structurelle, non réglée** — un seuil d'embarcation élevé (0,845) ferme
Gibraltar mais retarde Wallacea. L'archéologie dit pourtant : Wallacea franchie, Gibraltar non. Ce
paradoxe est réel et débattu ; on ne le règle pas sur une région de test.

**Amériques (test) : diagnostic du forçage, pas du modèle** — recherche d'un chemin terrestre libre
de glace depuis l'Alaska, sur les données Beyer à 1° et notre géographie : aucun jusqu'à 14k
(latitude la plus au sud atteignable : 53,5–55,5° N), un chemin à partir de 13k (corridor libre de
glace). La route côtière du Pacifique (~16k) n'existe pas à cette résolution sans embarcations.
Avec une fin de simulation à 10k, la cible « Amérique du Nord 24–13k » est quasi inatteignable par
construction. Aucune modification : c'est une limite de résolution du forçage, à documenter dans
la validation finale.

**Transparence sur la validation pré-enregistrée** — le log du run de démonstration s25 (seed 1)
affiche la population finale (11,7 millions, au-dessus de la fourchette 1–10 millions). Ce diagnostic
existait avant le pré-enregistrement. On l'a donc vu pour UN monde ; les critères restent inchangés
et ne serviront à aucun réglage.

**Calcul sur machine personnelle (0.4.7)** — quota GitHub Actions épuisé (dépôt privé, 2 000 min/mois).
Choix : runner auto-hébergé sur l'ordinateur de l'utilisateur (gratuit, dépôt reste privé).
`scripts/calibrate_local.py` exécute la même calibration v2 en parallèle sur les cœurs de la machine ;
workflow `calibrate-local` (runs-on: self-hosted, commandes compatibles Windows/macOS/Linux) ;
données conservées hors du dépôt (`WORLDSIM_DATA`). Sécurité : garder le dépôt privé tant qu'un
runner personnel y est attaché.
Runner Windows : la résolution DNS a échoué au téléchargement d'ETOPO (réseau instable), alors que
pip venait de fonctionner. Pour ne plus dépendre du réseau pendant les calculs, les données d'entrée
sont désormais stockées dans le dépôt privé (`sim/data` : relief ETOPO 10′, 4,7 Mo ; climat Beyer
compact à 1°, 10,9 Mo). La calibration locale utilise donc la version compacte du climat (précision
float16, différences négligeables avec le netCDF). `fetch_data.py` réessaie 5 fois en cas d'échec.

**Calibration v2, tour 2 — fin de la calibration de la V0.3–V0.4 (dépôt passé en public)**
Choix s23 (adv 0,302 ; cx_n0 985 ; boat_C 0,939 ; neanderthal_C 0,241 ; marine 0,052), 20 mondes :
Levant 100 %, Asie du Sud 75 % (53,8k), Europe 60 % (46k), Arctique 55 % (38,5k) → entraînement 72 %.
Test : Chine 60 % (43,5k), Japon 45 % (33k), Australie 0 % (atteinte dans 30 % des mondes, ~20k),
Amériques jamais → test 21 %.
Europe et Arctique ont désormais des médianes DANS leurs fourchettes : sortie d'Afrique, arrivée en
Europe et colonisation de l'Arctique émergent du climat, de la démographie et de la culture.
Limite assumée : boat_C = 0,939 colle au bord haut de l'espace, c'est-à-dire « presque pas de
navigation ». L'entraînement pousse vers un monde sans bateaux pour fermer Gibraltar, ce que
contredit la colonisation de Sahul. Le modèle n'a qu'un seuil de navigation mondial ; la
navigation liée aux environnements côtiers et insulaires relève de la V0.7 (transport), pas d'un
réglage. On n'élargit pas l'espace au-delà : ce serait supprimer les bateaux.
Décision : la calibration de cette étape est close. s23 devient le réglage figé du scénario C
(moteur 0.4.9). Prochaine et unique étape avant la V0.5 : la validation finale pré-enregistrée sur
50 mondes neufs (seeds 1001–1050), workflow `validate`, lancée une seule fois ; son résultat sera
consigné tel quel.
