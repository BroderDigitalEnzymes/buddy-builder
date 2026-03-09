import {
  PERMISSION_MODE_PRESETS,
  type SessionEvent,
  type ToolPolicyConfig,
  type PolicyPreset,
  type PermissionMode,
  type ChatEntry,
  type ImageData,
  type IndexStatusInfo,
} from "../ipc.js";
import { api } from "./utils.js";
import { applySessionEvent } from "./event-handler.js";
import { state, emit, IS_POPOUT, POPOUT_SESSION_ID, type SessionData } from "./store.js";

// ─── Actions ─────────────────────────────────────────────────────

export function navigateHome(): void {
  state.currentView = "home";
  emit();
}

export async function openInApp(id: string): Promise<void> {
  state.activeId = id;
  state.currentView = "chat";
  // Lazy-load entries
  const data = state.sessions.get(id);
  if (data && data.entries.length === 0) {
    try {
      const entries = await api().getSessionEntries({ sessionId: id });
      data.entries = entries;
    } catch { /* empty */ }
  }
  emit();
}

export async function switchSession(id: string): Promise<void> {
  if (IS_POPOUT && id !== POPOUT_SESSION_ID) return; // locked to one session
  state.activeId = id;
  // Lazy-load entries if not yet loaded (dead history OR live popout inheriting conversation)
  const data = state.sessions.get(id);
  if (data && data.entries.length === 0) {
    try {
      const entries = await api().getSessionEntries({ sessionId: id });
      data.entries = entries;
    } catch { /* empty */ }
  }
  emit();
}

export async function loadPersistedSessions(): Promise<void> {
  try {
    const infos = await api().listSessions();
    for (const info of infos) {
      if (state.sessions.has(info.id)) continue;
      // Don't fetch entries upfront — lazy-load on switchSession
      state.counter++;
      state.sessions.set(info.id, {
        id: info.id,
        name: info.name,
        projectName: info.projectName,
        state: info.state,
        claudeSessionId: info.claudeSessionId,
        cwd: info.cwd,
        permissionMode: "default",
        policyPreset: "no-writes",
        favorite: info.favorite,
        lastActiveAt: info.lastActiveAt,
        entries: [],
        rateLimit: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        model: null,
        tools: [],
        mcpServers: [],
        claudeCodeVersion: null,
        skills: [],
        agents: [],
        slashCommands: [],
        messageQueue: [],
      });
    }
    // In popout mode, auto-switch to the locked session
    if (IS_POPOUT && POPOUT_SESSION_ID) {
      await switchSession(POPOUT_SESSION_ID);
      return; // switchSession calls emit
    }
    emit();
  } catch (err) {
    console.error("Failed to load persisted sessions:", err);
  }
}

export type NewSessionOptions = {
  permissionMode: PermissionMode;
  cwd?: string;
  name?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  openInApp?: boolean; // false = terminal only, default true
};

export async function createSession(permissionMode: PermissionMode, cwd?: string, name?: string): Promise<string | null>;
export async function createSession(opts: NewSessionOptions): Promise<string | null>;
export async function createSession(
  permOrOpts: PermissionMode | NewSessionOptions,
  cwd?: string,
  name?: string,
): Promise<string | null> {
  const opts: NewSessionOptions = typeof permOrOpts === "string"
    ? { permissionMode: permOrOpts, cwd, name }
    : permOrOpts;

  try {
    const id = await api().createSession({
      permissionMode: opts.permissionMode,
      cwd: opts.cwd,
      name: opts.name,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      maxTurns: opts.maxTurns,
    });
    state.counter++;
    state.sessions.set(id, {
      id,
      name: opts.name ?? `Session ${state.counter}`,
      projectName: opts.cwd ?? "(new)",
      state: "idle",
      claudeSessionId: null,
      cwd: opts.cwd ?? null,
      permissionMode: opts.permissionMode,
      policyPreset: PERMISSION_MODE_PRESETS[opts.permissionMode],
      favorite: false,
      lastActiveAt: Date.now(),
      entries: [{ kind: "system", text: `Session created · ${opts.permissionMode}`, ts: Date.now() }],
      rateLimit: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      model: opts.model ?? null,
      tools: [],
      mcpServers: [],
      claudeCodeVersion: null,
      skills: [],
      agents: [],
      slashCommands: [],
      messageQueue: [],
    });
    state.activeId = id;
    if (opts.openInApp !== false) {
      state.currentView = "chat";
    }
    emit();
    return id;
  } catch (err) {
    console.error("[store] createSession FAILED:", err);
    return null;
  }
}

export async function pickFolder(): Promise<string | null> {
  try {
    return await api().pickFolder();
  } catch {
    return null;
  }
}

export async function sendMessage(text: string, images?: ImageData[]): Promise<void> {
  if (!state.activeId) return;
  const data = state.sessions.get(state.activeId);
  if (!data || data.state === "dead") return;

  // Always show the user entry immediately
  const entry: ChatEntry = { kind: "user", text, ts: Date.now(), ...(images?.length ? { images } : {}) };
  data.entries.push(entry);

  if (data.state === "idle") {
    // Send immediately
    state.sessions.set(state.activeId, { ...data });
    emit();
    try {
      await api().sendMessage({ sessionId: state.activeId, text, images });
    } catch (err) {
      data.entries.push({ kind: "system", text: `Send error: ${err}`, ts: Date.now() });
      emit();
    }
  } else {
    // Queue for later — will flush when session becomes idle
    data.messageQueue.push({ text, images });
    state.sessions.set(state.activeId, { ...data });
    emit();
  }
}

