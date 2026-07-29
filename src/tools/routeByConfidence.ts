// ---------------------------------------------------------------------------
// TOOL 4 — route_by_confidence
// Décision human-in-the-loop : "auto-validé" si tout est clair, sinon "à revoir"
// avec le motif. Une anomalie bloquante force TOUJOURS la revue, quel que soit
// le score. L'agent ne comptabilise jamais ce qu'il n'a pas auto-validé.
// ---------------------------------------------------------------------------

import type Anthropic from "@anthropic-ai/sdk";
import type { Anomalie, RoutageResult } from "../types.js";

export const schema: Anthropic.Tool = {
  name: "route_by_confidence",
  description:
    "Route la pièce : 'auto-valide' si le score dépasse le seuil et qu'aucune anomalie ne " +
    "l'exige, sinon 'a-revoir' avec un motif en une phrase. Toute anomalie bloquante force " +
    "'a-revoir' quel que soit le score.",
  input_schema: {
    type: "object",
    properties: {
      confidence: { type: "number", description: "Score de confiance 0..1 de propose_ecriture." },
      anomalies: { type: "array", description: "Anomalies cumulées.", items: { type: "object" } },
      seuilAutoValidation: {
        type: "number",
        description: "Seuil d'auto-validation (défaut 0.85).",
      },
    },
    required: ["confidence", "anomalies"],
  },
};

// Avertissements qui, à eux seuls, imposent une revue humaine.
const AVERTISSEMENTS_A_REVOIR: Anomalie["code"][] = [
  "COMPTE_AMBIGU",
  "IMMOBILISATION",
  "TVA_A_VERIFIER",
  "TVA_NON_DEDUCTIBLE",
  "AUTOLIQUIDATION",
];

export function handler(input: {
  confidence: number;
  anomalies: Anomalie[];
  seuilAutoValidation?: number;
}): RoutageResult {
  const seuil = input.seuilAutoValidation ?? 0.85;
  const { anomalies, confidence } = input;

  const bloquante = anomalies.find((a) => a.gravite === "bloquante");
  if (bloquante) {
    return { statut: "a-revoir", motif: `Anomalie bloquante — ${bloquante.message}` };
  }

  const flag = anomalies.find((a) => AVERTISSEMENTS_A_REVOIR.includes(a.code));
  if (flag) {
    return { statut: "a-revoir", motif: `Contrôle requis — ${flag.message}` };
  }

  if (confidence < seuil) {
    return {
      statut: "a-revoir",
      motif: `Confiance ${(confidence * 100).toFixed(0)}% < seuil ${(seuil * 100).toFixed(0)}%.`,
    };
  }

  return {
    statut: "auto-valide",
    motif: `Écriture claire et conforme (confiance ${(confidence * 100).toFixed(0)}%).`,
  };
}
