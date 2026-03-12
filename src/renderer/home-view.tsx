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
  type NewSessionOptions,
} from "./store-actions.js";
import { SettingsModal } from "./settings-modal.js";
import { SessionActionButtons } from "./session-actions.js";
import type { PermissionMode } from "../ipc.js";
import { PERM_ITEMS } from "./chat-header.js";
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

// ─── New Session Dialog ──────────────────────────────────────────

export function NewSessionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [addDirs, setAddDirs] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [fallbackModel, setFallbackModel] = useState("");
  const [effort, setEffort] = useState<"" | "low" | "medium" | "high" | "max">("");
  const [worktree, setWorktree] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");

  const handlePickFolder = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) setCwd(folder);
  }, []);

  const handleAddDir = useCallback(async () => {
    const folder = await pickFolder();
    if (folder && !addDirs.includes(folder)) setAddDirs((prev) => [...prev, folder]);
  }, [addDirs]);

  const handleRemoveDir = useCallback((dir: string) => {
    setAddDirs((prev) => prev.filter((d) => d !== dir));
  }, []);

  const handleCreate = useCallback(async () => {
    const { api } = await import("./utils.js");
    const cfg = await api().getConfig();
    const resolvedCwd = cwd || cfg.defaultProjectsFolder || await pickFolder();
    if (!resolvedCwd) return;

    const budgetNum = parseFloat(maxBudget);
    const opts: NewSessionOptions = {
      permissionMode: permissionMode,
      cwd: resolvedCwd,
      name: name.trim() || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      maxBudgetUsd: budgetNum > 0 ? budgetNum : undefined,
      fallbackModel: fallbackModel.trim() || undefined,
      addDirs: addDirs.length > 0 ? addDirs : undefined,
      effort: effort || undefined,
      worktree: worktree || undefined,
    };
    const id = await createSession(opts);
    if (id && cfg.popOutByDefault) popOutSession(id);
    onClose();
    setName(""); setCwd(""); setAddDirs([]); setSystemPrompt(""); setMaxBudget(""); setFallbackModel(""); setEffort(""); setWorktree(false); setPermissionMode("default");
  }, [name, cwd, addDirs, systemPrompt, maxBudget, fallbackModel, effort, worktree, permissionMode, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel new-session-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">New Session</h2>
          <button className="modal-close" onClick={onClose}>{"\u00D7"}</button>
        </div>
        <div className="modal-body">
          <label className="field-label">Name (optional)</label>
          <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Session name" />

          <label className="field-label">Working Directory</label>
          <div className="field-row">
            <input className="field-input" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="Default folder or pick..." readOnly />
            <button className="field-btn" onClick={handlePickFolder}>Browse</button>
          </div>

          <label className="field-label">Additional Directories (optional)</label>
          <div className="field-add-dirs">
            {addDirs.map((dir) => (
              <div key={dir} className="field-add-dir-item">
                <span className="field-add-dir-path">{dir}</span>
                <button className="field-add-dir-remove" onClick={() => handleRemoveDir(dir)} title="Remove">{"\u00D7"}</button>
              </div>
            ))}
            <button className="field-btn" onClick={handleAddDir}>+ Add Directory</button>
          </div>

          <label className="field-label">Permission Mode</label>
          <select className="field-select" value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}>
            {PERM_ITEMS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>

          <label className="field-label">System Prompt (optional)</label>
          <textarea
            className="field-textarea"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Custom instructions appended to Claude's system prompt..."
            rows={4}
          />

          <label className="field-label">Budget Limit (optional)</label>
          <input
            className="field-input"
            type="number"
            step="0.5"
            min="0"
            value={maxBudget}
            onChange={(e) => setMaxBudget(e.target.value)}
            placeholder="Max spend in USD (e.g. 5.00)"
          />

          <label className="field-label">Fallback Model (optional)</label>
          <select className="field-select" value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)}>
            <option value="">None</option>
            <option value="sonnet">sonnet</option>
            <option value="opus">opus</option>
            <option value="haiku">haiku</option>
          </select>

          <label className="field-label">Effort Level (optional)</label>
          <select className="field-select" value={effort} onChange={(e) => setEffort(e.target.value as typeof effort)}>
            <option value="">Default (high)</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="max">Max (extended thinking)</option>
          </select>

          <label className="field-label">Worktree Isolation</label>
          <label className="field-toggle">
            <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
            <span>Create a git worktree for safe parallel changes</span>
          </label>
        </div>
        <div className="modal-footer">
          <button className="modal-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="modal-btn-primary" onClick={handleCreate}>Create Session</button>
        </div>
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
  const [showNewDialog, setShowNewDialog] = useState(false);
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

  const handleNewAdvanced = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowNewDialog(true);
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
              <button className="home-new-arrow" onClick={handleNewAdvanced} title="Advanced new session...">
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
      <NewSessionDialog open={showNewDialog} onClose={() => setShowNewDialog(false)} />
    </>
  );
});
