import React, { useCallback, useEffect, useMemo } from "react";
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
} from "./store-actions.js";
import { TitleBar, InfoWindow } from "./components.js";
import { ChatHeader } from "./chat-header.js";
import { MessageList, RateLimitBanner } from "./chat.js";
import { InputBar } from "./input-bar.js";
import { HomeView } from "./home-view.js";
import { StatusBar } from "./status-bar.js";
import type { ImageData, PolicyPreset } from "../ipc.js";

function App() {
  // Subscribe to all store changes via version counter
  useStoreVersion();
  const { sessions, activeId, currentView, poppedOutIds } = getState();

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
        onOpenTerminal={resumeInTerminal}
        onBack={IS_POPOUT ? undefined : navigateHome}
        onPopOut={IS_POPOUT ? undefined : handlePopOut}
        onPopIn={IS_POPOUT ? handlePopIn : undefined}
      />
      <RateLimitBanner rateLimit={activeSession?.rateLimit ?? null} />
      <MessageList entries={entries} isBusy={activeSession?.state === "busy"} />
      <InputBar
        disabled={!canSend}
        isBusy={activeSession?.state === "busy"}
        queueCount={activeSession?.messageQueue.length ?? 0}
        showResume={showResume}
        slashCommands={mergedSlashCommands}
        claudeSessionId={activeSession?.claudeSessionId ?? null}
        cwd={activeSession?.cwd ?? null}
        permissionMode={activeSession?.permissionMode}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        onResume={handleResume}
        onResumeTerminal={handleResumeTerminal}
      />
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

  return (
    <>
      <TitleBar />
      {currentView === "chat" ? chatArea : (
        <HomeView sessions={sessionList} poppedOutIds={poppedOutIds} />
      )}
      <StatusBar />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

// Expose store actions for e2e tests
(window as any).__buddyStore = { createSession, switchSession, sendMessage, interruptSession, getState };
