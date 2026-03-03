import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { pickFolder, type SessionData } from "./store.js";
import type { PermissionMode } from "../ipc.js";
import { SettingsModal } from "./chat.js";

// ─── Fuzzy match ─────────────────────────────────────────────────

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ─── Relative time ───────────────────────────────────────────────

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ─── Editable session label ──────────────────────────────────────

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

// ─── Directory tree types and builder ────────────────────────────

type DirTreeNode = {
  segment: string;
  fullPath: string;
  children: Map<string, DirTreeNode>;
  sessions: SessionData[];
};

type DirTree = {
  commonPrefix: string;
  roots: DirTreeNode[];
  rootSessions: SessionData[];
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

// ─── Session item ────────────────────────────────────────────────

type SessionItemProps = {
  session: SessionData;
  depth: number;
  activeId: string | null;
  poppedOutIds?: Set<string>;
  live: boolean;
  timeLabel?: string;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
};

function SessionItem({ session: s, depth, activeId, poppedOutIds, live, timeLabel, onSwitch, onKill, onDelete, onRename }: SessionItemProps) {
  const isDead = s.state === "dead";
  const isPoppedOut = poppedOutIds?.has(s.id) ?? false;
  return (
    <button
      className={`session-item ${s.id === activeId ? "active" : ""} ${isDead ? "session-dead" : ""} ${isPoppedOut ? "popped-out" : ""}`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      onClick={() => onSwitch(s.id)}
      title={isPoppedOut ? "Focus pop-out window" : undefined}
    >
      <span className="dir-tree-toggle-spacer" />
      <span className={`session-dot state-${s.state}`} />
      <EditableSessionLabel name={s.name} onRename={(name) => onRename(s.id, name)} />
      {timeLabel && <span className="session-time">{timeLabel}</span>}
      {isPoppedOut && <span className="popout-indicator" title="Popped out">&#8599;</span>}
      {live ? (
        <span className="session-kill" title="Terminate session" onClick={(e) => { e.stopPropagation(); onKill(s.id); }}>&#9632;</span>
      ) : (
        <span className="session-close" title="Remove from list" onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}>&times;</span>
      )}
    </button>
  );
}

// ─── Directory tree node (recursive) ─────────────────────────────

type DirTreeNodeViewProps = {
  node: DirTreeNode;
  depth: number;
  activeId: string | null;
  poppedOutIds?: Set<string>;
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
  node, depth, activeId, poppedOutIds, expandedPaths, isSearching,
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
              poppedOutIds={poppedOutIds}
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
              poppedOutIds={poppedOutIds}
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

// ─── Directory tree list ─────────────────────────────────────────

type DirTreeListProps = {
  tree: DirTree;
  activeId: string | null;
  poppedOutIds?: Set<string>;
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
  tree, activeId, poppedOutIds, expandedPaths, isSearching,
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
          poppedOutIds={poppedOutIds}
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
          poppedOutIds={poppedOutIds}
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
              poppedOutIds={poppedOutIds}
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

// ─── Sidebar resize hook ─────────────────────────────────────────

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 500;
const SIDEBAR_DEFAULT = 240;

function useSidebarResize() {
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, ev.clientX)));
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return { width, onResizeMouseDown: onMouseDown };
}

// ─── Sidebar ─────────────────────────────────────────────────────

type SidebarProps = {
  sessions: SessionData[];
  activeId: string | null;
  poppedOutIds?: Set<string>;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (perm: PermissionMode, cwd?: string) => void;
};

const HISTORY_LIMIT = 20;

export const Sidebar = memo(function Sidebar({ sessions, activeId, poppedOutIds, onSwitch, onKill, onDelete, onRename, onCreate }: SidebarProps) {
  const [perm, setPerm] = useState<PermissionMode>("default");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [liveExpanded, setLiveExpanded] = useState<Set<string>>(new Set());
  const panelsRef = useRef<HTMLDivElement>(null);
  const { topRatio, onMouseDown } = useDragBar(panelsRef, 0.3);
  const { width, onResizeMouseDown } = useSidebarResize();

  const isSearching = search.trim().length > 0;
  const q = search.trim();

  // Split into live vs history
  const liveSessions = useMemo(() => sessions.filter((s) => s.state !== "dead"), [sessions]);

  const liveTree = useMemo(() => buildDirTree(liveSessions, search), [liveSessions, search]);

  // History: flat list, sorted by recency, capped, filterable
  const historySessions = useMemo(() => {
    let dead = sessions.filter((s) => s.state === "dead");
    if (q) dead = dead.filter(s => fuzzyMatch(q, s.name) || fuzzyMatch(q, s.cwd ?? "") || fuzzyMatch(q, s.projectName));
    dead.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return dead.slice(0, HISTORY_LIMIT);
  }, [sessions, q]);

  const toggleLive = useCallback((p: string) => {
    setLiveExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }, []);
  const handleCreateInDir = useCallback((cwd: string) => onCreate(perm, cwd), [perm, onCreate]);
  const handleBrowse = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) onCreate(perm, folder);
  }, [perm, onCreate]);

  return (
    <>
      <div id="sidebar" style={{ width }}>
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
                poppedOutIds={poppedOutIds}
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
            <div className="panel-label">History ({historySessions.length})</div>
            <div className="panel-scroll">
              {historySessions.length === 0 ? (
                <div className="panel-empty">No sessions found</div>
              ) : historySessions.map(s => (
                <SessionItem
                  key={s.id}
                  session={s}
                  depth={0}
                  activeId={activeId}
                  poppedOutIds={poppedOutIds}
                  live={false}
                  timeLabel={relativeTime(s.lastActiveAt)}
                  onSwitch={onSwitch}
                  onKill={onKill}
                  onDelete={onDelete}
                  onRename={onRename}
                />
              ))}
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
        <div className="sidebar-resize-handle" onMouseDown={onResizeMouseDown} />
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
});
