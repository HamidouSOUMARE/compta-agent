import { useMemo, useState } from "react";
import { BATCH } from "./api";
import { InvoiceTable } from "./components/InvoiceTable";
import { EcritureView } from "./components/EcritureView";

const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function App() {
  const [aRevoirOnly, setARevoirOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(BATCH.dossiers[0]?.id ?? null);

  const visible = useMemo(
    () => (aRevoirOnly ? BATCH.dossiers.filter((d) => d.statut === "a-revoir") : BATCH.dossiers),
    [aRevoirOnly]
  );

  const selectedDossier =
    BATCH.dossiers.find((d) => d.id === selected) ?? visible[0] ?? BATCH.dossiers[0];

  const equilibre = Math.abs(BATCH.totalDebit - BATCH.totalCredit) <= 0.01;

  return (
    <div className="app">
      <header className="masthead">
        <h1>Agent de pré-comptabilisation</h1>
        <p>Factures fournisseurs → écritures proposées, validées et routées par niveau de confiance.</p>
        <div className="meta">
          Lot du {new Date(BATCH.generatedAt).toLocaleString("fr-FR")} · mode{" "}
          <code>{BATCH.mode}</code> · human-in-the-loop (aucune écriture postée automatiquement)
        </div>
      </header>

      <section className="stats">
        <div className="stat">
          <div className="value">{BATCH.totalFactures}</div>
          <div className="label">Factures traitées</div>
        </div>
        <div className="stat ok">
          <div className="value">{BATCH.autoValides}</div>
          <div className="label">Auto-validées</div>
        </div>
        <div className="stat warn">
          <div className="value">{BATCH.aRevoir}</div>
          <div className="label">À revoir</div>
        </div>
        <div className="stat balance">
          <div className="value">{eur(BATCH.totalDebit)} €</div>
          <div className="label">Total débit</div>
        </div>
        <div className="stat balance">
          <div className="value" style={{ color: equilibre ? "var(--ok)" : "var(--danger)" }}>
            {equilibre ? "Équilibré ✓" : "Déséquilibré ✗"}
          </div>
          <div className="label">Débit = Crédit</div>
        </div>
      </section>

      <div className="toolbar">
        <label className="filter">
          <input
            type="checkbox"
            checked={aRevoirOnly}
            onChange={(e) => setARevoirOnly(e.target.checked)}
          />
          Afficher uniquement « à revoir »
        </label>
        <span className="spacer" />
        <span className="count">{visible.length} facture(s) affichée(s)</span>
      </div>

      <div className="layout">
        <InvoiceTable dossiers={visible} selected={selectedDossier?.id ?? null} onSelect={setSelected} />
        {selectedDossier ? (
          <EcritureView dossier={selectedDossier} />
        ) : (
          <div className="detail"><div className="empty">Sélectionnez une facture.</div></div>
        )}
      </div>
    </div>
  );
}
