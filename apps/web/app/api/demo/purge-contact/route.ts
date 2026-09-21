/**
 * POST /api/demo/purge-contact — remove a contact's whole footprint.
 *
 * The generic entry DELETE only drops `entry_fields` + the `entries` row, so
 * everything that referenced the contact kept pointing at a dead id: their
 * interactions, orders, campaign sends (with entry documents and .md files),
 * their entry page, and relation values in other objects. Re-running the demo
 * prep on a dirty workspace then leaves "different sources and logs" (data in
 * one view, ghosts in another).
 *
 * The schema enforces real foreign keys (`entry_fields.entry_id` and
 * `documents.entry_id` → `entries(id)`), so deletion MUST happen in FK-safe
 * order: parent references → documents → entry_fields → entries. Sloppy DELETEs
 * fail silently under DuckDB and leave literal ghosts behind.
 *
 * Body:
 *   { email: "..." }       — purge EVERY person with that email (+ their
 *                             interactions, orders, campaign sends, documents,
 *                             files, relations). Duplicates included.
 *   { personId: "..." }    — purge one specific person entry.
 *   { purgeOrphans: true } — additionally delete workspace-wide residue
 *                            (entries with no fields, relation values and
 *                            documents pointing at missing entries/files)
 *   { auditOnly: true }    — no writes; return the residual counts so the
 *                            demo script can fail when cleanup is needed
 *
 * Auth: same Bearer secret as the phone webhook (CRM_A_PHONE_WEBHOOK_SECRET).
 */

