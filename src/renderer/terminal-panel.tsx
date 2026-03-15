import React, { memo, useState, useRef, useEffect, useCallback } from "react";
import { api } from "./utils.js";

type CommandResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

type TerminalBarProps = {
  cwd: string;
};

export const TerminalBar = memo(function TerminalBar({ cwd }: TerminalBarProps) {
  const [history, setHistory] = useState<CommandResult[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const runCommand = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || running) return;

    setInput("");
    setRunning(true);
    setExpanded(true);
    setCmdHistory((h) => [cmd, ...h.filter((c) => c !== cmd)]);
    setHistoryIndex(-1);

    try {
      const result = await api().runCommand({ command: cmd, cwd });
      setHistory((h) => [...h, { command: cmd, ...result }]);
    } catch (err) {
      setHistory((h) => [...h, { command: cmd, stdout: "", stderr: String(err), exitCode: 1 }]);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }, [input, running, cwd]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length > 0) {
        const next = Math.min(historyIndex + 1, cmdHistory.length - 1);
        setHistoryIndex(next);
        setInput(cmdHistory[next]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setInput(cmdHistory[next]);
      } else {
        setHistoryIndex(-1);
        setInput("");
      }
    } else if (e.key === "Escape") {
      setExpanded(false);
    }
  }, [runCommand, cmdHistory, historyIndex]);

  const cwdShort = cwd.replace(/^\/Users\/[^/]+/, "~");

  return (
    <div className="terminal-bar">
      {expanded && history.length > 0 && (
        <div className="terminal-output" ref={scrollRef}>
          {history.map((r, i) => (
            <div key={i} className="terminal-entry">
              <div className="terminal-cmd">
                <span className="terminal-prompt">$</span> {r.command}
              </div>
              {r.stdout && <pre className="terminal-stdout">{r.stdout}</pre>}
              {r.stderr && <pre className="terminal-stderr">{r.stderr}</pre>}
              {r.exitCode !== 0 && r.exitCode !== null && (
                <div className="terminal-exit-code">exit {r.exitCode}</div>
              )}
            </div>
          ))}
          {running && <div className="terminal-running">Running...</div>}
        </div>
      )}
      <div className="terminal-input-row">
        <span className="terminal-cwd" title={cwd}>{cwdShort}</span>
        <span className="terminal-prompt">$</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          onChange={(e) => { setInput(e.target.value); setHistoryIndex(-1); }}
          onKeyDown={handleKeyDown}
          placeholder="Run a command..."
          disabled={running}
          spellCheck={false}
          autoComplete="off"
        />
        {expanded && history.length > 0 && (
          <button
            className="terminal-collapse"
            onClick={() => setExpanded(false)}
            title="Collapse output"
          >&#x25BC;</button>
        )}
        {!expanded && history.length > 0 && (
          <button
            className="terminal-collapse"
            onClick={() => setExpanded(true)}
            title="Show output"
          >&#x25B2;</button>
        )}
      </div>
    </div>
  );
});
