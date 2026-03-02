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
  loadPersistedSessions,
} from "./store.js";
import {
  TitleBar,
  Sidebar,
  Toolbar,
  MessageList,
  InputBar,
} from "./components.js";
import type { ImageData, PolicyPreset, PermissionMode } from "../ipc.js";

function App() {
  // Subscribe to all store changes via version counter
  useStoreVersion();
  const { sessions, activeId } = getState();

  // Load persisted sessions on mount
  useEffect(() => {
    loadPersistedSessions();
  }, []);

  const activeSession = activeId ? sessions.get(activeId) ?? null : null;
  const sessionList = [...sessions.values()];
  const entries = activeSession?.entries ?? [];
  const canSend = !!activeSession && activeSession.state === "idle";
  const showResume = !!activeSession && activeSession.state === "dead" && !!activeSession.claudeSessionId;

  const handleSwitch = useCallback((id: string) => switchSession(id), []);
  const handleKill = useCallback((id: string) => killSession(id), []);
  const handleDelete = useCallback((id: string) => deleteSession(id), []);
  const handleRename = useCallback((id: string, name: string) => renameSession(id, name), []);
  const handleCreate = useCallback((perm: PermissionMode) => createSession(perm), []);
  const handlePreset = useCallback((p: PolicyPreset) => setPreset(p), []);
  const handleSend = useCallback((text: string, images?: ImageData[]) => sendMessage(text, images), []);
  const handleResume = useCallback(() => {
    if (activeId) resumeSession(activeId);
  }, [activeId]);

  return (
    <>
      <TitleBar />
      <div id="app-layout">
        <Sidebar
          sessions={sessionList}
          activeId={activeId}
          onSwitch={handleSwitch}
          onKill={handleKill}
          onDelete={handleDelete}
          onRename={handleRename}
          onCreate={handleCreate}
        />
        <div id="main-area">
          <Toolbar session={activeSession} onSetPreset={handlePreset} />
          <MessageList entries={entries} />
          <InputBar
            disabled={!canSend}
            showResume={showResume}
            onSend={handleSend}
            onResume={handleResume}
          />
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
