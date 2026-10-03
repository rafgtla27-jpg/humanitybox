# WORLD_SIM — Roadmap maître

Source de vérité du projet (dépôt GitHub `humanitybox`). Une copie vit dans le skill Claude
`world-sim`. Toute modification se fait ici d'abord, puis le skill est régénéré.

Sommaire : 1. Vision · 2. Principes · 3. Versions (piste simulation + piste visuelle) ·
4. Registre complet des idées (rien n'est perdu) · 5. Stack · 6. Origine des idées

---

## 1. Vision

Un **laboratoire d'émergence historique** : lancer 100 mondes et obtenir des trajectoires
différentes (pas d'agriculture, plusieurs foyers agricoles, sociétés maritimes dominantes,
industrialisation ailleurs, effondrements, quelque chose qui ressemble à notre monde), et pouvoir
toujours dire : « je comprends pourquoi cela s'est produit ».

Boucle causale visée : monde physique → ressources → organismes → contraintes → comportement →
sélection → connaissance → société → transformation du monde → nouvelles contraintes.

Chemin : **Terre réelle → humains → validation → complexification → planètes procédurales.**
La vision complète (section 4) reste l'objectif ; l'ordre de construction (section 3) est ce qui
permet d'y arriver.

## 2. Principes directeurs

1. Toute cause importante doit être explicable ; toutes ne doivent pas être simulées depuis les
   premiers principes (la température peut venir d'un jeu de données).
2. Pas de script événementiel ni de bonus arbitraire (`coastalBonus = 1.25` interdit) : effets
   via ressources, coûts, flux. Les règles conditionnelles (préconditions de l'agriculture, etc.)
   sont assumées comme des règles écrites, pas présentées comme « émergence pure ».
3. Forçages issus de reconstructions indépendantes, jamais réglés pour obtenir le bon résultat.
4. Calibrer sur un jeu d'observations, valider sur un autre.
5. Cibles = fourchettes ; résultats = distributions sur des ensembles de seeds (P(x | conditions)).
6. La contingence doit venir de mécanismes explicites, pas seulement du seed.
7. Un flux aléatoire par processus ; déterminisme par seed.
8. Simulation LOD ≠ rendu LOD. Le web lit des résultats, il n'en produit pas.
9. Aucune couche ne doit bloquer l'apparition d'humains à l'écran.
10. Chaque version livre quelque chose de **visible** et de **vérifiable**.

## 3. Versions

Chaque version a deux livrables : la simulation et son rendu. Le rendu n'attend jamais la fin
du projet.

| Version | Monde | Humains | Objectif / validation | Rendu livré | État |
|---|---|---|---|---|---|
| V0.0 | Terre réelle (ETOPO) | aucun | pipeline géospatial | carte 2D | ✅ |
| V0.1 | Terre paléo paramétrique | cohortes | dispersion, niveau marin | GIF + viewer web, frise | ✅ |
| V0.2 | Terre paléo Beyer 2020 | cohortes + archaïques | dates d'arrivée vs archéologie | **globe 3D** (R1, livré en avance) + calques climat | ✅ résultats lus (voir DECISIONS) |
| V0.3 | idem | ✅ eau douce + rivières émergentes, ✅ adaptation au froid culturelle, ✅ contingence explicite (bruit démographique, pionniers) ; à faire : calibration, refuges, goulots | ✅ P(arrivée) sur ensembles ; ✅ calibration v2 (hypercube latin + confirmation sur 20 mondes, entraînement/test séparés) ; ✅ validation finale pré-enregistrée ; meilleur résultat : entraînement 60 % / test 17 % sur 20 mondes (s25) | ✅ rivières, calque culture, distributions dans /labo | 🔧 en cours |
| V0.4 | −120k → −5k | ✅ complexité culturelle liée au réseau social (Henrich, Powell 2009), ✅ avantage compétitif émergent (scénario C) ; à faire : graphe de savoirs, oubli d'innovations précises | sortie d'Afrique ~60k sans α fixé à la main (calibration C en cours) | ✅ calque « Complexité culturelle » ; à faire : timeline des savoirs | 🔧 commencée |
| V0.5 | Holocène | plantes/animaux exploitables (traits), domestication | P(agriculture) par foyer (Croissant fertile, Chine, Mésoamérique, Andes, Nouvelle-Guinée, Sahel) | carte des foyers + probabilités | ⏳ |
| V0.6 | Holocène + sols (SoilGrids comme ancre) | stockage, sédentarisation, villages, maladies (zoonoses) | densités, croissance post-agricole | **carte stratégique** (R2) : villages, réseaux | ⏳ |
| V0.7 | Terre réelle | réciprocité → échange → monnaie, conflits sous contrainte, transport à coûts | commerce sur axes peu coûteux, villes après surplus | routes, frontières culturelles | ⏳ |
| V0.8 | Terre réelle | institutions comme technologies sociales, coordination capacity, écriture par besoin | diversité des trajectoires politiques | vue « pourquoi ? » (graphe causal) | ⏳ |
| V1.0 | Terre réelle | système humain complet jusqu'à l'énergie fossile, transition démographique | ordres de grandeur crédibles sur toute l'histoire | **zoom local voxels** (R3) | ⏳ |
| V2.0 | planète procédurale | même moteur humain | générateurs validés contre la Terre ; contrefactuels | globe de mondes alternatifs | ⏳ |
| V2+ | physique planétaire dynamique | — | tectonique, magnétosphère, O₂, évolution des lignées | — | ⏳ |

### Piste visuelle (rendu LOD)

- **R0 — Carte 2D** (fait) : population, glaces, côtes, frise niveau marin, validation par région.
- **R1 — Globe 3D** (fait, v0.2.2 ; plein écran sur fond spatial en v0.3.0, page `/labo` pour l'analyse) : Three.js, même texture que R0, calques Humains /
  Température / Précipitations / Productivité, rotation et zoom, défilement du temps.
  À venir : relief (displacement), biomes, comparaison de deux runs.
- **R2 — Carte stratégique** (V0.6–V0.7) : villages, routes commerciales, frontières culturelles
  (langue, génétique), flux.
- **R3 — Zoom local** (V1.0) : tuiles/voxels 3D avec `InstancedMesh`, tilt-shift, rendu direct
  des couches (sécheresse qui craquelle le sol, feu qui carbonise les arbres). Exige des données
  locales (végétation, sols, structures) qui n'existent qu'à partir de V0.6.

### Piste sprites (personnages à l'écran)

Règle : une silhouette ne montre jamais plus que ce que le moteur simule. Tant qu'il n'y a pas
d'agents, une silhouette représente un effectif ; elle ne prend pas de décisions.

- **S1 — Silhouettes de groupes** (fait, viewer 0.3.2) : une silhouette = S personnes (25 à
  10 000 selon la population mondiale, au plus 30 000 silhouettes), position stable dans sa
  cellule, apparition quand on zoome, sol de végétation sous les humains. Mouvement sur place
  décoratif.
- **S2 — Camps et villages** (V0.6) : silhouettes typées (chasseurs-cueilleurs, agriculteurs),
  structures (campements, huttes, greniers) quand la sédentarisation existe dans le moteur.
- **S3 — Agents réels dans la zone regardée** (V0.7–V0.8, résolution adaptative) : la cohorte se
  décompose en groupes puis en individus là où l'on zoome ; trajets réels, caravanes sur les
  routes, conflits visibles.
- **S4 — Zoom local animé** (V1.0, avec R3) : personnages sur tuiles/voxels, activités
  (chasse, récolte, construction) tirées de la simulation.

### Expériences de référence

- **#001** dispersion 120k → 10k BP (en cours). Contrefactuels prévus : #002 mer +20 m,
  #003 Sahara +20 % d'humidité, #004 pas de pont de Béringie, #005 autre cycle glaciaire,
  #1000 planète procédurale.

## 4. Registre complet des idées

Rien n'est abandonné : chaque idée a une version cible. « Gén. » = utilisé à la génération de
planètes procédurales plutôt que simulé en continu.

### Noyau de simulation
| Idée | Cible | État |
|---|---|---|
| Boucle State → Processes → Flux → Events → State | V0.1 | partiel (processus + événements) |
| Unités physiques communes, conservation masse/énergie quand pertinent | V0.3 | conservation migration testée |
| RNG déterministe par seed, un flux par processus | V0.1 | ✅ |
| Scheduler multi-échelle (heures → temps géologique) | V0.1 | ✅ (années → siècles) |
| Snapshots, rewind/replay | V0.3 | snapshots ✅ |
| Historique causal / graphe de causalité (« pourquoi ? ») | V0.3 → V0.8 | journal d'événements ✅ |
| Hiérarchie spatiale Planète/Région/Cellule/Patch, résolution adaptative (cohortes ↔ groupes ↔ agents) | V0.6 → V1.0 | cohortes ✅ |
| Path dependence (état historique, pas seulement conditions actuelles) | V0.4 | ✅ partiel : répertoires culturels hérités et transportés |
| Métriques de validation automatiques (T, P, glace, biomasse, population, espérance de vie, énergie/capita…) | continu | dates d'arrivée ✅ |
| Simulation contrefactuelle par seed et paramètres | V0.3 | ✅ ensembles parallèles |

### Planète physique
| Idée | Cible | État |
|---|---|---|
| Noyau, dynamo, magnétosphère | V2+ / gén. | — |
| Tectonique exacte (subduction : fosses, volcans ; divergence : dorsales, rifts) | V2 gén. | — |
| Mécanique céleste : lune, marées, éclipses (interprétées si capacité d'abstraction) | V0.8 (éclipses → croyances), V2 | — |
| Impacts météoritiques, fer météoritique | V2 | — |
| Atmosphère dynamique (ouragans, moussons, ENSO émergents) | V2 (données en V0–V1) | indice de mousson provisoire |
| Cycle hydrologique complet (évapotranspiration, nappes, fonte, méandres) | V0.3 (rivières), V0.6, V2 | rivières émergentes + Budyko ✅, ressources fluviales ✅ (0.4.3) |
| Cycle du carbone ; dérèglement par énergie fossile | V1.0 | — |
| Cycles de Milankovitch, glaciations, ponts terrestres | V0.1 (données) / V2 (gén.) | ✅ via niveau marin |
| Niveau marin dynamique (glace ↑ mer ↓, dilatation) | V0.1 | ✅ |
| Chimie planétaire : O₂ variable | V2+ | — |
| Azote, phosphore, potassium, C organique | V0.6 | — |
| Océan vivant (T, salinité, nutriments, O₂ dissous, courants, upwellings, productivité) | V0.6 (ressource côtière), V0.7 (navigation) | ressource côtière forfaitaire |
| Volcans (fertilisation, VEI, refroidissement) | V0.5 | — |

### Sols et ressources
| Idée | Cible | État |
|---|---|---|
| Pédologie : profondeur, pH, NPK, argile/limon/sable, humidité, matière organique, salinité, T | V0.6 (SoilGrids ancre) | — |
| Épuisement, salinisation par irrigation, fertilisation par crues/volcans | V0.6–V0.7 | — |
| Ressources par qualité/accessibilité (profondeur, pureté, coût énergétique) | V0.7 | — |
| Couche d'habitabilité / attractivité (eau, calories, T, sécurité, capacité de charge) | V0.1 | ✅ partiel |

### Biosphère
| Idée | Cible | État |
|---|---|---|
| Organismes par traits (plantes : froid, rendement, graine ; animaux : masse, régime, sociabilité, agressivité) | V0.5 | — |
| Chaîne trophique, dynamique de populations animales | V0.5 | — |
| Domestication émergente (animal social + humains sédentaires stockant) | V0.5 | — |
| Feu (foudre, clairières), microbiome des sols | V0.6 | — |
| Épidémiologie, zoonoses, diffusion par routes, villes pièges jusqu'à l'hygiène | V0.6–V0.7 | — |
| Extinctions causées par l'homme (chasse > reproduction), cascades trophiques | V0.5 (mégafaune) | — |

### Humains : biologie et cognition
| Idée | Cible | État |
|---|---|---|
| Besoins physiologiques (calories, protéines, eau, chaleur, sommeil) | V0.3 | froid ✅, eau ✅ |
| Génétique humaine (traits continus, dérive, adaptation au biome) | V0.4 | — |
| Évolution des lignées intelligentes (cerveau coûteux, néoténie, enfance, imitation…) | extension V2+ | — |
| Longue enfance et boucle cognition ↔ culture | V0.4 | — |
| Sélection sexuelle | V0.4 (simplifiée) | — |
| Coopération, triche, punition, passager clandestin | V0.6 | — |
| Mémoire collective locale / carte mentale imparfaite | V0.7 | — |
| Monde perçu ≠ monde réel (PERCEIVED_WORLD_STATE) | V0.7 | — |
| Autres humains (Néandertaliens, Dénisoviens) et compétition | V0.2 | ✅ α émergent de la complexité culturelle (0.4.0) |

### Culture et technique
| Idée | Cible | État |
|---|---|---|
| Cognition par préconditions (agriculture, poterie), pas d'arbre technologique | V0.4–V0.5 | — |
| Culture cumulative : inventer, imiter, mal copier, améliorer, combiner, oublier | V0.4 | premier trait (froid) ✅ |
| Graphe de connaissances dynamique (recombinaisons, outil composite) | V0.4 | — |
| Oubli technologique (praticiens → 0) | V0.3–V0.4 | ✅ pour l'adaptation au froid |
| Innovation = recherche dans un espace de solutions, évolution darwinienne des objets (Tool{material, geometry…}) | V0.4 → V1.0 | — |
| Énergie par capita comme fil conducteur (muscle → bois → animal → vent/eau → charbon → pétrole → atome) | V0.6 → V1.0 | — |
| Langues : dérive, contact, créoles | V0.6 | — |
| Écriture émergeant d'un besoin (stocks, dette, impôt) | V0.8 | — |
| Information : géographie et vitesse (oral → messagers → … → Internet), rumeurs | V0.7 → V1.0 | — |

### Sociétés, économie, politique
| Idée | Cible | État |
|---|---|---|
| Stockage (production → stock → consommation future) | V0.6 | — |
| Surplus et division du travail | V0.6 | — |
| Économie avant l'argent : réciprocité → troc → monnaie-marchandise → crédit, prix, marchés, banques | V0.7 | — |
| Transport : coût dépendant de la technologie (pied, cheval, bateau) → routes, cols, ports, villes | V0.7 | coût du relief ✅, embarcations liées au répertoire ✅ (0.4.3) |
| Réseaux commerciaux physiques (masse, volume, valeur, périssabilité, danger) | V0.7 | — |
| Moteur social : parenté, dette, confiance | V0.6 | — |
| Institutions comme technologies sociales (propriété, contrats, justice, armée, impôt, succession) | V0.8 | — |
| Pression institutionnelle → chefferie, conseil, coalition, bureaucratie, réseau ; l'État n'est pas obligatoire | V0.8 | — |
| Coordination capacity | V0.8 | — |
| Conflits sous contrainte (densité × fertilité × eau) | V0.7 | compétition archaïques ✅ |
| Urbanisation émergente (densité + surplus + accessibilité + commerce + sécurité) | V0.7 | — |
| Transition démographique | V1.0 | — |
| Écologie anthropique (déforestation, irrigation, barrages, mines, pollution, invasives, artificialisation) | V0.6 → V1.0 | — |

## 5. Stack

- **GitHub** (`humanitybox`) : code, CI (`ci.yml`), calcul (`simulate.yml`, jusqu'à 6 h par job).
- **Supabase** : runs, résultats par région, événements (Postgres, RLS lecture publique) ; frames
  et manifests (Storage, bucket `runs`). Écriture par la CI uniquement (service_role).
- **Vercel** : viewer Next.js (`web/`), lecture seule avec la clé anon. Aucune simulation.
- Moteur : Python + numpy (`sim/`), grille 1°, ~30–50 s pour 110 000 ans sur un CPU.
- Données : ETOPO1 10' (relief), Beyer et al. 2020 via pastclim/Zenodo 7388091 (climat, NPP,
  biomes, glaces), plus tard SoilGrids, ICE-6G si besoin.

## 6. Origine des idées

- Plan Maître initial (phases 0–7 : moteur causal, genèse, machine thermique, peau de la Terre,
  biosphère, moteur humain, culture et société, rendu LOD).
- Ajouts ChatGPT (kernel, points 1–30, ordre de développement, architecture, objectif des
  100 mondes).
- Critique Claude : échelles de temps, Terre réelle d'abord, calibration ≠ validation,
  contradiction émergence pure / réalisme.
- Corrections ChatGPT : `EarthState(t)`, sols actuels ≠ sols passés, P(agriculture | conditions),
  table de versions, principe « cause explicable ».
- Résultats d'expériences (voir `docs/DECISIONS.md`).
