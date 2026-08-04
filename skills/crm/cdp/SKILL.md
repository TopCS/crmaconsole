# CDP — Events, Segments, Campaigns

Customer Data Platform surfaces layered on top of the CRM objects: journey **events** (web tracking + server ingestion), **segments** (saved people clusters), and **campaigns** (email marketing to a segment).

All three are stored as regular DuckDB objects, so everything in the parent CRM skill (entries, fields, pivot views) applies.

---

## Object schemas

| Object                           | Purpose                                      | Key fields                                                                                                                                                                         |
| -------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interaction` ("Events" section) | One row per journey event or sync touchpoint | `Type` (Email, Meeting, Page View, Form Submit, Purchase, Custom), `Occurred At`, `Person` (m2o→people), `Company`, `Direction`, `Score Contribution`, `Properties` (JSON payload) |
| `people`                         | Identified + anonymous profiles              | … plus `Anonymous ID` (web-tracking cookie id), `Source` (Manual, Gmail, Calendar, **Anonymous**)                                                                                  |
| `segment`                        | Saved people cluster                         | `Name`, `Description`, `Filter` (JSON definition), `Member Count`, `Computed At`                                                                                                   |
| `campaign`                       | Email marketing run                          | `Name`, `Subject`, `Body`, `Segment` (m2o→segment), `Status` (Draft, Ready, Sent), `Sent At`, `Recipients Count`, `Opens`, `Clicks`                                                |

Email/Meeting interactions come from Gmail/Calendar sync and carry `Score Contribution` (feeds Strength Score). Journey events (Page View, Purchase, …) come from the ingestion APIs and carry `Properties` JSON instead.

## Recording events (server-side)

```
POST /api/crm/events
{ "personEmail": "ada@example.com",   // or "personId": "<entry id>"
  "type": "Purchase",                 // Email | Meeting | Page View | Form Submit | Purchase | Custom
  "occurredAt": "2026-08-04T10:00:00Z", // optional, defaults to now
  "properties": { "amount": 99 } }     // optional JSON payload
```

Unknown emails create the person (`Source=Manual`). Returns `{ eventId, personId, createdPerson }`.

## Web tracking (anonymous → identified)

Paste the snippet from **Integrations → Web Tracking** into a site:

```html
<script src="<console-origin>/tracker.js" data-write-key="cra_wk_…" defer></script>
```

- Page views are tracked automatically; `crma.track("Purchase", { amount: 99 })` for custom events; `crma.identify("user@example.com", { name: "Ada" })` on login/signup.
- Anonymous events land on a **shadow person** (`Source=Anonymous`, `Anonymous ID` = cookie id). `identify()` merges the shadow into the real person server-side — all historical events move onto the identified profile's timeline.
- Endpoints (public, write-key authenticated via `x-write-key` header or `writeKey` body field):
  - `POST /api/events/collect` `{ anonymousId?, email?, type, occurredAt?, properties? }`
  - `POST /api/events/identify` `{ anonymousId, email, traits? }`
- The write key lives in `<stateDir>/.crm-a-tracking.json` (auto-generated).

## Segments

A segment's `Filter` field is a JSON definition:

```json
{
  "filters": {
    "id": "root",
    "conjunction": "and",
    "rules": [{ "id": "r1", "field": "Job Title", "operator": "contains", "value": "engineer" }]
  },
  "events": [{ "type": "Page View", "operator": "has", "minCount": 3, "withinDays": 30 }]
}
```

- `filters` is the standard object-view `FilterGroup` over people fields (demographics).
- `events` conditions: `operator` `has` (≥ `minCount`, default 1) or `has_not`, optional `withinDays` recency window. Evaluated as COUNT subqueries over `interaction`.
- Membership is computed on demand — no membership table.
- APIs: `POST /api/crm/segments/compute` (count preview), `GET /api/crm/segments/[id]/members` (list + refreshes Member Count cache).

## Campaigns

Campaigns email a segment through the connected Gmail account (Composio, requires the Crm-A Cloud key and a Gmail connection — without them `/send` returns a clear 400).

- Audience = segment members with a non-empty email, excluding `Source=Anonymous` shadows.
- APIs: `GET /api/crm/campaigns/[id]/audience` (preview), `POST /api/crm/campaigns/[id]/send` (serial sends, marks Status=Sent with Sent At + Recipients Count).
- `Opens`/`Clicks` are placeholder fields — no tracking pixel/link rewriting yet.
