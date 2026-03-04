import React, { useState } from "react";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";

// ─── Glob view ──────────────────────────────────────────────────

type GlobInput = {
  pattern: string;
  path?: string;
};

function isGlob(input: Record<string, unknown>): input is GlobInput {
  return typeof input.pattern === "string";
}

function GlobViewRenderer({ entry }: ToolViewProps<GlobInput>) {
  const { pattern, path } = entry.toolInput;
  const [open, setOpen] = useState(entry.status === "running");
  const raw = entry.toolResult ?? "";
  const files = raw.trim() ? raw.trim().split("\n") : [];

  return (
    <div className="search-view">
      <div className="search-header">
        <span className="search-pattern">{pattern}</span>
        {path && <span className="search-scope">in {path}</span>}
      </div>
      {files.length > 0 && (
        <details
          className="search-details"
          open={open}
          onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="search-toggle">
            <span className="search-chevron">{open ? "\u25BE" : "\u25B8"}</span>
            <span>{files.length} file{files.length !== 1 ? "s" : ""}</span>
          </summary>
          <div className="search-results">
            {files.map((f, i) => (
              <div key={i} className="search-result-file">{f}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

registerToolView({
  id: "glob",
  label: "Files",
  match: (entry) => entry.toolName === "Glob" && isGlob(entry.toolInput),
  render: GlobViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as GlobInput;
    const raw = entry.toolResult ?? "";
    const count = raw.trim() ? raw.trim().split("\n").length : 0;
    return `${input.pattern} (${count} files)`;
  },
});

// ─── Grep view ──────────────────────────────────────────────────

type GrepInput = {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: string;
};

function isGrep(input: Record<string, unknown>): input is GrepInput {
  return typeof input.pattern === "string";
}

function GrepViewRenderer({ entry }: ToolViewProps<GrepInput>) {
  const { pattern, path, glob: globFilter, output_mode } = entry.toolInput;
  const [open, setOpen] = useState(entry.status === "running");
  const raw = entry.toolResult ?? "";
  const lines = raw.trim() ? raw.trim().split("\n") : [];
  const isContentMode = output_mode === "content" || output_mode === "count";

  return (
    <div className="search-view">
      <div className="search-header">
        <span className="search-icon">{"\uD83D\uDD0D"}</span>
        <span className="search-pattern">{pattern}</span>
        {path && <span className="search-scope">in {path}</span>}
        {globFilter && <span className="search-filter">{globFilter}</span>}
      </div>
      {lines.length > 0 && (
        <details
          className="search-details"
          open={open}
          onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="search-toggle">
            <span className="search-chevron">{open ? "\u25BE" : "\u25B8"}</span>
            <span>{lines.length} {isContentMode ? "lines" : "files"}</span>
          </summary>
          <div className="search-results">
            {isContentMode ? (
              <pre className="search-content"><code>{raw.trim()}</code></pre>
            ) : (
              lines.map((f, i) => (
                <div key={i} className="search-result-file">{f}</div>
              ))
            )}
          </div>
        </details>
      )}
    </div>
  );
}

registerToolView({
  id: "grep",
  label: "Search",
  match: (entry) => entry.toolName === "Grep" && isGrep(entry.toolInput),
  render: GrepViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as GrepInput;
    const raw = entry.toolResult ?? "";
    const count = raw.trim() ? raw.trim().split("\n").length : 0;
    return `\uD83D\uDD0D ${input.pattern} (${count} matches)`;
  },
});
