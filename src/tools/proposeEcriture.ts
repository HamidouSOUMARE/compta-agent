// ---------------------------------------------------------------------------
// TOOL 3 — propose_ecriture
// Construit l'écriture d'achat ÉQUILIBRÉE par construction (crédit 401 = somme
// des débits), applique le traitement TVA décidé, et calcule un score de
// confiance auditable. Ne comptabilise pas : il propose.
// ---------------------------------------------------------------------------

import type Anthropic from "@anthropic-ai/sdk";
import type { Anomalie, Ecriture, ExtractedFields, LigneEcriture, PropositionResult } from "../types.js";
import { COMPTES, PENALITES_CONFIANCE, TAUX_TVA_COURANT, TAUX_NORMAL_INTRACOM } from "../config.js";
import { round2 } from "../lib/tva.js";
import {
  classifyCharge,
  analyseTva,
  detecteAutoliquidation,
  champsCritiquesManquants,
} from "../lib/classify.js";

export const schema: Anthropic.Tool = {
  name: "propose_ecriture",
  description:
    "Propose l'écriture comptable d'achat équilibrée (débit 6xx/218 HT + débit 445 TVA " +
    "déductible = crédit 401 TTC), en tenant compte de la classification, de l'immobilisation " +
    "et de la déductibilité de la TVA. Renvoie l'écriture, un score de confiance et une " +
    "justification en une phrase.",
  input_schema: {
    type: "object",
    properties: {
      fields: { type: "object", description: "Champs extraits de la facture." },
      anomalies: {
        type: "array",
        description: "Anomalies remontées par validate_invoice.",
        items: { type: "object" },
      },
    },
    required: ["fields", "anomalies"],
  },
};

function has(anomalies: Anomalie[], code: Anomalie["code"]): boolean {
  return anomalies.some((a) => a.code === code);
}

