import React from "react";
import { registerToolView, type ToolViewProps } from "./core.js";

// ─── Raw view (always matches, always last) ──────────────────────

export function RawViewRenderer({ entry }: ToolViewProps) {
  const hasInput = Object.keys(entry.toolInput).length > 0;
  return (
    <>
      {hasInput && (
        <pre className="tool-input">
          <code>{JSON.stringify(entry.toolInput, null, 2)}</code>
        </pre>
      )}
      {entry.status === "done" && entry.toolResult && (
        <pre className="tool-result">
          <code>{entry.toolResult}</code>
        </pre>
      )}
    </>
  );
}

registerToolView({
  id: "raw",
  label: "Raw",
  match: () => true,
  render: RawViewRenderer,
  priority: 1000,
});
