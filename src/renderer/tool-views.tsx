import React, { useState, useCallback } from "react";
import { sendMessage, answerQuestion } from "./store.js";
import type { ChatEntry, AskUserQuestionInput, AskQuestionItem } from "../ipc.js";
import { EntryRow } from "./components.js";

// ─── Core types ──────────────────────────────────────────────────

/** A tool ChatEntry — the shape every view receives. */
export type ToolChatEntry = ChatEntry & { kind: "tool" };

/** Props passed to every view renderer. */
export type ToolViewProps<TInput = Record<string, unknown>> = {
  entry: ToolChatEntry & { toolInput: TInput };
  sendResponse: (text: string) => void;
};

/**
 * A tool view definition.
 * - `id`:          unique key (React key for tabs)
 * - `label`:       tab label ("Question", "Raw")
 * - `match`:       returns true if this view can render the entry
 * - `render`:      React component for the view body
 * - `priority`:    lower = first tab / default selection. Raw is 1000.
 * - `fullReplace`: if true, replaces the <details> wrapper entirely
 */
export type ToolViewDef = {
  id: string;
  label: string;
  match: (entry: ToolChatEntry) => boolean;
  render: React.ComponentType<ToolViewProps<any>>;
  priority: number;
  fullReplace?: boolean;
  /** One-line summary shown when entry is done. Return null to stay expanded. */
  summary?: (entry: ToolChatEntry) => string | null;
};

// ─── Registry ────────────────────────────────────────────────────

const views: ToolViewDef[] = [];

/** Register a tool view. Called at module load time. */
export function registerToolView(view: ToolViewDef): void {
  views.push(view);
  views.sort((a, b) => a.priority - b.priority);
}

/** Get all views that match a given tool entry. */
export function getMatchingViews(entry: ToolChatEntry): ToolViewDef[] {
  return views.filter((v) => v.match(entry));
}

// ─── ToolViewTabs — orchestrates matching & tab switching ────────

type ToolViewTabsProps = {
  entry: ToolChatEntry;
};

export function ToolViewTabs({ entry }: ToolViewTabsProps) {
  const matchingViews = getMatchingViews(entry);
  const defaultId = matchingViews[0]?.id ?? "raw";
  const [activeId, setActiveId] = useState(defaultId);
  const [expanded, setExpanded] = useState(false);

  // If active tab no longer matches, fall back to first.
  const activeView =
    matchingViews.find((v) => v.id === activeId) ?? matchingViews[0];

  const handleSendResponse = useCallback(
    (text: string) => sendMessage(text),
    [],
  );

  if (!activeView) return null;

  // Collapsed summary: when done, top view provides a summary, and user hasn't expanded
  const summaryText = entry.status === "done" && !expanded
    ? activeView.summary?.(entry) ?? null
    : null;

  if (summaryText) {
    return (
      <div className="tool-view-summary" onClick={() => setExpanded(true)}>
        <span className="tool-view-summary-icon">{"\u25B8"}</span>
        <span className="tool-view-summary-text">{summaryText}</span>
      </div>
    );
  }

  const Renderer = activeView.render;
  const showTabs = matchingViews.length > 1;

  return (
    <>
      {showTabs && (
        <div className="tool-view-tabs">
          {matchingViews.map((v) => (
            <button
              key={v.id}
              className={`tool-view-tab ${v.id === activeView.id ? "active" : ""}`}
              onClick={() => setActiveId(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      <div className="tool-view-body">
        <Renderer entry={entry as any} sendResponse={handleSendResponse} />
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════
// Built-in views
// ═════════════════════════════════════════════════════════════════

// ─── Raw view (always matches, always last) ──────────────────────

function RawViewRenderer({ entry }: ToolViewProps) {
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

// ─── AskUserQuestion view ────────────────────────────────────────

function isAskUserQuestion(input: Record<string, unknown>): input is AskUserQuestionInput {
  return (
    Array.isArray(input.questions) &&
    input.questions.length > 0 &&
    typeof (input.questions as any)[0]?.question === "string"
  );
}

function AskQuestionCard({
  item,
  sendResponse,
  disabled,
}: {
  item: AskQuestionItem;
  sendResponse: (text: string) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleOption = useCallback((label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (selected.size === 0) return;
    sendResponse([...selected].join(", "));
  }, [selected, sendResponse]);

  return (
    <div className="ask-question">
      <div className="ask-header">
        <span className="ask-badge">{item.header}</span>
        <span className="ask-text">{item.question}</span>
      </div>
      <div className="ask-options">
        {item.options.map((opt, i) =>
          item.multiSelect ? (
            <button
              key={i}
              className={`ask-option ask-option-multi ${selected.has(opt.label) ? "selected" : ""}`}
              onClick={() => !disabled && toggleOption(opt.label)}
              disabled={disabled}
            >
              <span className="ask-check">{selected.has(opt.label) ? "\u2713" : ""}</span>
              <span className="ask-option-body">
                <span className="ask-option-label">{opt.label}</span>
                <span className="ask-option-desc">{opt.description}</span>
              </span>
            </button>
          ) : (
            <button
              key={i}
              className="ask-option"
              onClick={() => !disabled && sendResponse(opt.label)}
              disabled={disabled}
            >
              <span className="ask-option-label">{opt.label}</span>
              <span className="ask-option-desc">{opt.description}</span>
            </button>
          ),
        )}
      </div>
      {item.multiSelect && (
        <div className="ask-multi-footer">
          <span className="ask-multi-hint">
            {selected.size === 0 ? "Select one or more options" : `${selected.size} selected`}
          </span>
          <button
            className="ask-submit"
            disabled={disabled || selected.size === 0}
            onClick={handleSubmit}
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}

function AskQuestionViewRenderer({
  entry,
}: ToolViewProps<AskUserQuestionInput>) {
  const input = entry.toolInput;
  const done = entry.status === "done";

  // Route answers through the dedicated answerQuestion IPC (holds the hook)
  const handleAnswer = useCallback(
    (text: string) => answerQuestion(entry.toolUseId, text),
    [entry.toolUseId],
  );

  return (
    <div className={`ask-entry ask-${entry.status}`}>
      {input.questions.map((q, i) => (
        <AskQuestionCard key={i} item={q} sendResponse={handleAnswer} disabled={done} />
      ))}
      {done && entry.toolResult && (
        <div className="ask-answer">
          <span className="ask-answer-label">Answer:</span>
          <span className="ask-answer-value">{entry.toolResult}</span>
        </div>
      )}
    </div>
  );
}

registerToolView({
  id: "ask-user-question",
  label: "Question",
  match: (entry) =>
    entry.toolName === "AskUserQuestion" && isAskUserQuestion(entry.toolInput),
  render: AskQuestionViewRenderer,
  priority: 0,
  fullReplace: true,
  summary: (entry) => {
    if (!entry.toolResult) return null;
    const input = entry.toolInput as AskUserQuestionInput;
    const q = input.questions[0]?.question ?? "Question";
    return `${q} \u2192 ${entry.toolResult}`;
  },
});

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
