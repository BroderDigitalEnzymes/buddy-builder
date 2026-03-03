import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { marked } from "marked";
import { pickFolder, type SessionData } from "./store.js";
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

const SENDER_ICONS: Record<Sender, React.ReactNode> = {
  user: (
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  ),
  claude: (
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1l1.8 4.2L14 7l-4.2 1.8L8 13l-1.8-4.2L2 7l4.2-1.8z" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3M3 3l2 2M11 11l2 2M13 3l-2 2M5 11l-2 2" strokeWidth="1.5" stroke="#fff" fill="none" />
    </svg>
  ),
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

  const avatarClass = AVATAR_CLASSES[sender];

  // Group start: avatar + name + timestamp + content
  if (isGroupStart) {
    return (
      <div className="msg-row msg-row-first">
        <div className={avatarClass}>
          {SENDER_ICONS[sender]}
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
  isBusy?: boolean;
};

export function MessageList({ entries, isBusy }: MessageListProps) {
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
  }, [entries, entries.length > 0 ? entries[entries.length - 1] : null, isBusy]);

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
        {isBusy && (
          <div className="msg-row msg-row-first thinking-row">
            <div className="msg-avatar msg-avatar-claude msg-avatar-thinking">
              {SENDER_ICONS.claude}
            </div>
            <div className="msg-content">
              <div className="msg-header">
                <span className="msg-sender">Claude</span>
              </div>
            </div>
          </div>
        )}
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
  onCreate: (perm: PermissionMode, cwd?: string) => void;
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

// ─── Directory tree types and builder ─────────────────────────────

type DirTreeNode = {
  segment: string;
  fullPath: string;
  children: Map<string, DirTreeNode>;
  sessions: SessionData[];
};

type DirTree = {
  commonPrefix: string;
  roots: DirTreeNode[];
  rootSessions: SessionData[];  // sessions whose cwd equals the common prefix
  unknown: SessionData[];
};

function pathSegments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

function findCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const segArrays = paths.map(pathSegments);
  const minLen = Math.min(...segArrays.map(s => s.length));
  let shared = 0;
  for (let i = 0; i < minLen; i++) {
    if (segArrays.every(a => a[i] === segArrays[0][i])) shared = i + 1;
    else break;
  }
  if (shared === 0) return "/";
  return "/" + segArrays[0].slice(0, shared).join("/");
}

function countSessions(node: DirTreeNode): number {
  let count = node.sessions.length;
  for (const child of node.children.values()) count += countSessions(child);
  return count;
}

function buildDirTree(sessions: SessionData[], filter: string): DirTree {
  const q = filter.trim();
  const unknown: SessionData[] = [];
  const withCwd: SessionData[] = [];

  for (const s of sessions) {
    if (q && !fuzzyMatch(q, s.name) && !fuzzyMatch(q, s.cwd ?? "") && !fuzzyMatch(q, s.projectName)) continue;
    if (s.cwd) withCwd.push(s);
    else unknown.push(s);
  }

  const cwds = withCwd.map(s => s.cwd!);
  const commonPrefix = findCommonPrefix(cwds);
  const prefixSegs = pathSegments(commonPrefix);
  const rootMap = new Map<string, DirTreeNode>();
  const rootSessions: SessionData[] = [];

  for (const s of withCwd) {
    const segs = pathSegments(s.cwd!);
    const relSegs = segs.slice(prefixSegs.length);

    if (relSegs.length === 0) {
      rootSessions.push(s);
      continue;
    }

    let currentMap = rootMap;
    let currentPath = commonPrefix;
    let node: DirTreeNode | undefined;

    for (const seg of relSegs) {
      currentPath = currentPath + "/" + seg;
      if (!currentMap.has(seg)) {
        currentMap.set(seg, { segment: seg, fullPath: currentPath, children: new Map(), sessions: [] });
      }
      node = currentMap.get(seg)!;
      currentMap = node.children;
    }
    node!.sessions.push(s);
  }

  const roots = [...rootMap.values()].sort((a, b) => a.segment.localeCompare(b.segment));
  return { commonPrefix, roots, rootSessions, unknown };
}

// ─── Session item (extracted for reuse) ───────────────────────────

type SessionItemProps = {
  session: SessionData;
  depth: number;
  activeId: string | null;
  live: boolean;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
};

