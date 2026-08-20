// ---------------------------------------------------------------------------
// Génère un SNAPSHOT statique et autonome du dashboard de révision à partir de
// data/output/ecritures.json :
//   - docs/dashboard.html          (page autonome, ouvrable au double-clic)
//   - docs/_embed-body.html        (corps seul, pour intégration dans une page)
// Aucun navigateur requis : rendu côté serveur.
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, ECRITURES_JSON } from "../src/store.js";
import type { Anomalie, BatchResult, DossierFacture } from "../src/types.js";

const LIB_ANOMALIE: Record<string, string> = {
  SIREN_INVALIDE: "SIREN invalide",
  TVA_INCOHERENTE: "TVA incohérente",
  TTC_INCOHERENT: "TTC incohérent",
  DOUBLON: "Doublon",
  MENTION_MANQUANTE: "Mention manquante",
  COMPTE_AMBIGU: "Compte ambigu",
  TVA_NON_DEDUCTIBLE: "TVA non déductible",
  TVA_A_VERIFIER: "TVA à vérifier",
  IMMOBILISATION: "Immobilisation",
  AUTOLIQUIDATION: "Autoliquidation",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function confClass(c: number) {
  return c >= 0.85 ? "hi" : c >= 0.5 ? "mid" : "lo";
}

function chips(anomalies: Anomalie[]): string {
  if (!anomalies.length) return `<span class="chip ok">Conforme</span>`;
  return anomalies
    .map((a) => `<span class="chip ${a.gravite}" title="${esc(a.message)}">${LIB_ANOMALIE[a.code] ?? a.code}</span>`)
    .join(" ");
}

function row(d: DossierFacture): string {
  const f = d.fields;
  const auto = d.statut === "auto-valide";
  return `<tr>
    <td class="sev ${auto ? "sev-ok" : "sev-warn"}"></td>
    <td>
      <div class="fournisseur">${esc(f.fournisseur ?? "—")}</div>
      <div class="muted small">${esc(f.numeroFacture ?? "—")} · ${esc(f.dateFacture ?? "—")}</div>
    </td>
    <td class="desig muted">${esc((f.designation ?? "—").slice(0, 42))}</td>
    <td class="mono compte">${d.proposition.compteCharge}${d.proposition.estImmobilisation ? '<span class="tag">immo</span>' : ""}</td>
    <td class="mono num">${eur(f.montantTTC)}</td>
    <td class="conf">
      <div class="bar"><span class="${confClass(d.confidence)}" style="width:${Math.round(d.confidence * 100)}%"></span></div>
      <span class="mono small muted">${Math.round(d.confidence * 100)}%</span>
    </td>
    <td><span class="pill ${auto ? "auto" : "revoir"}">${auto ? "Auto-validé" : "À revoir"}</span></td>
    <td class="chips">${chips(d.anomalies)}</td>
  </tr>`;
}

function ecritureCard(d: DossierFacture): string {
  const e = d.ecriture;
  const lignes = e.lignes
    .map(
      (l) => `<tr>
        <td class="mono compte">${l.compte}</td>
        <td class="muted small">${esc(l.libelle)}</td>
        <td class="mono num">${l.debit ? eur(l.debit) : ""}</td>
        <td class="mono num">${l.credit ? eur(l.credit) : ""}</td>
      </tr>`
    )
    .join("");
  return `<article class="card">
    <header>
      <h3>${esc(d.fields.fournisseur ?? "—")}</h3>
      <span class="pill revoir">À revoir · ${Math.round(d.confidence * 100)}%</span>
    </header>
    <p class="justif">${esc(d.justification)}</p>
    <p class="motif">→ ${esc(d.motifRoutage)}</p>
    <div class="tablewrap">
      <table class="ecriture">
        <thead><tr><th>Compte</th><th>Libellé</th><th class="num">Débit</th><th class="num">Crédit</th></tr></thead>
        <tbody>${lignes}
          <tr class="total"><td colspan="2">Totaux</td><td class="mono num">${eur(e.totalDebit)}</td><td class="mono num">${eur(e.totalCredit)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="chips">${d.ecriture.equilibre ? '<span class="chip ok">Équilibré ✓</span>' : '<span class="chip bloquante">Déséquilibré ✗</span>'} ${chips(d.anomalies)}</div>
  </article>`;
}

const STYLE = `<style>
  :root{
    --bg:#f7f8fa; --panel:#ffffff; --panel-2:#f1f4f8; --border:#dce1e8;
    --ink:#1b2430; --muted:#697588; --accent:#2563a8;
    --ok:#1a8f52; --ok-bg:#e6f4ec; --warn:#b6791b; --warn-bg:#fbf1dd; --danger:#c0392b; --danger-bg:#fbe9e7;
    --mono:ui-monospace,"SFMono-Regular","JetBrains Mono",Menlo,monospace;
  }
  @media (prefers-color-scheme:dark){
    :root{ --bg:#0f1620; --panel:#18212e; --panel-2:#212c3b; --border:#2c3a4c;
      --ink:#e7edf5; --muted:#93a1b5; --accent:#5aa9f0;
      --ok:#3ad07f; --ok-bg:rgba(58,208,127,.13); --warn:#e9a838; --warn-bg:rgba(233,168,56,.14); --danger:#f0685a; --danger-bg:rgba(240,104,90,.14); }
  }
  :root[data-theme="light"]{ --bg:#f7f8fa; --panel:#fff; --panel-2:#f1f4f8; --border:#dce1e8; --ink:#1b2430; --muted:#697588; --accent:#2563a8; --ok:#1a8f52; --ok-bg:#e6f4ec; --warn:#b6791b; --warn-bg:#fbf1dd; --danger:#c0392b; --danger-bg:#fbe9e7; }
  :root[data-theme="dark"]{ --bg:#0f1620; --panel:#18212e; --panel-2:#212c3b; --border:#2c3a4c; --ink:#e7edf5; --muted:#93a1b5; --accent:#5aa9f0; --ok:#3ad07f; --ok-bg:rgba(58,208,127,.13); --warn:#e9a838; --warn-bg:rgba(233,168,56,.14); --danger:#f0685a; --danger-bg:rgba(240,104,90,.14); }
  *{box-sizing:border-box}
  body{margin:0}
  .wrap{max-width:1180px;margin:0 auto;padding:32px 24px 64px;color:var(--ink);
    background:var(--bg);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;
    font-variant-numeric:tabular-nums;min-height:100vh;}
  .mast h1{margin:0 0 4px;font-size:23px;letter-spacing:-.01em;text-wrap:balance}
  .mast p{margin:0;color:var(--muted);max-width:64ch}
  .mast .meta{margin-top:8px;font-size:12px;color:var(--muted)}
  .mast .meta code{color:var(--accent);font-family:var(--mono)}
  .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:22px 0}
  .stat{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
  .stat .v{font-size:25px;font-weight:700;letter-spacing:-.02em}
  .stat .l{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-top:3px}
  .stat.ok .v{color:var(--ok)} .stat.warn .v{color:var(--warn)} .stat.bal .v{font-size:18px}
  h2.sec{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:30px 0 12px;font-weight:600}
  .tablewrap{overflow-x:auto;background:var(--panel);border:1px solid var(--border);border-radius:12px}
  table{width:100%;border-collapse:collapse;min-width:760px}
  thead th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;padding:11px 12px;border-bottom:1px solid var(--border)}
  tbody td{padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:middle}
  tbody tr:last-child td{border-bottom:none}
  .mono{font-family:var(--mono)} .num{text-align:right;white-space:nowrap} .small{font-size:12px} .muted{color:var(--muted)}
  .sev{width:4px;padding:0!important} .sev-ok{background:var(--ok)} .sev-warn{background:var(--warn)}
  .fournisseur{font-weight:600} .desig{max-width:230px} .compte{color:var(--accent)}
  .tag{margin-left:6px;font-size:10px;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 4px;font-family:system-ui}
  .conf{white-space:nowrap} .bar{display:inline-block;width:58px;height:6px;border-radius:99px;background:var(--border);overflow:hidden;vertical-align:middle;margin-right:6px}
  .bar span{display:block;height:100%} .bar .hi{background:var(--ok)} .bar .mid{background:var(--warn)} .bar .lo{background:var(--danger)}
  .pill{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}
  .pill.auto{color:var(--ok);background:var(--ok-bg)} .pill.revoir{color:var(--warn);background:var(--warn-bg)}
  .chips{display:flex;flex-wrap:wrap;gap:4px}
  .chip{display:inline-block;padding:2px 7px;border-radius:6px;font-size:10.5px;font-weight:600;white-space:nowrap}
  .chip.ok{color:var(--ok);background:var(--ok-bg)} .chip.avertissement{color:var(--warn);background:var(--warn-bg)} .chip.bloquante{color:var(--danger);background:var(--danger-bg)}
  .cards{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px}
  .card header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}
  .card h3{margin:0;font-size:15px}
  .justif{margin:0 0 4px;background:var(--panel-2);border-left:3px solid var(--accent);padding:9px 11px;border-radius:6px}
  .motif{margin:0 0 10px;color:var(--muted);font-size:12.5px}
  table.ecriture{min-width:0} table.ecriture th{padding:6px 8px} table.ecriture td{padding:6px 8px;font-size:12.5px}
  table.ecriture .total td{font-weight:700;border-top:2px solid var(--border);border-bottom:none}
  @media (max-width:820px){ .stats{grid-template-columns:repeat(2,1fr)} .cards{grid-template-columns:1fr} }
</style>`;

function renderBody(batch: BatchResult): string {
  const equilibre = Math.abs(batch.totalDebit - batch.totalCredit) <= 0.01;
  const rows = batch.dossiers.map(row).join("\n");
  const cartes = batch.dossiers.filter((d) => d.statut === "a-revoir").map(ecritureCard).join("\n");
  const date = new Date(batch.generatedAt).toLocaleString("fr-FR");

  return `${STYLE}
<div class="wrap">
  <header class="mast">
    <h1>Agent de pré-comptabilisation — dashboard de révision</h1>
    <p>Factures fournisseurs → écritures proposées, validées et routées par niveau de confiance. Human-in-the-loop : aucune écriture n'est postée automatiquement.</p>
    <div class="meta">Lot du ${esc(date)} · mode <code>${batch.mode}</code> · ${batch.totalFactures} factures</div>
  </header>

  <section class="stats">
    <div class="stat"><div class="v">${batch.totalFactures}</div><div class="l">Factures traitées</div></div>
    <div class="stat ok"><div class="v">${batch.autoValides}</div><div class="l">Auto-validées</div></div>
    <div class="stat warn"><div class="v">${batch.aRevoir}</div><div class="l">À revoir</div></div>
    <div class="stat bal"><div class="v">${eur(batch.totalDebit)} €</div><div class="l">Total débit</div></div>
    <div class="stat bal"><div class="v" style="color:${equilibre ? "var(--ok)" : "var(--danger)"}">${equilibre ? "Équilibré ✓" : "Déséquilibré ✗"}</div><div class="l">Débit = Crédit</div></div>
  </section>

  <h2 class="sec">Journal des écritures proposées</h2>
  <div class="tablewrap">
    <table>
      <thead><tr><th></th><th>Fournisseur</th><th>Désignation</th><th>Compte</th><th class="num">TTC</th><th>Confiance</th><th>Statut</th><th>Anomalies</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>

  <h2 class="sec">Pièces routées « à revoir » — écriture proposée &amp; motif</h2>
  <div class="cards">
${cartes}
  </div>
</div>`;
}

export async function generateSnapshot(batch: BatchResult): Promise<string> {
  const body = renderBody(batch);
  await mkdir(resolve(ROOT, "docs"), { recursive: true });

  const standalone = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard de révision — pré-comptabilisation</title></head>
<body>
${body}
</body>
</html>`;

  const out = resolve(ROOT, "docs/dashboard.html");
  await writeFile(out, standalone, "utf8");
  await writeFile(resolve(ROOT, "docs/_embed-body.html"), body, "utf8");
  return out;
}

async function main() {
  const batch = JSON.parse(await readFile(ECRITURES_JSON, "utf8")) as BatchResult;
  const out = await generateSnapshot(batch);
  console.log(`✅ Snapshot généré : ${out} (+ docs/_embed-body.html)`);
}

// Exécution directe (npm run snapshot) uniquement.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
