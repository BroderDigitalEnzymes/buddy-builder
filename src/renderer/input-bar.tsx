import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ImageData } from "../ipc.js";
import { getDraft, setDraft } from "./store.js";
import { SessionActionButtons } from "./session-actions.js";
import { fileToImageData, extractImageFiles } from "./image-data.js";

// ─── Default slash commands (fallback when init hasn't fired yet) ─

const DEFAULT_SLASH_COMMANDS = [
  "compact", "context", "cost", "init", "review",
  "pr-comments", "release-notes", "security-review",
  "insights", "simplify", "batch", "debug", "extra-usage",
];

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
  sessionId: string | null;
  disabled: boolean;
  isBusy: boolean;
  queueCount: number;
  showResume: boolean;
  slashCommands: string[];
  claudeSessionId: string | null;
  cwd: string | null;
  permissionMode?: string;
  onSend: (text: string, images?: ImageData[]) => void;
  onInterrupt: () => void;
  onResume: () => void;
  onResumeTerminal: () => void;
};

export const InputBar = memo(function InputBar({ sessionId, disabled, isBusy, queueCount, showResume, slashCommands, claudeSessionId, cwd, permissionMode, onSend, onInterrupt, onResume, onResumeTerminal }: InputBarProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pendingImages, setPendingImages] = useState<ImageData[]>([]);
  const lastEscapeRef = useRef(0);
  const [escapeHint, setEscapeHint] = useState(false);

  // Restore draft when switching sessions
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Save draft for the previous session
    if (prevSessionRef.current && prevSessionRef.current !== sessionId) {
      setDraft(prevSessionRef.current, el.value);
    }
    // Restore draft for the new session
    if (sessionId && sessionId !== prevSessionRef.current) {
      el.value = getDraft(sessionId);
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }
    prevSessionRef.current = sessionId;
  }, [sessionId]);

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
    if (sessionId) setDraft(sessionId, "");
    onSend(text || "(image)", pendingImages.length > 0 ? pendingImages : undefined);
    setPendingImages([]);
    requestAnimationFrame(() => el.focus());
  }, [onSend, pendingImages]);

  // Auto-focus on mount and when switching sessions
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled, sessionId]);

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
    // Save draft
    if (sessionId) setDraft(sessionId, el.value);
    // Slash autocomplete trigger
    const value = el.value;
    if (value.startsWith("/") && !value.includes(" ")) {
      setSlashOpen(true);
      setSlashFilter(value.slice(1));
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  }, [sessionId]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = extractImageFiles(items);
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
        <SessionActionButtons
          claudeSessionId={claudeSessionId}
          cwd={cwd}
          permissionMode={permissionMode}
          onResume={onResume}
          onResumeTerminal={onResumeTerminal}
        />
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
