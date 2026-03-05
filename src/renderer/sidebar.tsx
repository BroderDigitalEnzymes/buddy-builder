import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { pickFolder, type SessionData } from "./store.js";
import type { PermissionMode } from "../ipc.js";
import { SettingsModal, PolicyPicker, PERM_ITEMS } from "./chat.js";
import { useDrag } from "./hooks.js";
import { api } from "./utils.js";

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
  pinned?: boolean;
  timeLabel?: string;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite?: (id: string) => void;
};

function SessionItem({ session: s, depth, activeId, poppedOutIds, live, pinned, timeLabel, onSwitch, onKill, onDelete, onRename, onToggleFavorite }: SessionItemProps) {
  const isDead = s.state === "dead";
  const isPoppedOut = poppedOutIds?.has(s.id) ?? false;
  return (
    <button
      className={`session-item ${s.id === activeId ? "active" : ""} ${isDead ? "session-dead" : ""} ${isPoppedOut ? "popped-out" : ""} ${pinned ? "session-pinned" : ""}`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      onClick={() => onSwitch(s.id)}
      title={isPoppedOut ? "Focus pop-out window" : undefined}
    >
      <span className="dir-tree-toggle-spacer" />
      {pinned ? (
        <span
          className="session-pin"
          title="Unpin"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(s.id); }}
        >{"\u2605"}</span>
      ) : (
        <span className={`session-dot state-${s.state}`} />
      )}
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
  onToggleFavorite: (id: string) => void;
};

const HISTORY_LIMIT = 20;

export const Sidebar = memo(function Sidebar({ sessions, activeId, poppedOutIds, onSwitch, onKill, onDelete, onRename, onCreate, onToggleFavorite }: SidebarProps) {
  const [perm, setPerm] = useState<PermissionMode>("default");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Load saved default permission mode from config
  useEffect(() => {
    api().getConfig().then((cfg: any) => {
      if (cfg.defaultPermissionMode) setPerm(cfg.defaultPermissionMode);
    });
  }, []);
  const [search, setSearch] = useState("");
  const [historyMode, setHistoryMode] = useState<"flat" | "tree">("flat");
  const [liveExpanded, setLiveExpanded] = useState<Set<string>>(new Set());
  const [historyExpanded, setHistoryExpanded] = useState<Set<string>>(new Set());
  const panelsRef = useRef<HTMLDivElement>(null);
  const { value: topRatio, onMouseDown } = useDrag({
    initial: 0.3, min: 0.08, max: 0.92, cursor: "row-resize",
    getPosition: (e) => {
      const rect = panelsRef.current?.getBoundingClientRect();
      if (!rect) return 0.3;
      return (e.clientY - rect.top) / rect.height;
    },
  });
  const { value: width, onMouseDown: onResizeMouseDown } = useDrag({
    initial: 240, min: 180, max: 500,
    getPosition: (e) => e.clientX,
  });

  const isSearching = search.trim().length > 0;
  const q = search.trim();

  // Split into live vs history
  const liveSessions = useMemo(() => sessions.filter((s) => s.state !== "dead"), [sessions]);

  const liveTree = useMemo(() => buildDirTree(liveSessions, search), [liveSessions, search]);

  // Pinned sessions (favorites) — shown at top of history, any state
  const pinnedSessions = useMemo(() => {
    let pinned = sessions.filter((s) => s.favorite && s.state === "dead");
    if (q) pinned = pinned.filter(s => fuzzyMatch(q, s.name) || fuzzyMatch(q, s.cwd ?? "") || fuzzyMatch(q, s.projectName));
    pinned.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return pinned;
  }, [sessions, q]);

  const pinnedIds = useMemo(() => new Set(pinnedSessions.map(s => s.id)), [pinnedSessions]);

  // History: flat list, sorted by recency, capped, filterable (excludes pinned)
  const historySessions = useMemo(() => {
    let dead = sessions.filter((s) => s.state === "dead" && !pinnedIds.has(s.id));
    if (q) dead = dead.filter(s => fuzzyMatch(q, s.name) || fuzzyMatch(q, s.cwd ?? "") || fuzzyMatch(q, s.projectName));
    dead.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return dead.slice(0, HISTORY_LIMIT);
  }, [sessions, q, pinnedIds]);

  const historyForTree = useMemo(() => {
    let dead = sessions.filter((s) => s.state === "dead");
    if (q) dead = dead.filter(s => fuzzyMatch(q, s.name) || fuzzyMatch(q, s.cwd ?? "") || fuzzyMatch(q, s.projectName));
    return dead;
  }, [sessions, q]);

  const historyTree = useMemo(() => buildDirTree(historyForTree, ""), [historyForTree]);

  const toggleLive = useCallback((p: string) => {
    setLiveExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
  }, []);
  const toggleHistory = useCallback((p: string) => {
    setHistoryExpanded((prev) => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; });
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
            <div className="panel-label">
              History
              <button
                className="panel-view-toggle"
                title={historyMode === "flat" ? "Switch to tree view" : "Switch to flat view"}
                onClick={() => setHistoryMode(m => m === "flat" ? "tree" : "flat")}
              >
                {historyMode === "flat" ? (
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 2v12" /><path d="M6 6h8" /><path d="M6 10h6" /><path d="M2 6h4" /><path d="M2 10h4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 4h12" /><path d="M2 8h12" /><path d="M2 12h12" />
                  </svg>
                )}
              </button>
            </div>
            <div className="panel-scroll">
              {pinnedSessions.length > 0 && pinnedSessions.map(s => (
                <SessionItem
                  key={s.id}
                  session={s}
                  depth={0}
                  activeId={activeId}
                  poppedOutIds={poppedOutIds}
                  live={false}
                  pinned={true}
                  timeLabel={relativeTime(s.lastActiveAt)}
                  onSwitch={onSwitch}
                  onKill={onKill}
                  onDelete={onDelete}
                  onRename={onRename}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
              {pinnedSessions.length > 0 && (historySessions.length > 0 || historyForTree.length > 0) && (
                <div className="pinned-divider" />
              )}
              {historyMode === "tree" ? (
                <DirTreeList
                  tree={historyTree}
                  activeId={activeId}
                  poppedOutIds={poppedOutIds}
                  expandedPaths={historyExpanded}
                  isSearching={isSearching}
                  onToggle={toggleHistory}
                  onSwitch={onSwitch}
                  onKill={onKill}
                  onDelete={onDelete}
                  onRename={onRename}
                  onCreate={handleCreateInDir}
                  live={false}
                />
              ) : (
                historySessions.length === 0 && pinnedSessions.length === 0 ? (
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
                ))
              )}
            </div>
          </div>
        </div>
        <div id="sidebar-actions">
          <PolicyPicker items={PERM_ITEMS} value={perm} onChange={setPerm} />
          <button id="new-session" onClick={handleBrowse} title="Browse for project folder">+ New...</button>
        </div>
        <button id="settings-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
          &#9881; Settings
        </button>
        <div className="sidebar-resize-handle" onMouseDown={onResizeMouseDown} />
      </div>
      <SettingsModal open={settingsOpen} onClose={() => {
        setSettingsOpen(false);
        // Re-sync permission mode in case user changed the default
        api().getConfig().then((cfg: any) => {
          if (cfg.defaultPermissionMode) setPerm(cfg.defaultPermissionMode);
        });
      }} />
    </>
  );
});
