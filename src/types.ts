// ---------------------------------------------------------------------------
// Types partagés — schéma d'une écriture comptable et des étapes de l'agent.
// ---------------------------------------------------------------------------

/** Un mouvement sur un compte (une ligne du grand-livre). */
export interface LigneEcriture {
  compte: string; // ex. "607000", "445660", "401000"
  libelle: string;
  debit: number; // 0 si c'est un crédit
  credit: number; // 0 si c'est un débit
}

/** Ventilation d'un montant de TVA pour un taux donné. */
export interface TvaParTaux {
  taux: number; // 20, 10, 5.5, 2.1
  montant: number;
}

/** Champs extraits d'une facture (sortie de extract_invoice_fields). */
export interface ExtractedFields {
  fournisseur: string | null;
  siren: string | null;
  tvaIntra: string | null;
  dateFacture: string | null; // ISO "2026-05-12"
  numeroFacture: string | null;
  montantHT: number | null;
  tvaParTaux: TvaParTaux[];
  montantTTC: number | null;
  paysFournisseur: string | null; // "FR", "DE"... utile pour l'autoliquidation
  designation: string | null; // libellé produit/prestation, sert à classer la charge
  champsManquants: string[];
  sourceFile: string;
}

export type CodeAnomalie =
  | "SIREN_INVALIDE"
  | "TVA_INCOHERENTE"
  | "TTC_INCOHERENT"
  | "DOUBLON"
  | "MENTION_MANQUANTE"
  | "COMPTE_AMBIGU"
  | "TVA_NON_DEDUCTIBLE"
  | "TVA_A_VERIFIER"
  | "IMMOBILISATION"
  | "AUTOLIQUIDATION"
  | "CHAMP_CRITIQUE_MANQUANT";

export interface Anomalie {
  code: CodeAnomalie;
  gravite: "bloquante" | "avertissement";
  message: string;
}

export type StatutValidation = "valide" | "avertissement" | "invalide";
export type StatutRoutage = "auto-valide" | "a-revoir";

/** Résultat de validate_invoice. */
export interface ValidationResult {
  statut: StatutValidation;
  anomalies: Anomalie[];
}

/** Traitement TVA retenu pour l'écriture (décision comptable auditable). */
export interface TvaTreatment {
  tauxDeductibilite: number; // 1 | 0.8 | 0 — prorata de déduction
  compteTva: string | null; // 445660 (B&S), 445620 (immo), ou null si taux = 0
  motif: string;
}

/** L'écriture proposée, cœur du livrable. */
export interface Ecriture {
  id: string;
  journal: "ACH";
  date: string | null;
  numeroPiece: string | null;
  libelle: string;
  lignes: LigneEcriture[];
  totalDebit: number;
  totalCredit: number;
  equilibre: boolean;
}

/** Résultat de propose_ecriture. */
export interface PropositionResult {
  ecriture: Ecriture;
  confidence: number; // 0..1
  justification: string;
  compteCharge: string;
  estImmobilisation: boolean;
  tvaTreatment: TvaTreatment;
}

/** Résultat de route_by_confidence. */
export interface RoutageResult {
  statut: StatutRoutage;
  motif: string;
}

/** Enregistrement final consolidé d'une facture traitée (une ligne du journal). */
export interface DossierFacture {
  id: string;
  sourceFile: string;
  fields: ExtractedFields;
  validation: ValidationResult;
  proposition: PropositionResult;
  routage: RoutageResult;
  // Miroir aplati pour le dashboard :
  statut: StatutRoutage;
  confidence: number;
  anomalies: Anomalie[];
  ecriture: Ecriture;
  justification: string;
  motifRoutage: string;
}

export interface BatchResult {
  generatedAt: string;
  mode: "deterministe" | "agent";
  totalFactures: number;
  autoValides: number;
  aRevoir: number;
  totalDebit: number;
  totalCredit: number;
  dossiers: DossierFacture[];
}
