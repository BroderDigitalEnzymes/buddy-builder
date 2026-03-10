import React, { useCallback } from "react";
import { approvePermission, approveAllPermissions } from "../store-actions.js";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";
import { getState } from "../store.js";

// ─── Permission prompt view ─────────────────────────────────────

function formatToolInput(toolInput: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(toolInput)) {
    if (typeof v === "string") {
      // Truncate long values but show enough for context
      const display = v.length > 200 ? v.slice(0, 200) + "..." : v;
      parts.push(`${k}: ${display}`);
    }
  }
  return parts.join("\n");
}

function countPendingPermissions(): number {
  const { activeId, sessions } = getState();
  if (!activeId) return 0;
  const data = sessions.get(activeId);
  if (!data) return 0;

  let count = 0;
  function walk(entries: import("../../ipc.js").ChatEntry[]) {
    for (const e of entries) {
      if (e.kind === "tool" && e.status === "permission") count++;
      if (e.kind === "tool" && e.children) walk(e.children);
    }
  }
  walk(data.entries);
  return count;
}

function PermissionViewRenderer({ entry }: ToolViewProps) {
  const isPending = entry.status === "permission";
  const isDenied = entry.status === "blocked";
  const inputSummary = entry.toolInput ? formatToolInput(entry.toolInput) : "";
  const pendingCount = isPending ? countPendingPermissions() : 0;

  const handleAllow = useCallback(() => {
    approvePermission(entry.toolUseId, true);
  }, [entry.toolUseId]);

  const handleAllowAll = useCallback(() => {
    approveAllPermissions();
  }, []);

  const handleDeny = useCallback(() => {
    approvePermission(entry.toolUseId, false);
  }, [entry.toolUseId]);

  return (
    <div className={`permission-prompt ${isPending ? "" : "permission-done"} ${isDenied ? "permission-blocked" : ""}`}>
      <div className="permission-header">
        <span className="permission-icon">{"\u26A0\uFE0F"}</span>
        <span className="permission-label">
          <strong>{entry.toolName}</strong> wants to run
        </span>
      </div>
      {inputSummary && isPending && (
        <pre className="permission-input">{inputSummary}</pre>
      )}
      {isPending && (
        <div className="permission-actions">
          <button className="permission-btn permission-allow" onClick={handleAllow}>Allow</button>
          {pendingCount > 1 && (
            <button className="permission-btn permission-allow-all" onClick={handleAllowAll}>
              Allow All ({pendingCount})
            </button>
          )}
          <button className="permission-btn permission-deny" onClick={handleDeny}>Deny</button>
        </div>
      )}
      {isDenied && (
        <div className="permission-denied">Permission denied</div>
      )}
    </div>
  );
}

registerToolView({
  id: "permission",
  label: "Permission",
  match: (entry: ToolChatEntry) =>
    entry.status === "permission" || (entry.status === "blocked" && wasPermissionPrompt(entry)),
  render: PermissionViewRenderer,
  priority: 0,
  fullReplace: true,
});

/** Check if a blocked entry was originally a permission prompt (has toolInput). */
function wasPermissionPrompt(entry: ToolChatEntry): boolean {
  return entry.detail?.includes("Blocked by policy") ?? false;
}
