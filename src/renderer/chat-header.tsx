import React, { memo, useState, useRef } from "react";
import type { SessionData } from "./store.js";
import type { PolicyPreset, PermissionMode } from "../ipc.js";
import { useClickOutside } from "./hooks.js";
import { api, formatTokens } from "./utils.js";

// ─── SVG icons for policy picker ────────────────────────────────

const SvgWarning = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1L1 14h14L8 1z" /><path d="M8 6v4" /><circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

const SvgPencil = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
  </svg>
);

const SvgShield = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1L2 4v4c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V4L8 1z" />
  </svg>
);

const SvgLock = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="7" width="10" height="7" rx="1" /><path d="M5 7V5a3 3 0 016 0v2" />
  </svg>
);

// ─── Shared PolicyPicker component ──────────────────────────────

export type PickerItem<T extends string> = { value: T; label: string; icon: React.ReactNode };

export const PRESET_ITEMS: PickerItem<PolicyPreset>[] = [
  { value: "unrestricted", label: "Unrestricted",  icon: SvgWarning },
  { value: "allow-edits",  label: "Allow Edits",   icon: SvgPencil },
  { value: "no-writes",    label: "No Writes",     icon: SvgShield },
  { value: "read-only",    label: "Read Only",     icon: SvgLock },
];

export const PERM_ITEMS: PickerItem<PermissionMode>[] = [
  { value: "bypassPermissions", label: "Bypass Permissions",  icon: SvgWarning },
  { value: "acceptEdits",       label: "Auto-Accept Edits",   icon: SvgPencil },
  { value: "default",           label: "Default",             icon: SvgShield },
  { value: "plan",              label: "Plan Only",           icon: SvgLock },
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
      <button className={`policy-picker-trigger ${variant}`} onClick={() => setOpen((v) => !v)} title={`Tool policy: ${current?.label ?? ""}`}>
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

// ─── Session info popover ────────────────────────────────────────

function SessionInfoButton({ session }: { session: SessionData }) {
  const hasInfo = session.model || session.tools.length > 0 || session.mcpServers.length > 0 || session.claudeCodeVersion || session.skills.length > 0 || session.agents.length > 0 || session.slashCommands.length > 0;
  if (!hasInfo) return null;

  return (
    <button
      className="chat-header-icon-btn"
      onClick={() => api().openInfoWindow({ sessionId: session.id })}
      title="Session info"
    >
      {"\u2139\uFE0F"}
    </button>
  );
}

// ─── Chat header (Slack-style) ───────────────────────────────────

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
