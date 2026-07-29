// ---------------------------------------------------------------------------
// Cœur métier (déterministe) : classification de la charge, décision
// d'immobilisation et analyse de déductibilité de la TVA. Source de vérité
// unique partagée par validate_invoice et propose_ecriture.
// ---------------------------------------------------------------------------

import {
  REGLES_COMPTE,
  COMPTE_CHARGE_DEFAUT,
  COMPTES,
  SEUIL_IMMOBILISATION_HT,
  MOTS_CARBURANT,
  MOTS_VEHICULE_UTILITAIRE,
  MOTS_VEHICULE_TOURISME,
  MOTS_RECHARGE,
  MOTS_PEAGE_PARKING,
  MOTS_HEBERGEMENT,
  MOTS_CADEAU,
  MOTS_CLES_TVA_A_VERIFIER,
} from "../config.js";
import type { ExtractedFields } from "../types.js";

function haystack(fields: ExtractedFields): string {
  return `${fields.designation ?? ""} ${fields.fournisseur ?? ""}`.toLowerCase();
}

function matchRule(text: string, motsCles: string[]): boolean {
  return motsCles.some((mc) => text.includes(mc.toLowerCase()));
}

export interface ChargeAnalysis {
  compteCharge: string; // compte finalement retenu (6xx ou 218xxx)
  libelleCompte: string;
  estImmobilisation: boolean;
  /** Immo forcée qui contredit la tolérance 500 € (transport < 500 ou saucissonnage) -> à revoir. */
  immoNonTriviale: boolean;
  compteAmbigu: boolean;
  motif: string;
}

/** Détecte un "saucissonnage" : quantité > 1 dont le total dépasse le seuil. */
function detecteSaucissonnage(text: string, montantHT: number | null): boolean {
  if (montantHT == null || montantHT <= SEUIL_IMMOBILISATION_HT) return false;
  if (/\b(lot|ensemble|aménagement|amenagement)\b/.test(text)) return true;
  const m = text.match(/(\d+)\s*(chaises?|meubles?|bureaux?|fauteuils?|postes?|écrans?|ecrans?)/);
  if (m && Number(m[1]) > 1) {
    const unitaire = montantHT / Number(m[1]);
    return unitaire < SEUIL_IMMOBILISATION_HT; // unités sous le seuil mais ensemble au-dessus
  }
  return false;
}

export function classifyCharge(fields: ExtractedFields): ChargeAnalysis {
  const text = haystack(fields);
  const ht = fields.montantHT;

  // Garde carburant : un consommable (essence/gazole) reste une charge 606400,
  // JAMAIS une immobilisation de transport, même si le libellé cite "véhicule".
  if (matchRule(text, MOTS_CARBURANT)) {
    return {
      compteCharge: COMPTE_CHARGE_DEFAUT,
      libelleCompte: "Carburants (achats non stockés)",
      estImmobilisation: false,
      immoNonTriviale: false,
      compteAmbigu: false,
      motif: `Carburant classé en charge ${COMPTE_CHARGE_DEFAUT} (consommable, non immobilisable).`,
    };
  }

  const matches = REGLES_COMPTE.filter((r) => matchRule(text, r.motsCles));
  const comptesDistincts = new Set(matches.map((r) => r.compte));

  // Aucun mot-clé -> compte par défaut, ambigu.
  if (matches.length === 0) {
    return {
      compteCharge: COMPTE_CHARGE_DEFAUT,
      libelleCompte: "Achats non stockés (par défaut)",
      estImmobilisation: false,
      immoNonTriviale: false,
      compteAmbigu: true,
      motif: `Aucun mot-clé reconnu : classement par défaut en ${COMPTE_CHARGE_DEFAUT} à confirmer.`,
    };
  }

  const principal = matches[0]; // priorité = ordre des règles
  const compteAmbigu = comptesDistincts.size > 1;

  // --- Décision d'immobilisation ---
  const transport = matches.find((r) => r.transportImmo);
  const immoCat = matches.find((r) => r.immo);
  const saucissonnage = detecteSaucissonnage(text, ht);

  let estImmobilisation = false;
  let immoNonTriviale = false;
  let compteCharge = principal.compte;
  let libelleCompte = principal.libelle;
  let motif = `Classé en ${principal.compte} (${principal.libelle}) sur mots-clés.`;

  if (transport) {
    // Matériel de transport : toujours immobilisé, la tolérance 500 € ne s'applique pas.
    estImmobilisation = true;
    compteCharge = transport.compte;
    libelleCompte = transport.libelle;
    immoNonTriviale = ht == null || ht <= SEUIL_IMMOBILISATION_HT;
    motif = immoNonTriviale
      ? `Matériel de transport immobilisé en ${transport.compte} malgré un montant < 500 € (tolérance inapplicable).`
      : `Matériel de transport immobilisé en ${transport.compte}.`;
  } else if (immoCat && saucissonnage) {
    // Ensemble cohérent d'éléments unitaires < 500 € -> apprécier le prix global.
    estImmobilisation = true;
    compteCharge = immoCat.compte;
    libelleCompte = immoCat.libelle;
    immoNonTriviale = true;
    motif = `Ensemble cohérent (saucissonnage) : immobilisé en ${immoCat.compte} d'après le prix global > 500 €.`;
  } else if (immoCat && ht != null && ht > SEUIL_IMMOBILISATION_HT) {
    // Bien durable au-dessus du seuil -> immobilisation claire.
    estImmobilisation = true;
    compteCharge = immoCat.compte;
    libelleCompte = immoCat.libelle;
    motif = `Bien durable > 500 € HT immobilisé en ${immoCat.compte}.`;
  } else if (immoCat) {
    // Bien durable sous le seuil -> tolérance, comptabilisé en charge.
    compteCharge = COMPTE_CHARGE_DEFAUT;
    libelleCompte = "Petit équipement (tolérance < 500 €)";
    motif = `Bien durable ≤ 500 € HT : maintenu en charge (${COMPTE_CHARGE_DEFAUT}) par tolérance.`;
  }

  if (compteAmbigu) {
    motif += ` Plusieurs natures possibles (${[...comptesDistincts].join(", ")}).`;
  }

  return { compteCharge, libelleCompte, estImmobilisation, immoNonTriviale, compteAmbigu, motif };
}

