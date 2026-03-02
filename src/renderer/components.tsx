import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { marked } from "marked";
import type { SessionData } from "./store.js";
import type { ChatEntry, ImageData, PolicyPreset, PermissionMode } from "../ipc.js";
import { WindowControls } from "./window-controls.js";
import { ToolViewTabs, getMatchingViews } from "./tool-views.js";

// Configure marked for safe, synchronous rendering
marked.setOptions({ async: false, breaks: true });

// ─── Sender helpers ──────────────────────────────────────────────

type Sender = "user" | "claude" | "system";

function getSender(kind: ChatEntry["kind"]): Sender {
  switch (kind) {
    case "user": return "user";
    case "text":
    case "tool": return "claude";
    case "system":
    case "result": return "system";
  }
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

const SENDER_LABELS: Record<Sender, string> = {
  user: "You",
  claude: "Claude",
  system: "System",
};

const SENDER_INITIALS: Record<Sender, string> = {
  user: "Y",
  claude: "C",
  system: "S",
};

const AVATAR_CLASSES: Record<Sender, string> = {
  user: "msg-avatar msg-avatar-user",
  claude: "msg-avatar msg-avatar-claude",
  system: "msg-avatar msg-avatar-system",
};

// ─── Tool entry (collapsible, delegates to view registry) ────────

const STATUS_ICONS: Record<string, React.ReactNode> = {
  running: <span className="tool-icon spinning" />,
  done:    <span className="tool-icon done" />,
  blocked: <span className="tool-icon blocked" />,
};

type ToolEntryProps = {
  entry: ChatEntry & { kind: "tool" };
};

export function ToolEntry({ entry }: ToolEntryProps) {
  const matchedViews = getMatchingViews(entry);
  const topView = matchedViews[0];

  // Full-replace: custom view takes over entirely (e.g., AskUserQuestion)
  if (topView?.fullReplace) {
    return <ToolViewTabs entry={entry} />;
  }

  // Standard: collapsible <details> with view tabs inside
  const [open, setOpen] = useState(false);

  return (
    <details
      className={`tool-entry tool-${entry.status}`}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="tool-summary">
        {STATUS_ICONS[entry.status]}
        <span className="tool-name">{entry.toolName}</span>
        {entry.detail && <span className="tool-detail">{entry.detail}</span>}
      </summary>
      <ToolViewTabs entry={entry} />
    </details>
  );
}

// ─── Markdown text renderer ──────────────────────────────────────

function MarkdownText({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text) as string, [text]);
  return <div className="msg-text prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Entry content (inner content without layout wrapper) ────────

type EntryContentProps = {
  entry: ChatEntry;
  prevKind?: string;
  nextKind?: string;
};

function EntryContent({ entry, prevKind, nextKind }: EntryContentProps) {
  switch (entry.kind) {
    case "user":
      return (
        <>
          {entry.images && entry.images.length > 0 && (
            <div className="msg-images">
              {entry.images.map((img, i) => (
                <img key={i} className="msg-image" src={`data:${img.mediaType};base64,${img.base64}`} alt="" />
              ))}
            </div>
          )}
          <div className="msg-text">{entry.text}</div>
        </>
      );

    case "text":
      return <MarkdownText text={entry.text} />;

    case "tool": {
      const classes = ["tool-wrap"];
      if (prevKind === "tool") classes.push("tool-grouped");
      if (prevKind === "tool" && nextKind !== "tool") classes.push("tool-group-last");
      if (prevKind !== "tool" && nextKind === "tool") classes.push("tool-group-first");
      if (prevKind !== "tool" && nextKind !== "tool") classes.push("tool-solo");
      return (
        <div className={classes.join(" ")}>
          <ToolEntry entry={entry} />
        </div>
      );
    }

    default:
      return null;
  }
}

// ─── Message entry (Slack-style row) ─────────────────────────────

type EntryRowProps = {
  entry: ChatEntry;
  isGroupStart: boolean;
  prevKind?: string;
  nextKind?: string;
};

export function EntryRow({ entry, isGroupStart, prevKind, nextKind }: EntryRowProps) {
  const sender = getSender(entry.kind);

  // System messages: centered pill
  if (entry.kind === "system") {
    return (
      <div className="msg-row msg-row-system">
        <div className="msg-system-text">{entry.text}</div>
      </div>
    );
  }

  // Result: skip rendering (cost shown in status bar)
  if (entry.kind === "result") {
    return null;
  }

  // Group start: avatar + name + timestamp + content
  if (isGroupStart) {
    return (
      <div className="msg-row msg-row-first">
        <div className={AVATAR_CLASSES[sender]}>
          {SENDER_INITIALS[sender]}
        </div>
        <div className="msg-content">
          <div className="msg-header">
            <span className="msg-sender">{SENDER_LABELS[sender]}</span>
            <span className="msg-timestamp">{formatTime(entry.ts)}</span>
          </div>
          <EntryContent entry={entry} prevKind={prevKind} nextKind={nextKind} />
        </div>
      </div>
    );
  }

  // Continuation: hover timestamp + content only
  return (
    <div className="msg-row msg-row-continuation">
      <span className="msg-timestamp-hover">{formatTime(entry.ts)}</span>
      <div className="msg-content">
        <EntryContent entry={entry} prevKind={prevKind} nextKind={nextKind} />
      </div>
    </div>
  );
}

// ─── Message list with auto-scroll + grouping ────────────────────

type MessageListProps = {
  entries: ChatEntry[];
};

export function MessageList({ entries }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (stickRef.current) {
      const el = containerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [entries, entries.length > 0 ? entries[entries.length - 1] : null]);

  if (entries.length === 0) {
    return (
      <div id="chat" className="chat-area chat-empty" ref={containerRef}>
        <div className="empty-state">No session. Click <strong>+ New</strong> to start.</div>
      </div>
    );
  }

  return (
    <div id="chat" className="chat-area" ref={containerRef} onScroll={onScroll}>
      <div className="messages">
        {entries.map((entry, i) => {
          const prevEntry = entries[i - 1];
          const sender = getSender(entry.kind);
          const prevSender = prevEntry ? getSender(prevEntry.kind) : null;

          const isGroupStart =
            i === 0 ||
            sender !== prevSender ||
            sender === "system" ||
            entry.kind === "result" ||
            (entry.ts - (prevEntry?.ts ?? 0)) > 5 * 60 * 1000;

          return (
            <EntryRow
              key={i}
              entry={entry}
              isGroupStart={isGroupStart}
              prevKind={entries[i - 1]?.kind}
              nextKind={entries[i + 1]?.kind}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Settings modal ──────────────────────────────────────────────

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [claudePath, setClaudePath] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (open) {
      (window as any).claude.getConfig().then((cfg: any) => setClaudePath(cfg.claudePath));
      setStatus("");
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    try {
      await (window as any).claude.setConfig({ claudePath });
      setStatus("Saved. Restart sessions for changes to take effect.");
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }, [claudePath]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <div className="settings-hero">
          <img className="settings-logo" src="../assets/icon-256.png" alt="Buddy Builder" />
          <div className="settings-brand">Buddy Builder</div>
          <div className="settings-tagline">Your AI pair programming companion</div>
        </div>
        <div className="modal-body">
          <div className="settings-section">
            <div className="settings-section-title">Configuration</div>
            <label className="setting-label">
              Claude CLI path
              <input
                className="setting-input"
                type="text"
                value={claudePath}
                onChange={(e) => setClaudePath(e.target.value)}
                placeholder="claude"
                spellCheck={false}
              />
              <span className="setting-hint">
                Command name (e.g. "claude") or full path to executable
              </span>
            </label>
          </div>
          {status && <div className="setting-status">{status}</div>}
        </div>
        <div className="modal-footer">
          <span className="settings-version">v1.0.0</span>
          <button className="modal-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Title bar (drag region + window controls) ───────────────────

export const TitleBar = memo(function TitleBar() {
  return (
    <div id="title-bar">
      <div id="title-bar-left">
        <img id="title-bar-icon" src="../assets/icon-32.png" alt="" />
        <span id="title-bar-label">Buddy Builder</span>
      </div>
      <WindowControls />
    </div>
  );
});

// ─── Editable session label ───────────────────────────────────────

type EditableSessionLabelProps = {
  name: string;
  onRename: (name: string) => void;
};

function EditableSessionLabel({ name, onRename }: EditableSessionLabelProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(name); }, [name]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = useCallback(() => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    } else {
      setValue(name);
    }
  }, [value, name, onRename]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") { setEditing(false); setValue(name); }
  }, [save, name]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="session-label-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span
      className="session-label"
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      {name}
    </span>
  );
}

// ─── Sidebar (session list + new session + settings) ─────────────

type SidebarProps = {
  sessions: SessionData[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (perm: PermissionMode) => void;
};

/**
 * Simple fuzzy match: every character in the query must appear
 * in order somewhere in the target (case-insensitive).
 */
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

type ProjectGroup = { project: string; items: SessionData[] };

function groupByProject(sessions: SessionData[], query: string): ProjectGroup[] {
  const q = query.trim();
  const groups: ProjectGroup[] = [];
  const map = new Map<string, SessionData[]>();
  const order: string[] = [];
  for (const s of sessions) {
    if (q && !fuzzyMatch(q, s.projectName) && !fuzzyMatch(q, s.name)) continue;
    const p = s.projectName;
    if (!map.has(p)) { map.set(p, []); order.push(p); }
    map.get(p)!.push(s);
  }
  for (const p of order) groups.push({ project: p, items: map.get(p)! });
  return groups;
}

// ─── Reusable session group list ─────────────────────────────────

type SessionGroupListProps = {
  groups: ProjectGroup[];
  activeId: string | null;
  expanded: Set<string>;
  defaultOpen: boolean;
  isSearching: boolean;
  onToggle: (project: string) => void;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  live: boolean;
};

function SessionGroupList({
  groups, activeId, expanded, defaultOpen, isSearching,
  onToggle, onSwitch, onKill, onDelete, onRename, live,
}: SessionGroupListProps) {
  if (groups.length === 0) {
    return (
      <div className="panel-empty">
        {live ? "No active sessions" : "No sessions found"}
      </div>
    );
  }

  return (
    <>
      {groups.map(({ project, items }) => {
        const isOpen = isSearching || (defaultOpen ? !expanded.has(project) : expanded.has(project));
        return (
          <div key={project} className="project-group">
            <button className="project-header" onClick={() => onToggle(project)}>
              <span className={`project-chevron ${isOpen ? "" : "collapsed"}`} />
              <span className="project-name">{project}</span>
              <span className="project-count">{items.length}</span>
            </button>
            {isOpen && items.map((s) => {
              const isDead = s.state === "dead";
              return (
                <button
                  key={s.id}
                  className={`session-item ${s.id === activeId ? "active" : ""} ${isDead ? "session-dead" : ""}`}
                  onClick={() => onSwitch(s.id)}
                >
                  <span className={`session-dot state-${s.state}`} />
                  <EditableSessionLabel
                    name={s.name}
                    onRename={(name) => onRename(s.id, name)}
                  />
                  {live ? (
                    <span
                      className="session-kill"
                      title="Terminate session"
                      onClick={(e) => { e.stopPropagation(); onKill(s.id); }}
                    >
                      &#9632;
                    </span>
                  ) : (
                    <span
                      className="session-close"
                      title="Remove from list"
                      onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                    >
                      &times;
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

// ─── Drag bar hook ───────────────────────────────────────────────

function useDragBar(containerRef: React.RefObject<HTMLDivElement | null>, initial: number) {
  const [topRatio, setTopRatio] = useState(initial);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const ratio = Math.max(0.08, Math.min(0.92, y / rect.height));
      setTopRatio(ratio);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [containerRef]);

  return { topRatio, onMouseDown };
}

// ─── Sidebar ─────────────────────────────────────────────────────

export const Sidebar = memo(function Sidebar({ sessions, activeId, onSwitch, onKill, onDelete, onRename, onCreate }: SidebarProps) {
  const [perm, setPerm] = useState<PermissionMode>("default");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [liveExpanded, setLiveExpanded] = useState<Set<string>>(new Set());
  const [histExpanded, setHistExpanded] = useState<Set<string>>(new Set());
  const panelsRef = useRef<HTMLDivElement>(null);
  const { topRatio, onMouseDown } = useDragBar(panelsRef, 0.3);

  const isSearching = search.trim().length > 0;

  // Split into live vs history
  const liveSessions = useMemo(() => sessions.filter((s) => s.state !== "dead"), [sessions]);
  const deadSessions = useMemo(() => sessions.filter((s) => s.state === "dead"), [sessions]);

  const liveGroups = useMemo(() => groupByProject(liveSessions, search), [liveSessions, search]);
  const histGroups = useMemo(() => groupByProject(deadSessions, search), [deadSessions, search]);

  const toggleLive = useCallback((p: string) => {
    setLiveExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }, []);
  const toggleHist = useCallback((p: string) => {
    setHistExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }, []);

  return (
    <>
      <div id="sidebar">
        <div id="sidebar-search">
          <input
            className="sidebar-search-input"
            type="text"
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
          />
          {search && (
            <button className="sidebar-search-clear" onClick={() => setSearch("")}>
              &times;
            </button>
          )}
        </div>
        <div id="sidebar-panels" ref={panelsRef}>
          <div className="sidebar-panel" style={{ flex: `0 0 ${topRatio * 100}%` }}>
            <div className="panel-label">Live</div>
            <div className="panel-scroll">
              <SessionGroupList
                groups={liveGroups}
                activeId={activeId}
                expanded={liveExpanded}
                defaultOpen={true}
                isSearching={isSearching}
                onToggle={toggleLive}
                onSwitch={onSwitch}
                onKill={onKill}
                onDelete={onDelete}
                onRename={onRename}
                live={true}
              />
            </div>
          </div>
          <div className="sidebar-drag" onMouseDown={onMouseDown} />
          <div className="sidebar-panel" style={{ flex: 1 }}>
            <div className="panel-label">History</div>
            <div className="panel-scroll">
              <SessionGroupList
                groups={histGroups}
                activeId={activeId}
                expanded={histExpanded}
                defaultOpen={false}
                isSearching={isSearching}
                onToggle={toggleHist}
                onSwitch={onSwitch}
                onKill={onKill}
                onDelete={onDelete}
                onRename={onRename}
                live={false}
              />
            </div>
          </div>
        </div>
        <div id="sidebar-actions">
          <select
            id="perm-mode"
            value={perm}
            onChange={(e) => setPerm(e.target.value as PermissionMode)}
          >
            <option value="bypassPermissions">Bypass Permissions</option>
            <option value="acceptEdits">Auto-Accept Edits</option>
            <option value="default">Default</option>
            <option value="plan">Plan Only</option>
          </select>
          <button id="new-session" onClick={() => onCreate(perm)}>+ New</button>
        </div>
        <button id="settings-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
          &#9881; Settings
        </button>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
});

// ─── Toolbar ─────────────────────────────────────────────────────

const PRESETS: PolicyPreset[] = ["unrestricted", "allow-edits", "no-writes", "read-only"];
const PRESET_LABELS: Record<PolicyPreset, string> = {
  "unrestricted": "Unrestricted",
  "allow-edits": "Allow Edits",
  "no-writes": "No Writes",
  "read-only": "Read Only",
};

type ToolbarProps = {
  session: SessionData | null;
  onSetPreset: (p: PolicyPreset) => void;
};

export const Toolbar = memo(function Toolbar({ session, onSetPreset }: ToolbarProps) {
  if (!session) return null;

  return (
    <div id="toolbar">
      <span id="toolbar-label">Tool Policy</span>
      {PRESETS.map((p) => (
        <button
          key={p}
          className={`policy-btn ${p === session.policyPreset ? "active" : ""}`}
          data-preset={p}
          onClick={() => onSetPreset(p)}
        >
          {PRESET_LABELS[p]}
        </button>
      ))}
      <span id="toolbar-info">mode: {session.permissionMode}</span>
    </div>
  );
});

// ─── Status bar ──────────────────────────────────────────────────

// ─── Input bar ───────────────────────────────────────────────────

// ─── Helpers: read clipboard images ──────────────────────────────

function fileToImageData(file: File): Promise<ImageData | null> {
  const mediaType = file.type as ImageData["mediaType"];
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      if (base64) resolve({ base64, mediaType });
      else resolve(null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ─── Input bar ───────────────────────────────────────────────────

type InputBarProps = {
  disabled: boolean;
  showResume: boolean;
  onSend: (text: string, images?: ImageData[]) => void;
  onResume: () => void;
};

export const InputBar = memo(function InputBar({ disabled, showResume, onSend, onResume }: InputBarProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const prevDisabled = useRef(disabled);
  const [pendingImages, setPendingImages] = useState<ImageData[]>([]);

  const handleSend = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text && pendingImages.length === 0) return;
    el.value = "";
    el.style.height = "auto";
    onSend(text || "(image)", pendingImages.length > 0 ? pendingImages : undefined);
    setPendingImages([]);
    requestAnimationFrame(() => el.focus());
  }, [onSend, pendingImages]);

  // Re-focus when session goes from busy → idle
  useEffect(() => {
    if (prevDisabled.current && !disabled) {
      ref.current?.focus();
    }
    prevDisabled.current = disabled;
  }, [disabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;
    e.preventDefault();
    const results = await Promise.all(imageFiles.map(fileToImageData));
    const valid = results.filter((r): r is ImageData => r !== null);
    if (valid.length > 0) {
      setPendingImages((prev) => [...prev, ...valid]);
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  if (showResume) {
    return (
      <div id="input-bar">
        <button className="resume-btn" onClick={onResume}>
          Resume Session
        </button>
      </div>
    );
  }

  return (
    <div id="input-bar">
      {pendingImages.length > 0 && (
        <div className="image-preview-bar">
          {pendingImages.map((img, i) => (
            <div key={i} className="image-preview-thumb">
              <img src={`data:${img.mediaType};base64,${img.base64}`} alt="" />
              <button className="image-preview-remove" onClick={() => removeImage(i)}>&times;</button>
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
        <textarea
          ref={ref}
          id="input"
          placeholder={pendingImages.length > 0 ? "Add a message about the image(s)..." : "Message Claude..."}
          rows={1}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
        />
        <button id="send" disabled={disabled} onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  );
});
