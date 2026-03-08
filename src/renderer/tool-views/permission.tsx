import React, { useCallback } from "react";
import { approvePermission } from "../store.js";
import { registerToolView, type ToolViewProps } from "./core.js";

// ─── Tool Permission Prompt ────────────────────────────────────────

function PermissionViewRenderer({ entry }: ToolViewProps) {
  const handleAllow = useCallback(() => {
    approvePermission(entry.toolUseId, true);
  }, [entry.toolUseId]);

  const handleDeny = useCallback(() => {
    approvePermission(entry.toolUseId, false);
  }, [entry.toolUseId]);

  const waiting = entry.status === "permission";

  return (
    <div className={`permission-prompt permission-${entry.status}`}>
      <div className="permission-header">
        <span className="permission-icon">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 1a5 5 0 0 0-5 5v2a2 2 0 0 0-1 1.7V13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3.3A2 2 0 0 0 13 8V6a5 5 0 0 0-5-5z" />
            <circle cx="8" cy="11" r="1" fill="currentColor" />
          </svg>
        </span>
        <span className="permission-label">
          <strong>{entry.toolName}</strong> requires permission
        </span>
      </div>
      {waiting && (
        <div className="permission-actions">
          <button className="permission-btn permission-allow" onClick={handleAllow}>
            Allow
          </button>
          <button className="permission-btn permission-deny" onClick={handleDeny}>
            Deny
          </button>
        </div>
      )}
      {entry.status === "blocked" && (
        <div className="permission-denied">Denied by user</div>
      )}
    </div>
  );
}

registerToolView({
  id: "tool-permission",
  label: "Permission",
  match: (entry) => entry.status === "permission" || (entry.status === "blocked" && entry.detail === "Denied by user"),
  render: PermissionViewRenderer,
  priority: -1, // higher priority than default
  fullReplace: true,
  summary: (entry) => {
    if (entry.status === "permission") return `${entry.toolName} — awaiting permission`;
    if (entry.status === "blocked") return `${entry.toolName} — denied`;
    return null;
  },
});
