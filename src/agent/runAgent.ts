// ---------------------------------------------------------------------------
// Boucle agentique RÉELLE (Anthropic tool-calling) pour UNE facture. Claude
// décide d'appeler les 4 tools ; nos handlers déterministes exécutent. On
// capture les résultats des tools pour assembler le dossier final.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, TOOL_SCHEMAS } from "../tools/index.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import type { DejaTraitee } from "../tools/validateInvoice.js";
import type {
  DossierFacture,
  ExtractedFields,
  PropositionResult,
  RoutageResult,
  ValidationResult,
} from "../types.js";

// Défaut volontairement Haiku (le moins cher) : la boucle agentique ne sert qu'à
// valider l'ordre des tools et la cohérence des justifications, pas à raisonner.
// Surcharge possible via ANTHROPIC_MODEL dans .env.local.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
const MAX_TURNS = 10;

/** Traite une facture via la boucle tool-calling de Claude. */
export async function runAgentOnInvoice(
  client: Anthropic,
  rawText: string,
  sourceFile: string,
  dejaTraitees: DejaTraitee[]
): Promise<DossierFacture> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Traite cette facture (fichier ${sourceFile}). Factures déjà traitées dans le lot ` +
        `(pour la détection de doublon) : ${JSON.stringify(dejaTraitees)}.\n\n` +
        `--- TEXTE NATIF DE LA FACTURE ---\n${rawText}`,
    },
  ];

  // On capture les sorties des tools au fil de la boucle.
  const captured: {
    fields?: ExtractedFields;
    validation?: ValidationResult;
    proposition?: PropositionResult;
    routage?: RoutageResult;
  } = {};
  let commentaire = "";
  const trace: string[] = []; // ordre d'appel des tools choisi par Claude

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: TOOL_SCHEMAS,
      messages,
    });

    const textParts = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    if (textParts.length) commentaire = textParts.map((t) => t.text).join(" ").trim();

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
      if (process.env.AGENT_TRACE) {
        console.log(`   🧰 ordre des tools : ${trace.join(" → ") || "(aucun)"}`);
      }
      break; // Claude a fini (routage obtenu, phrase de synthèse rendue).
    }

    messages.push({ role: "assistant", content: resp.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const def = TOOLS[tu.name];
      trace.push(tu.name);
      const result = def.handler(tu.input);
      // On mémorise chaque sortie pour reconstruire le dossier.
      if (tu.name === "extract_invoice_fields") captured.fields = result as ExtractedFields;
      if (tu.name === "validate_invoice") captured.validation = result as ValidationResult;
      if (tu.name === "propose_ecriture") captured.proposition = result as PropositionResult;
      if (tu.name === "route_by_confidence") captured.routage = result as RoutageResult;
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!captured.fields || !captured.validation || !captured.proposition || !captured.routage) {
    throw new Error(`Boucle agent incomplète pour ${sourceFile} (un tool n'a pas été appelé).`);
  }

  return assembleDossier(
    sourceFile,
    captured.fields,
    captured.validation,
    captured.proposition,
    captured.routage,
    commentaire
  );
}

/** Assemble le dossier consolidé (miroir aplati pour le dashboard). */
export function assembleDossier(
  sourceFile: string,
  fields: ExtractedFields,
  validation: ValidationResult,
  proposition: PropositionResult,
  routage: RoutageResult,
  commentaire?: string
): DossierFacture {
  return {
    id: sourceFile,
    sourceFile,
    fields,
    validation,
    proposition,
    routage,
    statut: routage.statut,
    confidence: proposition.confidence,
    anomalies: validation.anomalies,
    ecriture: proposition.ecriture,
    justification: commentaire?.length ? commentaire : proposition.justification,
    motifRoutage: routage.motif,
  };
}
