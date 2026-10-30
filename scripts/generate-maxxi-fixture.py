#!/usr/bin/env python3
"""Expand the MAXXI demo fixture to a realistic pilot size.

The eight reference personas are preserved verbatim (they carry the demo
narrative and the identity edge cases). The generator adds ~190 deterministic
synthetic visitors, their memberships, consents, events and provenance records.

Run from the repository root:

    python3 scripts/generate-maxxi-fixture.py

The script is idempotent: it keeps only the core records on each run and
regenerates the additional population from the same seed.
"""

from __future__ import annotations

import json
import random
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "docs" / "fixtures" / "maxxi_demo_seed.json"

RNG = random.Random(20261028)
CLOCK = datetime(2026, 10, 28, 12, 0, tzinfo=timezone(timedelta(hours=1)))
WINDOW_FROM = "2026-10-28"
WINDOW_TO = "2026-12-12"
INTERACTION_FROM = "2025-10-28"

CORE_IDS = {
    "P-MARIA",
    "P-MARIA-AMBIG",
    "P-GIULIA",
    "P-ELENA",
    "P-PAOLO",
    "P-LUCA",
    "P-SARA",
    "P-GIOVANNI",
}

FIRST_NAMES = [
    "Alessandro", "Alice", "Andrea", "Anna", "Beatrice", "Carlo", "Chiara",
    "Claudia", "Davide", "Diana", "Emma", "Fabio", "Federica", "Filippo",
    "Francesca", "Gabriele", "Giorgia", "Ilaria", "Jacopo", "Laura", "Lorenzo",
    "Marta", "Matteo", "Michele", "Nicola", "Noemi", "Pietro", "Rebecca",
    "Riccardo", "Roberta", "Simone", "Sofia", "Stefano", "Valentina", "Vittorio",
]

LAST_NAMES = [
    "Amato", "Barbieri", "Bellini", "Bernardi", "Bruno", "Caruso", "Colombo",
    "Conti", "Costa", "De Luca", "Esposito", "Fabbri", "Ferrari", "Ferri",
    "Gallo", "Gentile", "Giordano", "Greco", "Lombardi", "Longo", "Mancini",
    "Marini", "Mazza", "Moretti", "Negri", "Palumbo", "Pellegrini", "Rinaldi",
    "Rizzo", "Rossi", "Russo", "Santoro", "Serra", "Testa", "Villa",
]

INTERESTS = [
    ("architecture", 45),
    ("photography", 20),
    ("contemporary art", 18),
    ("design", 10),
    ("education", 7),
]

ORGANIZATIONS = [
    ("O-SPONSOR-2", "Fondazione Fittizia Arte e Città", "sponsor"),
    ("O-SPONSOR-3", "Studio Architettura Nomade", "sponsor"),
    ("O-SCHOOL-1", "Liceo Artistico Demo Roma", "school"),
    ("O-SCHOOL-2", "Università Fittizia del Paesaggio", "school"),
    ("O-PARTNER-2", "Associazione Amici della Fotografia", "partner"),
    ("O-PARTNER-3", "Consorzio Fittizio Editoria d'Arte", "partner"),
    ("O-PARTNER-4", "Rete Fittizia Musei del Lazio", "partner"),
    ("O-PARTNER-5", "Bottega Fittizia Restauro", "partner"),
]


def slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return normalized.lower().replace(" ", ".")


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def round_dt() -> datetime:
    return CLOCK.replace(hour=10, minute=0, second=0, microsecond=0)


def weighted_interest() -> list[str]:
    roll = RNG.randint(1, 100)
    cumulative = 0
    selected = []
    for name, weight in INTERESTS:
        cumulative += weight
        if roll <= cumulative:
            selected.append(name)
            break
    if RNG.random() < 0.18:
        extra = RNG.choice([name for name, _ in INTERESTS if name not in selected])
        selected.append(extra)
    return selected


