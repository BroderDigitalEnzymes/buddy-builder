import React, { memo } from "react";
import { WindowControls } from "./window-controls.js";

// ─── Title bar (drag region + window controls) ───────────────────

export const TitleBar = memo(function TitleBar({ compact, sessionName }: {
  compact?: boolean;
  sessionName?: string;
}) {
  return (
    <div id="title-bar">
      <div id="title-bar-left">
        <img id="title-bar-icon" src="../assets/icon-32.png" alt="" />
        <span id="title-bar-label">{compact ? sessionName ?? "Session" : "Buddy Builder"}</span>
      </div>
      <WindowControls />
    </div>
  );
});

// ─── Re-exports (public API — all consumers import from here) ────

export { Sidebar } from "./sidebar.js";
export { HomeView } from "./home-view.js";
export { ChatHeader, MessageList, InputBar, EntryRow, ToolEntry, SettingsModal, RateLimitBanner } from "./chat.js";
