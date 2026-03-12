import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { SessionData } from "./store.js";
import { pickFolder } from "./store-actions.js";
import type { PermissionMode } from "../ipc.js";

import { useDrag } from "./hooks.js";
import { api } from "./utils.js";
import { relativeTime } from "./time.js";
import { groupByDirectory, type DirGroup } from "./dir-tree.js";
import { fuzzyMatch, sessionMatchesQuery, splitSessions } from "./session-filters.js";

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

// ─── Session item ────────────────────────────────────────────────

type SessionItemProps = {
  session: SessionData;
  depth: number;
  activeId: string | null;
  poppedOutIds?: Set<string>;
  live: boolean;
  pinned?: boolean;
  timeLabel?: string;
  snippet?: string;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleFavorite?: (id: string) => void;
};

function SessionItem({ session: s, depth, activeId, poppedOutIds, live, pinned, timeLabel, snippet, onSwitch, onKill, onDelete, onRename, onToggleFavorite }: SessionItemProps) {
  const isDead = s.state === "dead";
  const isPoppedOut = poppedOutIds?.has(s.id) ?? false;
  return (
    <button
      className={`session-item ${s.id === activeId ? "active" : ""} ${isDead ? "session-dead" : ""} ${isPoppedOut ? "popped-out" : ""} ${pinned ? "session-pinned" : ""}`}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
      onClick={() => onSwitch(s.id)}
      title={isPoppedOut ? "Focus pop-out window" : undefined}
    >
      <span className={`session-dot state-${s.state}`} />
      <div className="session-item-text">
        <div className="session-item-row">
          <EditableSessionLabel name={s.name} onRename={(name) => onRename(s.id, name)} />
          {timeLabel && <span className="session-time">{timeLabel}</span>}
        </div>
        {snippet && (
          <div className="session-snippet" dangerouslySetInnerHTML={{ __html: snippet }} />
        )}
      </div>
      <span
        className={`session-fav ${s.favorite ? "starred" : ""}`}
        title={s.favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(s.id); }}
      >
        {s.favorite ? "\u2605" : "\u2606"}
      </span>
      {isPoppedOut && <span className="popout-indicator" title="Popped out">&#8599;</span>}
      {live ? (
        <span className="session-kill" title="Terminate session" onClick={(e) => { e.stopPropagation(); onKill(s.id); }}>&#9632;</span>
      ) : (
        <span className="session-close" title="Remove from list" onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}>&times;</span>
      )}
    </button>
  );
}

// ─── Directory group list (flat grouping by cwd) ─────────────────

