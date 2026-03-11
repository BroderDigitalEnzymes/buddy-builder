import React, { useState, useCallback, useRef, useMemo, memo } from "react";
import type { SessionData } from "./store.js";
import { getState } from "./store.js";
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
  setSearchQuery,
  popOutSession,
} from "./store-actions.js";
import { SettingsModal } from "./settings-modal.js";
import { SessionActionButtons } from "./session-actions.js";
import type { PermissionMode } from "../ipc.js";
import { relativeTime } from "./time.js";
import { groupByDirectory, type DirGroup } from "./dir-tree.js";

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    >
      <div className="hcard-top">
        <button
          className={`hcard-star ${session.favorite ? "starred" : ""}`}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(session.id); }}
          title={session.favorite ? "Unfavorite" : "Favorite"}
        >
          {session.favorite ? "\u2605" : "\u2606"}
        </button>
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
          <span className="hcard-time">{relativeTime(session.lastActiveAt)}</span>
          {session.model && <span className="hcard-model">{session.model}</span>}
        </div>
      </div>
      <div className="hcard-actions" onClick={(e) => e.stopPropagation()}>
        <button className="hcard-btn hcard-btn-rename" onClick={startRename} title="Rename">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
          </svg>
        </button>
        {canResume ? (
          <SessionActionButtons
            claudeSessionId={session.claudeSessionId}
            cwd={session.cwd}
            permissionMode={session.permissionMode}
            showView
            onView={() => openInApp(session.id)}
            onResume={async () => {
              resumeSession(session.id);
              const { api } = await import("./utils.js");
              const cfg = await api().getConfig();
              if (cfg.popOutByDefault) {
                popOutSession(session.id);
              } else {
                openInApp(session.id);
              }
            }}
            onResumeTerminal={() => resumeInTerminal(session.id)}
          />
        ) : (
          <>
            {!isDead && (
              <button className="hcard-btn" onClick={() => openInApp(session.id)}>Open</button>
            )}
            {isDead && (
              <button className="hcard-btn" onClick={() => openInApp(session.id)}>View</button>
            )}
            {!isDead && (
              <button className="hcard-btn hcard-btn-muted" onClick={() => killSession(session.id)}>Kill</button>
            )}
          </>
        )}
        <button
          className={`hcard-btn ${confirmDelete ? "hcard-btn-confirm-delete" : "hcard-btn-danger"}`}
          onClick={() => {
            if (confirmDelete) {
              if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
              deleteSession(session.id);
            } else {
              setConfirmDelete(true);
              deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
            }
          }}
          onMouseLeave={() => {
            if (confirmDelete) {
              if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
              deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 1500);
            }
          }}
        >
          {confirmDelete ? "Confirm?" : "Delete"}
        </button>
      </div>
    </div>
  );
}

// ─── Search result card ─────────────────────────────────────────

function SearchResultCard({ result, onOpen }: {
  result: { sessionId: string; sessionName: string; cwd: string | null; snippet: string; lastActiveAt: number };
  onOpen: (id: string) => void;
}) {
  return (
    <div className="hcard search-result" onClick={() => onOpen(result.sessionId)}>
      <div className="hcard-top">
        <div className="hcard-info">
          <div className="hcard-name-row">
            <span className="hcard-name">{result.sessionName}</span>
          </div>
          {result.cwd && <span className="hcard-cwd">{result.cwd}</span>}
        </div>
        <div className="hcard-meta">
          <span className="hcard-time">{relativeTime(result.lastActiveAt)}</span>
        </div>
      </div>
      <span
        className="search-snippet"
        dangerouslySetInnerHTML={{ __html: result.snippet }}
      />
    </div>
  );
}

// ─── Directory group view (flat grouping by cwd) ─────────────────

