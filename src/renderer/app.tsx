import React, { useCallback, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  useStoreVersion,
  getState,
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
  IS_POPOUT,
} from "./store.js";
import {
  TitleBar,
  Sidebar,
  ChatHeader,
  MessageList,
  InputBar,
  RateLimitBanner,
} from "./components.js";
import type { ImageData, PolicyPreset, PermissionMode } from "../ipc.js";

function App() {
  // Subscribe to all store changes via version counter
  useStoreVersion();
  const { sessions, activeId, poppedOutIds } = getState();

  // Load persisted sessions on mount
  useEffect(() => {
    loadPersistedSessions();
  }, []);

  const activeSession = activeId ? sessions.get(activeId) ?? null : null;
  const sessionList = [...sessions.values()];
  const entries = activeSession?.entries ?? [];
  const canSend = !!activeSession && activeSession.state !== "dead";
  const showResume = !!activeSession && activeSession.state === "dead" && !!activeSession.claudeSessionId;

  const handleSwitch = useCallback((id: string) => {
    if (poppedOutIds.has(id)) { focusPopout(id); return; }
    switchSession(id);
  }, [poppedOutIds]);
  const handleKill = useCallback((id: string) => killSession(id), []);
  const handleDelete = useCallback((id: string) => deleteSession(id), []);
  const handleRename = useCallback((id: string, name: string) => renameSession(id, name), []);
  const handleCreate = useCallback((perm: PermissionMode, cwd?: string, name?: string) => createSession(perm, cwd, name), []);
  const handlePreset = useCallback((p: PolicyPreset) => setPreset(p), []);
  const handleToggleFavorite = useCallback((id: string) => {
    toggleFavorite(id);
  }, []);
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

  // Chat area — defined once, rendered in both layouts
  const chatArea = (
    <div id="main-area">
      <ChatHeader
        session={activeSession}
        onSetPreset={handlePreset}
        onToggleFavorite={handleToggleFavorite}
        onOpenTerminal={resumeInTerminal}
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
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        onResume={handleResume}
        onResumeTerminal={handleResumeTerminal}
      />
    </div>
  );

  return (
    <>
      <TitleBar compact={IS_POPOUT} sessionName={IS_POPOUT ? activeSession?.name : undefined} />
      {IS_POPOUT ? chatArea : (
        <div id="app-layout">
          <Sidebar
            sessions={sessionList}
            activeId={activeId}
            poppedOutIds={poppedOutIds}
            onSwitch={handleSwitch}
            onKill={handleKill}
            onDelete={handleDelete}
            onRename={handleRename}
            onCreate={handleCreate}
            onToggleFavorite={handleToggleFavorite}
          />
          {chatArea}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

// Expose store actions for e2e tests
(window as any).__buddyStore = { createSession, switchSession, sendMessage, interruptSession, getState };
