import React, { useState, useCallback, useRef, useMemo, memo } from "react";
import type { SessionData } from "./store.js";
import {
  openInApp,
  createSession,
  deleteSession,
  killSession,
  resumeSession,
  resumeInTerminal,
  renameSession,
  toggleFavorite,
  focusPopout,
  pickFolder,
} from "./store.js";
import { SettingsModal } from "./chat.js";
import type { PermissionMode } from "../ipc.js";

// ─── Helpers ────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Directory tree types and builder ────────────────────────────

type DirTreeNode = {
  segment: string;
  fullPath: string;
  children: Map<string, DirTreeNode>;
  sessions: SessionData[];
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

type DirTree = {
  commonPrefix: string;
  roots: DirTreeNode[];
  rootSessions: SessionData[];
  unknown: SessionData[];
};

function buildDirTree(sessions: SessionData[]): DirTree {
  const unknown: SessionData[] = [];
  const withCwd: SessionData[] = [];
  for (const s of sessions) {
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
    if (relSegs.length === 0) { rootSessions.push(s); continue; }
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

// ─── Session card (rich inline card) ────────────────────────────

function SessionCard({ session, poppedOut }: {
  session: SessionData;
  poppedOut: boolean;
}) {
  const isDead = session.state === "dead";
  const isBusy = session.state === "busy";
  const canResume = isDead && !!session.claudeSessionId;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    if (poppedOut) { focusPopout(session.id); return; }
    openInApp(session.id);
  }, [session.id, poppedOut]);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(session.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.name) {
      renameSession(session.id, trimmed);
    }
    setEditing(false);
  }, [editValue, session.id, session.name]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { commitRename(); }
    else if (e.key === "Escape") { setEditing(false); }
  }, [commitRename]);

  return (
    <div
      className={`hcard ${isDead ? "hcard-dead" : ""} ${isBusy ? "hcard-busy" : ""} ${poppedOut ? "hcard-popout" : ""}`}
      onClick={handleClick}
    >
      <div className="hcard-top">
        <div className="hcard-status">
          <span className={`hcard-dot state-${session.state}`} />
        </div>
        <div className="hcard-info">
          <div className="hcard-name-row">
            {editing ? (
              <input
                ref={inputRef}
                className="hcard-name-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="hcard-name" onDoubleClick={startRename} title="Double-click to rename">
                {session.name}
              </span>
            )}
            {poppedOut && <span className="hcard-badge">Popout</span>}
          </div>
          {session.cwd && <span className="hcard-cwd">{session.cwd}</span>}
        </div>
        <div className="hcard-meta">
          <span className="hcard-time">{timeAgo(session.lastActiveAt)}</span>
          {session.model && <span className="hcard-model">{session.model}</span>}
        </div>
      </div>
      <div className="hcard-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`hcard-star ${session.favorite ? "starred" : ""}`}
          onClick={() => toggleFavorite(session.id)}
          title={session.favorite ? "Unfavorite" : "Favorite"}
        >
          {session.favorite ? "\u2605" : "\u2606"}
        </button>
        <button className="hcard-btn hcard-btn-rename" onClick={startRename} title="Rename">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
          </svg>
        </button>
        {!isDead && (
          <button className="hcard-btn" onClick={() => openInApp(session.id)}>Open</button>
        )}
        {isDead && (
          <button className="hcard-btn" onClick={() => openInApp(session.id)}>View</button>
        )}
        {canResume && (
          <>
            <button className="hcard-btn hcard-btn-primary" onClick={() => { resumeSession(session.id); openInApp(session.id); }}>
              Resume
            </button>
            <button className="hcard-btn" onClick={() => resumeInTerminal(session.id)}>
              Terminal
            </button>
          </>
        )}
        {!isDead && (
          <button className="hcard-btn hcard-btn-muted" onClick={() => killSession(session.id)}>Kill</button>
        )}
        <button className="hcard-btn hcard-btn-danger" onClick={() => deleteSession(session.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Tree node view (recursive) ──────────────────────────────────

function TreeNodeView({ node, poppedOutIds, expandedPaths, onToggle }: {
  node: DirTreeNode;
  poppedOutIds: Set<string>;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isOpen = !expandedPaths.has(node.fullPath); // default open, toggle collapses
  const childNodes = [...node.children.values()].sort((a, b) => a.segment.localeCompare(b.segment));
  const count = countSessions(node);

  return (
    <div className="htree-node">
      <button className="htree-header" onClick={() => onToggle(node.fullPath)}>
        <span className="htree-toggle">{isOpen ? "\u25BE" : "\u25B8"}</span>
        <svg className="htree-folder-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M1 3h5l1.5 1.5H15v9.5H1V3z" opacity="0.7" />
        </svg>
        <span className="htree-name">{node.segment}</span>
        <span className="htree-count">{count}</span>
      </button>
      {isOpen && (
        <div className="htree-children">
          {childNodes.map(child => (
            <TreeNodeView
              key={child.fullPath}
              node={child}
              poppedOutIds={poppedOutIds}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
            />
          ))}
          {node.sessions
            .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
            .map(s => (
              <SessionCard key={s.id} session={s} poppedOut={poppedOutIds.has(s.id)} />
            ))}
        </div>
      )}
    </div>
  );
}

// ─── HomeView ───────────────────────────────────────────────────

export const HomeView = memo(function HomeView({ sessions, poppedOutIds }: {
  sessions: SessionData[];
  poppedOutIds: Set<string>;
}) {
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "tree">("list");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Filter sessions
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = q
      ? sessions.filter((s) =>
          s.name.toLowerCase().includes(q) ||
          (s.cwd ?? "").toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q))
      : sessions;
    return [...list].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.lastActiveAt - a.lastActiveAt;
    });
  }, [sessions, search]);

  // Group for list view
  const live = filtered.filter((s) => s.state !== "dead");
  const dead = filtered.filter((s) => s.state === "dead");

  // Tree view data
  const dirTree = useMemo(() => buildDirTree(filtered), [filtered]);

  const handleNew = useCallback(async () => {
    const cwd = await pickFolder();
    if (cwd) {
      await createSession("default" as PermissionMode, cwd);
    }
  }, []);

  const handleToggleTree = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  // Toggle icons
  const listIcon = (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  );
  const treeIcon = (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2v12" /><path d="M6 6h8" /><path d="M6 10h6" /><path d="M2 6h4" /><path d="M2 10h4" />
    </svg>
  );

  return (
    <>
      <div id="home-view">
        <div className="home-content">
          <div className="home-toolbar">
            <div className="home-search-wrap">
              <svg className="home-search-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
              </svg>
              <input
                className="home-search-input"
                type="text"
                placeholder="Search sessions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="home-search-clear" onClick={() => setSearch("")}>
                  {"\u00D7"}
                </button>
              )}
            </div>
            <button
              className={`home-view-toggle ${viewMode === "tree" ? "active" : ""}`}
              onClick={() => setViewMode(m => m === "list" ? "tree" : "list")}
              title={viewMode === "list" ? "Switch to directory view" : "Switch to list view"}
            >
              {viewMode === "list" ? treeIcon : listIcon}
            </button>
            <button className="home-new-btn" onClick={handleNew}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 2v12M2 8h12" />
              </svg>
              New Session
            </button>
            <button className="home-settings-btn" onClick={() => setShowSettings(true)} title="Settings">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="2" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M12.95 3.05l-1.41 1.41M4.46 11.54l-1.41 1.41" />
              </svg>
            </button>
          </div>

          <div className="home-grid">
            {filtered.length === 0 && (
              <div className="home-empty">
                {search ? `No sessions match "${search}"` : "No sessions yet. Start a new one!"}
              </div>
            )}

            {viewMode === "list" ? (
              <>
                {live.length > 0 && (
                  <div className="home-section">
                    <div className="home-section-label">Active Sessions</div>
                    {live.map((s) => (
                      <SessionCard key={s.id} session={s} poppedOut={poppedOutIds.has(s.id)} />
                    ))}
                  </div>
                )}
                {dead.length > 0 && (
                  <div className="home-section">
                    {live.length > 0 && <div className="home-section-label">Recent</div>}
                    {dead.map((s) => (
                      <SessionCard key={s.id} session={s} poppedOut={poppedOutIds.has(s.id)} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                {dirTree.commonPrefix && dirTree.commonPrefix !== "/" && (
                  <div className="htree-prefix">{dirTree.commonPrefix}</div>
                )}
                {dirTree.roots.map(node => (
                  <TreeNodeView
                    key={node.fullPath}
                    node={node}
                    poppedOutIds={poppedOutIds}
                    expandedPaths={expandedPaths}
                    onToggle={handleToggleTree}
                  />
                ))}
                {dirTree.rootSessions.map(s => (
                  <SessionCard key={s.id} session={s} poppedOut={poppedOutIds.has(s.id)} />
                ))}
                {dirTree.unknown.length > 0 && (
                  <div className="htree-node">
                    <button className="htree-header" onClick={() => handleToggleTree("__unknown__")}>
                      <span className="htree-toggle">{!expandedPaths.has("__unknown__") ? "\u25BE" : "\u25B8"}</span>
                      <span className="htree-name">(no directory)</span>
                      <span className="htree-count">{dirTree.unknown.length}</span>
                    </button>
                    {!expandedPaths.has("__unknown__") && (
                      <div className="htree-children">
                        {dirTree.unknown.map(s => (
                          <SessionCard key={s.id} session={s} poppedOut={poppedOutIds.has(s.id)} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
});