function SessionItem({ session: s, depth, activeId, live, onSwitch, onKill, onDelete, onRename }: SessionItemProps) {
  const isDead = s.state === "dead";
  return (
    <button
      className={`session-item ${s.id === activeId ? "active" : ""} ${isDead ? "session-dead" : ""}`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      onClick={() => onSwitch(s.id)}
    >
      <span className="dir-tree-toggle-spacer" />
      <span className={`session-dot state-${s.state}`} />
      <EditableSessionLabel name={s.name} onRename={(name) => onRename(s.id, name)} />
      {live ? (
        <span className="session-kill" title="Terminate session" onClick={(e) => { e.stopPropagation(); onKill(s.id); }}>&#9632;</span>
      ) : (
        <span className="session-close" title="Remove from list" onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}>&times;</span>
      )}
    </button>
  );
}

// ─── Directory tree node (recursive) ──────────────────────────────

type DirTreeNodeViewProps = {
  node: DirTreeNode;
  depth: number;
  activeId: string | null;
  expandedPaths: Set<string>;
  isSearching: boolean;
  onToggle: (path: string) => void;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (cwd: string) => void;
  live: boolean;
};

function DirTreeNodeView({
  node, depth, activeId, expandedPaths, isSearching,
  onToggle, onSwitch, onKill, onDelete, onRename, onCreate, live,
}: DirTreeNodeViewProps) {
  const defaultOpen = true;
  const userToggled = expandedPaths.has(node.fullPath);
  const isOpen = defaultOpen ? !userToggled : userToggled;

  const childNodes = [...node.children.values()].sort((a, b) => a.segment.localeCompare(b.segment));

  return (
    <div className="dir-tree-node">
      <button
        className="dir-tree-header"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => onToggle(node.fullPath)}
      >
        <span className="dir-tree-toggle">{isOpen ? "\u2212" : "+"}</span>
        <span className="dir-tree-name">{node.segment}</span>
        <span className="dir-tree-count">{countSessions(node)}</span>
        <span
          className="dir-tree-new"
          title={`New session in ${node.fullPath}`}
          onClick={(e) => { e.stopPropagation(); onCreate(node.fullPath); }}
        >+</span>
      </button>
      {isOpen && (
        <>
          {node.sessions.map(s => (
            <SessionItem
              key={s.id}
              session={s}
              depth={depth + 1}
              activeId={activeId}
              live={live}
              onSwitch={onSwitch}
              onKill={onKill}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
          {childNodes.map(child => (
            <DirTreeNodeView
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              expandedPaths={expandedPaths}
              isSearching={isSearching}
              onToggle={onToggle}
              onSwitch={onSwitch}
              onKill={onKill}
              onDelete={onDelete}
              onRename={onRename}
              onCreate={onCreate}
              live={live}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ─── Directory tree list ──────────────────────────────────────────

type DirTreeListProps = {
  tree: DirTree;
  activeId: string | null;
  expandedPaths: Set<string>;
  isSearching: boolean;
  onToggle: (path: string) => void;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (cwd: string) => void;
  live: boolean;
};

function DirTreeList({
  tree, activeId, expandedPaths, isSearching,
  onToggle, onSwitch, onKill, onDelete, onRename, onCreate, live,
}: DirTreeListProps) {
  if (tree.roots.length === 0 && tree.rootSessions.length === 0 && tree.unknown.length === 0) {
    return (
      <div className="panel-empty">
        {live ? "No active sessions" : "No sessions found"}
      </div>
    );
  }

  const unknownOpen = isSearching || expandedPaths.has("__unknown__");

  return (
    <>
      {tree.commonPrefix && tree.commonPrefix !== "/" && (
        <div className="dir-tree-prefix" title={tree.commonPrefix}>{tree.commonPrefix}</div>
      )}
      {tree.roots.map(node => (
        <DirTreeNodeView
          key={node.fullPath}
          node={node}
          depth={0}
          activeId={activeId}
          expandedPaths={expandedPaths}
          isSearching={isSearching}
          onToggle={onToggle}
          onSwitch={onSwitch}
          onKill={onKill}
          onDelete={onDelete}
          onRename={onRename}
          onCreate={onCreate}
          live={live}
        />
      ))}
      {tree.rootSessions.map(s => (
        <SessionItem
          key={s.id}
          session={s}
          depth={0}
          activeId={activeId}
          live={live}
          onSwitch={onSwitch}
          onKill={onKill}
          onDelete={onDelete}
          onRename={onRename}
        />
      ))}
      {tree.unknown.length > 0 && (
        <div className="dir-tree-node">
          <button
            className="dir-tree-header"
            style={{ paddingLeft: "12px" }}
            onClick={() => onToggle("__unknown__")}
          >
            <span className="dir-tree-toggle">{unknownOpen ? "\u2212" : "+"}</span>
            <span className="dir-tree-name">(unknown)</span>
            <span className="dir-tree-count">{tree.unknown.length}</span>
          </button>
          {unknownOpen && tree.unknown.map(s => (
            <SessionItem
              key={s.id}
              session={s}
              depth={1}
              activeId={activeId}
              live={live}
              onSwitch={onSwitch}
              onKill={onKill}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
        </div>
      )}
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

  const liveTree = useMemo(() => buildDirTree(liveSessions, search), [liveSessions, search]);
  const histTree = useMemo(() => buildDirTree(deadSessions, search), [deadSessions, search]);

  const toggleLive = useCallback((p: string) => {
    setLiveExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }, []);
  const toggleHist = useCallback((p: string) => {
    setHistExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }, []);
  const handleCreateInDir = useCallback((cwd: string) => onCreate(perm, cwd), [perm, onCreate]);
  const handleBrowse = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) onCreate(perm, folder);
  }, [perm, onCreate]);

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
              <DirTreeList
                tree={liveTree}
                activeId={activeId}
                expandedPaths={liveExpanded}
                isSearching={isSearching}
                onToggle={toggleLive}
                onSwitch={onSwitch}
                onKill={onKill}
                onDelete={onDelete}
                onRename={onRename}
                onCreate={handleCreateInDir}
                live={true}
              />
            </div>
          </div>
          <div className="sidebar-drag" onMouseDown={onMouseDown} />
          <div className="sidebar-panel" style={{ flex: 1 }}>
            <div className="panel-label">History</div>
            <div className="panel-scroll">
              <DirTreeList
                tree={histTree}
                activeId={activeId}
                expandedPaths={histExpanded}
                isSearching={isSearching}
                onToggle={toggleHist}
                onSwitch={onSwitch}
                onKill={onKill}
                onDelete={onDelete}
                onRename={onRename}
                onCreate={handleCreateInDir}
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
          <button id="new-session" onClick={handleBrowse} title="Browse for project folder">+ New...</button>
        </div>
        <button id="settings-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
          &#9881; Settings
        </button>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
});

// ─── Chat header (Slack-style) ───────────────────────────────────

const PRESETS: PolicyPreset[] = ["unrestricted", "allow-edits", "no-writes", "read-only"];
const PRESET_LABELS: Record<PolicyPreset, string> = {
  "unrestricted": "Unrestricted",
  "allow-edits": "Allow Edits",
  "no-writes": "No Writes",
  "read-only": "Read Only",
};

const PRESET_ICONS: Record<PolicyPreset, string> = {
  "unrestricted": "\u26A0",   // warning sign
  "allow-edits": "\u270E",    // pencil
  "no-writes": "\u{1F6E1}",   // shield
  "read-only": "\u{1F512}",   // lock
};

type ChatHeaderProps = {
  session: SessionData | null;
  onSetPreset: (p: PolicyPreset) => void;
  onToggleFavorite: () => void;
};

export const ChatHeader = memo(function ChatHeader({ session, onSetPreset, onToggleFavorite }: ChatHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  if (!session) {
    return <div id="chat-header" />;
  }

  return (
    <div id="chat-header">
      <div className="chat-header-left">
        <button
          className={`chat-header-star ${session.favorite ? "starred" : ""}`}
          title={session.favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={onToggleFavorite}
        >
          {session.favorite ? "\u2605" : "\u2606"}
        </button>
        <div className="chat-header-info">
          <span className="chat-header-name">{session.name}</span>
          <span className="chat-header-project">{session.projectName}</span>
        </div>
      </div>
      <div className="chat-header-right">
        <div className="chat-header-dropdown-wrap" ref={dropdownRef}>
          <button
            className="chat-header-icon-btn"
            title="Tool policy"
            onClick={() => setDropdownOpen((v) => !v)}
          >
            <span className="policy-icon">{PRESET_ICONS[session.policyPreset]}</span>
            <span className="policy-chevron">{"\u25BE"}</span>
          </button>
          {dropdownOpen && (
            <div className="policy-dropdown">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className={`policy-dropdown-item ${p === session.policyPreset ? "active" : ""}`}
                  data-preset={p}
                  onClick={() => { onSetPreset(p); setDropdownOpen(false); }}
                >
                  <span className="policy-dropdown-icon">{PRESET_ICONS[p]}</span>
                  <span className="policy-dropdown-label">{PRESET_LABELS[p]}</span>
                  {p === session.policyPreset && <span className="policy-dropdown-check">{"\u2713"}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
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
  onResumeTerminal: () => void;
};

export const InputBar = memo(function InputBar({ disabled, showResume, onSend, onResume, onResumeTerminal }: InputBarProps) {
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
        <div className="resume-actions">
          <button className="resume-btn" onClick={onResume}>
            Resume Session
          </button>
          <button className="resume-terminal-btn" onClick={onResumeTerminal} title="Resume in Terminal">
            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
              <path d="M2 3l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="9" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
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
