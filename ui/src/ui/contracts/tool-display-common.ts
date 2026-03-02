export type ToolDisplayActionSpec = {
  label?: string;
  detailKeys?: string[];
};

export type ToolDisplaySpec = {
  title?: string;
  label?: string;
  detailKeys?: string[];
  actions?: Record<string, ToolDisplayActionSpec>;
};

export type CoerceDisplayValueOptions = {
  includeFalse?: boolean;
  includeZero?: boolean;
  includeNonFinite?: boolean;
  maxStringChars?: number;
  maxArrayEntries?: number;
};

const TOOL_NAME_ALIASES: Record<string, string> = {
  bash: "exec",
  "apply-patch": "apply_patch",
};

type ArgsRecord = Record<string, unknown>;

function asRecord(args: unknown): ArgsRecord | undefined {
  return args && typeof args === "object" ? (args as ArgsRecord) : undefined;
}

export function normalizeToolName(name?: string): string {
  const normalized = (name ?? "tool").trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] ?? normalized;
}

export function defaultTitle(name: string): string {
  const cleaned = name.replace(/_/g, " ").trim();
  if (!cleaned) {
    return "Tool";
  }
  return cleaned
    .split(/\s+/)
    .map((part) => `${part.at(0)?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function normalizeVerb(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/_/g, " ");
}

export function coerceDisplayValue(
  value: unknown,
  opts: CoerceDisplayValueOptions = {},
): string | undefined {
  const maxStringChars = opts.maxStringChars ?? 160;
  const maxArrayEntries = opts.maxArrayEntries ?? 3;

  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
    if (!firstLine) {
      return undefined;
    }
    if (firstLine.length > maxStringChars) {
      return `${firstLine.slice(0, Math.max(0, maxStringChars - 3))}…`;
    }
    return firstLine;
  }
  if (typeof value === "boolean") {
    if (!value && !opts.includeFalse) {
      return undefined;
    }
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return opts.includeNonFinite ? String(value) : undefined;
    }
    if (value === 0 && !opts.includeZero) {
      return undefined;
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    const values = value
      .map((item) => coerceDisplayValue(item, opts))
      .filter((item): item is string => Boolean(item));
    if (values.length === 0) {
      return undefined;
    }
    const preview = values.slice(0, maxArrayEntries).join(", ");
    return values.length > maxArrayEntries ? `${preview}…` : preview;
  }
  return undefined;
}

function lookupValueByPath(args: unknown, path: string): unknown {
  if (!args || typeof args !== "object") {
    return undefined;
  }
  let current: unknown = args;
  for (const segment of path.split(".")) {
    if (!segment || !current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function formatDetailKey(raw: string): string {
  const segments = raw.split(".").filter(Boolean);
  const last = segments.at(-1) ?? raw;
  const cleaned = last.replace(/_/g, " ").replace(/-/g, " ");
  const spaced = cleaned.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.trim().toLowerCase() || last.toLowerCase();
}

function resolvePathArg(args: unknown): string | undefined {
  const record = asRecord(args);
  if (!record) {
    return undefined;
  }
  for (const candidate of [record.path, record.file_path, record.filePath]) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function resolveReadDetail(args: unknown): string | undefined {
  const record = asRecord(args);
  if (!record) {
    return undefined;
  }
  const path = resolvePathArg(record);
  if (!path) {
    return undefined;
  }
  const offset =
    typeof record.offset === "number" && Number.isFinite(record.offset)
      ? Math.max(1, Math.floor(record.offset))
      : undefined;
  const limit =
    typeof record.limit === "number" && Number.isFinite(record.limit)
      ? Math.max(1, Math.floor(record.limit))
      : undefined;
  if (offset !== undefined && limit !== undefined) {
    return `lines ${offset}-${offset + limit - 1} from ${path}`;
  }
  if (offset !== undefined) {
    return `from line ${offset} in ${path}`;
  }
  if (limit !== undefined) {
    return `first ${limit} lines of ${path}`;
  }
  return `from ${path}`;
}

export function resolveWriteDetail(toolKey: string, args: unknown): string | undefined {
  const record = asRecord(args);
  if (!record) {
    return undefined;
  }

  const path =
    resolvePathArg(record) ?? (typeof record.url === "string" ? record.url.trim() : undefined);
  if (!path) {
    return undefined;
  }
  if (toolKey === "attach") {
    return `from ${path}`;
  }

  const destinationPrefix = toolKey === "edit" ? "in" : "to";
  const content =
    typeof record.content === "string"
      ? record.content
      : typeof record.newText === "string"
        ? record.newText
        : typeof record.new_string === "string"
          ? record.new_string
          : undefined;
  if (content && content.length > 0) {
    return `${destinationPrefix} ${path} (${content.length} chars)`;
  }
  return `${destinationPrefix} ${path}`;
}

export function resolveWebSearchDetail(args: unknown): string | undefined {
  const record = asRecord(args);
  if (!record) {
    return undefined;
  }
  const query =
    typeof record.query === "string"
      ? record.query.trim()
      : typeof record.search_term === "string"
        ? record.search_term.trim()
        : undefined;
  const count =
    typeof record.count === "number" && Number.isFinite(record.count) && record.count > 0
      ? Math.floor(record.count)
      : undefined;
  if (!query) {
    return undefined;
  }
  return count !== undefined ? `for "${query}" (top ${count})` : `for "${query}"`;
}

export function resolveWebFetchDetail(args: unknown): string | undefined {
  const record = asRecord(args);
  if (!record) {
    return undefined;
  }
  const url = typeof record.url === "string" ? record.url.trim() : undefined;
  if (!url) {
    return undefined;
  }
  return `from ${url}`;
}

export function resolveExecDetail(args: unknown): string | undefined {
  const record = asRecord(args);
  if (!record) {
    return undefined;
  }
  const command = typeof record.command === "string" ? record.command.trim() : undefined;
  if (!command) {
    return undefined;
  }
  const cwdRaw =
    typeof record.workdir === "string"
      ? record.workdir
      : typeof record.cwd === "string"
        ? record.cwd
        : undefined;
  const cwd = cwdRaw?.trim();
  const compact = command
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cwd) {
    return compact;
  }
  return `${compact} (in ${cwd})`;
}

export function resolveActionSpec(
  spec: ToolDisplaySpec | undefined,
  action: string | undefined,
): ToolDisplayActionSpec | undefined {
  if (!spec || !action) {
    return undefined;
  }
  return spec.actions?.[action] ?? undefined;
}

export function resolveDetailFromKeys(
  args: unknown,
  keys: string[],
  opts: {
    mode: "first" | "summary";
    coerce?: CoerceDisplayValueOptions;
    maxEntries?: number;
  },
): string | undefined {
  if (opts.mode === "first") {
    for (const key of keys) {
      const value = lookupValueByPath(args, key);
      const display = coerceDisplayValue(value, opts.coerce);
      if (display) {
        return display;
      }
    }
    return undefined;
  }

  const entries: Array<{ label: string; value: string }> = [];
  for (const key of keys) {
    const value = lookupValueByPath(args, key);
    const display = coerceDisplayValue(value, opts.coerce);
    if (!display) {
      continue;
    }
    entries.push({ label: formatDetailKey(key), value: display });
  }
  if (entries.length === 0) {
    return undefined;
  }
  if (entries.length === 1) {
    return entries[0].value;
  }
  const seen = new Set<string>();
  const unique: Array<{ label: string; value: string }> = [];
  for (const entry of entries) {
    const token = `${entry.label}:${entry.value}`;
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    unique.push(entry);
  }
  return unique
    .slice(0, opts.maxEntries ?? 8)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join(" · ");
}
