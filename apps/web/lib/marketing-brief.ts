/**
 * Marketing brief generator (demo parity — Atto 3/4).
 *
 * The phone environment is briefed via a Markdown export, not runtime lookups:
 * this console authors the marketing content (product `Marketing Message`
 * copy) and exports a coherent brief the phone env imports. The generator
 * assembles the facts from the CRM so the brief always matches the demo data
 * (launch date, price, comparisons vs the previous generation, audience).
 */

import { duckdbQueryAsync } from "./workspace";
import { loadCrmFieldMaps } from "./crm-queries";
import { ONBOARDING_OBJECT_IDS } from "./workspace-schema-migrations";

export type BriefProduct = {
  id: string;
  name: string;
  brand: string | null;
  sku: string | null;
  price: string | null;
  availableFrom: string | null;
  status: string | null;
  marketingMessage: string | null;
};

export type BriefAudienceStats = {
  total: number;
  optIn: number;
  telegram: number;
  email: number;
};

async function loadProducts(): Promise<BriefProduct[]> {
  const fieldMaps = await loadCrmFieldMaps();
  const map = fieldMaps.product;
  const cols: Array<[string, string]> = [
    ["Name", "name"],
    ["Brand", "brand"],
    ["SKU", "sku"],
    ["Price", "price"],
    ["Available From", "availableFrom"],
    ["Status", "status"],
    ["Marketing Message", "marketingMessage"],
  ];
  const projections = cols
    .map(([f, alias]) => {
      const id = map[f];
      if (!id) {return `NULL AS "${alias}"`;}
      return `MAX(CASE WHEN ef.field_id = '${id}' THEN ef.value END) AS "${alias}"`;
    })
    .join(",\n      ");
  const rows = await duckdbQueryAsync<Record<string, string | null>>(
    `SELECT e.id AS entry_id, ${projections}
       FROM entries e
       LEFT JOIN entry_fields ef ON ef.entry_id = e.id
      WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.product}'
      GROUP BY e.id
      ORDER BY MAX(CASE WHEN ef.field_id = '${map["Available From"] ?? ""}' THEN ef.value END) DESC NULLS LAST;`,
  );
  return rows.map((r) => ({
    id: String(r.entry_id),
    name: r.name ?? "",
    brand: r.brand ?? null,
    sku: r.sku ?? null,
    price: r.price ?? null,
    availableFrom: r.availableFrom ?? null,
    status: r.status ?? null,
    marketingMessage: r.marketingMessage ?? null,
  }));
}

async function loadAudienceStats(): Promise<BriefAudienceStats> {
  const fieldMaps = await loadCrmFieldMaps();
  const optinId = fieldMaps.people["Marketing Opt-in"];
  const prefId = fieldMaps.people["Preferred Contact Channel"];
  if (!optinId && !prefId) {
    return { total: 0, optIn: 0, telegram: 0, email: 0 };
  }
  const rows = await duckdbQueryAsync<Record<string, string | null>>(
    `SELECT
       ${optinId ? `MAX(CASE WHEN ef.field_id = '${optinId}' THEN ef.value END)` : "NULL"} AS optin,
       ${prefId ? `MAX(CASE WHEN ef.field_id = '${prefId}' THEN ef.value END)` : "NULL"} AS pref
       FROM entries e
       LEFT JOIN entry_fields ef ON ef.entry_id = e.id
      WHERE e.object_id = '${ONBOARDING_OBJECT_IDS.people}'
      GROUP BY e.id;`,
  );
  let optIn = 0;
  let telegram = 0;
  let email = 0;
  for (const row of rows) {
    if (row.optin === "true") {optIn++;}
    if (row.pref === "telegram") {telegram++;}
    if (row.pref === "email") {email++;}
  }
  return { total: rows.length, optIn, telegram, email };
}

function fmtDate(iso: string | null): string {
  if (!iso) {return "—";}
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {return iso;}
  return d.toISOString().slice(0, 10);
}

/**
 * Build the Markdown brief for the phone environment. Promoted product =
 * `promotedSku` or the "Upcoming" product; previous generation =
 * `previousSku` or the newest non-promoted catalog entry.
 */
export async function buildMarketingBrief(opts?: {
  promotedSku?: string;
  previousSku?: string;
}): Promise<string> {
  const products = await loadProducts();
  const promoted =
    (opts?.promotedSku ? products.find((p) => p.sku === opts.promotedSku) : undefined)
    ?? products.find((p) => p.status === "Upcoming")
    ?? products[0];
  const previous =
    (opts?.previousSku ? products.find((p) => p.sku === opts.previousSku) : undefined)
    ?? products.find((p) => p.id !== promoted?.id && p.status !== "Upcoming")
    ?? null;
  const stats = await loadAudienceStats();

  const lines: string[] = [];
  lines.push(`# Brief di lancio — ${promoted?.name ?? "Prodotto"}`);
  lines.push("");
  lines.push(`> Generato da Crm-A Console il ${new Date().toISOString().slice(0, 10)}. Contenuto da importare nell'ambiente telefonico.`);
  lines.push("");

  lines.push("## 1. Prodotto e lancio");
  lines.push("");
  if (promoted) {
    lines.push(`- **Prodotto**: ${promoted.name}`);
    if (promoted.brand) {lines.push(`- **Marca**: ${promoted.brand}`);}
    if (promoted.sku) {lines.push(`- **SKU**: ${promoted.sku}`);}
    if (promoted.price) {lines.push(`- **Prezzo**: € ${promoted.price}`);}
    lines.push(`- **Disponibile dal**: ${fmtDate(promoted.availableFrom)}`);
    if (promoted.status) {lines.push(`- **Stato**: ${promoted.status}`);}
  }
  lines.push("");

  if (promoted?.marketingMessage) {
    lines.push("## 2. Messaggio di marketing (copy ufficiale)");
    lines.push("");
    lines.push(promoted.marketingMessage.trim());
    lines.push("");
  }

  lines.push("## 3. Confronto con il modello precedente");
  lines.push("");
  if (previous) {
    lines.push(`- **Precedente**: ${previous.name}${previous.price ? ` (€ ${previous.price})` : ""}`);
    lines.push(`- **Nuovo prodotto**: ${promoted?.name ?? "—"}${promoted?.price ? ` (€ ${promoted.price})` : ""}`);
  } else {
    lines.push("- Nessun modello precedente in catalogo.");
  }
  lines.push("");

  lines.push("## 4. Target di pubblico (segmento lancio)");
  lines.push("");
  lines.push(`- **Contatti totali**: ${stats.total}`);
  lines.push(`- **Con opt-in marketing**: ${stats.optIn}`);
  lines.push(`- **Preferenza Telegram**: ${stats.telegram}`);
  lines.push(`- **Preferenza email**: ${stats.email}`);
  lines.push("");
  lines.push("## 5. Esempio di risposta con memoria (post-acquisto)");
  lines.push("");
  lines.push(`> "Bentornato Lorenzo — si riferisce al suo ultimo acquisto. Il corriere ha preso in carico l'ordine; consegna prevista domani entro le 18."`);
  lines.push("");

  return lines.join("\n");
}