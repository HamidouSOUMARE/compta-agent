// ---------------------------------------------------------------------------
// Registry des 4 tools : chaque entrée associe le SCHÉMA envoyé à Claude et le
// HANDLER déterministe exécuté par notre code. Claude décide QUAND appeler quoi ;
// le code fait le travail comptable auditable.
// ---------------------------------------------------------------------------

import type Anthropic from "@anthropic-ai/sdk";
import * as extract from "./extractInvoiceFields.js";
import * as validate from "./validateInvoice.js";
import * as propose from "./proposeEcriture.js";
import * as route from "./routeByConfidence.js";

export interface ToolDef {
  schema: Anthropic.Tool;
  handler: (input: any) => unknown;
}

export const TOOLS: Record<string, ToolDef> = {
  extract_invoice_fields: { schema: extract.schema, handler: extract.handler },
  validate_invoice: { schema: validate.schema, handler: validate.handler },
  propose_ecriture: { schema: propose.schema, handler: propose.handler },
  route_by_confidence: { schema: route.schema, handler: route.handler },
};

export const TOOL_SCHEMAS: Anthropic.Tool[] = Object.values(TOOLS).map((t) => t.schema);

export { extract, validate, propose, route };