import { duckdbExecOnFileAsync, duckdbPathAsync, duckdbQueryAsync, resolveWorkspaceRoot } from "@/lib/workspace";
import { loadCrmFieldMaps, sqlString, type CrmFieldMaps } from "@/lib/crm-queries";
import { ONBOARDING_OBJECT_IDS } from "@/lib/workspace-schema-migrations";
import { isPhoneWebhookAuthorized } from "@/lib/phone-webhook";
import { rmSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PurgeRemoved = {
  persons: string[];
  interactions: string[];
  orders: string[];
  campaignSends: string[];
  documents: string[];
  files: string[];
  clearedRelations: number;
  ghostEntries: number;
  danglingRelations: number;
  danglingDocuments: number;
};

type PurgeLeftovers = {
  danglingRelations: number;
  danglingDocuments: number;
  ghostEntries: number;
};

type PurgeResult = {
  ok: boolean;
  removed?: PurgeRemoved;
  leftovers?: PurgeLeftovers;
  error?: string;
};

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function unlinkWorkspaceFile(relPath: string, root: string): boolean {
  const resolved = path.normalize(relPath.trim()).replaceAll("\\", "/");
  if (path.isAbsolute(resolved) || resolved.trim() === "" || resolved.split("/").includes("..")) {
    return false;
  }
  const abs = path.join(root, resolved);
  if (!abs.startsWith(root + path.sep)) {
    return false;
  }
  try {
    rmSync(abs, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete entries in FK-safe order. `entry_fields.entry_id` and
 * `documents.entry_id` reference `entries(id)`, and `documents.parent_id`
 * references `documents(id)` — so clear parent refs, then document rows, then
 * field rows, then the entries themselves. Returns the files unlinked.
 */
async function deleteEntriesByIds(
  dbPath: string,
  dbPathForQuery: string,
  ids: Iterable<string>,
  workspaceRoot: string | null,
): Promise<{ documentIds: string[]; files: string[] }> {
  const list = [...ids];
  const out = { documentIds: [] as string[], files: [] as string[] };
  if (list.length === 0) {
    return out;
  }
  const ph = list.map((id) => sqlString(id)).join(",");

  const docs = await duckdbQueryAsync<{ id: string; file_path: string }>(
    `SELECT id, file_path FROM documents WHERE entry_id IN (${ph})`,
  );
  out.documentIds = docs.map((d) => d.id);
  if (workspaceRoot) {
    for (const doc of docs) {
      if (doc.file_path && unlinkWorkspaceFile(doc.file_path, workspaceRoot)) {
        out.files.push(doc.file_path);
      }
    }
  }

  let docPh = "";
  if (out.documentIds.length > 0) {
    docPh = out.documentIds.map((id) => sqlString(id)).join(",");
  }

  // FK-safe order; each statement only frees references the next one removes.
  await duckdbExecOnFileAsync(
    dbPathForQuery,
    [
      // Documents may be parents of other documents: break the parent link
      // for anyone pointing at a document we are about to delete.
      `UPDATE documents SET parent_id = NULL WHERE parent_id IN (${ph})`,
      // Drop the removed entries' own documents (row only; files above).
      out.documentIds.length > 0 ? `DELETE FROM documents WHERE id IN (${docPh})` : `SELECT 1 WHERE FALSE`,
      `DELETE FROM entry_fields WHERE entry_id IN (${ph})`,
      `DELETE FROM entries WHERE id IN (${ph})`,
    ].join(";\n"),
  );
  return out;
}

/** Entries that exist only because of the contact (their related records). */
async function collectContactFootprint(
  personId: string,
  fieldMaps: CrmFieldMaps,
): Promise<{ interactions: string[]; orders: string[]; campaignSends: string[] }> {
  const related = async (
    fieldId: string | undefined,
    objectId: string,
  ): Promise<string[]> => {
    if (!fieldId) {
      return [];
    }
    const rows = await duckdbQueryAsync<{ entry_id: string }>(
      `SELECT ef.entry_id AS entry_id
         FROM entry_fields ef
        WHERE ef.field_id = ${sqlString(fieldId)} AND ef.value = ${sqlString(personId)}
          AND ef.entry_id IN (SELECT id FROM entries WHERE object_id = ${sqlString(objectId)})`,
    );
    return rows.map((r) => r.entry_id);
  };
  return {
    interactions: await related(fieldMaps.interaction?.["Person"], ONBOARDING_OBJECT_IDS.interaction),
    orders: await related(fieldMaps.order?.["Customer"], ONBOARDING_OBJECT_IDS.order),
    campaignSends: await related(fieldMaps.campaign_send?.["Person"], ONBOARDING_OBJECT_IDS.campaign_send),
  };
}

async function countWorkspaceResidue(): Promise<PurgeLeftovers> {
  const danglingRelations = await duckdbQueryAsync<{ n: number }>(
    `SELECT count(*) AS n
       FROM entry_fields ef
       JOIN fields f ON f.id = ef.field_id
      WHERE f.type = 'relation' AND ef.value <> ''
        AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.id = ef.value)`,
  );
  const danglingDocuments = await duckdbQueryAsync<{ n: number }>(
    `SELECT count(*) AS n FROM documents d
      WHERE d.entry_id IS NOT NULL AND d.entry_id <> ''
        AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.id = d.entry_id)`,
  );
  const ghostEntries = await duckdbQueryAsync<{ n: number }>(
    `SELECT count(*) AS n FROM entries e
      WHERE NOT EXISTS (SELECT 1 FROM entry_fields ef WHERE ef.entry_id = e.id)`,
  );
  return {
    danglingRelations: Number(danglingRelations[0]?.n ?? 0),
    danglingDocuments: Number(danglingDocuments[0]?.n ?? 0),
    ghostEntries: Number(ghostEntries[0]?.n ?? 0),
  };
}

/** Clear relation values on OTHER entries that point at a removed entry. */
async function clearReferencesTo(dbPath: string, ids: Set<string>): Promise<number> {
  if (ids.size === 0) {
    return 0;
  }
  const ph = [...ids].map((id) => sqlString(id)).join(",");
  const rows = await duckdbQueryAsync<{ entry_id: string; field_id: string }>(
    `SELECT DISTINCT ef.entry_id AS entry_id, ef.field_id AS field_id
       FROM entry_fields ef
       JOIN fields f ON f.id = ef.field_id
      WHERE f.type = 'relation' AND ef.value IN (${ph})`,
  );
  const perField = new Map<string, string[]>();
  for (const r of rows) {
    if (ids.has(r.entry_id)) {
      continue;
    }
    perField.set(r.field_id, [...(perField.get(r.field_id) ?? []), r.entry_id]);
  }
  let cleared = 0;
  for (const [fieldId, entryIds] of perField) {
    const inClause = entryIds.map((id) => sqlString(id)).join(",");
    await duckdbExecOnFileAsync(
      dbPath,
      `DELETE FROM entry_fields WHERE field_id = ${sqlString(fieldId)} AND entry_id IN (${inClause})`,
    );
    cleared += entryIds.length;
  }
  return cleared;
}

export async function POST(req: Request) {
  if (!isPhoneWebhookAuthorized(req)) {
    return jsonError("Unauthorized", 401);
  }
  const body = await parseBody(req);
  const auditOnly = body.auditOnly === true;
  const purgeOrphans = body.purgeOrphans === true;
  const dbPath = await duckdbPathAsync();
  if (!dbPath) {
    return jsonError("DuckDB not found", 500);
  }
  const workspaceRoot = resolveWorkspaceRoot();

  const fieldMaps = await loadCrmFieldMaps();
  const leftovers = await countWorkspaceResidue();
  if (auditOnly) {
    return Response.json({ ok: true, leftovers } satisfies PurgeResult);
  }

  const removed: PurgeRemoved = {
    persons: [],
    interactions: [],
    orders: [],
    campaignSends: [],
    documents: [],
    files: [],
    clearedRelations: 0,
    ghostEntries: 0,
    danglingRelations: 0,
    danglingDocuments: 0,
  };

  // ── resolve the contact: EVERY person with that email, or one by id ──────
  const email = asString(body.email);
  const personId = asString(body.personId);
  const targets = new Set<string>();
  if (personId) {
    const rows = await duckdbQueryAsync<{ id: string }>(
      `SELECT id FROM entries WHERE id = ${sqlString(personId)} AND object_id = ${sqlString(ONBOARDING_OBJECT_IDS.people)} LIMIT 1`,
    );
    if (rows.length > 0) {
      targets.add(personId);
    }
  } else if (email) {
    const emailFld = fieldMaps.people?.["Email Address"];
    if (emailFld) {
      // No LIMIT: duplicate person records (seed upsert by phone + webhook
      // creation by email) must ALL be purged together or one always remains.
      const rows = await duckdbQueryAsync<{ entry_id: string }>(
        `SELECT ef.entry_id AS entry_id
           FROM entry_fields ef
          WHERE ef.field_id = ${sqlString(emailFld)} AND lower(ef.value) = ${sqlString(email.toLowerCase())}`,
      );
      for (const r of rows) {
        targets.add(r.entry_id);
      }
    }
  }

  const deleteSet = new Set<string>(targets);
  for (const target of targets) {
    removed.persons.push(target);
    const { interactions, orders, campaignSends } = await collectContactFootprint(target, fieldMaps);
    for (const id of interactions) { deleteSet.add(id); }
    for (const id of orders) { deleteSet.add(id); }
    for (const id of campaignSends) { deleteSet.add(id); }
    removed.interactions.push(...interactions);
    removed.orders.push(...orders);
    removed.campaignSends.push(...campaignSends);
  }

  // Clear relations pointing at the removed set BEFORE the FK deletes.
  removed.clearedRelations += await clearReferencesTo(dbPath, deleteSet);

  if (deleteSet.size > 0) {
    const { documentIds, files } = await deleteEntriesByIds(dbPath, dbPath, deleteSet, workspaceRoot);
    removed.documents.push(...documentIds);
    removed.files.push(...files);
  }

  // ── stale segment member counts (a purge changes membership) ──────────────
  const cacheFields = [fieldMaps.segment?.["Member Count"], fieldMaps.segment?.["Computed At"]]
    .filter((v): v is string => Boolean(v));
  if (cacheFields.length > 0 && (purgeOrphans || deleteSet.size > 0)) {
    const flds = cacheFields.map((f) => sqlString(f)).join(",");
    await duckdbExecOnFileAsync(
      dbPath,
      `DELETE FROM entry_fields WHERE field_id IN (${flds}) AND entry_id IN (SELECT id FROM entries WHERE object_id = ${sqlString(ONBOARDING_OBJECT_IDS.segment)})`,
    );
  }

  // ── workspace orphan purge ────────────────────────────────────────────────
  if (purgeOrphans) {
    // ghost entries (no fields at all), FK-safe
    const ghosts = await duckdbQueryAsync<{ id: string }>(
      `SELECT e.id AS id FROM entries e
        WHERE NOT EXISTS (SELECT 1 FROM entry_fields ef WHERE ef.entry_id = e.id)`,
    );
    if (ghosts.length > 0) {
      const ghostIds = ghosts.map((g) => g.id);
      const { documentIds, files } = await deleteEntriesByIds(dbPath, dbPath, ghostIds, workspaceRoot);
      removed.ghostEntries = ghostIds.length;
      removed.documents.push(...documentIds);
      removed.files.push(...files);
    }

    // relation values pointing at missing entries (value cleared, entry kept)
    const dangling = await duckdbQueryAsync<{ entry_id: string; field_id: string }>(
      `SELECT ef.entry_id AS entry_id, ef.field_id AS field_id
         FROM entry_fields ef
         JOIN fields f ON f.id = ef.field_id
        WHERE f.type = 'relation' AND ef.value <> ''
          AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.id = ef.value)`,
    );
    if (dangling.length > 0) {
      const perField = new Map<string, string[]>();
      for (const r of dangling) {
        perField.set(r.field_id, [...(perField.get(r.field_id) ?? []), r.entry_id]);
      }
      for (const [fieldId, entryIds] of perField) {
        const inClause = entryIds.map((id) => sqlString(id)).join(",");
        await duckdbExecOnFileAsync(
          dbPath,
          `DELETE FROM entry_fields WHERE field_id = ${sqlString(fieldId)} AND entry_id IN (${inClause})`,
        );
      }
      removed.danglingRelations = dangling.length;
    }

    // document rows pointing at missing entries (and their files)
    const danglingDocs = await duckdbQueryAsync<{ id: string; file_path: string }>(
      `SELECT id, file_path FROM documents d
        WHERE d.entry_id IS NOT NULL AND d.entry_id <> ''
          AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.id = d.entry_id)`,
    );
    if (danglingDocs.length > 0) {
      const docIds = danglingDocs.map((d) => d.id).join(",").length > 0
        ? danglingDocs.map((d) => sqlString(d.id)).join(",")
        : "";
      if (docIds) {
        await duckdbExecOnFileAsync(
          dbPath,
          `UPDATE documents SET parent_id = NULL WHERE parent_id IN (${docIds});` +
            `DELETE FROM documents WHERE id IN (${docIds});`,
        );
      }
      removed.danglingDocuments = danglingDocs.length;
      if (workspaceRoot) {
        for (const doc of danglingDocs) {
          if (doc.file_path && unlinkWorkspaceFile(doc.file_path, workspaceRoot)) {
            removed.files.push(doc.file_path);
          }
        }
      }
    }
  }

  const final = await countWorkspaceResidue();
  return Response.json({ ok: true, removed, leftovers: final } satisfies PurgeResult);
}