/** Flush the next queued message when a session becomes idle. */
async function flushQueue(sessionId: string): Promise<void> {
  const data = state.sessions.get(sessionId);
  if (!data || data.state !== "idle" || data.messageQueue.length === 0) return;

  const next = data.messageQueue.shift()!;
  state.sessions.set(sessionId, { ...data });
  emit();

  try {
    await api().sendMessage({ sessionId, text: next.text, images: next.images });
  } catch (err) {
    data.entries.push({ kind: "system", text: `Send error: ${err}`, ts: Date.now() });
    state.sessions.set(sessionId, { ...data });
    emit();
  }
}

export async function answerQuestion(toolUseId: string, answer: string): Promise<void> {
  if (!state.activeId) return;
  try {
    await api().answerQuestion({ sessionId: state.activeId, toolUseId, answer });
  } catch (err) {
    console.error("Failed to answer question:", err);
  }
}

export async function approvePermission(toolUseId: string, allow: boolean): Promise<void> {
  if (!state.activeId) return;
  try {
    await api().approvePermission({ sessionId: state.activeId, toolUseId, allow });
  } catch (err) {
    console.error("Failed to approve permission:", err);
  }
}

export async function setPreset(preset: PolicyPreset): Promise<void> {
  if (!state.activeId) return;
  const data = state.sessions.get(state.activeId);
  if (!data) return;

  const policy: ToolPolicyConfig = { preset, blockedTools: [] };
  try {
    await api().updatePolicy({ sessionId: state.activeId, policy });
    data.policyPreset = preset;
    data.entries.push({ kind: "system", text: `Tool policy → ${preset}`, ts: Date.now() });
    emit();
  } catch (err) {
    console.error("Failed to update policy:", err);
  }
}

export async function interruptSession(id: string): Promise<void> {
  try {
    await api().interruptSession({ sessionId: id });
  } catch { /* ignore */ }
}

export async function killSession(id: string): Promise<void> {
  try {
    await api().killSession({ sessionId: id });
  } catch { /* ignore */ }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await api().deleteSession({ sessionId: id });
  } catch { /* ignore */ }
  state.sessions.delete(id);
  if (state.activeId === id) {
    const ids = [...state.sessions.keys()];
    state.activeId = ids.length > 0 ? ids[ids.length - 1] : null;
  }
  emit();
}

export async function renameSession(id: string, name: string): Promise<void> {
  const data = state.sessions.get(id);
  if (!data) return;
  data.name = name;
  emit();
  try {
    await api().renameSession({ sessionId: id, name });
  } catch (err) {
    console.error("Failed to rename session:", err);
  }
}

export function toggleFavorite(id: string): void {
  const data = state.sessions.get(id);
  if (!data) return;
  const newFav = !data.favorite;
  state.sessions.set(id, { ...data, favorite: newFav });
  emit();
  api().setFavorite({ sessionId: id, favorite: newFav }).catch(() => {});
}

export async function resumeSession(id: string): Promise<void> {
  const data = state.sessions.get(id);
  if (!data) return;
  try {
    await api().resumeSession({ sessionId: id });
    // State will be updated via stateChange event
  } catch (err) {
    data.entries.push({ kind: "system", text: `Resume failed: ${err}`, ts: Date.now() });
    emit();
  }
}

export async function resumeInTerminal(id: string): Promise<void> {
  try {
    await api().resumeInTerminal({ sessionId: id });
  } catch (err) {
    const data = state.sessions.get(id);
    if (data) {
      data.entries.push({ kind: "system", text: `Open terminal failed: ${err}`, ts: Date.now() });
      emit();
    }
  }
}

// ─── Event handling ──────────────────────────────────────────────

function handleEvent(event: SessionEvent): void {
  const data = state.sessions.get(event.sessionId);
  if (!data) {
    console.log("[store] event for unknown session:", event.kind, event.sessionId?.slice(0, 8));
    return;
  }
  console.log("[store] event:", event.kind, event.sessionId?.slice(0, 8));

  const effects = applySessionEvent(data, event);
  if (effects.flushQueue) flushQueue(effects.flushQueue);
  if (effects.addPoppedOut) state.poppedOutIds.add(effects.addPoppedOut);
  if (effects.removePoppedOut) state.poppedOutIds.delete(effects.removePoppedOut);

  // Replace object reference so memo'd components re-render
  state.sessions.set(event.sessionId, { ...data });

  emit();
}

// ─── Pop-out actions ────────────────────────────────────────────

export async function popOutSession(id: string): Promise<void> {
  await api().popOutSession({ sessionId: id });
}

export async function popInSession(id: string): Promise<void> {
  await api().popInSession({ sessionId: id });
}

export async function focusPopout(id: string): Promise<boolean> {
  return await api().focusPopout({ sessionId: id });
}

// ─── Search actions ──────────────────────────────────────────────

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function setSearchQuery(query: string): void {
  state.searchQuery = query;

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

  if (!query.trim()) {
    state.searchResults = null;
    emit();
    return;
  }

  emit();

  searchDebounceTimer = setTimeout(async () => {
    try {
      const results = await api().searchSessions({ query: query.trim() });
      // Only apply if query hasn't changed while we were waiting
      if (state.searchQuery === query) {
        state.searchResults = results;
        emit();
      }
    } catch (err) {
      console.error("[store] search failed:", err);
    }
  }, 200);
}

export function clearSearch(): void {
  state.searchQuery = "";
  state.searchResults = null;
  emit();
}

export async function triggerReindex(): Promise<void> {
  try {
    await api().triggerReindex();
  } catch (err) {
    console.error("[store] reindex failed:", err);
  }
}

// ─── IPC event wiring ───────────────────────────────────────────

// Wire up the IPC event listener
api().onSessionEvent(handleEvent);

// Wire up index progress listener
api().onIndexProgress((status: IndexStatusInfo) => {
  state.indexStatus = status;
  emit();
});