function DirGroupList({
  groups, unknown, activeId, poppedOutIds,
  onSwitch, onKill, onDelete, onRename, onCreate, onToggleFavorite, live, snippets,
}: {
  groups: DirGroup[];
  unknown: SessionData[];
  activeId: string | null;
  poppedOutIds?: Set<string>;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (cwd: string) => void;
  onToggleFavorite: (id: string) => void;
  live: boolean;
  snippets?: Map<string, string>;
}) {
  if (groups.length === 0 && unknown.length === 0) {
    return (
      <div className="panel-empty">
        {live ? "No active sessions" : "No sessions found"}
      </div>
    );
  }

  return (
    <>
      {groups.map(group => (
        <div key={group.directory} className="dir-tree-node">
          <div
            className="dir-tree-header"
            style={{ paddingLeft: "12px" }}
          >
            <span className="dir-tree-name" title={group.directory}>{group.directory}</span>
            <span
              className="dir-tree-new"
              title={`New session in ${group.directory}`}
              onClick={(e) => { e.stopPropagation(); onCreate(group.directory); }}
            >+</span>
          </div>
          {group.sessions.map(s => (
            <SessionItem
              key={s.id}
              session={s}
              depth={1}
              activeId={activeId}
              poppedOutIds={poppedOutIds}
              live={live}
              snippet={snippets?.get(s.id)}
              onSwitch={onSwitch}
              onKill={onKill}
              onDelete={onDelete}
              onRename={onRename}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      ))}
      {unknown.length > 0 && unknown.map(s => (
        <SessionItem
          key={s.id}
          session={s}
          depth={0}
          activeId={activeId}
          poppedOutIds={poppedOutIds}
          live={live}
          snippet={snippets?.get(s.id)}
          onSwitch={onSwitch}
          onKill={onKill}
          onDelete={onDelete}
          onRename={onRename}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </>
  );
}

type HistoryMode = "flat" | "tree";

// ─── Sidebar ─────────────────────────────────────────────────────

type SidebarProps = {
  sessions: SessionData[];
  activeId: string | null;
  poppedOutIds?: Set<string>;
  search: string;
  onSwitch: (id: string) => void;
  onKill: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCreate: (perm: PermissionMode, cwd?: string, name?: string) => void;
  onToggleFavorite: (id: string) => void;
};

const HISTORY_LIMIT = 20;

export const Sidebar = memo(function Sidebar({ sessions, activeId, poppedOutIds, search, onSwitch, onKill, onDelete, onRename, onCreate, onToggleFavorite }: SidebarProps) {
  const [perm, setPerm] = useState<PermissionMode>("default");
  const [defaultFolder, setDefaultFolder] = useState("");

  // Load saved defaults from config
  useEffect(() => {
    api().getConfig().then((cfg: any) => {
      if (cfg.defaultPermissionMode) setPerm(cfg.defaultPermissionMode);
      if (cfg.defaultProjectsFolder) setDefaultFolder(cfg.defaultProjectsFolder);
    });
  }, []);

  const [historyMode, setHistoryMode] = useState<HistoryMode>("flat");
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

  const q = search;

  // Full-text content search via the search index
  const [contentMatches, setContentMatches] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!q.trim()) {
      setContentMatches(new Map());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await api().searchSessions({ query: q.trim() });
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const r of results) map.set(r.sessionId, r.snippet);
          setContentMatches(map);
        }
      } catch {}
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q]);
  const contentMatchIds = useMemo(() => new Set(contentMatches.keys()), [contentMatches]);

  // Split into live / pinned / history via pure module
  const pinnedIds = useMemo(() => new Set(sessions.filter(s => s.favorite).map(s => s.id)), [sessions]);
  const { live: filteredLive, pinned: pinnedSessions, history: historySessions, historyAll: historyForTree } = useMemo(
    () => splitSessions(sessions, q, pinnedIds, HISTORY_LIMIT, q.trim() ? contentMatchIds : undefined),
    [sessions, q, pinnedIds, contentMatchIds],
  );

  const liveGroups = useMemo(() => groupByDirectory(filteredLive), [filteredLive]);
  const historyGroups = useMemo(() => groupByDirectory(historyForTree), [historyForTree]);
  const handleCreateInDir = useCallback((cwd: string) => onCreate(perm, cwd), [perm, onCreate]);
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);

  const handleBrowse = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) onCreate(perm, folder);
  }, [perm, onCreate]);

  const handleNewClick = useCallback(async () => {
    if (defaultFolder) {
      onCreate(perm, defaultFolder);
    } else {
      const folder = await pickFolder();
      if (!folder) return;
      // Show prompt offering to save as default
      setPendingFolder(folder);
    }
  }, [defaultFolder, perm, onCreate]);

  const handlePendingJustOnce = useCallback(() => {
    if (pendingFolder) onCreate(perm, pendingFolder);
    setPendingFolder(null);
  }, [pendingFolder, perm, onCreate]);

  const handlePendingSetDefault = useCallback(async () => {
    if (!pendingFolder) return;
    const cfg = await api().getConfig();
    await api().setConfig({ ...cfg, defaultProjectsFolder: pendingFolder });
    setDefaultFolder(pendingFolder);
    onCreate(perm, pendingFolder);
    setPendingFolder(null);
  }, [pendingFolder, perm, onCreate]);

  return (
    <>
      <div id="sidebar" style={{ width }}>
        <div id="sidebar-header">
          <span className="sidebar-header-label">Sessions</span>
          <div className="sidebar-header-actions">
            <button
              className="sidebar-new-btn"
              onClick={handleNewClick}
              title={defaultFolder ? `New session in ${defaultFolder}` : "New session (browse folder)"}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2.5l.5.5L7 9.5 5.5 11l.5-2.5L12.5 2l.5.5z" />
                <path d="M2 13.5h12" />
              </svg>
            </button>
            <button
              className="sidebar-browse-btn"
              onClick={handleBrowse}
              title="New session in folder..."
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4v9h12V6H7.5L6 4H2z" />
                <path d="M10 8v4" /><path d="M8 10h4" />
              </svg>
            </button>
          </div>
        </div>
        <div id="sidebar-panels" ref={panelsRef}>
          <div className="sidebar-panel" style={{ flex: `0 0 ${topRatio * 100}%` }}>
            <div className="panel-label">Live</div>
            <div className="panel-scroll">
              <DirGroupList
                groups={liveGroups.groups}
                unknown={liveGroups.unknown}
                activeId={activeId}
                poppedOutIds={poppedOutIds}
                onSwitch={onSwitch}
                onKill={onKill}
                onDelete={onDelete}
                onRename={onRename}
                onCreate={handleCreateInDir}
                onToggleFavorite={onToggleFavorite}
                live={true}
                snippets={contentMatches}
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
                  snippet={contentMatches.get(s.id)}
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
                <DirGroupList
                  groups={historyGroups.groups}
                  unknown={historyGroups.unknown}
                  activeId={activeId}
                  poppedOutIds={poppedOutIds}
                  onSwitch={onSwitch}
                  onKill={onKill}
                  onDelete={onDelete}
                  onRename={onRename}
                  onCreate={handleCreateInDir}
                  onToggleFavorite={onToggleFavorite}
                  live={false}
                  snippets={contentMatches}
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
                    snippet={contentMatches.get(s.id)}
                    onSwitch={onSwitch}
                    onKill={onKill}
                    onDelete={onDelete}
                    onRename={onRename}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))
              )}
            </div>
          </div>
        </div>
        <div className="sidebar-resize-handle" onMouseDown={onResizeMouseDown} />
      </div>
      {pendingFolder && (
        <div className="naming-modal-overlay" onClick={() => setPendingFolder(null)}>
          <div className="naming-modal" onClick={(e) => e.stopPropagation()}>
            <div className="naming-modal-title">Set as default folder?</div>
            <div className="default-folder-prompt-path">{pendingFolder}</div>
            <div className="default-folder-prompt-hint">
              New sessions will open here automatically, so you won't need to pick a folder each time.
            </div>
            <div className="naming-modal-actions">
              <button className="naming-btn naming-btn-cancel" onClick={handlePendingJustOnce}>Just this once</button>
              <button className="naming-btn naming-btn-ok" onClick={handlePendingSetDefault}>Set as default</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