def main() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    # Keep only the reference narrative.
    def touches_core(person_id: str | None) -> bool:
        return person_id in CORE_IDS

    core_people = [p for p in fixture["people"] if p["id"] in CORE_IDS]
    core_memberships = [m for m in fixture["memberships"] if m["person_id"] in CORE_IDS]
    core_consents = [c for c in fixture["consents"] if c["person_id"] in CORE_IDS]
    core_events = [e for e in fixture["events"] if touches_core(e.get("person_id")) or e.get("person_id") is None]
    core_feedback = [f for f in fixture["feedback_cases"] if f["person_id"] in CORE_IDS]
    core_relationships = [r for r in fixture["relationships"] if r["person_id"] in CORE_IDS]
    core_sources = [
        r
        for r in fixture["source_records"]
        if r["source_record_id"] in {
            "P-MARIA-WEB",
            "P-MARIA-MEMBER",
            "P-MARIA-AMBIG",
            "P-GIULIA-MEMBER",
            "P-ELENA-MEMBER",
            "P-PAOLO-MEMBER",
            "P-LUCA-MEMBER",
            "P-SARA-MEMBER",
        }
    ]

    people = list(core_people)
    memberships = list(core_memberships)
    consents = list(core_consents)
    events = list(core_events)
    feedback = list(core_feedback)
    relationships = list(core_relationships)
    source_records = list(core_sources)

    used_names = {p["name"] for p in core_people}

    # ── Additional population ────────────────────────────────────────────
    target_total = 200
    index = 0
    while len(people) < target_total:
        index += 1
        first = RNG.choice(FIRST_NAMES)
        last = RNG.choice(LAST_NAMES)
        name = f"{first} {last}"
        if name in used_names:
            continue
        used_names.add(name)

        person_id = f"P-GEN-{index:04d}"
        email = f"{slug(first)}.{slug(last)}.{index:04d}@example.invalid"
        interests = weighted_interest()
        people.append(
            {
                "id": person_id,
                "name": name,
                "email": email,
                "interests_explicit": interests,
                "language": "it",
            }
        )

        # 85% have a myMAXXI card. 25% of those expire in the 45-day window.
        if RNG.random() < 0.85:
            card_code = f"MYMAXXI-GEN-{index:04d}"
            if RNG.random() < 0.25:
                valid_to = CLOCK.date() + timedelta(days=RNG.randint(1, 45))
            elif RNG.random() < 0.20:
                valid_to = CLOCK.date() - timedelta(days=RNG.randint(1, 60))
            else:
                valid_to = CLOCK.date() + timedelta(days=RNG.randint(120, 500))
            valid_from = valid_to - timedelta(days=RNG.choice([365, 365, 730]))
            memberships.append(
                {
                    "id": f"M-GEN-{index:04d}",
                    "person_id": person_id,
                    "card_code": card_code,
                    "product": "myMAXXI",
                    "valid_from": valid_from.isoformat(),
                    "valid_to": valid_to.isoformat(),
                    "source_system": "mymaxxi_manual",
                    "source_record_id": f"M-GEN-{index:04d}",
                }
            )

            # Provenance for the card (namespace match).
            source_records.append(
                {
                    "source_system": "mymaxxi_manual",
                    "source_record_id": f"M-GEN-{index:04d}",
                    "card_code": card_code,
                    "verified_email": False,
                    "observed_at": iso(round_dt()),
                }
            )

        # Consent: per purpose/channel, never a single flag.
        roll = RNG.random()
        if roll < 0.75:
            status = "granted"
        elif roll < 0.88:
            status = "withdrawn"
        else:
            status = "unknown"
        consent_dt = CLOCK - timedelta(days=RNG.randint(30, 300))
        consents.append(
            {
                "person_id": person_id,
                "purpose": "event_marketing",
                "channel": "email",
                "status": status,
                "captured_at": iso(consent_dt) if status != "unknown" else None,
                "withdrawn_at": iso(consent_dt + timedelta(days=20)) if status == "withdrawn" else None,
                "source_system": "site_form",
                "source_record_id": f"CONS-GEN-{index:04d}",
            }
        )

        # Verified web identity, plus a second source for part of the cohort.
        source_records.append(
            {
                "source_system": "site_form",
                "source_record_id": f"P-GEN-{index:04d}-WEB",
                "name": name,
                "email": email,
                "verified_email": True,
                "observed_at": iso(round_dt() - timedelta(days=RNG.randint(20, 300))),
                "expected_person_id": person_id,
            }
        )
        if RNG.random() < 0.35:
            source_records.append(
                {
                    "source_system": "biblioteca_manual",
                    "source_record_id": f"P-GEN-{index:04d}-LIB",
                    "name": name,
                    "email": email,
                    "verified_email": True,
                    "observed_at": iso(round_dt() - timedelta(days=RNG.randint(10, 200))),
                    "expected_person_id": person_id,
                }
            )

        # Events: 1-4 per person, spread over the demo window.
        event_count = RNG.choices([0, 1, 2, 3, 4], weights=[8, 27, 33, 22, 10])[0]
        for event_index in range(event_count):
            event_type = RNG.choices(
                [
                    "form_submitted",
                    "museum_visit_attended",
                    "exhibition_ticket_purchased",
                    "library_checkin",
                    "feedback_submitted",
                    "newsletter_consent_granted",
                    "membership_activated",
                ],
                weights=[12, 32, 20, 10, 8, 6, 12],
            )[0]
            source_by_type = {
                "form_submitted": "site_form",
                "museum_visit_attended": "archeoares_xls",
                "exhibition_ticket_purchased": "archeoares_xls",
                "library_checkin": "biblioteca_manual",
                "feedback_submitted": "infopoint_xls",
                "newsletter_consent_granted": "site_form",
                "membership_activated": "mymaxxi_manual",
            }
            occurred = CLOCK - timedelta(
                days=RNG.randint(1, 88),
                hours=RNG.randint(0, 8),
                minutes=RNG.choice([0, 15, 30, 45]),
            )
            properties: dict[str, str] = {}
            if "architecture" in interests:
                properties["topic"] = "architecture"
            elif interests:
                properties["topic"] = interests[0]
            events.append(
                {
                    "id": f"E-GEN-{index:04d}-{event_index + 1}",
                    "person_id": person_id,
                    "type": event_type,
                    "occurred_at": iso(occurred),
                    "observed_at": iso(occurred + timedelta(hours=1)),
                    "source_system": source_by_type[event_type],
                    "source_record_id": f"EV-GEN-{index:04d}-{event_index + 1}",
                    "catalog_item_id": (
                        "X-ARCH-2026"
                        if "architecture" in interests
                        else "X-CALLE-2026"
                    ),
                    "properties": properties,
                }
            )

        # A subset has an open or closed infopoint case.
        if RNG.random() < 0.18:
            opened = CLOCK - timedelta(days=RNG.randint(2, 70))
            is_open = RNG.random() < 0.35
            feedback.append(
                {
                    "id": f"F-GEN-{index:04d}",
                    "person_id": person_id,
                    "channel": RNG.choice(["email", "phone", "front_desk"]),
                    "category": RNG.choice(["accessibility", "visit_info", "membership", "event"]),
                    "status": "open" if is_open else "closed",
                    "opened_at": iso(opened),
                    "closed_at": None if is_open else iso(opened + timedelta(days=RNG.randint(1, 10))),
                    "summary": "Richiesta demo sintetica, nessun dato reale.",
                    "source_system": "infopoint_xls",
                    "source_record_id": f"F-GEN-{index:04d}",
                }
            )

    # ── Organizations and relationships ─────────────────────────────────
    organizations = [
        {
            "id": org_id,
            "name": name,
            "relationship_kind": kind,
            "synthetic": True,
        }
        for org_id, name, kind in ORGANIZATIONS
    ]
    organizations.insert(
        0,
        {
            "id": "O-PARTNER",
            "name": "Laboratorio Fittizio Cultura S.r.l.",
            "relationship_kind": "prospective_sponsor",
            "synthetic": True,
        },
    )

    relationship_count = 0
    for org in organizations[1:]:
        for _ in range(RNG.randint(2, 5)):
            person = RNG.choice(people)
            if person["id"] in CORE_IDS:
                continue
            relationship_count += 1
            relationships.append(
                {
                    "id": f"R-GEN-{relationship_count:04d}",
                    "person_id": person["id"],
                    "organization_id": org["id"],
                    "type": RNG.choice(["contact_of", "attended_program", "member_of_network"]),
                    "source_system": "operator_relation",
                    "source_record_id": f"R-GEN-{relationship_count:04d}",
                }
            )

    # ── Identity edge cases: namesakes and unusable records ─────────────
    review_people = [p for p in people if p["id"] not in CORE_IDS]
    RNG.shuffle(review_people)
    for offset, person in enumerate(review_people[:8], start=1):
        source_records.append(
            {
                "source_system": "site_form",
                "source_record_id": f"REV-GEN-{offset:04d}",
                "name": person["name"],
                "email": f"omonimo.{offset:04d}@example.invalid",
                "verified_email": False,
                "observed_at": iso(round_dt() - timedelta(days=RNG.randint(5, 60))),
            }
        )
    for offset in range(1, 11):
        source_records.append(
            {
                "source_system": RNG.choice(["archeoares_xls", "infopoint_xls"]),
                "source_record_id": f"UNMATCHED-GEN-{offset:04d}",
                "verified_email": False,
                "observed_at": iso(round_dt() - timedelta(days=RNG.randint(5, 60))),
            }
        )

    # ── Expected reference values ───────────────────────────────────────
    people_by_id = {p["id"]: p for p in people}
    memberships_by_person: dict[str, list[dict]] = {}
    for membership in memberships:
        memberships_by_person.setdefault(membership["person_id"], []).append(membership)
    consents_by_person = {c["person_id"]: c for c in consents}
    events_by_person: dict[str, list[dict]] = {}
    for event in events:
        if event.get("person_id"):
            events_by_person.setdefault(event["person_id"], []).append(event)
    linked_people = {
        record.get("expected_person_id")
        for record in source_records
        if record.get("verified_email") and record.get("expected_person_id")
    }

    eligible: list[str] = []
    excluded_consent: list[str] = []
    for person in people:
        pid = person["id"]
        interest = "architecture" in person.get("interests_explicit", [])
        in_window = any(
            m["product"] == "myMAXXI" and WINDOW_FROM <= m["valid_to"] <= WINDOW_TO
            for m in memberships_by_person.get(pid, [])
        )
        interacted = any(e["occurred_at"][:10] >= INTERACTION_FROM for e in events_by_person.get(pid, []))
        consent = (consents_by_person.get(pid) or {}).get("status")
        if pid in linked_people and interest and in_window and interacted:
            if consent == "granted":
                eligible.append(pid)
            elif consent in {"withdrawn", "unknown"}:
                excluded_consent.append(pid)

    expected = {
        "identified_people": len(people),
        "memberships_mymaxxi": sum(1 for m in memberships if m["product"] == "myMAXXI"),
        "total_events": len(events),
        "attended_visits": sum(
            1
            for e in events
            if e["type"] == "museum_visit_attended" and e.get("person_id")
        ),
        "anonymous_events": sum(1 for e in events if not e.get("person_id")),
        "source_records": len(source_records),
        "review_candidates": sum(
            1
            for r in source_records
            if r["source_record_id"] == "P-MARIA-AMBIG" or r["source_record_id"].startswith("REV-GEN-")
        ),
        "arch_renewal_45d_email_eligible_person_ids": eligible,
        "arch_renewal_45d_excluded_consent_person_ids": excluded_consent,
        "must_not_merge_person_ids": ["P-MARIA", "P-MARIA-AMBIG"],
        "anonymous_ticket_id": "T-ANON-001",
        "outbound_calls": 0,
    }

    fixture.update(
        {
            "_comment": (
                "SYNTHETIC FIXTURE. These are not real MAXXI visitors, accounts, "
                "transactions, consents or visits. Generated by "
                "scripts/generate-maxxi-fixture.py; the eight reference personas "
                "are preserved for the demo narrative. All emails use example.invalid."
            ),
            "people": people,
            "organizations": organizations,
            "source_records": source_records,
            "memberships": memberships,
            "consents": consents,
            "events": events,
            "feedback_cases": feedback,
            "relationships": relationships,
            "expected_for_reference_seed": expected,
        }
    )

    FIXTURE.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {FIXTURE}: {len(people)} people, {len(events)} events, "
        f"{len(memberships)} memberships, {len(consents)} consents, "
        f"{len(source_records)} source records, {len(feedback)} feedback cases, "
        f"{len(relationships)} relationships, "
        f"{len(eligible)} eligible / {len(excluded_consent)} excluded by consent."
    )


if __name__ == "__main__":
    main()
