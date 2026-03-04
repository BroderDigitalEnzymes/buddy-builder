import React, { useState } from "react";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";

// ─── WebFetch view ──────────────────────────────────────────────

type WebFetchInput = {
  url: string;
  prompt: string;
};

function isWebFetch(input: Record<string, unknown>): input is WebFetchInput {
  return typeof input.url === "string" && typeof input.prompt === "string";
}

function WebFetchViewRenderer({ entry }: ToolViewProps<WebFetchInput>) {
  const { url, prompt } = entry.toolInput;
  const [open, setOpen] = useState(entry.status === "running");
  const result = entry.toolResult ?? "";

  return (
    <div className="web-view">
      <div className="web-header">
        <span className="web-icon">{"\uD83C\uDF10"}</span>
        <span className="web-url">{url}</span>
      </div>
      <div className="web-prompt">{prompt}</div>
      {result && (
        <details
          className="web-details"
          open={open}
          onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="web-toggle">
            <span className="web-chevron">{open ? "\u25BE" : "\u25B8"}</span>
            <span>Response</span>
          </summary>
          <div className="web-result">{result}</div>
        </details>
      )}
    </div>
  );
}

registerToolView({
  id: "web-fetch",
  label: "Fetch",
  match: (entry) => entry.toolName === "WebFetch" && isWebFetch(entry.toolInput),
  render: WebFetchViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as WebFetchInput;
    try {
      const host = new URL(input.url).hostname;
      return `\uD83C\uDF10 ${host}`;
    } catch {
      return `\uD83C\uDF10 ${input.url.slice(0, 40)}`;
    }
  },
});

// ─── WebSearch view ─────────────────────────────────────────────

type WebSearchInput = {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
};

function isWebSearch(input: Record<string, unknown>): input is WebSearchInput {
  return typeof input.query === "string";
}

function WebSearchViewRenderer({ entry }: ToolViewProps<WebSearchInput>) {
  const { query, allowed_domains, blocked_domains } = entry.toolInput;
  const [open, setOpen] = useState(entry.status === "running");
  const result = entry.toolResult ?? "";

  const domains = [
    ...(allowed_domains ?? []).map((d) => ({ domain: d, type: "allow" as const })),
    ...(blocked_domains ?? []).map((d) => ({ domain: d, type: "block" as const })),
  ];

  return (
    <div className="web-view">
      <div className="web-header">
        <span className="web-icon">{"\uD83D\uDD0E"}</span>
        <span className="web-query">{query}</span>
      </div>
      {domains.length > 0 && (
        <div className="web-domains">
          {domains.map((d, i) => (
            <span key={i} className={`web-domain-badge web-domain-${d.type}`}>
              {d.type === "block" ? "\u2212" : "+"} {d.domain}
            </span>
          ))}
        </div>
      )}
      {result && (
        <details
          className="web-details"
          open={open}
          onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="web-toggle">
            <span className="web-chevron">{open ? "\u25BE" : "\u25B8"}</span>
            <span>Results</span>
          </summary>
          <div className="web-result">{result}</div>
        </details>
      )}
    </div>
  );
}

registerToolView({
  id: "web-search",
  label: "Search",
  match: (entry) => entry.toolName === "WebSearch" && isWebSearch(entry.toolInput),
  render: WebSearchViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as WebSearchInput;
    return `\uD83D\uDD0E ${input.query.slice(0, 50)}`;
  },
});
