# Agent de pré-comptabilisation

> Transforme un lot de **factures fournisseurs (PDF texte natif)** en **écritures comptables
> proposées**, validées et **routées selon un niveau de confiance** — avec un dashboard de
> révision et un export type **FEC**.

Ce n'est **pas** un pipeline linéaire. C'est un **agent** qui, pour chaque facture, *lit →
valide → décide → route* via de vrais outils (tool-calling Anthropic), en **human-in-the-loop** :
il ne comptabilise jamais automatiquement, il **propose et signale**. Chaque décision est
**justifiée en une phrase** pour la traçabilité d'un comptable.

---

## Le cœur : 4 outils agentiques

L'agent boucle sur chaque facture en appelant, dans l'ordre, 4 outils dont **le schéma est
exposé à Claude** et **le handler est du code déterministe et auditable** :

| Outil | Rôle | Ce que fait le code |
|-------|------|---------------------|
| `extract_invoice_fields` | Texte PDF → champs structurés | Regex sur le texte natif (fournisseur, SIREN, TVA intra, dates, montants HT/TVA/TTC multi-taux). |
| `validate_invoice` | Contrôles métier obligatoires | SIREN (Luhn), HT+TVA=TTC (±0,01 €), taux de TVA légal, doublon, mentions légales, flags métier. |
| `propose_ecriture` | Écriture équilibrée + confiance | Construit l'écriture (crédit 401 = Σ débits **par construction**), applique le traitement TVA, calcule un score de confiance auditable. |
| `route_by_confidence` | Décision human-in-the-loop | `auto-validé` si clair, sinon `à revoir` + motif. Une anomalie **bloquante** force toujours la revue. |

> **Principe directeur** : Claude **orchestre et justifie en langage naturel** ; il ne calcule
> **jamais** un montant comptable. Luhn, arithmétique TVA, seuils et déductibilité sont du code
> testable — c'est ce qui rend l'agent défendable devant un expert-comptable.

---

## La logique comptable (le MOAT)

Au-delà d'un simple parseur, l'agent encode de vraies règles métier françaises :

- **Déductibilité de la TVA en PRORATA** — la déduction n'est pas binaire, c'est un coefficient
  **1 / 0,8 / 0** appliqué de façon uniforme, la **fraction non déductible étant réintégrée au
  coût de la charge** (débit 6xx majoré) :
  - carburant **véhicule de tourisme** → **80 %** (20 % réintégrés) ; **véhicule utilitaire** →
    100 % ; recharge élec./GPL/GNV et péage → 100 % ;
  - achat de **véhicule de tourisme**, **hébergement**, **cadeaux** → **0 %** (TVA 100 % au coût) ;
  - restauration / réception → 100 % mais **à vérifier** → *à revoir*.
- **Mentions légales à conséquence réelle** — n° TVA intra manquant (montant ≥ 150 €) →
  **perte du droit à déduction** (coef 0) → anomalie bloquante → *à revoir*.
- **Immobilisation vs charge** — seuil dur à **500 € HT** (BOI-BIC-CHG-20-30-10), avec les vraies
  exceptions : matériel de **transport toujours immobilisé** (même < 500 €), **saucissonnage**
  (ensemble cohérent d'éléments unitaires < 500 € → prix global) → *à revoir*.
- **Autoliquidation intracommunautaire — écriture COMPLÈTE générée côté code.** Un achat de
  service UE sans TVA est autoliquidé en **4 lignes** (pas seulement flaggé) :

  | Compte | Rôle | Montant |
  |--------|------|---------|
  | `622600` (6xx) | charge = HT + part de TVA non déductible | HT (+ non déd.) |
  | `445662` | TVA déductible intracom (`= TVA_due × coef`, omise si 0) | déductible |
  | `401000` | fournisseur, **crédité au HT** (facture intracom = HT seul) | HT |
  | `445200` (4452) | **TVA due** intracom — **toujours le plein montant** | HT × taux |

  La TVA due (4452) est intégrale quel que soit le coef ; seule la jambe déductible (445662)
  suit le prorata, la fraction non déductible majorant la charge. **Équilibre par identité :**
  `débit = HT + TVA_due = crédit`, vérifié aux 3 coefficients (100 / 80 / 0 %). Le taux (défaut
  **20 %**, `TAUX_NORMAL_INTRACOM`, paramétrable) est *reconstitué* faute de TVA sur la facture,
  donc la pièce reste *à revoir*.

### Plan comptable simplifié utilisé
`607000` marchandises · `606400` achats non stockés · `613000` locations · `615000` entretien ·
`622600` honoraires · `625700` déplacements/réceptions · `626000` frais postaux & télécoms ·
`218300/218400/218200` immobilisations (info-bureau / mobilier / transport) ·
contreparties `401000` fournisseurs, `445660` TVA déductible B&S, `445620` TVA déductible immo,
`445662` TVA déductible intracom, `445200` (= `4452`) TVA due intracommunautaire.

> Tous les comptes sont écrits sur **6 chiffres** ; `445200` est le compte PCG `4452`
> « TVA due intracommunautaire » complété par des zéros, comme `4456` → `445660`.

---

## Démarrage

```bash
npm install
npm run seed      # génère 20 factures PDF texte natif dans data/invoices/
npm run demo      # traite le lot (mode déterministe, aucune clé API requise)
npm run dashboard # dashboard de révision -> http://localhost:5173
npm test          # tests déterministes (durcissement "champ critique manquant")
```

> Le dashboard lit `data/output/ecritures.json`. Ce fichier est un **artefact de démo committé**
> (exception au `.gitignore` de `data/output/`) pour que le dashboard s'affiche **dès le clone**,
> sans étape préalable. Il est **régénérable à l'identique** par `npm run demo` (sortie
> déterministe) — relancez la démo pour le rafraîchir après un changement de règles ou de seed.

