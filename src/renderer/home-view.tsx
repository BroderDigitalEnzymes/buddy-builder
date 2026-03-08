import React, { useState, useCallback, useMemo, memo } from "react";
import type { SessionData } from "./store.js";
import {
  openInApp,
  createSession,
  deleteSession,
  renameSession,
  killSession,
  resumeSession,
  resumeInTerminal,
  toggleFavorite,
  focusPopout,
  pickFolder,
  setSearchQuery,
  getState,
} from "./store.js";
import { SettingsModal } from "./chat.js";
import { buildCliCommand } from "./utils.js";
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

function lastSegment(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

// ─── Session detail card ────────────────────────────────────────

function SessionCard({ session, onClose }: {
  session: SessionData;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const cliCmd = useMemo(() => buildCliCommand({
    claudeSessionId: session.claudeSessionId,
    cwd: session.cwd,
    permissionMode: session.permissionMode,
    model: session.model,
  }), [session.claudeSessionId, session.cwd, session.permissionMode, session.model]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(cliCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [cliCmd]);

  const isDead = session.state === "dead";
  const canResume = isDead && !!session.claudeSessionId;

  return (
    <div className="session-card">
      <div className="session-card-header">
        <div className="session-card-title">
          <span className="session-card-name">{session.name}</span>
        </div>
        <button className="session-card-close" onClick={onClose}>{"\u00D7"}</button>
      </div>
      {session.cwd && <div className="session-card-cwd">{session.cwd}</div>}
      <div className="session-card-meta">
        <span>{session.state}</span>
        {session.model && <span>{session.model}</span>}
        <span className="session-card-perm">{session.permissionMode}</span>
        <span>{timeAgo(session.lastActiveAt)}</span>
      </div>
      <div className="cli-command-block">
        <span className="cli-command-text">{cliCmd}</span>
        <button className="cli-command-copy" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="session-card-actions">
        {!isDead && (
          <button className="session-card-btn primary" onClick={() => openInApp(session.id)}>
            Open
          </button>
        )}
        {canResume && (
          <>
            <button className="session-card-btn primary" onClick={() => { resumeSession(session.id); openInApp(session.id); }}>
              Resume
            </button>
            <button className="session-card-btn" onClick={() => resumeInTerminal(session.id)}>
              Terminal
            </button>
          </>
        )}
        {!isDead && (
          <button className="session-card-btn" onClick={() => killSession(session.id)}>
            Kill
          </button>
        )}
        <button className="session-card-btn danger" onClick={() => { deleteSession(session.id); onClose(); }}>
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── HomeView ───────────────────────────────────────────────────

export const HomeView = memo(function HomeView({ sessions, poppedOutIds }: {
  sessions: SessionData[];
  poppedOutIds: Set<string>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const { searchQuery, searchResults } = getState();

  // Filter and sort sessions (used when no full-text search active)
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

  const selectedSession = selectedId ? sessions.find((s) => s.id === selectedId) ?? null : null;

  const handleNew = useCallback(async () => {
    const cwd = await pickFolder();
    if (cwd) {
      await createSession("default" as PermissionMode, cwd);
    }
  }, []);

  const handleClick = useCallback((id: string) => {
    if (poppedOutIds.has(id)) {
      focusPopout(id);
      return;
    }
    const s = sessions.find((s) => s.id === id);
    if (s && s.state !== "dead") {
      openInApp(id);
    } else {
      setSelectedId((prev) => (prev === id ? null : id));
    }
  }, [poppedOutIds, sessions]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchQuery("");
  }, []);

  // Use search results when available, otherwise fall back to name/cwd filter
  const showSearchResults = searchResults !== null && searchQuery.trim().length > 0;

  return (
    <>
      <div id="home-view">
        <div className="home-content">
          <div className="home-top">
            <div className="home-search-row">
              <div className="home-search-wrap">
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
              <button className="home-new-btn" onClick={handleNew}>
                New Session
              </button>
            </div>
          </div>
          <div className="home-body">
            <div className="home-list">
              {showSearchResults ? (
                // Full-text search results
                <>
                  {searchResults.length === 0 && (
                    <div className="home-empty">
                      No results for "{searchQuery}"
                    </div>
                  )}
                  {searchResults.map((r) => (
                    <button
                      key={r.sessionId}
                      className={`home-session-item search-result ${selectedId === r.sessionId ? "selected" : ""}`}
                      onClick={() => handleClick(r.sessionId)}
                    >
                      <span className="home-session-name">{r.sessionName}</span>
                      {r.cwd && <span className="home-session-cwd">{lastSegment(r.cwd)}</span>}
                      <span className="home-session-time">{timeAgo(r.lastActiveAt)}</span>
                      <span
                        className="search-snippet"
                        dangerouslySetInnerHTML={{ __html: r.snippet }}
                      />
                    </button>
                  ))}
                </>
              ) : (
                // Normal session list
                <>
                  {filtered.length === 0 && (
                    <div className="home-empty">
                      {searchQuery ? `No sessions match "${searchQuery}"` : "No sessions yet"}
                    </div>
                  )}
                  {filtered.map((s) => (
                    <button
                      key={s.id}
                      className={`home-session-item ${s.state === "dead" ? "dead" : ""} ${selectedId === s.id ? "selected" : ""}`}
                      onClick={() => handleClick(s.id)}
                    >
                      <span
                        className={`home-session-star ${s.favorite ? "starred" : ""}`}
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(s.id); }}
                      >
                        {s.favorite ? "\u2605" : "\u2606"}
                      </span>
                      <span className="home-session-name">{s.name}</span>
                      {s.cwd && <span className="home-session-cwd">{lastSegment(s.cwd)}</span>}
                      <span className="home-session-time">{timeAgo(s.lastActiveAt)}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
            <div className="home-detail">
              {selectedSession ? (
                <SessionCard
                  session={selectedSession}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <div className="home-detail-empty">Select a session to see details</div>
              )}
            </div>
          </div>
          <div className="home-footer">
            <button className="home-settings-btn" onClick={() => setShowSettings(true)}>
              Settings
            </button>
          </div>
        </div>
      </div>
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
});
