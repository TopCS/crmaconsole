/**
 * People fields offered by the segment builder — CLIENT-SAFE on purpose.
 *
 * The builder UI and the server-side SQL builder must read ONE list. A second
 * hardcoded copy in the UI silently diverged: the consent fields
 * ("Marketing Opt-in", "Preferred Contact Channel") were missing from it, so
 * `buildGroupSQL` dropped those rules and a "phone-consented" segment matched
 * the entire workspace — and operators could not rebuild the filter by hand
 * because the fields were not in the dropdown.
 *
 * Keep this module free of server imports (no node:fs / workspace) so the
 * client bundle can load it.
 */

export type SegmentPeopleField = {
  name: string;
  type: "text" | "email" | "url" | "relation" | "enum" | "number" | "date" | "boolean";
  /** Allowed values for `enum` fields — mirrored from the workspace schema. */
  enumValues?: string[];
};

export const SEGMENT_PEOPLE_FIELDS: SegmentPeopleField[] = [
  { name: "Full Name", type: "text" },
  { name: "Email Address", type: "email" },
  { name: "Phone Number", type: "text" },
  { name: "Job Title", type: "text" },
  { name: "LinkedIn URL", type: "url" },
  { name: "Company", type: "relation" },
  { name: "Status", type: "enum" },
  { name: "Source", type: "enum" },
  { name: "Strength Score", type: "number" },
  { name: "Last Interaction At", type: "date" },
  { name: "Marketing Opt-in", type: "boolean" },
  { name: "Preferred Contact Channel", type: "enum", enumValues: ["telegram", "email", "phone"] },
];

/** Interaction types offered as event conditions in the builder. */
export const SEGMENT_EVENT_TYPES = [
  "Email",
  "Meeting",
  "Page View",
  "Form Submit",
  "Purchase",
  "Custom",
] as const;
