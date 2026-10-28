/**
 * Deterministic, grounded answers over the MAXXI demo data.
 *
 * This is the "no-cloud fallback": it never invents numbers. Every answer
 * carries the query window, the counts and the evidence IDs (person/event/
 * source records) it was derived from. If the data cannot answer, it says so.
 */

import { evaluateArchRenewal45d, getPerson360, listAudit, listCampaigns, listSources } from "./queries";
import { MAXXI_CLOCK_ISO } from "./store";

export type AgentAnswer = {
  question: string;
  intent: string;
  answer: string;
  grounded: boolean;
  window?: { from: string; to: string };
  counts?: Record<string, number>;
  evidence: Array<{ kind: string; id: string; detail?: string }>;
  citations: string[];
  fallback: true;
};

const NO_EVIDENCE =
  "Non ho evidenze sufficienti su questo punto nei dati dimostrativi caricati.";

export async function askMaxxi(question: string): Promise<AgentAnswer> {
  const text = question.toLowerCase();
  const base = {
    question,
    fallback: true as const,
    citations: [] as string[],
  };

  // Renewal / architecture audience
  if (/(rinnovo|scadenza|scadono|in scadenza)/.test(text) && /(architettur|my ?maxxi|card)/.test(text)) {
    const segment = await evaluateArchRenewal45d();
    const evidence = segment.eligible.map((member) => ({
      kind: "person",
      id: member.personId,
      detail: `${member.name} — ${member.email}`,
    }));
    const consentExcluded = segment.excluded
      .filter((member) => member.segmentReason === "excluded_consent")
      .map((member) => ({ kind: "person", id: member.personId, detail: `escluso: consenso` }));

    return {
      ...base,
      intent: "segment_arch_renewal_45d",
      grounded: true,
      window: { from: segment.windowFrom, to: segment.windowTo },
      answer:
        `${segment.counts.eligible} persone risultano contattabili via email: interesse esplicito per l'architettura, ` +
        `card myMAXXI in scadenza tra ${segment.windowFrom} e ${segment.windowTo}, almeno un'interazione negli ultimi 365 giorni ` +
        `e consenso event_marketing/email valido. ` +
        `Esclusi per consenso non valido: ${segment.counts.excludedConsent}; per identità incerta: ${segment.counts.excludedIdentity}; ` +
        `per dati mancanti/condizioni non soddisfatte: ${segment.counts.excludedMissingData}. ` +
        `Orologio demo: ${MAXXI_CLOCK_ISO}.`,
      counts: {
        eligible: segment.counts.eligible,
        excludedConsent: segment.counts.excludedConsent,
        excludedIdentity: segment.counts.excludedIdentity,
        excludedMissingData: segment.counts.excludedMissingData,
      },
      evidence: [...evidence, ...consentExcluded],
      citations: ["maxxi_identity_link", "maxxi_membership", "maxxi_person_interest", "maxxi_consent", "maxxi_event"],
    };
  }

  // Person lookup
  if (/(chi e'|chi è|profilo|riepiloga|sappiamo di)/.test(text)) {
    const nameMatch = question.match(/([A-ZÀ-Ý][a-zà-ÿ]+)\s+([A-ZÀ-Ý][a-zà-ÿ]+)/);
    if (nameMatch) {
      const full = `${nameMatch[1]} ${nameMatch[2]}`;
      const { listPeople } = await import("./queries");
      const people = await listPeople({ limit: 200 });
      const found = people.find((person) => person.name.toLowerCase() === full.toLowerCase());
      if (found) {
        const person = await getPerson360(found.id);
        if (person) {
          const sources = [...new Set(person.identityLinks.map((link) => link.sourceSystem))];
          return {
            ...base,
            intent: "person_360",
            grounded: true,
            answer:
              `${person.person.name} (${person.person.email}) — ${person.identityLinks.length} identificativi di origine ` +
              `(${sources.join(", ") || "nessuno"}), ${person.timeline.length} eventi, ` +
              `${person.memberships.length} membership, ${person.feedback.length} richieste infopoint. ` +
              `Consensi: ${person.consents.map((c) => `${c.purpose}/${c.channel}=${c.status}`).join(", ") || "nessuno"}. ` +
              (person.dataQuality.identityIsCertain ? "Identità verificata." : "Identità da verificare."),
            evidence: [
              ...person.identityLinks.map((link) => ({ kind: "source", id: `${link.sourceSystem}:${link.sourceRecordId}` })),
              ...person.timeline.map((event) => ({ kind: "event", id: event.eventId, detail: event.type })),
            ],
            citations: ["maxxi_person", "maxxi_identity_link", "maxxi_event", "maxxi_membership", "maxxi_consent"],
          };
        }
      }
      return { ...base, intent: "person_360", grounded: false, answer: NO_EVIDENCE, evidence: [], citations: [] };
    }
  }

  // Donations / donors — explicitly unsupported
  if (/(donazion|donator|donor|donat|donare|sponsor|contribut)/.test(text)) {
    return {
      ...base,
      intent: "donations",
      grounded: false,
      answer:
        `${NO_EVIDENCE} Nel dataset dimostrativo non esistono importi di donazione o sponsorizzazione: ` +
        `posso solo dire se esiste una relazione organizzazione-contatto, non una cifra.`,
      evidence: [],
      citations: ["maxxi_organization", "maxxi_relationship"],
    };
  }

  // Campaigns
  if (/(campagn|bozza|comunicazione)/.test(text)) {
    const [campaigns, audit] = await Promise.all([listCampaigns(), listAudit(20)]);
    return {
      ...base,
      intent: "campaigns",
      grounded: true,
      answer:
        `${campaigns.length} bozze di campagna in modalità dry-run; ` +
        `${audit.filter((row) => row.action === "campaign_approval_simulated").length} approvazioni simulate. Nessun invio esterno.`,
      counts: { campaigns: campaigns.length, auditRows: audit.length },
      evidence: campaigns.map((c) => ({ kind: "campaign", id: c.campaignId, detail: c.status })),
      citations: ["maxxi_campaign", "maxxi_action_audit"],
    };
  }

  // Sources
  if (/(font|sorgent|provenienz|qualità|qualita)/.test(text)) {
    const sources = await listSources();
    return {
      ...base,
      intent: "sources",
      grounded: true,
      answer:
        `${sources.length} fonti registrate (tutte simulate): ` +
        sources.map((s) => `${s.sourceSystem} (${s.rowCount} righe, ${s.quarantinedCount} da revisionare)`).join("; ") + ".",
      counts: { sources: sources.length },
      evidence: sources.map((s) => ({ kind: "source", id: s.sourceSystem, detail: s.mockOrLive })),
      citations: ["maxxi_source_registry"],
    };
  }

  // Anything else: no invention.
  return {
    ...base,
    intent: "unknown",
    grounded: false,
    answer: `${NO_EVIDENCE} Prova a chiedere del pubblico in scadenza myMAXXI, di una persona, delle fonti o delle campagne.`,
    evidence: [],
    citations: [],
  };
}
