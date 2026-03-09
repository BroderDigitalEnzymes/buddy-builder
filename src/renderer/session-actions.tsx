import React, { useState, useCallback } from "react";
import { buildCliCommand } from "./utils.js";

// ─── SVG Icons ──────────────────────────────────────────────────

const IconView = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

const IconResume = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" stroke="none">
    <path d="M4 2.5v11l9-5.5z" />
  </svg>
);

const IconTerminal = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3l5 4-5 4" /><line x1="9" y1="12" x2="14" y2="12" />
  </svg>
);

const IconCopy = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="5" width="9" height="9" rx="1" />
    <path d="M3 11V3a1 1 0 011-1h8" />
  </svg>
);

// ─── Session action buttons (shared) ─────────────────────────────

type SessionActionButtonsProps = {
  claudeSessionId: string | null;
  cwd: string | null;
  permissionMode?: string;
  showView?: boolean;
  onView?: () => void;
  onResume: () => void;
  onResumeTerminal: () => void;
};

export function SessionActionButtons({
  claudeSessionId,
  cwd,
  permissionMode,
  showView,
  onView,
  onResume,
  onResumeTerminal,
}: SessionActionButtonsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const cmd = buildCliCommand({ claudeSessionId, cwd, permissionMode });
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [claudeSessionId, cwd, permissionMode]);

  return (
    <div className="session-action-btns">
      {showView && onView && (
        <button className="sa-btn" onClick={onView} title="View conversation">
          {IconView}
          <span>View</span>
        </button>
      )}
      <button className="sa-btn sa-btn-primary" onClick={onResume} title="Resume session">
        {IconResume}
        <span>Resume</span>
      </button>
      <button className="sa-btn" onClick={onResumeTerminal} title="Resume in terminal">
        {IconTerminal}
        <span>Terminal</span>
      </button>
      <button className="sa-btn" onClick={handleCopy} title="Copy CLI command">
        {copied ? (
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        ) : IconCopy}
        <span>{copied ? "Copied" : "Copy CLI"}</span>
      </button>
    </div>
  );
}
