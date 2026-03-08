import React, { memo, useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { Marked } from "marked";
import type { SessionData } from "./store.js";
import type { ChatEntry, ImageData, PolicyPreset, PermissionMode } from "../ipc.js";
import { ToolViewTabs, getMatchingViews } from "./tool-views/index.js";
import { getSender, api, type Sender } from "./utils.js";
import { useClickOutside } from "./hooks.js";

// ─── Default slash commands (fallback when init hasn't fired yet) ─

const DEFAULT_SLASH_COMMANDS = [
  "compact", "context", "cost", "init", "review",
  "pr-comments", "release-notes", "security-review",
  "insights", "simplify", "batch", "debug", "extra-usage",
];

// ─── Helpers: formatting ────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Rate Limit Banner ──────────────────────────────────────────

export function RateLimitBanner({ rateLimit }: { rateLimit: { resetsAt: number; status: string } | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!rateLimit) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [rateLimit]);

  if (!rateLimit || now >= rateLimit.resetsAt) return null;

  const remaining = Math.ceil((rateLimit.resetsAt - now) / 1000);
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="rate-limit-banner">
      <span className="rate-limit-icon">{"\u23F1"}</span>
      <span>Rate limited \u2014 resets in {timeStr}</span>
    </div>
  );
}

// Scoped marked instance (no global mutation)
const md = new Marked({ breaks: true });

