import React, { memo } from "react";
import { WindowControls } from "./window-controls.js";

// ─── Title bar (drag region + window controls) ───────────────────

export const TitleBar = memo(function TitleBar({ compact, sessionName, search, onSearchChange }: {
  compact?: boolean;
  sessionName?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
}) {
  return (
    <div id="title-bar">
      <div id="title-bar-left">
        <img id="title-bar-icon" src="../assets/icon-32.png" alt="" />
        <span id="title-bar-label">{compact ? sessionName ?? "Session" : "Buddy Builder"}</span>
      </div>
      {!compact && onSearchChange != null && (
        <div id="title-bar-search">
          <svg className="title-search-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
          </svg>
          <input
            className="title-search-input"
            type="text"
            placeholder="Search sessions..."
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            spellCheck={false}
          />
          {search && (
            <button className="title-search-clear" onClick={() => onSearchChange("")}>
              &times;
            </button>
          )}
        </div>
      )}
      <WindowControls />
    </div>
  );
});

// ─── Re-exports (public API — all consumers import from here) ────

export { Sidebar } from "./sidebar.js";
export { HomeView } from "./home-view.js";
export { ChatHeader } from "./chat-header.js";
export { SettingsModal } from "./settings-modal.js";
export { InputBar } from "./input-bar.js";
export { MessageList, EntryRow, ToolEntry, RateLimitBanner } from "./chat.js";
export { InfoWindow } from "./info-window.js";
export { StatusBar } from "./status-bar.js";
