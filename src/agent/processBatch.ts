// ---------------------------------------------------------------------------
// Orchestration du lot : itère sur chaque facture PDF et produit le journal
// d'écritures consolidé. Deux modes :
//  - "deterministe" : appelle les handlers dans l'ordre (aucune clé API requise).
//  - "agent"        : délègue l'orchestration à Claude (tool-calling réel).
// ---------------------------------------------------------------------------

import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { extractPdfText } from "../lib/pdf.js";
import { TOOLS } from "../tools/index.js";
import type { DejaTraitee } from "../tools/validateInvoice.js";
import { runAgentOnInvoice, assembleDossier } from "./runAgent.js";
import { INVOICES_DIR, ROOT } from "../store.js";
import type {
  BatchResult,
  DossierFacture,
  ExtractedFields,
  PropositionResult,
  RoutageResult,
  ValidationResult,
} from "../types.js";
import { SEUIL_AUTO_VALIDATION } from "../config.js";
import { round2 } from "../lib/tva.js";

/**
 * Chemins RELATIFS à la racine du projet : ils servent d'identifiant de dossier
 * et sont persistés dans ecritures.json. Un chemin absolu y exposerait
 * l'arborescence de la machine qui a lancé la démo, et rendrait le livrable
 * non reproductible d'un poste à l'autre.
 */
async function listInvoices(): Promise<string[]> {
  const files = await readdir(INVOICES_DIR);
  return files
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((f) => relative(ROOT, resolve(INVOICES_DIR, f)));
}

/** Pipeline déterministe : extract -> validate -> propose -> route. */
function pipelineDeterministe(
  rawText: string,
  sourceFile: string,
  dejaTraitees: DejaTraitee[]
): DossierFacture {
  const fields = TOOLS.extract_invoice_fields.handler({ rawText, sourceFile }) as ExtractedFields;
  const validation = TOOLS.validate_invoice.handler({ fields, dejaTraitees }) as ValidationResult;
  const proposition = TOOLS.propose_ecriture.handler({
    fields,
    anomalies: validation.anomalies,
  }) as PropositionResult;
  const routage = TOOLS.route_by_confidence.handler({
    confidence: proposition.confidence,
    anomalies: validation.anomalies,
    seuilAutoValidation: SEUIL_AUTO_VALIDATION,
  }) as RoutageResult;
  return assembleDossier(sourceFile, fields, validation, proposition, routage);
}

export async function processBatch(mode: "deterministe" | "agent"): Promise<BatchResult> {
  const invoices = await listInvoices();
  const client =
    mode === "agent" ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

  const dossiers: DossierFacture[] = [];
  const dejaTraitees: DejaTraitee[] = [];

  for (const file of invoices) {
    // `file` reste relatif (identité persistée) ; la lecture disque a besoin
    // du chemin absolu, résolu ici et nulle part ailleurs.
    const rawText = await extractPdfText(resolve(ROOT, file));
    const label = file.split("/").pop();

    let dossier: DossierFacture;
    if (mode === "agent" && client) {
      dossier = await runAgentOnInvoice(client, rawText, file, [...dejaTraitees]);
    } else {
      dossier = pipelineDeterministe(rawText, file, [...dejaTraitees]);
    }

    dossiers.push(dossier);
    dejaTraitees.push({
      fournisseur: dossier.fields.fournisseur ?? "",
      numeroFacture: dossier.fields.numeroFacture ?? "",
      ttc: dossier.fields.montantTTC ?? 0,
    });

    const icone = dossier.statut === "auto-valide" ? "✅" : "🔎";
    console.log(
      `${icone} ${label} → ${dossier.statut} (${(dossier.confidence * 100).toFixed(0)}%) — ${dossier.motifRoutage}`
    );
  }

  const autoValides = dossiers.filter((d) => d.statut === "auto-valide").length;
  const totalDebit = round2(dossiers.reduce((s, d) => s + d.ecriture.totalDebit, 0));
  const totalCredit = round2(dossiers.reduce((s, d) => s + d.ecriture.totalCredit, 0));

  return {
    generatedAt: new Date().toISOString(),
    mode,
    totalFactures: dossiers.length,
    autoValides,
    aRevoir: dossiers.length - autoValides,
    totalDebit,
    totalCredit,
    dossiers,
  };
}
