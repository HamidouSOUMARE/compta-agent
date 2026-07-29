// ---------------------------------------------------------------------------
// Paramètres métier : plan comptable, seuils, taux de TVA, règles de
// classification et de déductibilité. Tout est centralisé et auditable ici.
// ---------------------------------------------------------------------------

/** Comptes de contrepartie et de TVA. */
export const COMPTES = {
  fournisseur: "401000",
  tvaDeductibleBS: "445660", // TVA déductible sur biens et services
  tvaDeductibleImmo: "445620", // TVA déductible sur immobilisations
  // --- Autoliquidation intracommunautaire (achat de service UE sans TVA facturée) ---
  tvaDueIntracom: "445200", // 4452 — TVA due intracommunautaire (collectée par le preneur)
  tvaDeductibleIntracom: "445662", // TVA déductible intracom (sous-compte de 44566, cohérent avec 445660)
} as const;

/**
 * Taux normal reconstitué pour une prestation intracommunautaire : la facture
 * intracom ne porte PAS de TVA (HT seul), on doit donc reconstituer le taux
 * applicable pour autoliquider. Défaut = taux normal 20 %. Paramétrable car
 * certaines prestations intracom relèvent d'un taux réduit — la mécanique ne
 * doit pas être figée à 20 %.
 */
export const TAUX_NORMAL_INTRACOM = 0.2;

/** Taux de TVA valides en France (en %). */
export const TAUX_TVA_VALIDES = [20, 10, 5.5, 2.1] as const;

/** Taux "courant" — les autres taux valides baissent légèrement la confiance. */
export const TAUX_TVA_COURANT = 20;

/** Seuil d'immobilisation : ligne dure à 500 € HT (tolérance BOI-BIC-CHG-20-30-10). */
export const SEUIL_IMMOBILISATION_HT = 500;

/** Montant à partir duquel le n° de TVA intra du fournisseur est obligatoire. */
export const SEUIL_MENTION_TVA_INTRA = 150;

/** Seuil d'auto-validation par défaut (score de confiance). */
export const SEUIL_AUTO_VALIDATION = 0.85;

/**
 * Règles de classification de la charge par mots-clés (ordre = priorité).
 * `immo` indique un compte d'immobilisation (classe 2) ; `transportImmo`
 * force l'immobilisation quel que soit le montant (matériel de transport).
 */
export interface RegleCompte {
  compte: string;
  libelle: string;
  motsCles: string[];
  immo?: boolean;
  transportImmo?: boolean; // toujours immobilisé, la tolérance 500 € ne s'applique pas
}

export const REGLES_COMPTE: RegleCompte[] = [
  // --- Immobilisations (classe 2) ---
  {
    compte: "218200",
    libelle: "Matériel de transport",
    motsCles: ["véhicule", "vehicule", "voiture", "camion", "remorque", "utilitaire", "transport"],
    immo: true,
    transportImmo: true,
  },
  {
    compte: "218300",
    libelle: "Matériel informatique et de bureau",
    motsCles: ["ordinateur", "informatique", "serveur", "pc", "portable", "écran", "ecran", "imprimante"],
    immo: true,
  },
  {
    compte: "218400",
    libelle: "Mobilier",
    motsCles: ["mobilier", "meuble", "chaise", "chaises", "bureau", "fauteuil", "armoire", "étagère", "etagere"],
    immo: true,
  },
  // --- Charges (classe 6) ---
  {
    compte: "607000",
    libelle: "Achats de marchandises",
    motsCles: ["marchandise", "marchandises", "revente", "grossiste", "stock"],
  },
  {
    compte: "613000",
    libelle: "Locations",
    motsCles: ["loyer", "location", "bail", "crédit-bail", "credit-bail", "leasing"],
  },
  {
    compte: "615000",
    libelle: "Entretien et réparations",
    motsCles: ["entretien", "réparation", "reparation", "maintenance", "dépannage", "depannage"],
  },
  {
    compte: "622600",
    libelle: "Honoraires",
    motsCles: ["honoraires", "expert-comptable", "expert comptable", "avocat", "conseil", "notaire", "prestation intellectuelle"],
  },
  {
    compte: "625700",
    libelle: "Réceptions, missions, déplacements",
    motsCles: ["restaurant", "restauration", "réception", "reception", "repas", "hôtel", "hotel", "déplacement", "deplacement", "mission"],
  },
  {
    compte: "626000",
    libelle: "Frais postaux et télécommunications",
    motsCles: ["télécom", "telecom", "téléphone", "telephone", "internet", "mobile", "affranchissement", "poste", "abonnement"],
  },
  {
    compte: "606400",
    libelle: "Achats non stockés (fournitures, énergie)",
    motsCles: [
      "fourniture", "fournitures", "papeterie", "énergie", "energie", "électricité", "electricite",
      "edf", "gaz", "carburant", "essence", "gazole", "diesel", "péage", "peage",
    ],
  },
];

/** Compte de charge par défaut si aucune règle ne matche (déclenche COMPTE_AMBIGU). */
export const COMPTE_CHARGE_DEFAUT = "606400";

// ---------------------------------------------------------------------------
// Déductibilité de la TVA — PRORATA déterministe (1 | 0,8 | 0), pas un booléen.
// La part non déductible (TVA × (1 − taux)) est réintégrée au coût de la charge.
// ---------------------------------------------------------------------------

/** Carburants (essence ET gazole alignés depuis 2022) : 80 % VP, 100 % VU. */
export const MOTS_CARBURANT = [
  "carburant", "essence", "sans plomb", "sp95", "sp98", "gazole", "gasoil", "diesel",
];
/** Véhicule utilitaire (VU) : carburant déductible à 100 %. */
export const MOTS_VEHICULE_UTILITAIRE = [
  "utilitaire", "véhicule utilitaire", "vehicule utilitaire", "fourgon", "camionnette", " vu ",
];
/** Véhicule de tourisme (VP) : carburant à 80 %, le véhicule lui-même à 0 %. */
export const MOTS_VEHICULE_TOURISME = [
  "véhicule de tourisme", "vehicule de tourisme", "voiture particulière", "voiture particuliere", "tourisme", " vp ",
];
/** Énergies de recharge (électrique, GPL, GNV) : TVA déductible à 100 % tous véhicules. */
export const MOTS_RECHARGE = ["recharge", "électrique", "electrique", "borne", "gpl", "gnv"];
/** Péage / stationnement d'un véhicule pro : 100 % (règle propre, pas le 80 % carburant). */
export const MOTS_PEAGE_PARKING = ["péage", "peage", "parking", "stationnement"];
/** Hébergement des dirigeants / salariés : TVA non déductible (0 %). */
export const MOTS_HEBERGEMENT = ["hébergement", "hebergement", "hôtel", "hotel", "nuitée", "nuitee"];
/** Cadeaux au-delà du seuil unitaire (~73 € TTC/an/bénéficiaire) : 0 %. */
export const MOTS_CADEAU = ["cadeau", "cadeaux"];

/**
 * TVA déductible SOUS CONDITIONS (repas d'affaires / réception) : prorata 100 %
 * mais la pièce part "à revoir" (conditions à vérifier).
 */
export const MOTS_CLES_TVA_A_VERIFIER = [
  "restaurant", "restauration", "réception", "reception", "repas",
];

/** Pénalités de confiance (soustraites à 1.0). */
export const PENALITES_CONFIANCE = {
  compteAmbigu: 0.2,
  tauxTvaInhabituel: 0.1,
  avertissement: 0.15,
  immobilisationAmbigue: 0.15,
} as const;
