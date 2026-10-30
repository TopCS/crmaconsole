/**
 * Optional AI campaign proposal.
 *
 * The model receives only verified demo data (segment window/counts and the
 * public catalog) and returns a subject/body. It never saves a campaign and
 * never sends anything. Without a provider (or on any failure) we return the
 * same deterministic template used by the demo, so the flow never blocks.
 */

import { chatApiKey, resolveChatModel, type FetchLike } from "./chat";
import type { SegmentResult } from "./queries";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 20_000;

export type CatalogOption = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  isPublicReal: boolean;
};

export type CampaignProposal = {
  mode: "llm" | "template";
  subject: string;
  body: string;
  sources: string[];
  model: string | null;
  fallbackReason?: string;
};

function template(segment: SegmentResult, exhibition: CatalogOption | undefined): CampaignProposal {
  const title = exhibition?.title ?? "Vitalità dell'architettura italiana 1946-2026";
  const dates = exhibition ? `${exhibition.startDate} – ${exhibition.endDate}` : "";
  return {
    mode: "template",
    subject: `Rinnova la tua myMAXXI — ${title}`,
    body:
      `Con la tua card myMAXXI in scadenza, rinnova per continuare a seguire ` +
      `"${title}"${dates ? ` (${dates})` : ""}. ` +
      `La proposta è pensata per ${segment.counts.eligible} persone con interesse per l'architettura ` +
      `e consenso email valido. Bozza dimostrativa: nessun invio verrà effettuato.`,
    sources: exhibition ? [exhibition.id] : [],
    model: null,
  };
}

export async function generateCampaignProposal(params: {
  segment: SegmentResult;
  catalog: CatalogOption[];
  fetchImpl?: FetchLike;
  apiKey?: string | null;
  model?: string;
}): Promise<CampaignProposal> {
  const exhibition = params.catalog.find((item) => item.id === "X-ARCH-2026") ?? params.catalog[0];
  const fallback = () => template(params.segment, exhibition);
  const apiKey = params.apiKey === undefined ? chatApiKey() : params.apiKey;
  if (!apiKey) {return { ...fallback(), fallbackReason: "provider_not_configured" };}

  const model = params.model ?? resolveChatModel();
  const fetchImpl = params.fetchImpl ?? fetch;
  const prompt = [
    "Sei un copywriter per una demo non ufficiale di un museo.",
    "Rispondi SOLO con un oggetto JSON valido di forma {\"subject\":\"...\",\"body\":\"...\"}.",
    "Non usare markdown, non aggiungere testo fuori dal JSON.",
    `Segmento: ${params.segment.segmentName}. Finestra: ${params.segment.windowFrom} → ${params.segment.windowTo}. Persone eleggibili: ${params.segment.counts.eligible}.`,
    `Mostra: ${exhibition?.title ?? "nessuna"}; periodo: ${exhibition ? `${exhibition.startDate} → ${exhibition.endDate}` : "non disponibile"}.`,
    "Regole: cita solo la mostra e il rinnovo myMAXXI; non inventare prezzi, orari, presenze o benefici;",
    "non promettere invii; massimo 90 parole; tono professionale e sobrio; nessun riferimento a dati personali.",
  ].join("\n");

  try {
    const res = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3100",
        "X-Title": "CRM-A MAXXI demo",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Sei un copywriter preciso. Rispondi solo con JSON valido." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {return { ...fallback(), fallbackReason: `provider_http_${res.status}` };}
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {return { ...fallback(), fallbackReason: "provider_invalid_json" };}
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { subject?: unknown; body?: unknown };
    const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!subject || !body) {return { ...fallback(), fallbackReason: "provider_empty_content" };}
    return {
      mode: "llm",
      subject: subject.slice(0, 180),
      body: body.slice(0, 4000),
      sources: exhibition ? [exhibition.id] : [],
      model,
    };
  } catch {
    return { ...fallback(), fallbackReason: "provider_unreachable" };
  }
}
