import React, { useState } from "react";
import type { ChatEntry } from "../../ipc.js";
import { EntryRow } from "../components.js";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";

// ─── Agent / Task sub-agent view ──────────────────────────────────

const AGENT_STATUS_ICONS: Record<string, React.ReactNode> = {
  running: <span className="tool-icon spinning" />,
  done:    <span className="tool-icon done" />,
  blocked: <span className="tool-icon blocked" />,
};

function agentSummaryText(entry: ToolChatEntry): string {
  const children = entry.children ?? [];
  const tools = children.filter((c) => c.kind === "tool").length;
  const texts = children.filter((c) => c.kind === "text").length;
  return `${tools} tool call${tools !== 1 ? "s" : ""}, ${texts} response${texts !== 1 ? "s" : ""}`;
}

function getSender(kind: ChatEntry["kind"]): string {
  switch (kind) {
    case "user": return "user";
    case "text":
    case "tool": return "claude";
    case "system":
    case "result": return "system";
  }
}

function AgentViewRenderer({ entry }: ToolViewProps) {
  const [open, setOpen] = useState(entry.status === "running");
  const children = entry.children ?? [];
  const desc = (entry.toolInput as any).description ?? "";

  return (
    <details
      className={`tool-entry tool-${entry.status} agent-tool-entry`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="tool-summary">
        {AGENT_STATUS_ICONS[entry.status]}
        <span className="tool-name">Agent</span>
        <span className="tool-detail">
          {desc ? `${desc} — ` : ""}{agentSummaryText(entry)}
        </span>
      </summary>
      {children.length === 0 ? (
        <div className="agent-view agent-view-empty">
          <span className="tool-icon spinning" />
          <span>Sub-agent running...</span>
        </div>
      ) : (
        <div className="agent-view">
          {children.map((child, i) => {
            const prev = children[i - 1];
            const sender = getSender(child.kind);
            const prevSender = prev ? getSender(prev.kind) : null;
            const isGroupStart = i === 0 || sender !== prevSender || sender === "system";

            return (
              <EntryRow
                key={i}
                entry={child}
                isGroupStart={isGroupStart}
                prevKind={prev?.kind}
                nextKind={children[i + 1]?.kind}
              />
            );
          })}
        </div>
      )}
    </details>
  );
}

registerToolView({
  id: "agent",
  label: "Agent",
  match: (entry) => entry.toolName === "Agent" || entry.toolName === "Task",
  render: AgentViewRenderer,
  priority: 10,
  fullReplace: true,
});