function DirGroupView({ group, poppedOutIds }: {
  group: DirGroup;
  poppedOutIds: Set<string>;
}) {
  return (
    <div className="htree-node">
      <div className="htree-header">
        <svg className="htree-folder-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M1 3h5l1.5 1.5H15v9.5H1V3z" opacity="0.7" />
        </svg>
        <span className="htree-name" title={group.directory}>{group.directory}</span>
      </div>
      <div className="htree-children">
        {group.sessions
          .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
          .map(s => (
            <SessionCard key={s.id} session={s} poppedOut={poppedOutIds.has(s.id)} />
          ))}
      </div>
    </div>
  );
}

type HomeViewMode = "list" | "tree";

// ─── HomeView ───────────────────────────────────────────────────

export const HomeView = memo(function HomeView({ sessions, poppedOutIds }: {
  sessions: SessionData[];
  poppedOutIds: Set<string>;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState<HomeViewMode>("list");

  const { searchQuery, searchResults } = getState();

  // Filter sessions
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
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
  }, [sessions, searchQuery]);

  // Group for list view
  const live = filtered.filter((s) => s.state !== "dead");
  const dead = filtered.filter((s) => s.state === "dead");

  // Tree view data
  const dirGroups = useMemo(() => groupByDirectory(filtered), [filtered]);

  const handleNew = useCallback(async () => {
    const { api } = await import("./utils.js");
    const cfg = await api().getConfig();
    const cwd = cfg.defaultProjectsFolder || await pickFolder();
    if (cwd) {
      const id = await createSession(cfg.defaultPermissionMode ?? "default", cwd);
      if (id && cfg.popOutByDefault) popOutSession(id);
    }
  }, []);

  const handleNewPickFolder = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { api } = await import("./utils.js");
    const cfg = await api().getConfig();
    const cwd = await pickFolder();
    if (cwd) {
      const id = await createSession(cfg.defaultPermissionMode ?? "default", cwd);
      if (id && cfg.popOutByDefault) popOutSession(id);
    }
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchQuery("");
  }, []);

  const handleOpenResult = useCallback((id: string) => {
    if (poppedOutIds.has(id)) { focusPopout(id); return; }
    openInApp(id);
  }, [poppedOutIds]);

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

  // Use search results when available, otherwise fall back to name/cwd filter
  const showSearchResults = searchResults !== null && searchQuery.trim().length > 0;

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
                placeholder="Search sessions and content..."
                value={searchQuery}
                onChange={handleSearchChange}
              />
              {searchQuery && (
                <button className="home-search-clear" onClick={handleSearchClear}>
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
            <div className="home-new-split">
              <button className="home-new-btn" onClick={handleNew}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 2v12M2 8h12" />
                </svg>
                New Session
              </button>
              <button className="home-new-arrow" onClick={handleNewPickFolder} title="Choose folder...">
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>
            </div>
            <button className="home-settings-btn" onClick={() => setShowSettings(true)} title="Settings">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="2" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M12.95 3.05l-1.41 1.41M4.46 11.54l-1.41 1.41" />
              </svg>
            </button>
          </div>

          <div className="home-grid">
            {showSearchResults ? (
              // Full-text search results
              <>
                {searchResults.length === 0 && (
                  <div className="home-empty">
                    No results for "{searchQuery}"
                  </div>
                )}
                {searchResults.map((r) => (
                  <SearchResultCard
                    key={r.sessionId}
                    result={r}
                    onOpen={handleOpenResult}
                  />
                ))}
              </>
            ) : (
              <>
                {filtered.length === 0 && (
                  <div className="home-empty">
                    {searchQuery ? `No sessions match "${searchQuery}"` : "No sessions yet. Start a new one!"}
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
                    {dirGroups.groups.map(group => (
                      <DirGroupView
                        key={group.directory}
                        group={group}
                        poppedOutIds={poppedOutIds}
                      />
                    ))}
                    {dirGroups.unknown.map(s => (
                      <SessionCard key={s.id} session={s} poppedOut={poppedOutIds.has(s.id)} />
                    ))}
                  </>
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
