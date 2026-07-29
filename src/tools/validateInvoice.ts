// ---------------------------------------------------------------------------
// TOOL 2 — validate_invoice
// Contrôles métier déterministes : SIREN (Luhn), cohérence HT+TVA=TTC, taux de
// TVA légal, doublon, mentions légales, et flags métier (déductibilité,
// immobilisation, autoliquidation). Renvoie un statut + la liste des anomalies.
// ---------------------------------------------------------------------------

import type Anthropic from "@anthropic-ai/sdk";
import type { Anomalie, ExtractedFields, ValidationResult } from "../types.js";
import { SEUIL_MENTION_TVA_INTRA } from "../config.js";
import { isValidSiren } from "../lib/siren.js";
import { ttcCoherent, verifierTauxSurBase } from "../lib/tva.js";
import {
  classifyCharge,
  analyseTva,
  detecteAutoliquidation,
  champsCritiquesManquants,
} from "../lib/classify.js";

export interface DejaTraitee {
  fournisseur: string;
  numeroFacture: string;
  ttc: number;
}

export const schema: Anthropic.Tool = {
  name: "validate_invoice",
  description:
    "Applique les contrôles comptables obligatoires sur une facture extraite : validité du " +
    "SIREN (Luhn), égalité HT+TVA=TTC, taux de TVA légal, détection de doublon, mentions " +
    "légales, déductibilité de la TVA, immobilisation et autoliquidation. Renvoie un statut " +
    "(valide / avertissement / invalide) et la liste des anomalies.",
  input_schema: {
    type: "object",
    properties: {
      fields: { type: "object", description: "Champs extraits par extract_invoice_fields." },
      dejaTraitees: {
        type: "array",
        description: "Factures déjà traitées dans le lot (pour la détection de doublon).",
        items: {
          type: "object",
          properties: {
            fournisseur: { type: "string" },
            numeroFacture: { type: "string" },
            ttc: { type: "number" },
          },
        },
      },
    },
    required: ["fields", "dejaTraitees"],
  },
};

