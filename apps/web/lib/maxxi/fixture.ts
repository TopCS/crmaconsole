/**
 * Fixture loading for the MAXXI demo.
 *
 * The JSON is authored in docs/fixtures and is entirely synthetic (`example.invalid`).
 * It is read at runtime so the same file can be updated without touching code.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type MaxxiFixture = {
  schema_version: string;
  workspace_id: string;
  clock: string;
  random_seed: number;
  demo_mode: {
    enabled: boolean;
    external_outbound_enabled: boolean;
    telemetry_enabled: boolean;
    public_url_enabled: boolean;
    banner: string;
  };
  catalog: Array<{
    id: string;
    title: string;
    type: string;
    start_date: string;
    end_date: string;
    source_url: string;
    is_public_real_exhibition: boolean;
  }>;
  people: Array<{
    id: string;
    name: string;
    email: string;
    interests_explicit: string[];
    language: string;
  }>;
  organizations: Array<{
    id: string;
    name: string;
    relationship_kind: string;
    synthetic: boolean;
  }>;
  source_records: Array<{
    source_system: string;
    source_record_id: string;
    email?: string;
    name?: string;
    card_code?: string;
    verified_email?: boolean;
    observed_at: string;
    expected_person_id?: string;
  }>;
  memberships: Array<{
    id: string;
    person_id: string | null;
    card_code: string;
    product: string;
    valid_from: string;
    valid_to: string;
    source_system: string;
    source_record_id: string;
  }>;
  consents: Array<{
    person_id: string;
    purpose: string;
    channel: string;
    status: string;
    captured_at: string | null;
    withdrawn_at?: string;
    source_system: string;
    source_record_id: string;
  }>;
  events: Array<{
    id: string;
    person_id: string | null;
    anonymous_subject_id?: string;
    type: string;
    occurred_at: string;
    source_system: string;
    source_record_id: string;
    catalog_item_id?: string;
    properties: Record<string, unknown>;
  }>;
  feedback_cases: Array<{
    id: string;
    person_id: string | null;
    channel: string;
    category: string;
    status: string;
    opened_at: string;
    closed_at?: string;
    summary: string;
    source_system: string;
    source_record_id: string;
  }>;
  relationships: Array<{
    id: string;
    person_id: string;
    organization_id: string;
    type: string;
    source_system: string;
    source_record_id: string;
  }>;
  expected_for_reference_seed: {
    identified_people: number;
    memberships_mymaxxi: number;
    total_events: number;
    attended_visits?: number;
    anonymous_events?: number;
    source_records?: number;
    review_candidates?: number;
    arch_renewal_45d_email_eligible_person_ids: string[];
    arch_renewal_45d_excluded_consent_person_ids: string[];
    must_not_merge_person_ids: string[];
    anonymous_ticket_id: string;
    outbound_calls: number;
  };
};

function candidatePaths(): string[] {
  const override = process.env.CRM_A_MAXXI_FIXTURE?.trim();
  const cwd = process.cwd();
  const list = [
    ...(override ? [override] : []),
    path.join(cwd, "docs/fixtures/maxxi_demo_seed.json"),
    path.join(cwd, "../../docs/fixtures/maxxi_demo_seed.json"),
    "/app/docs/fixtures/maxxi_demo_seed.json",
  ];
  return list;
}

export function loadMaxxiFixture(): MaxxiFixture {
  for (const candidate of candidatePaths()) {
    if (!existsSync(candidate)) {continue;}
    const raw = readFileSync(candidate, "utf-8");
    return JSON.parse(raw) as MaxxiFixture;
  }
  throw new Error(
    "MAXXI fixture not found. Set CRM_A_MAXXI_FIXTURE to docs/fixtures/maxxi_demo_seed.json.",
  );
}
