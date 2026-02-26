import type {
  ClientApi,
  SessionEvent,
  ToolPolicyConfig,
  PolicyPreset,
  PermissionMode,
} from "../ipc.js";

declare global {
  interface Window { claude: ClientApi; }
}

// ─── DOM refs ───────────────────────────────────────────────────

const $ = (sel: string) => document.querySelector(sel)!;
const tabList = $("#tab-list") as HTMLDivElement;
const newSessionBtn = $("#new-session") as HTMLButtonElement;
const permModeSelect = $("#perm-mode") as HTMLSelectElement;
const toolbar = $("#toolbar") as HTMLDivElement;
const toolbarInfo = $("#toolbar-info") as HTMLSpanElement;
const messagesEl = $("#messages") as HTMLDivElement;
const statusBar = $("#status-bar") as HTMLDivElement;
const input = $("#input") as HTMLTextAreaElement;
const sendBtn = $("#send") as HTMLButtonElement;
const policyBtns = document.querySelectorAll<HTMLButtonElement>(".policy-btn");

// ─── State ──────────────────────────────────────────────────────

type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; toolName: string; toolUseId: string; status: "running" | "done" | "blocked"; detail?: string }
  | { kind: "result"; cost: number; turns: number; durationMs: number }
  | { kind: "system"; text: string };

type SessionData = {
  id: string;
  name: string;
  state: string;
  cost: number;
  permissionMode: PermissionMode;
  policyPreset: PolicyPreset;
  entries: ChatEntry[];
};

const sessions = new Map<string, SessionData>();
let activeId: string | null = null;

// ─── Rendering ──────────────────────────────────────────────────

function renderTabs(): void {
  tabList.innerHTML = "";
  for (const s of sessions.values()) {
    const tab = document.createElement("button");
    tab.className = `tab${s.id === activeId ? " active" : ""}`;
    const stateIcon = s.state === "busy" ? " ..." : s.state === "dead" ? " x" : "";
    tab.innerHTML = `${s.name}<span class="state">${stateIcon}</span>`;
    tab.onclick = () => switchSession(s.id);
    tabList.appendChild(tab);
  }
}

function renderMessages(): void {
  messagesEl.innerHTML = "";
  const data = activeId ? sessions.get(activeId) : null;
  if (!data) {
    messagesEl.innerHTML = `<div class="msg-system">No session. Click + New to start.</div>`;
    return;
  }

  for (const entry of data.entries) {
    const el = document.createElement("div");
    el.className = "msg";

    switch (entry.kind) {
      case "user":
        el.className += " msg-user";
        el.textContent = entry.text;
        break;
      case "text":
        el.className += " msg-text";
        el.textContent = entry.text;
        break;
      case "tool":
        el.className += ` msg-tool${entry.status === "blocked" ? " blocked" : ""}`;
        const icon = entry.status === "running" ? "..." : entry.status === "done" ? "done" : "BLOCKED";
        el.textContent = `[${entry.toolName}] ${icon}${entry.detail ? ` ${entry.detail}` : ""}`;
        break;
      case "result":
        el.className += " msg-result";
        el.textContent = `$${entry.cost.toFixed(4)} · ${entry.turns} turns · ${(entry.durationMs / 1000).toFixed(1)}s`;
        break;
      case "system":
        el.className += " msg-system";
        el.textContent = entry.text;
        break;
    }

    messagesEl.appendChild(el);
  }

  // Auto-scroll
  const chat = document.getElementById("chat")!;
  chat.scrollTop = chat.scrollHeight;
}

function renderToolbar(): void {
  const data = activeId ? sessions.get(activeId) : null;
  if (!data) {
    toolbar.style.display = "none";
    return;
  }
  toolbar.style.display = "flex";

  // Highlight active policy preset
  for (const btn of policyBtns) {
    const preset = btn.dataset.preset as PolicyPreset;
    btn.classList.toggle("active", preset === data.policyPreset);
  }

  toolbarInfo.textContent = `mode: ${data.permissionMode}`;
}

function renderStatus(): void {
  const data = activeId ? sessions.get(activeId) : null;
  if (!data) { statusBar.textContent = ""; return; }
  statusBar.textContent = `${data.state} · $${data.cost.toFixed(4)}`;
}

function render(): void {
  renderTabs();
  renderMessages();
  renderToolbar();
  renderStatus();
  updateSendButton();
}

function updateSendButton(): void {
  const data = activeId ? sessions.get(activeId) : null;
  sendBtn.disabled = !data || data.state !== "idle";
}

// ─── Actions ────────────────────────────────────────────────────

function switchSession(id: string): void {
  activeId = id;
  render();
  input.focus();
}

