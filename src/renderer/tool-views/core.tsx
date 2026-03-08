import React, { useState, useCallback, useEffect } from "react";
import { sendMessage } from "../store.js";
import type { ChatEntry } from "../../ipc.js";

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

export function ToolViewTabs({ entry }: { entry: ToolChatEntry }) {
  const matchingViews = getMatchingViews(entry);
  const defaultId = matchingViews[0]?.id ?? "raw";
  const [activeId, setActiveId] = useState(defaultId);
  const [expanded, setExpanded] = useState(false);

  // When a fullReplace view appears (e.g. permission prompt), auto-switch to it
  const topView = matchingViews[0];
  useEffect(() => {
    if (topView?.fullReplace && activeId !== topView.id) {
      setActiveId(topView.id);
    }
  }, [topView?.id, topView?.fullReplace]);

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
  const canCollapse = entry.status === "done" && expanded && activeView.summary?.(entry) != null;

  return (
    <>
      {canCollapse && (
        <div className="tool-view-collapse" onClick={() => setExpanded(false)}>
          <span className="tool-view-summary-icon">{"\u25BE"}</span>
          <span className="tool-view-collapse-label">Collapse</span>
        </div>
      )}
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
