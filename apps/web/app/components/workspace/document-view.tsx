"use client";

import dynamic from "next/dynamic";

// Load markdown renderer client-only to avoid SSR issues with ESM-only packages
const MarkdownContent = dynamic(
  () =>
    import("./markdown-content").then((mod) => mod.MarkdownContent),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse space-y-3 py-4">
        <div className="h-4 rounded" style={{ background: "var(--color-surface)", width: "80%" }} />
        <div className="h-4 rounded" style={{ background: "var(--color-surface)", width: "60%" }} />
        <div className="h-4 rounded" style={{ background: "var(--color-surface)", width: "70%" }} />
      </div>
    ),
  },
);

type DocumentViewProps = {
  content: string;
  title?: string;
};

export function DocumentView({ content, title }: DocumentViewProps) {
  // Strip YAML frontmatter if present
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");

  // Extract title from first H1 if no title provided
  const h1Match = body.match(/^#\s+(.+)/m);
  const displayTitle = title ?? h1Match?.[1];
  const markdownBody =
    displayTitle && h1Match ? body.replace(/^#\s+.+\n?/, "") : body;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {displayTitle && (
        <h1
          className="text-3xl font-bold mb-6"
          style={{ color: "var(--color-text)" }}
        >
          {displayTitle}
        </h1>
      )}

      <div className="workspace-prose">
        <MarkdownContent content={markdownBody} />
      </div>
    </div>
  );
}