// ─── Sender helpers (getSender and Sender imported from utils.ts) ─

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
  running:    <span className="tool-icon spinning" />,
  done:       <span className="tool-icon done" />,
  blocked:    <span className="tool-icon blocked" />,
  permission: <span className="tool-icon permission" />,
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
  const html = useMemo(() => md.parse(text) as string, [text]);
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
      if (entry.streaming) {
        // Compact single-line indicator — just enough to show life
        const lines = entry.text.split("\n");
        const lastLine = lines[lines.length - 1]?.trimStart() || lines[lines.length - 2]?.trimStart() || "";
        const preview = lastLine.slice(0, 120);
        return (
          <div className="streaming-line">
            <span className="streaming-pulse" />
            <span className="streaming-preview">{preview}</span>
          </div>
        );
      }
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

  // Compact messages: styled compaction pill
  if (entry.kind === "compact") {
    const tokenLabel = entry.preTokens ? ` · ${formatTokens(entry.preTokens)} tokens` : "";
    return (
      <div className="msg-row msg-row-system">
        <div className="msg-compact">
          <svg className="compact-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 2v4l4 2-4 2v4" /><path d="M12 2v4l-4 2 4 2v4" />
          </svg>
          Context compacted ({entry.trigger}){tokenLabel}
        </div>
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
        {isBusy && !entries.some(e => e.kind === "text" && e.streaming) && (
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

// ─── Shared PolicyPicker component ──────────────────────────────

export type PickerItem<T extends string> = { value: T; label: string; icon: string };

export const PRESET_ITEMS: PickerItem<PolicyPreset>[] = [
  { value: "unrestricted", label: "Unrestricted",  icon: "\u26A0" },
  { value: "allow-edits",  label: "Allow Edits",   icon: "\u270E" },
  { value: "no-writes",    label: "No Writes",     icon: "\u{1F6E1}" },
  { value: "read-only",    label: "Read Only",     icon: "\u{1F512}" },
];

export const PERM_ITEMS: PickerItem<PermissionMode>[] = [
  { value: "bypassPermissions", label: "Bypass Permissions",  icon: "\u26A0" },
  { value: "acceptEdits",       label: "Auto-Accept Edits",   icon: "\u270E" },
  { value: "default",           label: "Default",             icon: "\u{1F6E1}" },
  { value: "plan",              label: "Plan Only",           icon: "\u{1F512}" },
];

type PolicyPickerProps<T extends string> = {
  items: PickerItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** "icon" = compact icon-only trigger (chat header), "full" = icon + label trigger (sidebar/settings) */
  variant?: "icon" | "full";
};

export function PolicyPicker<T extends string>({ items, value, onChange, variant = "full" }: PolicyPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const current = items.find((i) => i.value === value);

  return (
    <div className={`policy-picker-wrap ${variant}`} ref={ref}>
      <button className={`policy-picker-trigger ${variant}`} onClick={() => setOpen((v) => !v)} title="Tool policy">
        <span className="policy-picker-icon">{current?.icon}</span>
        {variant === "full" && <span className="policy-picker-label">{current?.label}</span>}
        <span className="policy-chevron">{"\u25BE"}</span>
      </button>
      {open && (
        <div className="policy-dropdown">
          {items.map((item) => (
            <button
              key={item.value}
              className={`policy-dropdown-item ${item.value === value ? "active" : ""}`}
              onClick={() => { onChange(item.value); setOpen(false); }}
            >
              <span className="policy-dropdown-icon">{item.icon}</span>
              <span className="policy-dropdown-label">{item.label}</span>
              {item.value === value && <span className="policy-dropdown-check">{"\u2713"}</span>}
            </button>
          ))}
        </div>
      )}
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
  const [defaultPerm, setDefaultPerm] = useState<PermissionMode>("default");
  const [defaultFolder, setDefaultFolder] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (open) {
      api().getConfig().then((cfg: any) => {
        setClaudePath(cfg.claudePath);
        setDefaultPerm(cfg.defaultPermissionMode ?? "default");
        setDefaultFolder(cfg.defaultProjectsFolder ?? "");
      });
      setStatus("");
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    try {
      await api().setConfig({ claudePath, defaultPermissionMode: defaultPerm, defaultProjectsFolder: defaultFolder });
      setStatus("Saved. Restart sessions for changes to take effect.");
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }, [claudePath, defaultPerm, defaultFolder]);

  const handleBrowseFolder = useCallback(async () => {
    const folder = await api().pickFolder();
    if (folder) setDefaultFolder(folder);
  }, []);

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
          <div className="settings-section">
            <div className="settings-section-title">Defaults</div>
            <label className="setting-label">
              Default tool execution policy
              <PolicyPicker items={PERM_ITEMS} value={defaultPerm} onChange={setDefaultPerm} />
            </label>
            <label className="setting-label">
              Default projects folder
              <div className="settings-browse-row">
                <input
                  className="setting-input"
                  type="text"
                  value={defaultFolder}
                  onChange={(e) => setDefaultFolder(e.target.value)}
                  placeholder="Not set — will use folder picker"
                  spellCheck={false}
                />
                <button className="browse-btn" onClick={handleBrowseFolder} type="button">Browse</button>
              </div>
              <span className="setting-hint">
                New sessions create a subfolder here. Leave empty to always use folder picker.
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

// ─── Chat header (Slack-style) ───────────────────────────────────

// PRESET_ITEMS and PolicyPicker are defined above in the shared section.

// ─── Session info popover ────────────────────────────────────────

function SessionInfoButton({ session }: { session: SessionData }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, () => setOpen(false), open);

  const hasInfo = session.model || session.tools.length > 0 || session.mcpServers.length > 0 || session.claudeCodeVersion || session.skills.length > 0 || session.agents.length > 0 || session.slashCommands.length > 0;
  if (!hasInfo) return null;

  return (
    <div className="info-popover-wrap" ref={ref}>
      <button className="chat-header-icon-btn" onClick={() => setOpen((v) => !v)} title="Session info">
        {"\u2139\uFE0F"}
      </button>
      {open && (
        <div className="info-popover">
          {session.claudeCodeVersion && (
            <div className="info-row">
              <span className="info-label">Version</span>
              <span>{session.claudeCodeVersion}</span>
            </div>
          )}
          {session.model && (
            <div className="info-row">
              <span className="info-label">Model</span>
              <span>{session.model}</span>
            </div>
          )}
          {session.tools.length > 0 && (
            <>
              <div className="info-row">
                <span className="info-label">Tools ({session.tools.length})</span>
              </div>
              <div className="info-tool-list">
                {session.tools.map((t) => <span key={t} className="info-tool-tag">{t}</span>)}
              </div>
            </>
          )}
          {session.mcpServers.length > 0 && (
            <>
              <div className="info-row">
                <span className="info-label">MCP Servers</span>
              </div>
              {session.mcpServers.map((s) => (
                <div key={s.name} className="info-mcp-row">
                  <span>{s.name}</span>
                  <span className={`info-mcp-status info-mcp-${s.status}`}>{s.status}</span>
                </div>
              ))}
            </>
          )}
          {session.skills.length > 0 && (
            <>
              <div className="info-row">
                <span className="info-label">Skills ({session.skills.length})</span>
              </div>
              <div className="info-tool-list">
                {session.skills.map((s) => <span key={s} className="info-tool-tag">/{s}</span>)}
              </div>
            </>
          )}
          {session.agents.length > 0 && (
            <>
              <div className="info-row">
                <span className="info-label">Agents ({session.agents.length})</span>
              </div>
              <div className="info-tool-list">
                {session.agents.map((a) => <span key={a} className="info-tool-tag">{a}</span>)}
              </div>
            </>
          )}
          {session.slashCommands.length > 0 && (
            <>
              <div className="info-row">
                <span className="info-label">Commands ({session.slashCommands.length})</span>
              </div>
              <div className="info-tool-list">
                {session.slashCommands.map((c) => <span key={c} className="info-tool-tag">/{c}</span>)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type ChatHeaderProps = {
  session: SessionData | null;
  onSetPreset: (p: PolicyPreset) => void;
  onToggleFavorite: (id: string) => void;
  onOpenTerminal?: (id: string) => void;
  onBack?: () => void;
  onPopOut?: (id: string) => void;
  onPopIn?: () => void;
};

export const ChatHeader = memo(function ChatHeader({ session, onSetPreset, onToggleFavorite, onOpenTerminal, onBack, onPopOut, onPopIn }: ChatHeaderProps) {
  if (!session) {
    return <div id="chat-header" />;
  }

  return (
    <div id="chat-header">
      <div className="chat-header-left">
        {onBack && (
          <button className="chat-header-back" onClick={onBack} title="Back to sessions">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 2L4 8l6 6" />
            </svg>
          </button>
        )}
        <button
          className={`chat-header-star ${session.favorite ? "starred" : ""}`}
          title={session.favorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => onToggleFavorite(session.id)}
        >
          {session.favorite ? "\u2605" : "\u2606"}
        </button>
        <div className="chat-header-info">
          <span className="chat-header-name">{session.name}</span>
          <span className="chat-header-project">{session.projectName}</span>
        </div>
        {session.model && <span className="model-badge">{session.model}</span>}
      </div>
      <div className="chat-header-right">
        {session.totalInputTokens > 0 && (
          <span className="token-counter">
            {formatTokens(session.totalInputTokens)} in / {formatTokens(session.totalOutputTokens)} out
            {session.totalCost > 0 && <>{" \u00B7 $"}{session.totalCost.toFixed(3)}</>}
          </span>
        )}
        <SessionInfoButton session={session} />
        {onOpenTerminal && session.claudeSessionId && (
          <button
            className="chat-header-icon-btn"
            title="Open in terminal"
            onClick={() => onOpenTerminal(session.id)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3l5 4-5 4" /><line x1="9" y1="12" x2="14" y2="12" />
            </svg>
          </button>
        )}
        {onPopOut && session && (
          <button
            className="chat-header-icon-btn popout-btn"
            title="Pop out session"
            onClick={() => onPopOut(session.id)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 2h5v5" /><path d="M14 2L8 8" /><path d="M12 9v5H2V4h5" />
            </svg>
          </button>
        )}
        {onPopIn && (
          <button
            className="chat-header-icon-btn popout-btn"
            title="Pop back into main window"
            onClick={onPopIn}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 9l-5-5" /><path d="M2 4v5h5" /><path d="M14 2v12H2" />
            </svg>
          </button>
        )}
        <PolicyPicker items={PRESET_ITEMS} value={session.policyPreset} onChange={onSetPreset} variant="icon" />
      </div>
    </div>
  );
});

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

// ─── Slash command autocomplete ──────────────────────────────────

type SlashAutocompleteProps = {
  commands: string[];
  selectedIndex: number;
  onSelect: (command: string) => void;
};

function SlashAutocomplete({ commands, selectedIndex, onSelect }: SlashAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (commands.length === 0) return null;

  return (
    <div className="slash-autocomplete" ref={listRef}>
      {commands.map((cmd, i) => (
        <button
          key={cmd}
          className={`slash-autocomplete-item ${i === selectedIndex ? "active" : ""}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(cmd); }}
        >
          <span className="slash-autocomplete-cmd">/{cmd}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Input bar ───────────────────────────────────────────────────

type InputBarProps = {
  disabled: boolean;
  isBusy: boolean;
  queueCount: number;
  showResume: boolean;
  slashCommands: string[];
  onSend: (text: string, images?: ImageData[]) => void;
  onInterrupt: () => void;
  onResume: () => void;
  onResumeTerminal: () => void;
};

export const InputBar = memo(function InputBar({ disabled, isBusy, queueCount, showResume, slashCommands, onSend, onInterrupt, onResume, onResumeTerminal }: InputBarProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pendingImages, setPendingImages] = useState<ImageData[]>([]);
  const lastEscapeRef = useRef(0);
  const [escapeHint, setEscapeHint] = useState(false);

  // Slash command autocomplete state
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    if (!slashOpen) return [];
    const cmds = slashCommands.length > 0 ? slashCommands : DEFAULT_SLASH_COMMANDS;
    const prefix = slashFilter.toLowerCase();
    return cmds.filter((cmd) => cmd.toLowerCase().startsWith(prefix));
  }, [slashOpen, slashFilter, slashCommands]);

  const selectSlashCommand = useCallback((cmd: string) => {
    const el = ref.current;
    if (!el) return;
    el.value = `/${cmd} `;
    el.selectionStart = el.selectionEnd = el.value.length;
    setSlashOpen(false);
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

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

  // Auto-focus on mount
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Slash autocomplete navigation
    if (slashOpen && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectSlashCommand(filteredCommands[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    if (e.key === "Escape" && isBusy) {
      e.preventDefault();
      const now = Date.now();
      if (now - lastEscapeRef.current < 400) {
        lastEscapeRef.current = 0;
        setEscapeHint(false);
        onInterrupt();
      } else {
        lastEscapeRef.current = now;
        setEscapeHint(true);
        setTimeout(() => setEscapeHint(false), 1500);
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, isBusy, onInterrupt, slashOpen, filteredCommands, slashIndex, selectSlashCommand]);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
    // Slash autocomplete trigger
    const value = el.value;
    if (value.startsWith("/") && !value.includes(" ")) {
      setSlashOpen(true);
      setSlashFilter(value.slice(1));
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
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
      <div className="input-row-wrap">
        {slashOpen && filteredCommands.length > 0 && (
          <SlashAutocomplete
            commands={filteredCommands}
            selectedIndex={slashIndex}
            onSelect={selectSlashCommand}
          />
        )}
        <div className="input-row">
          <textarea
            ref={ref}
            id="input"
            placeholder={pendingImages.length > 0 ? "Add a message about the image(s)..." : isBusy ? "Type to queue a message..." : "Message Claude..."}
            rows={1}
            disabled={disabled}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
          />
          <button id="send" disabled={disabled} onClick={handleSend}>
            {queueCount > 0 ? `Send +${queueCount}` : "Send"}
          </button>
        </div>
      </div>
      {escapeHint && <div className="escape-hint">Press Esc again to stop</div>}
      {isBusy && queueCount > 0 && <div className="queue-hint">{queueCount} queued</div>}
    </div>
  );
});
