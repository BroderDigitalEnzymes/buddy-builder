import React, { useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  useStoreVersion,
  getState,
  switchSession,
  createSession,
  sendMessage,
  setPreset,
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
  const canSend = !!activeSession && activeSession.state === "idle";
  const showResume = !!activeSession && activeSession.state === "dead" && !!activeSession.claudeSessionId;

  const handleSwitch = useCallback((id: string) => {
    if (poppedOutIds.has(id)) { focusPopout(id); return; }
    switchSession(id);
  }, [poppedOutIds]);
  const handleKill = useCallback((id: string) => killSession(id), []);
  const handleDelete = useCallback((id: string) => deleteSession(id), []);
  const handleRename = useCallback((id: string, name: string) => renameSession(id, name), []);
  const handleCreate = useCallback((perm: PermissionMode, cwd?: string) => createSession(perm, cwd), []);
  const handlePreset = useCallback((p: PolicyPreset) => setPreset(p), []);
  const handleToggleFavorite = useCallback(() => {
    if (activeId) toggleFavorite(activeId);
  }, [activeId]);
  const handleSend = useCallback((text: string, images?: ImageData[]) => sendMessage(text, images), []);
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

  // Chat area — defined once, rendered in both layouts
  const chatArea = (
    <div id="main-area">
      <ChatHeader
        session={activeSession}
        onSetPreset={handlePreset}
        onToggleFavorite={handleToggleFavorite}
        onPopOut={IS_POPOUT ? undefined : handlePopOut}
        onPopIn={IS_POPOUT ? handlePopIn : undefined}
      />
      <MessageList entries={entries} isBusy={activeSession?.state === "busy"} />
      <InputBar
        disabled={!canSend}
        showResume={showResume}
        onSend={handleSend}
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
          />
          {chatArea}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
