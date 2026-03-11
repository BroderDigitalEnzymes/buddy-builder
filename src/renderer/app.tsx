import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  useStoreVersion,
  getState,
  IS_POPOUT,
  IS_INFO,
  INFO_SESSION_ID,
} from "./store.js";
import {
  switchSession,
  createSession,
  sendMessage,
  setPreset,
  interruptSession,
  killSession,
  deleteSession,
  renameSession,
  resumeSession,
  resumeInTerminal,
  toggleFavorite,
  loadPersistedSessions,
  popOutSession,
  popInSession,
  focusPopout,
  navigateHome,
  openInApp,
  showSettings,
} from "./store-actions.js";
import { TitleBar, InfoWindow } from "./components.js";
import { ChatHeader } from "./chat-header.js";
import { MessageList, RateLimitBanner } from "./chat.js";
import { InputBar } from "./input-bar.js";
import { Sidebar } from "./sidebar.js";
import { IconRail } from "./icon-rail.js";
import { SettingsView } from "./settings-view.js";
import { WelcomeView } from "./welcome-view.js";
import { StatusBar } from "./status-bar.js";
import { SessionActionButtons } from "./session-actions.js";
import type { ImageData, PolicyPreset } from "../ipc.js";

function App() {
  // Subscribe to all store changes via version counter
  useStoreVersion();
  const { sessions, activeId, sidebarView, poppedOutIds } = getState();

  // Search state (lifted here so title bar + sidebar share it)
  const [search, setSearch] = useState("");

  // Always-on-top state (popout windows only)
  const [isPinned, setIsPinned] = useState(false);
  const handleTogglePin = useCallback(async () => {
    const next = !isPinned;
    setIsPinned(next);
    const { api } = await import("./utils.js");
    api().setAlwaysOnTop({ alwaysOnTop: next });
  }, [isPinned]);

  // Load persisted sessions on mount
  useEffect(() => {
    loadPersistedSessions();
  }, []);

  const activeSession = activeId ? sessions.get(activeId) ?? null : null;
  const sessionList = [...sessions.values()];
  const entries = activeSession?.entries ?? [];
  const canSend = !!activeSession && activeSession.state !== "dead";
  const showResume = !!activeSession && activeSession.state === "dead" && !!activeSession.claudeSessionId;

  const handlePreset = useCallback((p: PolicyPreset) => setPreset(p), []);
  const handleToggleFavorite = useCallback((id: string) => toggleFavorite(id), []);
  const handleSend = useCallback((text: string, images?: ImageData[]) => sendMessage(text, images), []);
  const handleInterrupt = useCallback(() => {
    if (activeId) interruptSession(activeId);
  }, [activeId]);
  const handleResume = useCallback(() => {
    if (activeId) resumeSession(activeId);
  }, [activeId]);
  const handleResumeTerminal = useCallback(() => {
    if (activeId) resumeInTerminal(activeId);
  }, [activeId]);
  const handlePopOut = useCallback((id: string) => popOutSession(id), []);
  const handlePopIn = useCallback(() => {
    if (activeId) popInSession(activeId);
  }, [activeId]);

  const handleSwitch = useCallback((id: string) => {
    if (poppedOutIds.has(id)) { focusPopout(id); return; }
    openInApp(id);
  }, [poppedOutIds]);

  const handleNewSession = useCallback(async () => {
    const { api } = await import("./utils.js");
    const { pickFolder } = await import("./store-actions.js");
    const cfg = await api().getConfig();
    const cwd = cfg.defaultProjectsFolder || await pickFolder();
    if (cwd) {
      const id = await createSession(cfg.defaultPermissionMode ?? "default", cwd);
      if (id && cfg.popOutByDefault) popOutSession(id);
    }
  }, []);

  // Merge skills, agents, and slash commands into a single deduped sorted list
  const mergedSlashCommands = useMemo(() => {
    if (!activeSession) return [];
    const all = [
      ...activeSession.skills.map((s) => (s.startsWith("/") ? s : `/${s}`)),
      ...activeSession.agents.map((a) => (a.startsWith("/") ? a : `/${a}`)),
      ...activeSession.slashCommands.map((c) => (c.startsWith("/") ? c : `/${c}`)),
    ];
    return [...new Set(all)].sort();
  }, [activeSession?.skills, activeSession?.agents, activeSession?.slashCommands]);

  // Chat area — used in chat view and popout
  const chatArea = (
    <div id="main-area">
      <ChatHeader
        session={activeSession}
        onSetPreset={handlePreset}
        onToggleFavorite={handleToggleFavorite}
        onOpenTerminal={activeSession?.state === "dead" ? resumeInTerminal : undefined}
        onBack={undefined}
        onPopOut={IS_POPOUT ? undefined : handlePopOut}
        onPopIn={IS_POPOUT ? handlePopIn : undefined}
        isPinned={IS_POPOUT ? isPinned : undefined}
        onTogglePin={IS_POPOUT ? handleTogglePin : undefined}
      />
      <RateLimitBanner rateLimit={activeSession?.rateLimit ?? null} />
      {showResume && (
        <div className="resume-banner">
          <span className="resume-banner-label">This session has ended</span>
          <SessionActionButtons
            claudeSessionId={activeSession?.claudeSessionId ?? null}
            cwd={activeSession?.cwd ?? null}
            permissionMode={activeSession?.permissionMode}
            onResume={handleResume}
            onResumeTerminal={handleResumeTerminal}
          />
        </div>
      )}
      <MessageList entries={entries} isBusy={activeSession?.state === "busy"} />
      {!showResume && (
        <InputBar
          sessionId={activeId}
          disabled={!canSend}
          isBusy={activeSession?.state === "busy"}
          queueCount={activeSession?.messageQueue.length ?? 0}
          showResume={false}
          slashCommands={mergedSlashCommands}
          claudeSessionId={activeSession?.claudeSessionId ?? null}
          cwd={activeSession?.cwd ?? null}
          permissionMode={activeSession?.permissionMode}
          onSend={handleSend}
          onInterrupt={handleInterrupt}
          onResume={handleResume}
          onResumeTerminal={handleResumeTerminal}
        />
      )}
    </div>
  );

  if (IS_INFO) {
    return (
      <>
        <TitleBar compact sessionName="Session Info" />
        <InfoWindow sessionId={INFO_SESSION_ID!} />
      </>
    );
  }

  // Popout windows always show chat
  if (IS_POPOUT) {
    return (
      <>
        <TitleBar compact sessionName={activeSession?.name} />
        {chatArea}
      </>
    );
  }

  // Determine main area content
  let mainContent: React.ReactNode;
  if (sidebarView === "settings") {
    mainContent = <SettingsView />;
  } else if (activeSession) {
    mainContent = chatArea;
  } else {
    mainContent = <WelcomeView onNewSession={handleNewSession} />;
  }

  return (
    <>
      <TitleBar search={search} onSearchChange={setSearch} />
      <div id="app-layout">
        <IconRail
          sidebarView={sidebarView}
          onShowSessions={navigateHome}
          onShowSettings={showSettings}
        />
        {sidebarView === "sessions" && (
          <Sidebar
            sessions={sessionList}
            activeId={activeId}
            poppedOutIds={poppedOutIds}
            search={search}
            onSwitch={handleSwitch}
            onKill={killSession}
            onDelete={deleteSession}
            onRename={renameSession}
            onCreate={createSession}
            onToggleFavorite={toggleFavorite}
          />
        )}
        <div id="main-area-wrap">
          {mainContent}
        </div>
      </div>
      <StatusBar />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

// Expose store actions for e2e tests
(window as any).__buddyStore = { createSession, switchSession, sendMessage, interruptSession, getState };
