import React, { useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  useStoreVersion,
  getState,
  switchSession,
  createSession,
  sendMessage,
  setPreset,
  killSession,
} from "./store.js";
import {
  TabBar,
  Toolbar,
  MessageList,
  StatusBar,
  InputBar,
} from "./components.js";
import type { PolicyPreset, PermissionMode } from "../ipc.js";

function App() {
  // Subscribe to all store changes via version counter
  useStoreVersion();
  const { sessions, activeId } = getState();

  const activeSession = activeId ? sessions.get(activeId) ?? null : null;
  const sessionList = [...sessions.values()];
  const entries = activeSession?.entries ?? [];
  const canSend = !!activeSession && activeSession.state === "idle";

  const handleSwitch = useCallback((id: string) => switchSession(id), []);
  const handleClose = useCallback((id: string) => killSession(id), []);
  const handleCreate = useCallback((perm: PermissionMode) => createSession(perm), []);
  const handlePreset = useCallback((p: PolicyPreset) => setPreset(p), []);
  const handleSend = useCallback((text: string) => sendMessage(text), []);

  return (
    <>
      <TabBar
        sessions={sessionList}
        activeId={activeId}
        onSwitch={handleSwitch}
        onClose={handleClose}
        onCreate={handleCreate}
      />
      <Toolbar session={activeSession} onSetPreset={handlePreset} />
      <MessageList entries={entries} />
      <StatusBar session={activeSession} />
      <InputBar disabled={!canSend} onSend={handleSend} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