export function handler(input: {
  fields: ExtractedFields;
  dejaTraitees: DejaTraitee[];
}): ValidationResult {
  const { fields } = input;
  const anomalies: Anomalie[] = [];

  // Champs CRITIQUES au calcul de l'écriture : on détecte l'absence AVANT toute
  // coercition. Un champ perdu (LLM) ne doit pas être traité comme un vide légitime
  // -> anomalie bloquante -> revue forcée, jamais d'auto-validation d'une écriture
  // calculée sur des données incomplètes.
  const critiquesManquants = champsCritiquesManquants(fields);
  if (critiquesManquants.length > 0) {
    anomalies.push({
      code: "CHAMP_CRITIQUE_MANQUANT",
      gravite: "bloquante",
      message: `Champ(s) critique(s) absent(s) en entrée : ${critiquesManquants.join(", ")}. ` +
        `Écriture non fiable (donnée perdue), revue humaine obligatoire.`,
    });
  }

  // Champs bénins : absence = réellement vide -> normalisation en LOCAL (sans muter
  // l'objet `fields` reçu, pour ne pas contaminer un autre handler qui le partagerait).
  const tvaParTaux = Array.isArray(fields.tvaParTaux) ? fields.tvaParTaux : [];
  const dejaTraitees = Array.isArray(input.dejaTraitees) ? input.dejaTraitees : [];
  const totalTva = tvaParTaux.reduce((s, t) => s + t.montant, 0);

  // --- 1. SIREN présent et valide (Luhn) — uniquement pour un fournisseur français ---
  const estFrancais = (fields.paysFournisseur ?? "FR").toUpperCase() === "FR";
  if (estFrancais && !fields.siren) {
    anomalies.push({ code: "SIREN_INVALIDE", gravite: "bloquante", message: "SIREN absent de la facture." });
  } else if (fields.siren && !isValidSiren(fields.siren)) {
    anomalies.push({
      code: "SIREN_INVALIDE",
      gravite: "bloquante",
      message: `SIREN ${fields.siren} invalide (échec de la clé de Luhn).`,
    });
  }

  // --- 2. Cohérence HT + TVA = TTC ---
  if (fields.montantHT != null && fields.montantTTC != null) {
    if (!ttcCoherent(fields.montantHT, totalTva, fields.montantTTC)) {
      anomalies.push({
        code: "TTC_INCOHERENT",
        gravite: "bloquante",
        message: `Incohérence : HT ${fields.montantHT} + TVA ${totalTva.toFixed(2)} ≠ TTC ${fields.montantTTC}.`,
      });
    }
  }

  // --- 3. Taux de TVA cohérent (TVA / HT = taux légal) ---
  for (const t of tvaParTaux) {
    if (fields.montantHT == null) break;
    // On vérifie le taux affiché sur la base HT globale (multi-taux simplifié).
    const { tauxEffectif, valide } = verifierTauxSurBase(fields.montantHT, t.montant);
    const tauxAffiche = t.taux;
    if (!valide && Math.abs(tauxAffiche - tauxEffectif) > 0.15) {
      anomalies.push({
        code: "TVA_INCOHERENTE",
        gravite: "bloquante",
        message: `Taux TVA incohérent : ${t.montant} sur HT ${fields.montantHT} = ${tauxEffectif}% (affiché ${tauxAffiche}%).`,
      });
    }
  }

  // --- 4. Doublon (même fournisseur + n° facture + TTC) ---
  const doublon = dejaTraitees.find(
    (d) =>
      d.fournisseur === fields.fournisseur &&
      d.numeroFacture === fields.numeroFacture &&
      Math.abs(d.ttc - (fields.montantTTC ?? -1)) <= 0.01
  );
  if (doublon) {
    anomalies.push({
      code: "DOUBLON",
      gravite: "bloquante",
      message: `Doublon probable : ${fields.fournisseur} / ${fields.numeroFacture} / ${fields.montantTTC} € déjà traité.`,
    });
  }

  // --- 5. Mentions légales obligatoires ---
  const mentionsManquantes: string[] = [];
  if (!fields.numeroFacture) mentionsManquantes.push("n° de facture");
  if (!fields.dateFacture) mentionsManquantes.push("date");
  const ttc = fields.montantTTC ?? 0;
  if (ttc >= SEUIL_MENTION_TVA_INTRA && !fields.tvaIntra) {
    mentionsManquantes.push("n° de TVA intracommunautaire (montant ≥ 150 €)");
  }
  const mentionManquante = mentionsManquantes.length > 0;
  if (mentionManquante) {
    anomalies.push({
      code: "MENTION_MANQUANTE",
      gravite: "bloquante",
      message: `Mention(s) légale(s) manquante(s) : ${mentionsManquantes.join(", ")} — TVA non déductible.`,
    });
  }

  // --- 6. Flags métier (n'invalident pas la pièce mais orientent le routage) ---
  const charge = classifyCharge(fields);
  const tva = analyseTva(fields, charge.estImmobilisation, mentionManquante);

  if (charge.compteAmbigu) {
    anomalies.push({
      code: "COMPTE_AMBIGU",
      gravite: "avertissement",
      message: charge.motif,
    });
  }
  if (charge.immoNonTriviale) {
    anomalies.push({
      code: "IMMOBILISATION",
      gravite: "avertissement",
      message: charge.motif,
    });
  }
  if (tva.aVerifier) {
    anomalies.push({ code: "TVA_A_VERIFIER", gravite: "avertissement", message: tva.motif });
  }
  // Prorata < 100 % (hors mention manquante, déjà signalée en bloquante).
  if (tva.tauxDeductibilite < 1 && !mentionManquante) {
    const pct = Math.round(tva.tauxDeductibilite * 100);
    const qualif = pct === 0 ? "non déductible" : `partiellement déductible (prorata ${pct} %)`;
    anomalies.push({
      code: "TVA_NON_DEDUCTIBLE",
      gravite: "avertissement",
      message: `TVA ${qualif} — ${tva.motif}`,
    });
  }
  if (detecteAutoliquidation(fields)) {
    anomalies.push({
      code: "AUTOLIQUIDATION",
      gravite: "avertissement",
      message:
        "Achat de service intracom sans TVA : autoliquidation comptabilisée (TVA due 445200 / " +
        "déductible 445662) au taux normal reconstitué — à contrôler (taux applicable réel).",
    });
  }

  const aBloquante = anomalies.some((a) => a.gravite === "bloquante");
  const statut = aBloquante ? "invalide" : anomalies.length > 0 ? "avertissement" : "valide";

  return { statut, anomalies };
}
