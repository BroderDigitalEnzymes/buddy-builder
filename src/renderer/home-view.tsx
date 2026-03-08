import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  pickFolder,
  createSession,
  deleteSession,
  renameSession,
  resumeSession,
  resumeInTerminal,
  killSession,
  toggleFavorite,
  openInApp,
  type SessionData,
  type NewSessionOptions,
} from "./store.js";
import type { PermissionMode } from "../ipc.js";
import { SettingsModal, PolicyPicker, PERM_ITEMS } from "./chat.js";
import { api, buildCliCommand } from "./utils.js";

// ─── Reuse from sidebar (pure functions / types) ──────────────────

function sanitizeFolderName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

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

// ─── CLI Command Block ──────────────────────────────────────────

function CliCommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [command]);

  return (
    <div className="cli-command-block">
      <code className="cli-command-text">{command}</code>
      <button className="cli-command-copy" onClick={handleCopy} title="Copy command">
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

// ─── Session Card (expanded detail view) ─────────────────────────

type SessionCardProps = {
  session: SessionData;
  onClose: () => void;
};

function SessionCard({ session: s, onClose }: SessionCardProps) {
  const isLive = s.state !== "dead";
  const canResume = s.state === "dead" && !!s.claudeSessionId;

  const cliCommand = buildCliCommand({
    claudeSessionId: s.claudeSessionId,
    cwd: s.cwd,
    permissionMode: s.permissionMode,
    model: s.model,
  });

  const handleOpenInApp = useCallback(async () => {
    if (canResume) await resumeSession(s.id);
    openInApp(s.id);
  }, [s.id, canResume]);

  const handleOpenTerminal = useCallback(() => {
    if (canResume || isLive) {
      resumeInTerminal(s.id);
    }
  }, [s.id, canResume, isLive]);

  const handleKill = useCallback(() => killSession(s.id), [s.id]);
  const handleDelete = useCallback(() => { deleteSession(s.id); onClose(); }, [s.id, onClose]);

  return (
    <div className="session-card">
      <div className="session-card-header">
        <div className="session-card-title">
          <span className={`session-dot state-${s.state}`} />
          <span className="session-card-name">{s.name}</span>
          {s.model && <span className="model-badge">{s.model}</span>}
        </div>
        <button className="session-card-close" onClick={onClose}>&times;</button>
      </div>

      {s.cwd && <div className="session-card-cwd">{s.cwd}</div>}

      <div className="session-card-meta">
        <span>{relativeTime(s.lastActiveAt)}</span>
        <span className="session-card-perm">{s.permissionMode}</span>
        {s.totalCost > 0 && <span>${s.totalCost.toFixed(3)}</span>}
      </div>

      <CliCommandBlock command={cliCommand} />

      <div className="session-card-actions">
        {(canResume || isLive) && (
          <button className="session-card-btn primary" onClick={handleOpenInApp}>
            Open in App
          </button>
        )}
        {(canResume || isLive) && s.claudeSessionId && (
          <button className="session-card-btn" onClick={handleOpenTerminal}>
            Open in Terminal
          </button>
        )}
        {isLive && (
          <button className="session-card-btn danger" onClick={handleKill}>
            Kill
          </button>
        )}
        {!isLive && (
          <button className="session-card-btn danger" onClick={handleDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── New Session Form ────────────────────────────────────────────

type NewSessionFormProps = {
  onClose: () => void;
  defaultPermissionMode: PermissionMode;
  defaultFolder: string;
};

function NewSessionForm({ onClose, defaultPermissionMode, defaultFolder }: NewSessionFormProps) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState(defaultFolder);
  const [perm, setPerm] = useState<PermissionMode>(defaultPermissionMode);
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const sanitized = sanitizeFolderName(name);
  const effectiveCwd = defaultFolder && sanitized
    ? `${defaultFolder}/${sanitized}`
    : cwd;

  const previewCommand = buildCliCommand({
    cwd: effectiveCwd || undefined,
    permissionMode: perm,
    model: model || undefined,
    systemPrompt: systemPrompt || undefined,
    maxTurns: maxTurns ? parseInt(maxTurns, 10) : undefined,
  });

  const handleBrowse = useCallback(async () => {
    const folder = await pickFolder();
    if (folder) setCwd(folder);
  }, []);

  const buildOpts = useCallback((): NewSessionOptions => ({
    permissionMode: perm,
    cwd: effectiveCwd || undefined,
    name: name.trim() || undefined,
    model: model || undefined,
    systemPrompt: systemPrompt || undefined,
    maxTurns: maxTurns ? parseInt(maxTurns, 10) : undefined,
  }), [perm, effectiveCwd, name, model, systemPrompt, maxTurns]);

  const handleOpenInApp = useCallback(async () => {
    const opts = buildOpts();
    if (defaultFolder && sanitized) {
      try {
        const createdPath = await api().createProjectFolder({ parentDir: defaultFolder, folderName: sanitized });
        opts.cwd = createdPath;
      } catch (err) {
        console.error("Failed to create folder:", err);
        return;
      }
    }
    opts.openInApp = true;
    await createSession(opts);
    onClose();
  }, [buildOpts, defaultFolder, sanitized, onClose]);

  const handleOpenTerminal = useCallback(async () => {
    const opts = buildOpts();
    if (defaultFolder && sanitized) {
      try {
        const createdPath = await api().createProjectFolder({ parentDir: defaultFolder, folderName: sanitized });
        opts.cwd = createdPath;
      } catch (err) {
        console.error("Failed to create folder:", err);
        return;
      }
    }
    // Create the session but don't switch to chat
    opts.openInApp = false;
    const id = await createSession(opts);
    if (id) resumeInTerminal(id);
    onClose();
  }, [buildOpts, defaultFolder, sanitized, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  const canCreate = !!(effectiveCwd || cwd);

  return (
    <div className="new-session-form" onKeyDown={handleKeyDown}>
      <div className="nsf-header">
        <span className="nsf-title">New Session</span>
        <button className="session-card-close" onClick={onClose}>&times;</button>
      </div>

      <div className="nsf-field">
        <label className="nsf-label">Name</label>
        <input
          ref={nameRef}
          className="nsf-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Project"
          spellCheck={false}
        />
        {defaultFolder && sanitized && (
          <span className="nsf-hint">{effectiveCwd}</span>
        )}
      </div>

      {!defaultFolder && (
        <div className="nsf-field">
          <label className="nsf-label">Working Directory</label>
          <div className="nsf-browse-row">
            <input
              className="nsf-input"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/path/to/project"
              spellCheck={false}
            />
            <button className="nsf-browse-btn" onClick={handleBrowse}>Browse</button>
          </div>
        </div>
      )}

      <div className="nsf-field">
        <label className="nsf-label">Permission Mode</label>
        <PolicyPicker items={PERM_ITEMS} value={perm} onChange={setPerm} />
      </div>

      <button
        className="nsf-advanced-toggle"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide" : "Show"} advanced options
      </button>

      {showAdvanced && (
        <>
          <div className="nsf-field">
            <label className="nsf-label">Model</label>
            <input
              className="nsf-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-sonnet-4-6 (default)"
              spellCheck={false}
            />
          </div>
          <div className="nsf-field">
            <label className="nsf-label">System Prompt</label>
            <textarea
              className="nsf-textarea"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Optional system prompt..."
              rows={3}
            />
          </div>
          <div className="nsf-field">
            <label className="nsf-label">Max Turns</label>
            <input
              className="nsf-input nsf-input-short"
              type="number"
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
              placeholder="Unlimited"
              min={1}
            />
          </div>
        </>
      )}

      <div className="nsf-preview">
        <CliCommandBlock command={previewCommand} />
      </div>

      <div className="nsf-actions">
        <button className="session-card-btn primary" onClick={handleOpenInApp} disabled={!canCreate}>
          Open in App
        </button>
        <button className="session-card-btn" onClick={handleOpenTerminal} disabled={!canCreate}>
          Open in Terminal
        </button>
      </div>
    </div>
  );
}

// ─── Session list item (simplified for home view) ────────────────

type HomeSessionItemProps = {
  session: SessionData;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
};

function HomeSessionItem({ session: s, selected, onSelect, onToggleFavorite }: HomeSessionItemProps) {
  return (
    <button
      className={`home-session-item ${selected ? "selected" : ""} ${s.state === "dead" ? "dead" : ""}`}
      onClick={() => onSelect(s.id)}
    >
      <span className={`session-dot state-${s.state}`} />
      <span className="home-session-name">{s.name}</span>
      {s.cwd && <span className="home-session-cwd">{s.cwd.split("/").slice(-2).join("/")}</span>}
      <span className="home-session-time">{relativeTime(s.lastActiveAt)}</span>
      <span
        className={`home-session-star ${s.favorite ? "starred" : ""}`}
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(s.id); }}
      >
        {s.favorite ? "\u2605" : "\u2606"}
      </span>
    </button>
  );
}

// ─── Home View ──────────────────────────────────────────────────

type HomeViewProps = {
  sessions: SessionData[];
  poppedOutIds: Set<string>;
};

export const HomeView = memo(function HomeView({ sessions, poppedOutIds }: HomeViewProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultPerm, setDefaultPerm] = useState<PermissionMode>("default");
  const [defaultFolder, setDefaultFolder] = useState("");

  // Load config
  useEffect(() => {
    api().getConfig().then((cfg: any) => {
      if (cfg.defaultPermissionMode) setDefaultPerm(cfg.defaultPermissionMode);
      if (cfg.defaultProjectsFolder) setDefaultFolder(cfg.defaultProjectsFolder);
    });
  }, []);

  const q = search.trim();

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let list = sessions;
    if (q) {
      list = list.filter(s =>
        fuzzyMatch(q, s.name) || fuzzyMatch(q, s.cwd ?? "") || fuzzyMatch(q, s.projectName)
      );
    }
    // Live first, then by recency
    return [...list].sort((a, b) => {
      const aLive = a.state !== "dead" ? 1 : 0;
      const bLive = b.state !== "dead" ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      // Favorites next
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.lastActiveAt - a.lastActiveAt;
    });
  }, [sessions, q]);

  const selectedSession = selectedId ? sessions.find(s => s.id === selectedId) ?? null : null;

  const handleSelect = useCallback((id: string) => {
    setSelectedId((prev) => prev === id ? null : id);
    setShowNewForm(false);
  }, []);

  const handleNewClick = useCallback(() => {
    setShowNewForm(true);
    setSelectedId(null);
  }, []);

  const handleCloseNew = useCallback(() => setShowNewForm(false), []);
  const handleCloseCard = useCallback(() => setSelectedId(null), []);

  const handleToggleFavorite = useCallback((id: string) => toggleFavorite(id), []);
  const handleRename = useCallback((id: string, name: string) => renameSession(id, name), []);

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
                  placeholder="Search sessions..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  spellCheck={false}
                />
                {search && (
                  <button className="home-search-clear" onClick={() => setSearch("")}>&times;</button>
                )}
              </div>
              <button className="home-new-btn" onClick={handleNewClick}>+ New Session</button>
            </div>
          </div>

          <div className="home-body">
            <div className="home-list">
              {filteredSessions.length === 0 && (
                <div className="home-empty">
                  {q ? "No sessions match your search" : "No sessions yet. Click + New Session to start."}
                </div>
              )}
              {filteredSessions.map(s => (
                <HomeSessionItem
                  key={s.id}
                  session={s}
                  selected={s.id === selectedId}
                  onSelect={handleSelect}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>

            <div className="home-detail">
              {showNewForm && (
                <NewSessionForm
                  onClose={handleCloseNew}
                  defaultPermissionMode={defaultPerm}
                  defaultFolder={defaultFolder}
                />
              )}
              {selectedSession && !showNewForm && (
                <SessionCard session={selectedSession} onClose={handleCloseCard} />
              )}
              {!showNewForm && !selectedSession && (
                <div className="home-detail-empty">
                  Select a session or create a new one
                </div>
              )}
            </div>
          </div>

          <div className="home-footer">
            <button className="home-settings-btn" onClick={() => setSettingsOpen(true)}>
              &#9881; Settings
            </button>
          </div>
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => {
        setSettingsOpen(false);
        api().getConfig().then((cfg: any) => {
          if (cfg.defaultPermissionMode) setDefaultPerm(cfg.defaultPermissionMode);
          setDefaultFolder(cfg.defaultProjectsFolder ?? "");
        });
      }} />
    </>
  );
});
