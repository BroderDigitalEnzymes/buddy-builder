import React, { memo } from "react";
import type { ViewMode } from "./store.js";

type IconRailProps = {
  sidebarView: ViewMode;
  onShowSessions: () => void;
  onShowSettings: () => void;
};

export const IconRail = memo(function IconRail({
  sidebarView,
  onShowSessions,
  onShowSettings,
}: IconRailProps) {
  return (
    <div id="icon-rail">
      <button
        className={`icon-rail-btn ${sidebarView === "sessions" ? "active" : ""}`}
        onClick={onShowSessions}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 4h12M2 8h8M2 12h10" />
        </svg>
        <span className="icon-rail-label">Sessions</span>
      </button>

      <button
        className={`icon-rail-btn ${sidebarView === "settings" ? "active" : ""}`}
        onClick={onShowSettings}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="2" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M12.95 3.05l-1.41 1.41M4.46 11.54l-1.41 1.41" />
        </svg>
        <span className="icon-rail-label">Settings</span>
      </button>
    </div>
  );
});
