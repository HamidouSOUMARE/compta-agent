// ---------------------------------------------------------------------------
// Test déterministe (aucune clé API) : durcissement "champ critique manquant".
// Objectif : un champ matériel au calcul (tvaParTaux, base HT) perdu par le LLM
// ne doit JAMAIS produire une écriture auto-validée. Il lève une anomalie et la
// pièce part "à revoir" — même si l'anomalie n'est pas repassée aux outils suivants.
//   npm test
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { handler as validate } from "../src/tools/validateInvoice.js";
import { handler as propose } from "../src/tools/proposeEcriture.js";
import { handler as route } from "../src/tools/routeByConfidence.js";
import type { ExtractedFields } from "../src/types.js";

let ok = 0;
function check(nom: string, cond: boolean) {
  assert.ok(cond, `ÉCHEC : ${nom}`);
  console.log(`  ✅ ${nom}`);
  ok++;
}

// Facture intracom valide, TVA vide LÉGITIME (autoliquidation).
const factureIntracom: ExtractedFields = {
  fournisseur: "Berlin Software GmbH", siren: null, tvaIntra: "DE811569869",
  dateFacture: "2026-03-24", numeroFacture: "FAC-2026-018", montantHT: 2000,
  tvaParTaux: [], montantTTC: 2000, paysFournisseur: "DE",
  designation: "Prestation de conseil", champsManquants: [], sourceFile: "18.pdf",
};

// Même facture mais le LLM a PERDU tvaParTaux (undefined) en re-sérialisant.
const factureTvaPerdu = { ...factureIntracom, tvaParTaux: undefined } as unknown as ExtractedFields;

// Facture sans aucune base HT dérivable (HT et TTC nuls).
const factureSansBase: ExtractedFields = {
  ...factureIntracom, paysFournisseur: "FR", tvaParTaux: [{ taux: 20, montant: 40 }],
  montantHT: null, montantTTC: null, numeroFacture: "FAC-X",
};

console.log("\n1) tvaParTaux = [] (vide LÉGITIME) ne déclenche PAS l'anomalie critique");
{
  const v = validate({ fields: factureIntracom, dejaTraitees: [] });
  check("pas de CHAMP_CRITIQUE_MANQUANT sur une TVA vide légitime",
    !v.anomalies.some((a) => a.code === "CHAMP_CRITIQUE_MANQUANT"));
}

console.log("\n2) tvaParTaux PERDU (undefined) => anomalie bloquante + jamais auto-validé");
{
  const v = validate({ fields: factureTvaPerdu, dejaTraitees: [] });
  const critique = v.anomalies.find((a) => a.code === "CHAMP_CRITIQUE_MANQUANT");
  check("validate lève CHAMP_CRITIQUE_MANQUANT", !!critique);
  check("l'anomalie est bloquante", critique?.gravite === "bloquante");

  // Défense en profondeur : Claude "oublie" de repasser l'anomalie -> anomalies vide.
  const p = propose({ fields: factureTvaPerdu, anomalies: [] });
  check("propose plafonne la confiance à ≤ 0,25 sans dépendre de l'input anomalies",
    p.confidence <= 0.25);
  check("la justification signale le champ critique", p.justification.includes("critique"));

  // Routage avec anomalies vides (pire cas) : doit quand même partir en revue.
  const rSansAnomalie = route({ confidence: p.confidence, anomalies: [] });
  check("route -> 'à revoir' même sans l'anomalie (via la confiance plafonnée)",
    rSansAnomalie.statut === "a-revoir");

  // Routage avec l'anomalie correctement transmise : idem.
  const rAvecAnomalie = route({ confidence: p.confidence, anomalies: v.anomalies });
  check("route -> 'à revoir' avec l'anomalie transmise", rAvecAnomalie.statut === "a-revoir");
  check("jamais 'auto-valide'",
    rSansAnomalie.statut !== "auto-valide" && rAvecAnomalie.statut !== "auto-valide");
}

console.log("\n3) base HT indisponible (montantHT ET montantTTC nuls) => critique");
{
  const v = validate({ fields: factureSansBase, dejaTraitees: [] });
  check("validate lève CHAMP_CRITIQUE_MANQUANT sur base HT absente",
    v.anomalies.some((a) => a.code === "CHAMP_CRITIQUE_MANQUANT" && a.gravite === "bloquante"));
}

console.log(`\n✅ ${ok} assertions passées.\n`);
