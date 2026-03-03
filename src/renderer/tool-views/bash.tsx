import React, { useState } from "react";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";

// ─── Bash command view ───────────────────────────────────────────

type BashInput = {
  command: string;
  description?: string;
  timeout?: number;
};

type BashResult = {
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
};

function isBash(input: Record<string, unknown>): input is BashInput {
  return typeof input.command === "string";
}

/** Parse the toolResult — could be JSON wrapper or plain text. */
function parseResult(raw: string): { stdout: string; stderr: string; exitCode: number | null } {
  // Try JSON wrapper first: {"stdout":"...","stderr":"..."}
  try {
    const parsed = JSON.parse(raw) as BashResult;
    if (typeof parsed.stdout === "string") {
      return { stdout: parsed.stdout, stderr: parsed.stderr ?? "", exitCode: null };
    }
  } catch { /* not JSON, fall through */ }

  // Plain text — check for "Exit code N\n" prefix
  const exitMatch = raw.match(/^Exit code (\d+)\n/);
  if (exitMatch) {
    const code = parseInt(exitMatch[1], 10);
    const body = raw.slice(exitMatch[0].length);
    return { stdout: code === 0 ? body : "", stderr: code !== 0 ? body : "", exitCode: code };
  }

  return { stdout: raw, stderr: "", exitCode: null };
}

function BashViewRenderer({ entry }: ToolViewProps<BashInput>) {
  const { command, description } = entry.toolInput;
  const [outputOpen, setOutputOpen] = useState(entry.status === "running");
  const raw = entry.toolResult ?? "";

  const { stdout, stderr, exitCode } = parseResult(raw);
  const isError = (exitCode !== null && exitCode !== 0) || stderr.length > 0;
  const output = stdout.trimEnd();
  const hasOutput = output.length > 0;
  const hasStderr = stderr.trimEnd().length > 0;
  const lineCount = hasOutput ? output.split("\n").length : 0;

  return (
    <div className="bash-view">
      {description && (
        <div className="bash-desc">
          {entry.status === "running" && <span className="tool-icon spinning" />}
          {entry.status === "done" && !isError && <span className="bash-ok">{"\u2713"}</span>}
          {isError && <span className="bash-err">{"\u2717"}</span>}
          <span>{description}</span>
        </div>
      )}
      <div className={`bash-terminal ${isError ? "bash-terminal-err" : ""}`}>
        <pre className="bash-command"><code><span className="bash-prompt">$ </span>{command}</code></pre>
        {hasOutput && (
          <details
            className="bash-output-wrap"
            open={outputOpen}
            onToggle={(e) => setOutputOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary className="bash-output-toggle">
              <span className="bash-output-chevron">{outputOpen ? "\u25BE" : "\u25B8"}</span>
              {outputOpen
                ? <span>{lineCount} line{lineCount !== 1 ? "s" : ""}</span>
                : <span className="bash-output-preview">{output.split("\n")[0]?.slice(0, 100)}</span>
              }
            </summary>
            <pre className="bash-output"><code>{output}</code></pre>
          </details>
        )}
        {hasStderr && (
          <div className="bash-stderr-wrap">
            <pre className="bash-stderr"><code>{stderr.trimEnd()}</code></pre>
          </div>
        )}
        {exitCode !== null && exitCode !== 0 && (
          <div className="bash-exit-badge">exit {exitCode}</div>
        )}
      </div>
    </div>
  );
}

registerToolView({
  id: "bash",
  label: "Terminal",
  match: (entry) => entry.toolName === "Bash" && isBash(entry.toolInput),
  render: BashViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as BashInput;
    const raw = entry.toolResult ?? "";
    const { stderr, exitCode } = parseResult(raw);
    const isError = (exitCode !== null && exitCode !== 0) || stderr.length > 0;
    const prefix = isError ? "\u2717 " : "\u2713 ";
    return `${prefix}${input.description ?? input.command.slice(0, 60)}`;
  },
});
