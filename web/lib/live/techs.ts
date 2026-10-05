/**
 * Graphe des savoirs (V0.4 « culture cumulative » de la roadmap, version jeu).
 *
 * Pas un arbre à débloquer avec des points : chaque savoir est un TRAIT des populations (maîtrise
 * 0 → 1), qui apparaît là où ses préalables sont maîtrisés, où l'environnement le permet (minerai,
 * fleuve, côte, steppe, argile…) et où le besoin se fait sentir (froid, aridité, densité). Il se
 * transmet de voisin en voisin, et se PERD quand le groupe devient trop petit ou trop isolé pour
 * l'entretenir (effet « Tasmanie »). Ses effets passent par les causes du modèle : capacité
 * d'accueil, croissance, déplacements, navigation, taille des ensembles politiques.
 */
export type Ctx = {
  T: number; P: number; river: number; arch: number; coast: boolean; ore: number; steppe: number;
  density: number; net: number; C: number; agri: number; pop: number;
};

export type Tech = {
  id: string; name: string; era: 0 | 1 | 2 | 3 | 4; pre: string[];
  /** facteur d'opportunité 0..1 (environnement, besoin) */
  cond: (c: Ctx) => number;
  rate: number;        // probabilité d'invention par an et par cellule quand tout est réuni
  minNet: number;      // réseau social nécessaire pour l'entretenir
  desc: string;
};