export interface TvaAnalysis {
  tauxDeductibilite: number; // 1 | 0.8 | 0
  aVerifier: boolean;
  compteTva: string | null; // null si taux = 0
  motif: string;
}

/**
 * Analyse la déductibilité de la TVA en PRORATA (déterministe). L'ordre des cas
 * fait foi. `mentionManquante` (fournie par la validation) fait perdre le droit
 * à déduction (0 %).
 */
export function analyseTva(
  fields: ExtractedFields,
  estImmobilisation: boolean,
  mentionManquante: boolean
): TvaAnalysis {
  const text = haystack(fields);
  const compteBase = estImmobilisation ? COMPTES.tvaDeductibleImmo : COMPTES.tvaDeductibleBS;
  const build = (taux: number, motif: string, aVerifier = false): TvaAnalysis => ({
    tauxDeductibilite: taux,
    aVerifier,
    compteTva: taux > 0 ? compteBase : null,
    motif,
  });

  // 1. Mention légale manquante -> perte du droit à déduction.
  if (mentionManquante) return build(0, "TVA non déductible : mention légale obligatoire manquante.");

  // 2. Cadeaux au-delà du seuil unitaire.
  if (matchRule(text, MOTS_CADEAU))
    return build(0, "Cadeaux au-delà du seuil : TVA non déductible (0 %).");

  // 3. Carburant (essence/gazole alignés) : 100 % VU, 80 % VP/non précisé.
  if (matchRule(text, MOTS_CARBURANT)) {
    if (matchRule(text, MOTS_VEHICULE_UTILITAIRE))
      return build(1, "Carburant véhicule utilitaire (VU) : TVA déductible à 100 %.");
    return build(
      0.8,
      "Carburant véhicule de tourisme (VP) : TVA déductible à 80 % (20 % réintégrés au coût)."
    );
  }

  // 4. Recharge électrique / GPL / GNV : 100 % tous véhicules.
  if (matchRule(text, MOTS_RECHARGE))
    return build(1, "Recharge électrique / GPL / GNV : TVA déductible à 100 %.");

  // 5. Péage / stationnement d'un véhicule pro : 100 % (règle propre).
  if (matchRule(text, MOTS_PEAGE_PARKING))
    return build(1, "Péage / stationnement professionnel : TVA déductible à 100 %.");

  // 6. Achat d'un véhicule de tourisme (le véhicule lui-même) : 0 %.
  if (matchRule(text, MOTS_VEHICULE_TOURISME))
    return build(0, "Véhicule de tourisme : TVA non déductible (100 % réintégrée au coût).");

  // 7. Hébergement des dirigeants / salariés : 0 %.
  if (matchRule(text, MOTS_HEBERGEMENT))
    return build(0, "Hébergement dirigeants / salariés : TVA non déductible (0 %).");

  // 8. Restauration / réception (repas d'affaires) : 100 % mais à vérifier.
  if (matchRule(text, MOTS_CLES_TVA_A_VERIFIER))
    return build(1, "TVA déductible sous conditions (restauration / réception) : à vérifier.", true);

  // 9. Cas courant : 100 %.
  return build(1, `TVA déductible sur ${estImmobilisation ? "immobilisation" : "biens et services"}.`);
}

/**
 * Champs INDISPENSABLES au calcul des montants de l'écriture. S'ils sont
 * absents/non conformes en entrée (typiquement le LLM qui « perd » un champ en
 * re-sérialisant `fields`), l'écriture n'est pas fiable : on ne calcule pas comme
 * si vide était légitime, on force la revue humaine.
 *
 * Distinction essentielle : `tvaParTaux = []` (présent mais vide) est LÉGITIME
 * (autoliquidation intracom, opération exonérée) — seul un `tvaParTaux` qui n'est
 * pas un tableau (undefined) est considéré comme perdu. Pour la base HT, au moins
 * l'un de montantHT / montantTTC doit être présent pour dériver le montant.
 */
export function champsCritiquesManquants(fields: ExtractedFields): string[] {
  const manquants: string[] = [];
  if (!Array.isArray(fields.tvaParTaux)) manquants.push("tvaParTaux");
  if (fields.montantHT == null && fields.montantTTC == null) manquants.push("montantHT/montantTTC");
  return manquants;
}

/** Achat de service intracommunautaire / hors UE sans TVA -> autoliquidation. */
export function detecteAutoliquidation(fields: ExtractedFields): boolean {
  const pays = (fields.paysFournisseur ?? "FR").toUpperCase();
  const totalTva = (fields.tvaParTaux ?? []).reduce((s, t) => s + t.montant, 0);
  return pays !== "FR" && totalTva === 0;
}
