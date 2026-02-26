import React, { memo, useState, useRef, useEffect, useCallback } from "react";
import type { ChatEntry, SessionData } from "./store.js";
import type { PolicyPreset, PermissionMode } from "../ipc.js";

// ─── Tool entry (collapsible) ────────────────────────────────────

const STATUS_ICONS: Record<string, React.ReactNode> = {
  running: <span className="tool-icon spinning" />,
  done:    <span className="tool-icon done" />,
  blocked: <span className="tool-icon blocked" />,
};

type ToolEntryProps = {
  entry: ChatEntry & { kind: "tool" };
};

export function ToolEntry({ entry }: ToolEntryProps) {
  const [open, setOpen] = useState(entry.status === "running");
  const hasInput = Object.keys(entry.toolInput).length > 0;

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
      {hasInput && (
        <pre className="tool-input"><code>{JSON.stringify(entry.toolInput, null, 2)}</code></pre>
      )}
    </details>
  );
}

// ─── Message entry (text / user / system / result / tool) ────────

type EntryRowProps = {
  entry: ChatEntry;
  prevKind?: string;
  nextKind?: string;
};

export function EntryRow({ entry, prevKind, nextKind }: EntryRowProps) {
  switch (entry.kind) {
    case "user":
      return <div className="msg msg-user">{entry.text}</div>;

    case "text":
      return <div className="msg msg-assistant">{entry.text}</div>;

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

    case "result":
      return (
        <div className="msg msg-result">
          <hr className="result-line" />
          <span className="result-meta">
            ${entry.cost.toFixed(4)} &middot; {entry.turns} turns &middot; {(entry.durationMs / 1000).toFixed(1)}s
          </span>
          <hr className="result-line" />
        </div>
      );

    case "system":
      return <div className="msg msg-system">{entry.text}</div>;
  }
}

// ─── Message list with auto-scroll ──────────────────────────────

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
      <div id="chat" ref={containerRef}>
        <div className="empty-state">No session. Click <strong>+ New</strong> to start.</div>
      </div>
    );
  }

  return (
    <div id="chat" ref={containerRef} onScroll={onScroll}>
      <div id="messages">
        {entries.map((entry, i) => (
          <EntryRow
            key={i}
            entry={entry}
            prevKind={entries[i - 1]?.kind}
            nextKind={entries[i + 1]?.kind}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Tab bar ─────────────────────────────────────────────────────

type TabBarProps = {
  sessions: SessionData[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: (perm: PermissionMode) => void;
};

export const TabBar = memo(function TabBar({ sessions, activeId, onSwitch, onClose, onCreate }: TabBarProps) {
  const [perm, setPerm] = useState<PermissionMode>("default");

  return (
    <div id="tabs">
      <div id="tab-list">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`tab ${s.id === activeId ? "active" : ""}`}
            onClick={() => onSwitch(s.id)}
          >
            <span className={`tab-dot state-${s.state}`} />
            <span className="tab-label">{s.name}</span>
            <span
              className="tab-close"
              title="Close session"
              onClick={(e) => { e.stopPropagation(); onClose(s.id); }}
            >
              &times;
            </span>
          </button>
        ))}
      </div>
      <div id="new-session-group">
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
    </div>
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

type StatusBarProps = {
  session: SessionData | null;
};

export const StatusBar = memo(function StatusBar({ session }: StatusBarProps) {
  if (!session) {
    return <div id="status-bar" />;
  }

  return (
    <div id="status-bar">
      <span className="status-state">
        <span className={`status-dot state-${session.state}`} />
        {session.state}
      </span>
      <span className="status-sep" />
      <span className="status-cost">${session.cost.toFixed(4)}</span>
    </div>
  );
});

// ─── Input bar ───────────────────────────────────────────────────

type InputBarProps = {
  disabled: boolean;
  onSend: (text: string) => void;
};

export const InputBar = memo(function InputBar({ disabled, onSend }: InputBarProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text) return;
    el.value = "";
    el.style.height = "auto";
    onSend(text);
  }, [onSend]);

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

  return (
    <div id="input-bar">
      <textarea
        ref={ref}
        id="input"
        placeholder="Type a message..."
        rows={1}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
      />
      <button id="send" disabled={disabled} onClick={handleSend}>
        Send
      </button>
    </div>
  );
});
