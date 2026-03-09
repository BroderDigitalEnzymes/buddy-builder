import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Marked } from "marked";
import type { ChatEntry } from "../ipc.js";
import { ToolViewTabs, getMatchingViews } from "./tool-views/index.js";
import { getSender, formatTokens, type Sender } from "./utils.js";
import { formatTime } from "./time.js";

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
      <span>Rate limited &mdash; resets in {timeStr}</span>
    </div>
  );
}

// Scoped marked instance (no global mutation)
const md = new Marked({ breaks: true });

// ─── Sender helpers ─────────────────────────────────────────────

const SENDER_LABELS: Record<Sender, string> = {
  user: "You",
  claude: "Claude",
  system: "System",
};

const SENDER_ICONS: Record<Sender, React.ReactNode> = {
  user: (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  ),
  claude: (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
      <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z" />
      <circle cx="19" cy="5" r="1.5" opacity="0.5" />
      <circle cx="5" cy="17" r="1" opacity="0.4" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M19.07 4.93l-2.83 2.83M7.76 16.24l-2.83 2.83" />
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
        const lines = entry.text.split("\n");
        const lastLine = lines[lines.length - 1]?.trimStart() || lines[lines.length - 2]?.trimStart() || "";
        const preview = lastLine.slice(0, 160);
        return (
          <div className="streaming-block">
            <div className="streaming-bar" />
            <span className="streaming-preview">{preview}<span className="streaming-cursor" /></span>
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
      <div id="chat" className="chat-area chat-empty" ref={containerRef} />
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
              <div className="thinking-indicator">
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
