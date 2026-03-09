import React, { useCallback } from "react";
import { approvePermission } from "../store-actions.js";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";

// ─── Permission prompt view ─────────────────────────────────────

function PermissionViewRenderer({ entry }: ToolViewProps) {
  const isPending = entry.status === "permission";
  const isDenied = entry.status === "blocked";

  const handleAllow = useCallback(() => {
    approvePermission(entry.toolUseId, true);
  }, [entry.toolUseId]);

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
      {isPending && (
        <div className="permission-actions">
          <button className="permission-btn permission-allow" onClick={handleAllow}>Allow</button>
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
