// ---------------------------------------------------------------------------
// TOOL 1 — extract_invoice_fields
// Parse le TEXTE NATIF d'une facture en champs structurés. Déterministe : le
// handler lit des valeurs, il ne calcule aucun montant comptable.
// ---------------------------------------------------------------------------

import type Anthropic from "@anthropic-ai/sdk";
import type { ExtractedFields, TvaParTaux } from "../types.js";

export const schema: Anthropic.Tool = {
  name: "extract_invoice_fields",
  description:
    "Extrait les champs structurés d'une facture fournisseur à partir de son texte natif " +
    "(fournisseur, SIREN, TVA intra, dates, montants HT/TVA/TTC, désignation). " +
    "Ne calcule rien : renvoie ce qui est lisible et signale les champs manquants.",
  input_schema: {
    type: "object",
    properties: {
      rawText: { type: "string", description: "Texte natif brut du PDF de la facture." },
      sourceFile: { type: "string", description: "Chemin du fichier PDF source." },
    },
    required: ["rawText", "sourceFile"],
  },
};

/** "1 250,00" | "1250.00" | "1 250,00 EUR" -> 1250. */
function parseMontant(raw: string | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/\s/g, "").replace(/(eur|euros|€)/gi, "");
  if (s.includes(",")) {
    // Virgule = séparateur décimal FR ; le point est alors un séparateur de milliers.
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m?.[1]?.trim();
}

/** "12/03/2026" -> "2026-03-12". Renvoie l'ISO tel quel s'il l'est déjà. */
function toIso(raw: string | undefined): string | null {
  if (!raw) return null;
  const fr = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

const MONTANT = "([\\d\\s.,]+(?:eur|euros|\\u20AC)?)";

export function handler(input: { rawText: string; sourceFile: string }): ExtractedFields {
  const text = input.rawText;

  const numeroFacture =
    firstMatch(text, /N[°º.]?\s*facture\s*:?\s*([A-Z0-9\-\/]+)/i) ??
    firstMatch(text, /facture\s*n[°º.]?\s*:?\s*([A-Z0-9\-\/]+)/i) ??
    null;

  const fournisseur = firstMatch(text, /Fournisseur\s*:?\s*(.+)/i) ?? null;
  const designation = firstMatch(text, /D[ée]signation\s*:?\s*(.+)/i) ?? null;

  const sirenRaw = firstMatch(text, /SIREN\s*:?\s*([\d\s]{9,13})/i);
  const siren = sirenRaw ? sirenRaw.replace(/\s/g, "").slice(0, 9) : null;

  const tvaIntra =
    firstMatch(text, /TVA\s*intra[a-z]*\s*:?\s*([A-Z]{2}[A-Z0-9\s]{2,15})/i)?.replace(/\s/g, "") ??
    null;

  const dateFacture = toIso(firstMatch(text, /Date\s*(?:de\s*facture)?\s*:?\s*([\d\/\-]+)/i));

  const montantHT = parseMontant(firstMatch(text, new RegExp(`Montant\\s*HT\\s*:?\\s*${MONTANT}`, "i")));
  const montantTTC = parseMontant(
    firstMatch(text, new RegExp(`(?:Total\\s*)?TTC\\s*:?\\s*${MONTANT}`, "i"))
  );

  // Toutes les lignes "TVA <taux>% : <montant>" (gère le multi-taux).
  const tvaParTaux: TvaParTaux[] = [];
  const tvaLineRe = new RegExp(`TVA\\s*(\\d{1,2}(?:[.,]\\d)?)\\s*%\\s*:?\\s*${MONTANT}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = tvaLineRe.exec(text)) !== null) {
    const taux = Number(m[1].replace(",", "."));
    const montant = parseMontant(m[2]);
    if (montant != null) tvaParTaux.push({ taux, montant });
  }

  // Pays fournisseur : ligne explicite, sinon préfixe du n° de TVA intra, sinon FR.
  const paysExplicite = firstMatch(text, /Pays\s*(?:fournisseur)?\s*:?\s*([A-Z]{2})/i);
  const paysFournisseur =
    paysExplicite?.toUpperCase() ?? (tvaIntra ? tvaIntra.slice(0, 2).toUpperCase() : "FR");

  const champsManquants: string[] = [];
  if (!numeroFacture) champsManquants.push("numeroFacture");
  if (!dateFacture) champsManquants.push("dateFacture");
  if (!siren) champsManquants.push("siren");
  if (!tvaIntra) champsManquants.push("tvaIntra");
  if (montantHT == null) champsManquants.push("montantHT");
  if (montantTTC == null) champsManquants.push("montantTTC");

  return {
    fournisseur,
    siren,
    tvaIntra,
    dateFacture,
    numeroFacture,
    montantHT,
    tvaParTaux,
    montantTTC,
    paysFournisseur,
    designation,
    champsManquants,
    sourceFile: input.sourceFile,
  };
}
