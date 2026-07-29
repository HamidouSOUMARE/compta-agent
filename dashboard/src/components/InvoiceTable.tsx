import type { DossierFacture } from "../../../src/types";
import { AnomalyBadges } from "./AnomalyBadges";

const eur = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

function confColor(c: number) {
  if (c >= 0.85) return "var(--ok)";
  if (c >= 0.5) return "var(--warn)";
  return "var(--danger)";
}

export function InvoiceTable({
  dossiers,
  selected,
  onSelect,
}: {
  dossiers: DossierFacture[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (dossiers.length === 0) {
    return <div className="table-wrap"><div className="empty">Aucune facture pour ce filtre.</div></div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fournisseur</th>
            <th>Compte</th>
            <th style={{ textAlign: "right" }}>TTC</th>
            <th>Confiance</th>
            <th>Statut</th>
            <th>Anomalies</th>
          </tr>
        </thead>
        <tbody>
          {dossiers.map((d) => (
            <tr
              key={d.id}
              className={selected === d.id ? "selected" : ""}
              onClick={() => onSelect(d.id)}
            >
              <td>
                <div className="supplier">{d.fields.fournisseur ?? "—"}</div>
                <div className="sub">{d.fields.numeroFacture ?? "—"} · {d.fields.dateFacture ?? "—"}</div>
              </td>
              <td className="num">
                {d.proposition.compteCharge}
                {d.proposition.estImmobilisation && <div className="sub">immo</div>}
              </td>
              <td className="num">{eur(d.fields.montantTTC)}</td>
              <td>
                <div className="conf-bar">
                  <span style={{ width: `${d.confidence * 100}%`, background: confColor(d.confidence) }} />
                </div>
                <div className="sub">{(d.confidence * 100).toFixed(0)}%</div>
              </td>
              <td>
                <span className={`badge ${d.statut === "auto-valide" ? "auto" : "revoir"}`}>
                  {d.statut === "auto-valide" ? "Auto-validé" : "À revoir"}
                </span>
              </td>
              <td><AnomalyBadges anomalies={d.anomalies} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
