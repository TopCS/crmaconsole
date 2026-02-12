"use client";

import dynamic from "next/dynamic";
import { splitReportBlocks, hasReportBlocks } from "@/lib/report-blocks";

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

// Lazy-load ReportCard (uses Recharts which is heavy)
const ReportCard = dynamic(
  () =>
    import("../charts/report-card").then((m) => ({ default: m.ReportCard })),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-48 rounded-xl animate-pulse my-4"
        style={{ background: "var(--color-surface)" }}
      />
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

  // Check if the markdown contains embedded report-json blocks
  const hasReports = hasReportBlocks(markdownBody);

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

      {hasReports ? (
        <EmbeddedReportContent content={markdownBody} />
      ) : (
        <div className="workspace-prose">
          <MarkdownContent content={markdownBody} />
        </div>
      )}
    </div>
  );
}

/**
 * Renders markdown content that contains embedded report-json blocks.
 * Splits the content into alternating markdown and interactive chart sections.
 */
function EmbeddedReportContent({ content }: { content: string }) {
  const segments = splitReportBlocks(content);

  return (
    <div className="space-y-4">
      {segments.map((segment, index) => {
        if (segment.type === "report-artifact") {
          return (
            <div key={index} className="my-6">
              <ReportCard config={segment.config} />
            </div>
          );
        }
        // Text segment -- render as markdown
        return (
          <div key={index} className="workspace-prose">
            <MarkdownContent content={segment.text} />
          </div>
        );
      })}
    </div>
  );
}