export const ERAS = ["Paléolithique", "Néolithique", "Âge des cités", "Âge des royaumes", "Âge moderne"];

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const TECHS: Tech[] = [
  // --- Paléolithique
  { id: "fire", name: "Maîtrise du feu", era: 0, pre: [], cond: () => 1, rate: 0, minNet: 0, desc: "Connue de tous dès le départ." },
  { id: "stone", name: "Pierre taillée", era: 0, pre: [], cond: () => 1, rate: 0, minNet: 0, desc: "Connue de tous dès le départ." },
  { id: "sewing", name: "Aiguille et vêtements cousus", era: 0, pre: ["stone"], cond: (c) => clamp((8 - c.T) / 15), rate: 4e-6, minNet: 300, desc: "Naît du froid ; renforce l'adaptation au froid." },
  { id: "bow", name: "Arc et flèches", era: 0, pre: ["stone"], cond: (c) => clamp(c.C - 0.3), rate: 2e-6, minNet: 400, desc: "Chasse plus efficace : +15 % de ressources sauvages." },
  { id: "fishing", name: "Harpon et pêche", era: 0, pre: ["stone"], cond: (c) => Math.max(c.coast ? 1 : 0, c.river), rate: 3e-6, minNet: 300, desc: "Sur les côtes et les fleuves : +30 % de ressources aquatiques." },
  { id: "canoe", name: "Pirogue", era: 0, pre: ["fishing"], cond: (c) => clamp(c.arch / 0.15), rate: 3e-6, minNet: 600, desc: "Archipels : traverser les bras de mer." },
  { id: "pottery", name: "Poterie", era: 0, pre: ["fire"], cond: (c) => clamp(c.river + (c.P > 300 ? 0.3 : 0)) * clamp(c.C - 0.4), rate: 2e-6, minNet: 800, desc: "Cuire l'argile : conserver, cuisiner, stocker." },
  // --- Néolithique
  { id: "agri", name: "Domestication des plantes", era: 1, pre: ["stone"], cond: () => 0, rate: 0, minNet: 0, desc: "Émerge du potentiel agricole et du climat stable (moteur principal)." },
  { id: "herding", name: "Élevage", era: 1, pre: ["agri"], cond: (c) => Math.max(c.steppe, c.agri * 0.5), rate: 6e-6, minNet: 800, desc: "Steppes et prairies : ×1,5 sur les terres d'herbe." },
  { id: "storage", name: "Greniers et stockage", era: 1, pre: ["agri", "pottery"], cond: (c) => c.agri, rate: 8e-6, minNet: 1000, desc: "Amortit les famines : les populations s'effondrent moins." },
  { id: "weaving", name: "Tissage", era: 1, pre: ["agri"], cond: (c) => Math.max(c.agri, c.steppe) * 0.8, rate: 6e-6, minNet: 1000, desc: "Fibres et laine ; ouvre la voile." },
  { id: "irrigation", name: "Irrigation", era: 1, pre: ["agri"], cond: (c) => c.river * clamp((700 - c.P) / 500), rate: 8e-6, minNet: 2000, desc: "Fleuves des zones sèches : ×1,6 sur les champs." },
  { id: "plough", name: "Araire", era: 1, pre: ["agri", "herding"], cond: (c) => c.agri, rate: 5e-6, minNet: 2000, desc: "Labourer avec des bêtes : +40 % de récoltes." },
  { id: "wheel", name: "Roue", era: 1, pre: ["herding", "agri"], cond: (c) => clamp(c.density / 0.5), rate: 3e-6, minNet: 3000, desc: "Transports : déplacements +30 %, ensembles plus grands." },
  { id: "copper", name: "Cuivre", era: 1, pre: ["pottery", "agri"], cond: (c) => c.ore, rate: 4e-6, minNet: 3000, desc: "Fours de potier et minerai des montagnes." },
  // --- Âge des cités
  { id: "bronze", name: "Bronze", era: 2, pre: ["copper"], cond: (c) => c.ore * clamp(c.density / 0.8), rate: 3e-6, minNet: 6000, desc: "Alliage cuivre-étain : outils et armes." },
  { id: "writing", name: "Écriture", era: 2, pre: ["storage", "agri"], cond: (c) => clamp(c.density / 1.5) * clamp(c.pop / 4000), rate: 2e-6, minNet: 10000, desc: "Compter les réserves et les dettes : villes et cités-États." },
  { id: "sail", name: "Voile", era: 2, pre: ["canoe", "weaving"], cond: (c) => (c.coast ? 1 : 0), rate: 4e-6, minNet: 5000, desc: "Naviguer loin des côtes." },
  { id: "calendar", name: "Calendrier et mathématiques", era: 2, pre: ["writing"], cond: (c) => c.agri, rate: 4e-6, minNet: 10000, desc: "Prévoir les crues et les saisons." },
  { id: "money", name: "Monnaie", era: 2, pre: ["writing", "bronze"], cond: (c) => clamp(c.density), rate: 4e-6, minNet: 15000, desc: "Échanges et impôts." },
  // --- Âge des royaumes
  { id: "iron", name: "Fer", era: 3, pre: ["bronze"], cond: (c) => c.ore, rate: 3e-6, minNet: 15000, desc: "Outils pour tous : +20 % de récoltes, ensembles plus grands." },
  { id: "roads", name: "Routes", era: 3, pre: ["wheel", "writing"], cond: (c) => clamp(c.density), rate: 4e-6, minNet: 20000, desc: "Relier les provinces." },
  { id: "law", name: "Droit et administration", era: 3, pre: ["writing", "money"], cond: (c) => clamp(c.pop / 6000), rate: 4e-6, minNet: 25000, desc: "Gouverner loin : royaumes." },
  { id: "engineering", name: "Ingénierie (aqueducs, voûtes)", era: 3, pre: ["iron", "calendar"], cond: (c) => clamp(c.density / 1.5), rate: 3e-6, minNet: 30000, desc: "Grandes villes." },
  { id: "mill", name: "Moulin à eau", era: 3, pre: ["engineering"], cond: (c) => c.river, rate: 4e-6, minNet: 30000, desc: "L'énergie de l'eau : +30 % de récoltes." },
  { id: "compass", name: "Navigation hauturière", era: 3, pre: ["sail", "calendar"], cond: (c) => (c.coast ? 1 : 0), rate: 3e-6, minNet: 30000, desc: "Traverser les océans." },
  // --- Âge moderne
  { id: "printing", name: "Imprimerie", era: 4, pre: ["law", "engineering"], cond: (c) => clamp(c.density / 2), rate: 2e-6, minNet: 60000, desc: "Le savoir circule deux fois plus vite." },
  { id: "gunpowder", name: "Poudre", era: 4, pre: ["iron", "calendar"], cond: (c) => clamp(c.density / 2), rate: 2e-6, minNet: 50000, desc: "Armées et États plus grands." },
  { id: "science", name: "Méthode scientifique", era: 4, pre: ["printing"], cond: () => 1, rate: 3e-6, minNet: 80000, desc: "Inventer devient systématique." },
  { id: "medicine", name: "Hygiène et médecine", era: 4, pre: ["science"], cond: () => 1, rate: 6e-6, minNet: 80000, desc: "Moins de morts : la croissance s'accélère." },
  { id: "steam", name: "Machine à vapeur", era: 4, pre: ["science", "iron"], cond: (c) => c.ore, rate: 4e-6, minNet: 100000, desc: "Charbon : l'industrie, ×1,5 sur la production." },
  { id: "electricity", name: "Électricité", era: 4, pre: ["steam"], cond: () => 1, rate: 6e-6, minNet: 150000, desc: "Le monde moderne." },
];

export const TECH_INDEX = new Map(TECHS.map((t, i) => [t.id, i]));
export const NT = TECHS.length;