export function handler(input: { fields: ExtractedFields; anomalies: Anomalie[] }): PropositionResult {
  const { fields } = input;
  // Défense en profondeur : on re-détecte les champs critiques manquants ICI,
  // indépendamment des `anomalies` renvoyées par validate_invoice — car dans la
  // boucle réelle Claude pourrait « oublier » de repasser l'anomalie. Le plafond
  // de confiance appliqué plus bas ne dépend donc PAS de l'input `anomalies`.
  const critiquesManquants = champsCritiquesManquants(fields);

  // Normalisation LOCALE (sans muter `fields`) — voir validate_invoice.
  const tvaParTaux = Array.isArray(fields.tvaParTaux) ? fields.tvaParTaux : [];
  const anomalies = Array.isArray(input.anomalies) ? input.anomalies : [];

  const mentionManquante = has(anomalies, "MENTION_MANQUANTE");
  const charge = classifyCharge(fields);
  const tva = analyseTva(fields, charge.estImmobilisation, mentionManquante);
  const autoliquidation = detecteAutoliquidation(fields);

  const totalTva = round2(tvaParTaux.reduce((s, t) => s + t.montant, 0));
  const ht = round2(fields.montantHT ?? (fields.montantTTC ?? 0) - totalTva);
  const piece = fields.numeroFacture ?? "SANS-NUM";
  const libelleBase = `${fields.fournisseur ?? "Fournisseur inconnu"} - ${piece}`;

  const lignes: LigneEcriture[] = [];

  if (autoliquidation) {
    // --- Autoliquidation intracom : écriture COMPLÈTE en 4 lignes (côté code) ---
    // La facture intracom est en HT seul ; on reconstitue la TVA due au taux normal.
    //   TVA_due      = arrondi(HT × taux)                -> crédit 4452 (TOUJOURS plein montant)
    //   TVA_déduct.  = arrondi(TVA_due × coef)           -> débit 445662 (si > 0)
    //   partNonDeduct = TVA_due − TVA_déduct.  (par SOUSTRACTION, pas un arrondi séparé)
    //   charge 6xx   = HT + partNonDeduct
    //   fournisseur  = HT                                -> crédit 401 (facturé HT)
    // Équilibre par identité : débit = HT + TVA_due = crédit, au centime près.
    const coef = tva.tauxDeductibilite;
    const tvaDue = round2(ht * TAUX_NORMAL_INTRACOM);
    const tvaDeductible = round2(tvaDue * coef);
    const partNonDeduct = round2(tvaDue - tvaDeductible);
    const pctTaux = Math.round(TAUX_NORMAL_INTRACOM * 100);

    lignes.push({
      compte: charge.compteCharge,
      libelle:
        `${charge.libelleCompte} - ${libelleBase} (autoliquidation TVA intracom)` +
        (partNonDeduct > 0 ? ` (dont TVA non déductible ${partNonDeduct.toFixed(2)} € réintégrée)` : ""),
      debit: round2(ht + partNonDeduct),
      credit: 0,
    });
    if (tvaDeductible > 0) {
      const pctLabel = coef < 1 ? ` (${Math.round(coef * 100)}% déductible)` : "";
      lignes.push({
        compte: COMPTES.tvaDeductibleIntracom,
        libelle: `TVA déductible intracom ${pctTaux}%${pctLabel} - ${piece}`,
        debit: tvaDeductible,
        credit: 0,
      });
    }
    lignes.push({
      compte: COMPTES.fournisseur,
      libelle: `Fournisseur ${fields.fournisseur ?? ""} - ${piece}`.trim(),
      debit: 0,
      credit: ht,
    });
    lignes.push({
      compte: COMPTES.tvaDueIntracom,
      libelle: `TVA due intracom ${pctTaux}% (autoliquidation) - ${piece}`,
      debit: 0,
      credit: tvaDue,
    });
  } else {
    // --- Ventilation en PRORATA (logique unifiée, valable pour 1 / 0,8 / 0) ---
    //   tvaDeductible = Σ (TVA_taux × tauxDeductibilite)   -> ligne 445 (si > 0)
    //   partNonDeduct = TVA totale − tvaDeductible          -> ajoutée au coût de la charge
    //   Débit 6xx = HT + partNonDeduct ; Crédit 401 = TTC. Équilibré par construction.
    const taux = tva.tauxDeductibilite;
    const tvaDeductibleParTaux = tvaParTaux.map((t) => ({
      taux: t.taux,
      deductible: round2(t.montant * taux),
    }));
    const tvaDeductible = round2(tvaDeductibleParTaux.reduce((s, t) => s + t.deductible, 0));
    const partNonDeduct = round2(totalTva - tvaDeductible);

    const suffixeCharge =
      partNonDeduct > 0 ? ` (dont TVA non déductible ${partNonDeduct.toFixed(2)} € réintégrée)` : "";
    lignes.push({
      compte: charge.compteCharge,
      libelle: `${charge.libelleCompte} - ${libelleBase}${suffixeCharge}`,
      debit: round2(ht + partNonDeduct),
      credit: 0,
    });

    for (const t of tvaDeductibleParTaux) {
      if (t.deductible <= 0) continue; // ligne 445 omise si rien de déductible
      const pctLabel = taux < 1 ? ` (${Math.round(taux * 100)}% déductible)` : "";
      lignes.push({
        compte: tva.compteTva!,
        libelle: `TVA déductible ${t.taux}%${pctLabel} - ${piece}`,
        debit: t.deductible,
        credit: 0,
      });
    }

    // Crédit 401 = somme des débits -> écriture équilibrée PAR CONSTRUCTION.
    lignes.push({
      compte: COMPTES.fournisseur,
      libelle: `Fournisseur ${fields.fournisseur ?? ""} - ${piece}`.trim(),
      debit: 0,
      credit: round2(lignes.reduce((s, l) => s + l.debit, 0)),
    });
  }

  const totalDebit = round2(lignes.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lignes.reduce((s, l) => s + l.credit, 0));

  const ecriture: Ecriture = {
    id: fields.sourceFile,
    journal: "ACH",
    date: fields.dateFacture,
    numeroPiece: fields.numeroFacture,
    libelle: libelleBase,
    lignes,
    totalDebit,
    totalCredit,
    equilibre: Math.abs(totalDebit - totalCredit) <= 0.01,
  };

  // --- Score de confiance (auditable) ---
  let confidence = 1.0;
  if (charge.compteAmbigu) confidence -= PENALITES_CONFIANCE.compteAmbigu;
  if (charge.immoNonTriviale) confidence -= PENALITES_CONFIANCE.immobilisationAmbigue;
  if (tva.aVerifier || (tva.tauxDeductibilite < 1 && !mentionManquante)) confidence -= PENALITES_CONFIANCE.avertissement;
  if (autoliquidation) confidence -= PENALITES_CONFIANCE.avertissement;
  const tauxInhabituel = tvaParTaux.some((t) => t.taux !== TAUX_TVA_COURANT && t.montant > 0);
  if (tauxInhabituel) confidence -= PENALITES_CONFIANCE.tauxTvaInhabituel;
  const aBloquante = anomalies.some((a) => a.gravite === "bloquante");
  if (aBloquante) confidence = Math.min(confidence, 0.25);
  // Champ critique perdu -> plafond dur, indépendant de l'input `anomalies` :
  // une écriture calculée sur une donnée manquante ne peut jamais s'auto-valider.
  if (critiquesManquants.length > 0) confidence = Math.min(confidence, 0.25);
  confidence = Math.max(0, round2(confidence));

  const tvaPhrase = autoliquidation
    ? `Autoliquidation intracom : TVA due (${COMPTES.tvaDueIntracom}) et TVA déductible (${COMPTES.tvaDeductibleIntracom}) comptabilisées au taux ${Math.round(TAUX_NORMAL_INTRACOM * 100)}%.`
    : tva.motif;
  const alerteCritique =
    critiquesManquants.length > 0
      ? `⚠️ Champ(s) critique(s) absent(s) en entrée (${critiquesManquants.join(", ")}) : écriture à vérifier manuellement. `
      : "";
  const justification = `${alerteCritique}${charge.motif} ${tvaPhrase}`;

  return {
    ecriture,
    confidence,
    justification: justification.trim(),
    compteCharge: charge.compteCharge,
    estImmobilisation: charge.estImmobilisation,
    tvaTreatment: {
      tauxDeductibilite: tva.tauxDeductibilite,
      // En autoliquidation, le compte de TVA déductible réellement mouvementé est
      // le sous-compte intracom (445662), pas le 445660 domestique.
      compteTva: autoliquidation
        ? tva.tauxDeductibilite > 0
          ? COMPTES.tvaDeductibleIntracom
          : null
        : tva.compteTva,
      motif: autoliquidation ? tvaPhrase : tva.motif,
    },
  };
}
