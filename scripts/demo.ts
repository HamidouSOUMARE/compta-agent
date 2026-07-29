// ---------------------------------------------------------------------------
// Script de démo : traite tout le lot de factures et écrit les livrables.
//   npm run demo    -> mode déterministe (aucune clé API requise)
//   npm run agent   -> mode agent réel (Claude tool-calling, ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { processBatch } from "../src/agent/processBatch.js";
import { persistBatch, ECRITURES_JSON, FEC_CSV, INVOICES_DIR, ROOT } from "../src/store.js";
import { generateSnapshot } from "./snapshot.js";

// Charge .env puis .env.local (qui a priorité) — sans dépendance externe.
for (const name of [".env", ".env.local"]) {
  const p = resolve(ROOT, name);
  if (existsSync(p)) process.loadEnvFile(p);
}

async function main() {
  const wantAgent = process.argv.includes("--agent");
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const mode: "deterministe" | "agent" = wantAgent && hasKey ? "agent" : "deterministe";

  if (wantAgent && !hasKey) {
    console.log("⚠️  ANTHROPIC_API_KEY absente : bascule en mode déterministe.\n");
  }

  try {
    await access(INVOICES_DIR);
  } catch {
    console.error("❌ Aucune facture. Lance d'abord : npm run seed");
    process.exit(1);
  }

  console.log(`🚀 Traitement du lot en mode « ${mode} »\n`);
  const batch = await processBatch(mode);
  await persistBatch(batch);
  await generateSnapshot(batch);

  console.log("\n──────── Synthèse ────────");
  console.log(`Factures traitées : ${batch.totalFactures}`);
  console.log(`  ✅ auto-validées : ${batch.autoValides}`);
  console.log(`  🔎 à revoir      : ${batch.aRevoir}`);
  console.log(`Total débit = ${batch.totalDebit.toFixed(2)} €  |  crédit = ${batch.totalCredit.toFixed(2)} €`);
  const equilibre = Math.abs(batch.totalDebit - batch.totalCredit) <= 0.01;
  console.log(`Équilibre global : ${equilibre ? "OK ✅" : "DÉSÉQUILIBRE ❌"}`);
  console.log("\nLivrables :");
  console.log(`  • ${ECRITURES_JSON}`);
  console.log(`  • ${FEC_CSV}`);
  console.log(`  • docs/dashboard.html  (snapshot statique, ouvrable au double-clic)`);
  console.log("\n👉 Dashboard interactif : npm run dashboard");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
