/**
 * Deterministic, idempotent MAXXI demo seed.
 *
 * Every run rebuilds the demo tables from the fixture (same input => same
 * counts), so a second seed never duplicates people, events or cards.
 *
 * Identity resolution follows the conservative rules from the data contract:
 *   1. verified e-mail exact match            -> auto-link
 *   2. card code inside the myMAXXI namespace -> auto-link
 *   3. same name with a different identity    -> review candidate, never merged
 *   4. no usable identifier                   -> unlinked / quarantined
 */

import { randomUUID } from "node:crypto";
import { loadMaxxiFixture, type MaxxiFixture } from "./fixture";
import {
  MAXXI_CLOCK_ISO,
  ensureMaxxiSchema,
  maxxiExec,
  maxxiQuery,
  q,
  resetMaxxiDemo,
} from "./store";
import { clearMaxxiGraphCache } from "./graph";

const SOURCE_META: Record<string, { description: string; mock: boolean }> = {
  site_form: { description: "Form del sito (newsletter/eventi) — connettore demo simulato", mock: true },
  archeoares_xls: { description: "Report XLS biglietteria — layout inventato, non quello reale", mock: true },
  mymaxxi_manual: { description: "Anagrafiche myMAXXI — import demo simulato", mock: true },
  biblioteca_manual: { description: "Iscrizioni e accessi biblioteca — import demo simulato", mock: true },
  infopoint_xls: { description: "Richieste infopoint — report demo simulato", mock: true },
  operator_relation: { description: "Note manuali dell'operatore — demo simulata", mock: true },
  matomo_aggregate: { description: "Analytics web aggregati — nessuna identificazione", mock: true },
  sproutsocial_aggregate: { description: "Metriche social aggregate — nessuna identificazione", mock: true },
  capacity_aggregate: { description: "Sensori capienza — solo aggregati", mock: true },
  wifi_none: { description: "Wi-Fi — nessun dato personale disponibile", mock: true },
};