async function createNewSession(): Promise<void> {
  newSessionBtn.disabled = true;
  try {
    const permissionMode = permModeSelect.value as PermissionMode;
    const id = await window.claude.createSession({ permissionMode });
    sessions.set(id, {
      id,
      name: `Session ${sessions.size + 1}`,
      state: "idle",
      cost: 0,
      permissionMode,
      policyPreset: "unrestricted",
      entries: [{ kind: "system", text: `Session created · perm: ${permissionMode}` }],
    });
    activeId = id;
    render();
    input.focus();
  } catch (err) {
    console.error("Failed to create session:", err);
  } finally {
    newSessionBtn.disabled = false;
  }
}

async function setPreset(preset: PolicyPreset): Promise<void> {
  if (!activeId) return;
  const data = sessions.get(activeId);
  if (!data) return;

  const policy: ToolPolicyConfig = { preset, blockedTools: [] };
  try {
    await window.claude.updatePolicy({ sessionId: activeId, policy });
    data.policyPreset = preset;
    pushEntry(activeId, { kind: "system", text: `Tool policy → ${preset}` });
    render();
  } catch (err) {
    console.error("Failed to update policy:", err);
  }
}

async function sendMessage(): Promise<void> {
  const text = input.value.trim();
  if (!text || !activeId) return;

  const data = sessions.get(activeId);
  if (!data || data.state !== "idle") return;

  input.value = "";
  input.style.height = "auto";
  data.entries.push({ kind: "user", text });
  render();

  try {
    await window.claude.sendMessage({ sessionId: activeId, text });
  } catch (err) {
    data.entries.push({ kind: "system", text: `Send error: ${err}` });
    render();
  }
}

// ─── Append to a session's entries (helper) ─────────────────────

function pushEntry(sessionId: string, entry: ChatEntry): void {
  const data = sessions.get(sessionId);
  if (!data) return;
  data.entries.push(entry);
  if (sessionId === activeId) render();
}

function updateToolEntry(sessionId: string, toolUseId: string, status: "done" | "blocked", detail?: string): void {
  const data = sessions.get(sessionId);
  if (!data) return;
  for (let i = data.entries.length - 1; i >= 0; i--) {
    const e = data.entries[i];
    if (e.kind === "tool" && e.toolUseId === toolUseId) {
      e.status = status;
      if (detail) e.detail = detail;
      break;
    }
  }
  if (sessionId === activeId) render();
}

// ─── Event handler ──────────────────────────────────────────────

function handleEvent(event: SessionEvent): void {
  const data = sessions.get(event.sessionId);
  if (!data) return;

  switch (event.kind) {
    case "ready":
      pushEntry(event.sessionId, { kind: "system", text: `Connected · ${event.model}` });
      break;

    case "text": {
      // Merge consecutive text entries
      const last = data.entries[data.entries.length - 1];
      if (last?.kind === "text") {
        last.text += event.text;
        if (event.sessionId === activeId) render();
      } else {
        pushEntry(event.sessionId, { kind: "text", text: event.text });
      }
      break;
    }

    case "toolStart":
      pushEntry(event.sessionId, {
        kind: "tool",
        toolName: event.toolName,
        toolUseId: event.toolUseId,
        status: "running",
        detail: summarizeInput(event.toolInput),
      });
      break;

    case "toolEnd":
      updateToolEntry(event.sessionId, event.toolUseId, "done");
      break;

    case "toolBlocked":
      pushEntry(event.sessionId, {
        kind: "tool",
        toolName: event.toolName,
        toolUseId: "",
        status: "blocked",
        detail: event.reason,
      });
      break;

    case "result":
      data.cost = event.cost;
      pushEntry(event.sessionId, {
        kind: "result",
        cost: event.cost,
        turns: event.turns,
        durationMs: event.durationMs,
      });
      break;

    case "stateChange":
      data.state = event.to;
      if (event.sessionId === activeId) render();
      break;

    case "warn":
      break;

    case "error":
      pushEntry(event.sessionId, { kind: "system", text: `Error: ${event.message}` });
      break;

    case "exit":
      data.state = "dead";
      pushEntry(event.sessionId, { kind: "system", text: "Session ended." });
      break;
  }
}

function summarizeInput(toolInput: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(toolInput)) {
    if (typeof v === "string") {
      const short = v.replace(/\\/g, "/").split("/").slice(-2).join("/");
      parts.push(`${k}=${short}`);
    }
  }
  return parts.join(" ") || "";
}

// ─── Wire up ────────────────────────────────────────────────────

window.claude.onSessionEvent(handleEvent);

newSessionBtn.onclick = createNewSession;
sendBtn.onclick = sendMessage;

// Policy preset buttons
for (const btn of policyBtns) {
  btn.onclick = () => setPreset(btn.dataset.preset as PolicyPreset);
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

// Initial render
toolbar.style.display = "none";
render();