### Mode agent réel (tool-calling Claude)

Le même traitement, mais l'**orchestration des 4 outils est déléguée à Claude** :

```bash
cp .env.example .env      # renseigner ANTHROPIC_API_KEY
npm run agent             # boucle agentique réelle (Anthropic SDK)
```

> `npm run demo` et `npm run agent` produisent les **mêmes livrables** : les handlers sont
> identiques, seule l'orchestration change. **Le mode déterministe est la source de vérité des
> montants** — la démo est reproductible et sans clé ; le mode agent démontre le tool-calling.
> Sans `ANTHROPIC_API_KEY`, `npm run agent` bascule automatiquement en déterministe. Le modèle
> par défaut est **Haiku** (`ANTHROPIC_MODEL`, surchargeable) : la boucle ne sert qu'à orchestrer.

### Garde-fous (ce qui rend l'agent défendable)

- **Aucun montant inventé par le LLM n'entre dans l'écriture.** Tous les chiffres (HT, TVA,
  arrondis, TVA due/déductible en autoliquidation) sortent des handlers déterministes. Claude
  orchestre et rédige la justification ; le system prompt lui interdit de citer un compte ou un
  montant **absent de l'écriture réellement produite**, ou un compte « à ajouter ».
- **Un champ critique perdu ne peut pas s'auto-valider.** Dans la boucle réelle, Claude
  re-sérialise lui-même les champs et peut en « perdre » un. Les handlers distinguent alors le
  *vide légitime* (`tvaParTaux = []` d'une autoliquidation) d'une *donnée perdue* (`tvaParTaux`
  absent) : dans ce dernier cas ils lèvent une anomalie **bloquante** et **plafonnent la
  confiance** (défense en profondeur, indépendante de ce que Claude retransmet) → la pièce part
  toujours **à revoir**, jamais en auto-validation d'une écriture équilibrée-mais-fausse. Couvert
  par `npm test`.

---

## Le jeu de factures d'exemple (20 cas)

10 cas propres (607/606/613/622/626/615, dont une TVA à 5,5 %) **+** 10 cas piégés :
doublon · TVA incohérente · SIREN invalide (Luhn) · mention légale manquante · restauration
(TVA à vérifier) · carburant véhicule de tourisme (**TVA à 80 %**) · immobilisation claire
(218300 + 445620) · mobilier saucissonné · **facture intracom sans TVA (autoliquidation complète
4452 / 445662)** · remorque < 500 € (transport toujours immobilisé) · achat de véhicule de tourisme
(**TVA à 0 %**, immobilisé 218200).

Résultat attendu : **10 auto-validées / 10 à revoir**, journal **équilibré (débit = crédit)**.

---

## Livrables produits

- `data/output/ecritures.json` — journal complet consolidé (champs extraits, anomalies, écriture,
  confiance, routage, justification). Source du dashboard.
- `data/output/fec-export.csv` — export type **FEC** (`JournalCode;EcritureDate;CompteNum;
  EcritureLib;PieceRef;Debit;Credit`), **limité aux écritures auto-validées** : l'agent ne
  comptabilise jamais ce qu'il n'a pas validé.
- **Dashboard de révision** (Vite + React) — bandeau de synthèse, table des factures (statut,
  compte, confiance, anomalies), filtre « à revoir uniquement », et panneau de détail par facture
  (écriture débit/crédit, justification, anomalies, champs extraits).
- **`docs/dashboard.html`** — snapshot statique autonome du dashboard (rendu depuis les données
  réelles, ouvrable au double-clic, sans serveur), régénéré à chaque `npm run demo`.

### Aperçu du dashboard

Ouvrir le snapshot statique après la démo :

```bash
open docs/dashboard.html        # macOS  (xdg-open sous Linux, start sous Windows)
```

> Pour un PNG dans ce README (`docs/dashboard.png`), ouvrez `docs/dashboard.html` et capturez
> l'écran, ou lancez le dashboard interactif : `npm run dashboard`.

---

## Architecture des fichiers

```
src/
  types.ts              schéma d'une écriture et des étapes de l'agent
  config.ts             plan comptable, seuils, règles de classification & déductibilité
  lib/
    siren.ts            validation SIREN (Luhn) + clé TVA intra
    tva.ts              arrondi comptable, cohérence HT+TVA=TTC, taux légal
    classify.ts         CŒUR MÉTIER : compte de charge, immobilisation, déductibilité TVA
                        (prorata), autoliquidation, champs critiques manquants
    pdf.ts              lecture du texte natif (pdfjs-dist)
    fec.ts              sérialisation FEC / CSV
  tools/                les 4 outils = { schema Claude, handler déterministe }
  agent/
    systemPrompt.ts     rôle de Claude + garde-fous de narration
    runAgent.ts         boucle tool-calling réelle (Anthropic) pour une facture
    processBatch.ts     orchestration du lot (modes déterministe | agent)
scripts/
  seed-invoices.ts      génère les 20 PDF d'exemple
  demo.ts               npm run demo / npm run agent
  test-champs-critiques.ts  npm test (durcissement champ critique manquant)
dashboard/              Vite + React (dashboard de révision)
```

---

## Périmètre

Entrée **PDF à texte natif uniquement** (factures dématérialisées). L'**OCR** est un *stretch
goal* explicite, **non implémenté** au départ. Persistance en **JSON local** (pas de base lourde).