export type SeedSummary = {
  ok: true;
  workspaceId: string;
  seeded: string[];
  counts: {
    people: number;
    events: number;
    memberships: number;
    consents: number;
    sourceRecords: number;
    identityLinks: number;
    reviewCandidates: number;
    unmatched: number;
  };
  outboundCalls: 0;
};

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${value}`;
}

/** Pure identity decision for one source record (unit-testable). */
export type IdentityDecision =
  | { kind: "link"; personId: string; method: string; confidence: number }
  | { kind: "review"; personId: string | null; reason: string }
  | { kind: "unmatched"; reason: string };

export function resolveIdentity(
  record: MaxxiFixture["source_records"][number],
  people: MaxxiFixture["people"],
  cardToPerson: Map<string, string>,
): IdentityDecision {
  const email = normalizeEmail(record.email);
  const name = normalizeName(record.name);

  if (record.verified_email && email) {
    const exact = people.find((p) => normalizeEmail(p.email) === email);
    if (exact) {return { kind: "link", personId: exact.id, method: "verified_email", confidence: 1 };}
  }

  const card = record.card_code?.trim();
  if (card) {
    const owner = cardToPerson.get(card);
    if (owner) {return { kind: "link", personId: owner, method: "card_code_namespace", confidence: 0.95 };}
  }

  // Name-only or unverified e-mail: never merge automatically.
  const nameCollision = name ? people.find((p) => normalizeName(p.name) === name) : undefined;
  const ownPerson = email ? people.find((p) => normalizeEmail(p.email) === email) : undefined;

  if (nameCollision && (!ownPerson || ownPerson.id !== nameCollision.id)) {
    return {
      kind: "review",
      personId: ownPerson?.id ?? null,
      reason: "Stesso nome di un contatto esistente ma identità diversa: serve verifica umana.",
    };
  }
  if (ownPerson) {
    return { kind: "link", personId: ownPerson.id, method: "email_unverified", confidence: 0.6 };
  }
  return { kind: "unmatched", reason: "Nessun identificativo utilizzabile (email o card)." };
}

export async function seedMaxxiDemo(): Promise<SeedSummary> {
  const fixture = loadMaxxiFixture();
  await ensureMaxxiSchema();
  await resetMaxxiDemo();
  clearMaxxiGraphCache();

  const statements: string[] = [];
  const counts = {
    people: 0,
    events: 0,
    memberships: 0,
    consents: 0,
    sourceRecords: 0,
    identityLinks: 0,
    reviewCandidates: 0,
    unmatched: 0,
  };

  // ── People ────────────────────────────────────────────────────────────
  for (const person of fixture.people) {
    statements.push(
      `INSERT INTO maxxi_person (person_id, name, email, language, synthetic, created_at) VALUES (` +
        `${q(person.id)}, ${q(person.name)}, ${q(normalizeEmail(person.email))}, ${q(person.language)}, TRUE, ${q(MAXXI_CLOCK_ISO)});`,
    );
    for (const interest of person.interests_explicit) {
      statements.push(
        `INSERT INTO maxxi_person_interest (person_id, interest, kind) VALUES (${q(person.id)}, ${q(interest)}, 'explicit');`,
      );
    }
    counts.people += 1;
  }

  // ── Organizations & relationships ────────────────────────────────────
  for (const org of fixture.organizations) {
    statements.push(
      `INSERT INTO maxxi_organization (organization_id, name, relationship_kind, synthetic) VALUES (` +
        `${q(org.id)}, ${q(org.name)}, ${q(org.relationship_kind)}, TRUE);`,
    );
  }
  for (const rel of fixture.relationships) {
    statements.push(
      `INSERT INTO maxxi_relationship (relationship_id, person_id, organization_id, type, source_system, source_record_id) VALUES (` +
        `${q(rel.id)}, ${q(rel.person_id)}, ${q(rel.organization_id)}, ${q(rel.type)}, ${q(rel.source_system)}, ${q(rel.source_record_id)});`,
    );
  }

  // ── Catalog ───────────────────────────────────────────────────────────
  for (const item of fixture.catalog) {
    statements.push(
      `INSERT INTO maxxi_catalog_item (catalog_id, title, type, start_date, end_date, source_url, is_public_real) VALUES (` +
        `${q(item.id)}, ${q(item.title)}, ${q(item.type)}, ${q(item.start_date)}, ${q(item.end_date)}, ${q(item.source_url)}, TRUE);`,
    );
  }

  // ── Memberships (needed before identity, for card-code matching) ──────
  const cardToPerson = new Map<string, string>();
  for (const membership of fixture.memberships) {
    if (membership.person_id) {cardToPerson.set(membership.card_code, membership.person_id);}
    statements.push(
      `INSERT INTO maxxi_membership (membership_id, person_id, card_code, product, valid_from, valid_to, status, source_system, source_record_id, recorded_at) VALUES (` +
        `${q(membership.id)}, ${membership.person_id ? q(membership.person_id) : "NULL"}, ${q(membership.card_code)}, ` +
        `${q(membership.product)}, ${q(membership.valid_from)}, ${q(membership.valid_to)}, 'active', ` +
        `${q(membership.source_system)}, ${q(membership.source_record_id)}, ${q(MAXXI_CLOCK_ISO)});`,
    );
    counts.memberships += 1;
  }

  // ── Source records → identity links / review candidates ───────────────
  const perSource = new Map<string, { rows: number; unmatched: number; quarantined: number }>();
  for (const record of fixture.source_records) {
    counts.sourceRecords += 1;
    const bucket = perSource.get(record.source_system) ?? { rows: 0, unmatched: 0, quarantined: 0 };
    bucket.rows += 1;

    const decision = resolveIdentity(record, fixture.people, cardToPerson);
    if (decision.kind === "link") {
      statements.push(
        `INSERT INTO maxxi_identity_link (link_id, person_id, source_system, source_record_id, match_method, confidence, status, matched_at, reviewed_by, reviewed_at) VALUES (` +
          `${q(stableId("IL", record.source_record_id))}, ${q(decision.personId)}, ${q(record.source_system)}, ` +
          `${q(record.source_record_id)}, ${q(decision.method)}, ${decision.confidence}, 'linked', ${q(record.observed_at)}, NULL, NULL);`,
      );
      counts.identityLinks += 1;
    } else if (decision.kind === "review") {
      statements.push(
        `INSERT INTO maxxi_review_candidate (candidate_id, name, email, source_system, source_record_id, reason, status, created_at) VALUES (` +
          `${q(stableId("RC", record.source_record_id))}, ${q(record.name ?? "")}, ${q(normalizeEmail(record.email))}, ` +
          `${q(record.source_system)}, ${q(record.source_record_id)}, ${q(decision.reason)}, 'pending', ${q(MAXXI_CLOCK_ISO)});`,
      );
      counts.reviewCandidates += 1;
      bucket.quarantined += 1;
    } else {
      counts.unmatched += 1;
      bucket.unmatched += 1;
    }
    perSource.set(record.source_system, bucket);
  }

  // ── Consents ──────────────────────────────────────────────────────────
  for (const consent of fixture.consents) {
    statements.push(
      `INSERT INTO maxxi_consent (consent_id, person_id, purpose, channel, status, captured_at, withdrawn_at, source_system, source_record_id) VALUES (` +
        `${q(stableId("CONS", consent.source_record_id))}, ${q(consent.person_id)}, ${q(consent.purpose)}, ${q(consent.channel)}, ` +
        `${q(consent.status)}, ${consent.captured_at ? q(consent.captured_at) : "NULL"}, ` +
        `${consent.withdrawn_at ? q(consent.withdrawn_at) : "NULL"}, ${q(consent.source_system)}, ${q(consent.source_record_id)});`,
    );
    counts.consents += 1;
  }

  // ── Events ────────────────────────────────────────────────────────────
  for (const event of fixture.events) {
    statements.push(
      `INSERT INTO maxxi_event (event_id, person_id, anonymous_subject_id, type, occurred_at, observed_at, source_system, source_record_id, catalog_item_id, properties_json) VALUES (` +
        `${q(event.id)}, ${event.person_id ? q(event.person_id) : "NULL"}, ` +
        `${event.anonymous_subject_id ? q(event.anonymous_subject_id) : "NULL"}, ${q(event.type)}, ` +
        `${q(event.occurred_at)}, ${q(MAXXI_CLOCK_ISO)}, ${q(event.source_system)}, ${q(event.source_record_id)}, ` +
        `${event.catalog_item_id ? q(event.catalog_item_id) : "NULL"}, ${q(JSON.stringify(event.properties))});`,
    );
    counts.events += 1;
  }

  // ── Feedback cases ────────────────────────────────────────────────────
  for (const feedback of fixture.feedback_cases) {
    statements.push(
      `INSERT INTO maxxi_feedback_case (case_id, person_id, channel, category, status, opened_at, closed_at, summary, source_system, source_record_id) VALUES (` +
        `${q(feedback.id)}, ${feedback.person_id ? q(feedback.person_id) : "NULL"}, ${q(feedback.channel)}, ` +
        `${q(feedback.category)}, ${q(feedback.status)}, ${q(feedback.opened_at)}, ` +
        `${feedback.closed_at ? q(feedback.closed_at) : "NULL"}, ${q(feedback.summary)}, ` +
        `${q(feedback.source_system)}, ${q(feedback.source_record_id)});`,
    );
  }

  // ── Source registry ───────────────────────────────────────────────────
  for (const [source, bucket] of perSource) {
    const meta = SOURCE_META[source] ?? { description: "Fonte demo simulata", mock: true };
    statements.push(
      `INSERT INTO maxxi_source_registry (source_system, description, mock_or_live, last_imported_at, last_import_status, row_count, unmatched_count, quarantined_count) VALUES (` +
        `${q(source)}, ${q(meta.description)}, ${q(meta.mock ? "mock" : "live")}, ${q(MAXXI_CLOCK_ISO)}, 'ok', ` +
        `${bucket.rows}, ${bucket.unmatched}, ${bucket.quarantined});`,
    );
  }

  // One statement batch per run keeps the write atomic enough for the demo.
  await maxxiExec(statements.join("\n"));

  return {
    ok: true,
    workspaceId: fixture.workspace_id,
    seeded: ["people", "organizations", "relationships", "catalog", "memberships", "identity_links", "consents", "events", "feedback", "sources"],
    counts,
    outboundCalls: 0,
  };
}

/** Non-mutating presence check used by the UI to decide whether to seed. */
export async function maxxiIsSeeded(): Promise<boolean> {
  try {
    const rows = await maxxiQuery<{ n: number | string }>("SELECT COUNT(*) AS n FROM maxxi_person;");
    return Number(rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Deterministic id for audit rows. */
export function auditId(): string {
  return randomUUID();
}
