/**
 * MAXXI demo read facade.
 *
 * All numbers are computed from the seeded demo database at the fixed demo
 * clock — nothing is hardcoded in the UI. Every row carries provenance
 * (source_system + source_record_id) so the operator can explain "where this
 * comes from".
 */

import { MAXXI_NOW_MS, maxxiExec, maxxiQuery } from "./store";

const DAY_MS = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type PersonSummary = {
  id: string;
  name: string;
  email: string;
  language: string;
  interests: string[];
  links: number;
  memberships: number;
  lastEventAt: string | null;
};

export async function listPeople(options?: { limit?: number; search?: string }): Promise<PersonSummary[]> {
  const limit = Math.max(1, Math.min(200, options?.limit ?? 100));
  const search = (options?.search ?? "").trim().replace(/'/g, "''");
  const where = search
    ? `WHERE p.name ILIKE '%${search}%' OR p.email ILIKE '%${search}%' OR p.person_id ILIKE '%${search}%'`
    : "";
  const rows = await maxxiQuery<{
    person_id: string;
    name: string;
    email: string;
    language: string;
    interests: string | null;
    links: number | string;
    memberships: number | string;
    last_event_at: string | null;
  }>(`
    SELECT p.person_id, p.name, p.email, p.language,
      (SELECT STRING_AGG(i.interest, ',') FROM maxxi_person_interest i
        WHERE i.person_id = p.person_id AND i.kind = 'explicit') AS interests,
      (SELECT COUNT(*) FROM maxxi_identity_link l WHERE l.person_id = p.person_id AND l.status = 'linked') AS links,
      (SELECT COUNT(*) FROM maxxi_membership m WHERE m.person_id = p.person_id) AS memberships,
      (SELECT MAX(e.occurred_at) FROM maxxi_event e WHERE e.person_id = p.person_id) AS last_event_at
    FROM maxxi_person p
    ${where}
    ORDER BY p.name ASC
    LIMIT ${limit};
  `);
  return rows.map((row) => ({
    id: row.person_id,
    name: row.name,
    email: row.email,
    language: row.language,
    interests: row.interests ? row.interests.split(",").filter(Boolean) : [],
    links: Number(row.links ?? 0),
    memberships: Number(row.memberships ?? 0),
    lastEventAt: row.last_event_at,
  }));
}

export type Person360 = {
  person: {
    id: string;
    name: string;
    email: string;
    language: string;
    interestsExplicit: string[];
  };
  identityLinks: Array<{
    sourceSystem: string;
    sourceRecordId: string;
    matchMethod: string;
    confidence: number;
    status: string;
    matchedAt: string | null;
  }>;
  reviewCandidates: Array<{
    candidateId: string;
    name: string;
    email: string;
    sourceSystem: string;
    sourceRecordId: string;
    reason: string;
    status: string;
  }>;
  timeline: Array<{
    eventId: string;
    type: string;
    occurredAt: string;
    sourceSystem: string;
    sourceRecordId: string;
    catalogItemId: string | null;
    properties: Record<string, unknown>;
  }>;
  memberships: Array<{
    membershipId: string;
    cardCode: string;
    product: string;
    validFrom: string;
    validTo: string;
    status: string;
    sourceSystem: string;
  }>;
  consents: Array<{
    purpose: string;
    channel: string;
    status: string;
    capturedAt: string | null;
    sourceSystem: string;
    sourceRecordId: string;
  }>;
  feedback: Array<{
    caseId: string;
    channel: string;
    category: string;
    status: string;
    openedAt: string;
    summary: string;
  }>;
  organizations: Array<{ organizationId: string; name: string; type: string }>;
  dataQuality: { hasProvenance: boolean; identityIsCertain: boolean; notes: string[] };
};

export async function getPerson360(personId: string): Promise<Person360 | null> {
  const people = await maxxiQuery<{ person_id: string; name: string; email: string; language: string }>(
    `SELECT person_id, name, email, language FROM maxxi_person WHERE person_id = '${personId.replace(/'/g, "''")}' LIMIT 1;`,
  );
  const person = people[0];
  if (!person) {return null;}

  const safe = personId.replace(/'/g, "''");

  const interests = await maxxiQuery<{ interest: string }>(
    `SELECT interest FROM maxxi_person_interest WHERE person_id = '${safe}' AND kind = 'explicit' ORDER BY interest;`,
  );
  const links = await maxxiQuery<{
    source_system: string; source_record_id: string; match_method: string;
    confidence: number | string; status: string; matched_at: string | null;
  }>(`SELECT source_system, source_record_id, match_method, confidence, status, matched_at
      FROM maxxi_identity_link WHERE person_id = '${safe}' ORDER BY source_system;`);

  // Only candidates that plausibly refer to THIS person (same name or email).
  // Showing the global review queue on every profile was confusing: it made
  // unrelated visitors look like duplicates.
  const safeName = person.name.replace(/'/g, "''");
  const safeEmail = person.email.replace(/'/g, "''");
  const candidates = await maxxiQuery<{
    candidate_id: string; name: string; email: string; source_system: string;
    source_record_id: string; reason: string; status: string;
  }>(`SELECT candidate_id, name, email, source_system, source_record_id, reason, status
      FROM maxxi_review_candidate
      WHERE lower(name) = lower('${safeName}') OR lower(email) = lower('${safeEmail}')
      ORDER BY candidate_id;`);

  const events = await maxxiQuery<{
    event_id: string; type: string; occurred_at: string; source_system: string;
    source_record_id: string; catalog_item_id: string | null; properties_json: string;
  }>(`SELECT event_id, type, occurred_at, source_system, source_record_id, catalog_item_id, properties_json
      FROM maxxi_event WHERE person_id = '${safe}' ORDER BY occurred_at DESC;`);

  const memberships = await maxxiQuery<{
    membership_id: string; card_code: string; product: string; valid_from: string;
    valid_to: string; status: string; source_system: string;
  }>(`SELECT membership_id, card_code, product, valid_from, valid_to, status, source_system
      FROM maxxi_membership WHERE person_id = '${safe}' ORDER BY valid_to DESC;`);

  const consents = await maxxiQuery<{
    purpose: string; channel: string; status: string; captured_at: string | null;
    source_system: string; source_record_id: string;
  }>(`SELECT purpose, channel, status, captured_at, source_system, source_record_id
      FROM maxxi_consent WHERE person_id = '${safe}' ORDER BY purpose;`);

  const feedback = await maxxiQuery<{
    case_id: string; channel: string; category: string; status: string;
    opened_at: string; summary: string;
  }>(`SELECT case_id, channel, category, status, opened_at, summary
      FROM maxxi_feedback_case WHERE person_id = '${safe}' ORDER BY opened_at DESC;`);

  const orgs = await maxxiQuery<{ organization_id: string; name: string; relationship_kind: string }>(
    `SELECT o.organization_id, o.name, o.relationship_kind
       FROM maxxi_relationship r JOIN maxxi_organization o ON o.organization_id = r.organization_id
      WHERE r.person_id = '${safe}';`,
  );

  const notes: string[] = [];
  if (links.length === 0) {notes.push("Nessun identificativo di origine collegato: profilo non verificato.");}
  if (events.some((event) => event.type === "exhibition_ticket_purchased")) {
    notes.push("Un acquisto non implica la presenza effettiva in museo.");
  }

  return {
    person: {
      id: person.person_id,
      name: person.name,
      email: person.email,
      language: person.language,
      interestsExplicit: interests.map((row) => row.interest),
    },
    identityLinks: links.map((row) => ({
      sourceSystem: row.source_system,
      sourceRecordId: row.source_record_id,
      matchMethod: row.match_method,
      confidence: Number(row.confidence ?? 0),
      status: row.status,
      matchedAt: row.matched_at,
    })),
    reviewCandidates: candidates.map((row) => ({
      candidateId: row.candidate_id,
      name: row.name,
      email: row.email,
      sourceSystem: row.source_system,
      sourceRecordId: row.source_record_id,
      reason: row.reason,
      status: row.status,
    })),
    timeline: events.map((row) => ({
      eventId: row.event_id,
      type: row.type,
      occurredAt: row.occurred_at,
      sourceSystem: row.source_system,
      sourceRecordId: row.source_record_id,
      catalogItemId: row.catalog_item_id,
      properties: safeParse(row.properties_json),
    })),
    memberships: memberships.map((row) => ({
      membershipId: row.membership_id,
      cardCode: row.card_code,
      product: row.product,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      status: row.status,
      sourceSystem: row.source_system,
    })),
    consents: consents.map((row) => ({
      purpose: row.purpose,
      channel: row.channel,
      status: row.status,
      capturedAt: row.captured_at,
      sourceSystem: row.source_system,
      sourceRecordId: row.source_record_id,
    })),
    feedback: feedback.map((row) => ({
      caseId: row.case_id,
      channel: row.channel,
      category: row.category,
      status: row.status,
      openedAt: row.opened_at,
      summary: row.summary,
    })),
    organizations: orgs.map((row) => ({
      organizationId: row.organization_id,
      name: row.name,
      type: row.relationship_kind,
    })),
    dataQuality: {
      hasProvenance: links.length > 0,
      identityIsCertain: links.every((link) => Number(link.confidence ?? 0) >= 0.95),
      notes,
    },
  };
}

function safeParse(raw: string | null): Record<string, unknown> {
  if (!raw) {return {};}
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type DashboardKpis = {
  identifiedPeople: number;
  linkedPeople: number;
  anonymousSubjects: number;
  totalEvents: number;
  attendedVisits: number;
  purchases: number;
  membershipsExpiring45d: number;
  membershipsExpired: number;
  openFeedback: number;
  pendingReviews: number;
  sources: number;
  lastImportAt: string | null;
};

export async function getDashboardKpis(): Promise<DashboardKpis> {
  const [people, linked, anon, events, visits, purchases, expiring, expired, feedback, reviews, sources] =
    await Promise.all([
      // "Visitatori identificati" = unique people, never accesses or tickets.
      maxxiQuery<{ n: number | string }>(`SELECT COUNT(*) AS n FROM maxxi_person;`),
      maxxiQuery<{ n: number | string }>(
        `SELECT COUNT(DISTINCT person_id) AS n FROM maxxi_identity_link WHERE status = 'linked';`,
      ),
      maxxiQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM maxxi_event WHERE person_id IS NULL;`,
      ),
      maxxiQuery<{ n: number | string }>(`SELECT COUNT(*) AS n FROM maxxi_event;`),
      maxxiQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM maxxi_event WHERE type = 'museum_visit_attended' AND person_id IS NOT NULL;`,
      ),
      maxxiQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM maxxi_event WHERE type = 'exhibition_ticket_purchased';`,
      ),
      maxxiQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM maxxi_membership WHERE product = 'myMAXXI'
           AND valid_to BETWEEN '${iso(MAXXI_NOW_MS)}' AND '${iso(MAXXI_NOW_MS + 45 * DAY_MS)}';`,
      ),
      maxxiQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM maxxi_membership WHERE product = 'myMAXXI' AND valid_to < '${iso(MAXXI_NOW_MS)}';`,
      ),
      maxxiQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM maxxi_feedback_case WHERE status = 'open';`,
      ),
      maxxiQuery<{ n: number | string }>(
        `SELECT COUNT(*) AS n FROM maxxi_review_candidate WHERE status = 'pending';`,
      ),
      maxxiQuery<{ n: number | string; last: string | null }>(
        `SELECT COUNT(*) AS n, MAX(last_imported_at) AS last FROM maxxi_source_registry;`,
      ),
    ]);

  return {
    identifiedPeople: Number(people[0]?.n ?? 0),
    linkedPeople: Number(linked[0]?.n ?? 0),
    anonymousSubjects: Number(anon[0]?.n ?? 0),
    totalEvents: Number(events[0]?.n ?? 0),
    attendedVisits: Number(visits[0]?.n ?? 0),
    purchases: Number(purchases[0]?.n ?? 0),
    membershipsExpiring45d: Number(expiring[0]?.n ?? 0),
    membershipsExpired: Number(expired[0]?.n ?? 0),
    openFeedback: Number(feedback[0]?.n ?? 0),
    pendingReviews: Number(reviews[0]?.n ?? 0),
    sources: Number(sources[0]?.n ?? 0),
    lastImportAt: sources[0]?.last ?? null,
  };
}

export type ActivityPoint = {
  month: string;
  visits: number;
  events: number;
};

/**
 * Monthly activity for the "Pubblico nel tempo" panel.
 * Only months present in the dataset are returned: the demo window is
 * Aug–Oct 2026 and a synthetic zero-filled timeline would imply knowledge
 * we do not have.
 */
export async function getActivityByMonth(): Promise<ActivityPoint[]> {
  const rows = await maxxiQuery<{ month: string; visits: number | string; events: number | string }>(
    `SELECT substr(occurred_at, 1, 7) AS month,
            SUM(CASE WHEN type = 'museum_visit_attended' AND person_id IS NOT NULL THEN 1 ELSE 0 END) AS visits,
            COUNT(*) AS events
       FROM maxxi_event
      GROUP BY 1
      ORDER BY 1;`,
  );
  return rows.map((row) => ({
    month: row.month,
    visits: Number(row.visits ?? 0),
    events: Number(row.events ?? 0),
  }));
}

export type SourceRow = {
  sourceSystem: string;
  description: string;
  mockOrLive: string;
  lastImportedAt: string | null;
  status: string;
  rowCount: number;
  unmatchedCount: number;
  quarantinedCount: number;
};

export async function listSources(): Promise<SourceRow[]> {
  const rows = await maxxiQuery<{
    source_system: string; description: string; mock_or_live: string;
    last_imported_at: string | null; last_import_status: string;
    row_count: number | string; unmatched_count: number | string; quarantined_count: number | string;
  }>(`SELECT * FROM maxxi_source_registry ORDER BY source_system;`);
  return rows.map((row) => ({
    sourceSystem: row.source_system,
    description: row.description,
    mockOrLive: row.mock_or_live,
    lastImportedAt: row.last_imported_at,
    status: row.last_import_status,
    rowCount: Number(row.row_count ?? 0),
    unmatchedCount: Number(row.unmatched_count ?? 0),
    quarantinedCount: Number(row.quarantined_count ?? 0),
  }));
}

export async function listReviewCandidates() {
  const rows = await maxxiQuery<{
    candidate_id: string; name: string; email: string; source_system: string;
    source_record_id: string; reason: string; status: string;
  }>(`SELECT candidate_id, name, email, source_system, source_record_id, reason, status
      FROM maxxi_review_candidate ORDER BY candidate_id;`);
  return rows.map((row) => ({
    candidateId: row.candidate_id,
    name: row.name,
    email: row.email,
    sourceSystem: row.source_system,
    sourceRecordId: row.source_record_id,
    reason: row.reason,
    status: row.status,
  }));
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export type SegmentReason =
  | "included"
  | "excluded_consent"
  | "excluded_no_interest"
  | "excluded_membership_window"
  | "excluded_no_interaction"
  | "excluded_identity_uncertain";

export type SegmentMember = {
  personId: string;
  name: string;
  email: string;
  segmentReason: SegmentReason;
  reasons: string[];
};

export type SegmentResult = {
  segmentId: string;
  segmentName: string;
  windowFrom: string;
  windowTo: string;
  eligible: SegmentMember[];
  excluded: SegmentMember[];
  counts: {
    eligible: number;
    excludedConsent: number;
    excludedIdentity: number;
    excludedMissingData: number;
  };
};

const ARCH_45D_WINDOW_DAYS = 45;
const INTERACTION_WINDOW_DAYS = 365;

/**
 * S_ARCH_RENEWAL_45D — deterministic, at the fixed demo clock.
 * Every person gets an explanation, included or excluded.
 */
export async function evaluateArchRenewal45d(): Promise<SegmentResult> {
  const from = iso(MAXXI_NOW_MS);
  const to = iso(MAXXI_NOW_MS + ARCH_45D_WINDOW_DAYS * DAY_MS);
  const interactionFrom = iso(MAXXI_NOW_MS - INTERACTION_WINDOW_DAYS * DAY_MS);

  const rows = await maxxiQuery<{
    person_id: string; name: string; email: string;
    has_arch_interest: number | string;
    has_arch_event: number | string;
    membership_in_window: number | string;
    interactions: number | string;
    consent_granted: number | string;
    consent_status: string | null;
    identity_links: number | string;
    max_confidence: number | string | null;
  }>(`
    SELECT p.person_id, p.name, p.email,
      (SELECT COUNT(*) FROM maxxi_person_interest i
        WHERE i.person_id = p.person_id AND i.kind = 'explicit' AND lower(i.interest) = 'architecture') AS has_arch_interest,
      (SELECT COUNT(*) FROM maxxi_event e
        WHERE e.person_id = p.person_id
          AND lower(COALESCE(json_extract_string(e.properties_json, '$.topic'), '')) = 'architecture') AS has_arch_event,
      (SELECT COUNT(*) FROM maxxi_membership m
        WHERE m.person_id = p.person_id AND m.product = 'myMAXXI'
          AND m.valid_to BETWEEN '${from}' AND '${to}') AS membership_in_window,
      (SELECT COUNT(*) FROM maxxi_event e
        WHERE e.person_id = p.person_id AND e.occurred_at >= '${interactionFrom}') AS interactions,
      (SELECT COUNT(*) FROM maxxi_consent c
        WHERE c.person_id = p.person_id AND c.purpose = 'event_marketing'
          AND c.channel = 'email' AND c.status = 'granted') AS consent_granted,
      (SELECT MAX(c.status) FROM maxxi_consent c
        WHERE c.person_id = p.person_id AND c.purpose = 'event_marketing' AND c.channel = 'email') AS consent_status,
      (SELECT COUNT(*) FROM maxxi_identity_link l
        WHERE l.person_id = p.person_id AND l.status = 'linked') AS identity_links,
      (SELECT MAX(l.confidence) FROM maxxi_identity_link l
        WHERE l.person_id = p.person_id AND l.status = 'linked') AS max_confidence
    FROM maxxi_person p
    ORDER BY p.person_id;
  `);

  const members: SegmentMember[] = rows.map((row) => {
    const reasons: string[] = [];
    const archInterest = Number(row.has_arch_interest) > 0 || Number(row.has_arch_event) > 0;
    const membership = Number(row.membership_in_window) > 0;
    const interacted = Number(row.interactions) > 0;
    const consent = Number(row.consent_granted) > 0;
    const identityCertain = Number(row.identity_links) > 0 && Number(row.max_confidence ?? 0) >= 0.95;

    // Classification order matters for the demo counts: "excluded by consent"
    // means "would qualify on data, but consent blocks it". Data gaps are
    // reported separately so the two buckets never double-count.
    let reason: SegmentReason = "included";
    if (!identityCertain) {
      reasons.push("Identità non verificata con certezza sufficiente.");
      reason = "excluded_identity_uncertain";
    } else if (!archInterest) {
      reasons.push("Nessun interesse esplicito per l'architettura.");
      reason = "excluded_no_interest";
    } else if (!membership) {
      reasons.push(`Card myMAXXI non in scadenza tra ${from} e ${to}.`);
      reason = "excluded_membership_window";
    } else if (!interacted) {
      reasons.push(`Nessuna interazione negli ultimi ${INTERACTION_WINDOW_DAYS} giorni.`);
      reason = "excluded_no_interaction";
    } else if (!consent) {
      const status = row.consent_status ?? "assente";
      reasons.push(`Consenso event_marketing/email non valido (${status}).`);
      reason = "excluded_consent";
    }

    if (reason === "included") {
      reasons.push(
        `Interesse architettura, card in scadenza entro ${ARCH_45D_WINDOW_DAYS} giorni, ` +
          `${Number(row.interactions)} interazioni negli ultimi ${INTERACTION_WINDOW_DAYS} giorni, consenso email valido.`,
      );
    }
    return {
      personId: row.person_id,
      name: row.name,
      email: row.email,
      segmentReason: reason,
      reasons,
    };
  });

  const eligible = members.filter((member) => member.segmentReason === "included");
  const excluded = members.filter((member) => member.segmentReason !== "included");

  return {
    segmentId: "S_ARCH_RENEWAL_45D",
    segmentName: "Architettura + rinnovo myMAXXI entro 45 giorni",
    windowFrom: from,
    windowTo: to,
    eligible,
    excluded,
    counts: {
      eligible: eligible.length,
      excludedConsent: excluded.filter((m) => m.segmentReason === "excluded_consent").length,
      excludedIdentity: excluded.filter((m) => m.segmentReason === "excluded_identity_uncertain").length,
      excludedMissingData: excluded.filter((m) =>
        ["excluded_no_interest", "excluded_membership_window", "excluded_no_interaction"].includes(m.segmentReason),
      ).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Catalogue & campaigns
// ---------------------------------------------------------------------------

export async function listCatalog() {
  const rows = await maxxiQuery<{
    catalog_id: string; title: string; type: string; start_date: string;
    end_date: string; source_url: string; is_public_real: boolean;
  }>(`SELECT * FROM maxxi_catalog_item ORDER BY start_date;`);
  return rows.map((row) => ({
    id: row.catalog_id,
    title: row.title,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    sourceUrl: row.source_url,
    isPublicReal: Boolean(row.is_public_real),
  }));
}

export type CampaignPreview = {
  campaignId: string;
  segmentId: string;
  subject: string;
  body: string;
  status: "draft" | "approved_simulated";
  deliveryMode: "dry_run";
  recipients: Array<{ personId: string; name: string; email: string }>;
  counts: { eligible: number; excludedConsent: number; excludedIdentity: number; excludedMissingData: number };
  simulated: true;
  externalCalls: 0;
};

/** Build a dry-run campaign draft; never sends. */
export async function createCampaignDraft(params: {
  subject: string;
  body: string;
  principalId: string;
}): Promise<CampaignPreview> {
  const segment = await evaluateArchRenewal45d();
  const campaignId = `CAMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  await maxxiExec(
    `INSERT INTO maxxi_campaign (campaign_id, segment_id, subject, body, created_by, status, delivery_mode, created_at) VALUES (` +
      `'${campaignId}', '${segment.segmentId}', '${escape(params.subject)}', '${escape(params.body)}', ` +
      `'${escape(params.principalId)}', 'draft', 'dry_run', '${createdAt}');`,
  );
  await recordAudit({
    principalId: params.principalId,
    action: "campaign_draft_created",
    targetId: campaignId,
    status: "draft",
    details: { segmentId: segment.segmentId, eligible: segment.counts.eligible, deliveryMode: "dry_run" },
  });

  return {
    campaignId,
    segmentId: segment.segmentId,
    subject: params.subject,
    body: params.body,
    status: "draft",
    deliveryMode: "dry_run",
    recipients: segment.eligible.map((member) => ({
      personId: member.personId,
      name: member.name,
      email: member.email,
    })),
    counts: segment.counts,
    simulated: true,
    externalCalls: 0,
  };
}

/** Simulated approval: writes an audit row, never contacts a provider. */
export async function approveCampaignSimulated(params: {
  campaignId: string;
  principalId: string;
}): Promise<{ ok: true; campaignId: string; status: "approved_simulated"; externalCalls: 0 }> {
  const approvedAt = new Date().toISOString();
  await maxxiExec(
    `UPDATE maxxi_campaign SET status = 'approved_simulated' WHERE campaign_id = '${escape(params.campaignId)}';`,
  );
  await recordAudit({
    principalId: params.principalId,
    action: "campaign_approval_simulated",
    targetId: params.campaignId,
    status: "approved_simulated",
    details: { deliveryMode: "dry_run", externalCalls: 0, approvedAt },
  });
  return { ok: true, campaignId: params.campaignId, status: "approved_simulated", externalCalls: 0 };
}

export async function listCampaigns() {
  const rows = await maxxiQuery<{
    campaign_id: string; segment_id: string; subject: string; body: string;
    created_by: string; status: string; delivery_mode: string; created_at: string;
  }>(`SELECT * FROM maxxi_campaign ORDER BY created_at DESC LIMIT 50;`);
  return rows.map((row) => ({
    campaignId: row.campaign_id,
    segmentId: row.segment_id,
    subject: row.subject,
    body: row.body,
    createdBy: row.created_by,
    status: row.status,
    deliveryMode: row.delivery_mode,
    createdAt: row.created_at,
  }));
}

export type CampaignDetail = {
  campaign: {
    campaignId: string;
    segmentId: string;
    subject: string;
    body: string;
    createdBy: string;
    status: string;
    deliveryMode: string;
    createdAt: string;
  };
  segment: SegmentResult;
  audit: Awaited<ReturnType<typeof listAudit>>;
};

export async function getCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
  const safe = escape(campaignId);
  const rows = await maxxiQuery<{
    campaign_id: string; segment_id: string; subject: string; body: string;
    created_by: string; status: string; delivery_mode: string; created_at: string;
  }>(`SELECT * FROM maxxi_campaign WHERE campaign_id = '${safe}' LIMIT 1;`);
  const row = rows[0];
  if (!row) {return null;}

  const segment = await evaluateArchRenewal45d();
  const audit = await listAudit(100, campaignId);
  return {
    campaign: {
      campaignId: row.campaign_id,
      segmentId: row.segment_id,
      subject: row.subject,
      body: row.body,
      createdBy: row.created_by,
      status: row.status,
      deliveryMode: row.delivery_mode,
      createdAt: row.created_at,
    },
    segment,
    audit,
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function recordAudit(params: {
  principalId: string;
  action: string;
  targetId: string;
  status: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const id = `AUD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  await maxxiExec(
    `INSERT INTO maxxi_action_audit (audit_id, principal_id, action, target_id, requested_at, approved_at, status, details_sanitized) VALUES (` +
      `'${id}', '${escape(params.principalId)}', '${escape(params.action)}', '${escape(params.targetId)}', ` +
      `'${now}', ${params.status === "approved_simulated" ? `'${now}'` : "NULL"}, ` +
      `'${escape(params.status)}', '${escape(JSON.stringify(params.details ?? {}))}');`,
  );
}

export async function listAudit(limit = 50, targetId?: string) {
  const safeLimit = Math.max(1, Math.min(200, limit));
  const where = targetId ? ` WHERE target_id = '${escape(targetId)}'` : "";
  const rows = await maxxiQuery<{
    audit_id: string; principal_id: string; action: string; target_id: string;
    requested_at: string; approved_at: string | null; status: string; details_sanitized: string;
  }>(`SELECT * FROM maxxi_action_audit${where} ORDER BY requested_at DESC LIMIT ${safeLimit};`);
  return rows.map((row) => ({
    auditId: row.audit_id,
    principalId: row.principal_id,
    action: row.action,
    targetId: row.target_id,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    status: row.status,
    details: safeParse(row.details_sanitized),
  }));
}

function escape(value: string): string {
  return String(value).replace(/'/g, "''");
}
