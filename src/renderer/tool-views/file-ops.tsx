import React, { useState } from "react";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";

// ─── Read view ──────────────────────────────────────────────────

type ReadInput = {
  file_path: string;
  offset?: number;
  limit?: number;
  pages?: string;
};

function isRead(input: Record<string, unknown>): input is ReadInput {
  return typeof input.file_path === "string";
}

function ReadViewRenderer({ entry }: ToolViewProps<ReadInput>) {
  const { file_path, offset, limit } = entry.toolInput;
  const [open, setOpen] = useState(entry.status === "running");
  const content = entry.toolResult ?? "";
  const lineCount = content ? content.split("\n").length : 0;
  const rangeLabel = offset || limit
    ? ` (lines ${offset ?? 1}–${(offset ?? 1) + (limit ?? lineCount) - 1})`
    : "";

  return (
    <div className="file-op-view">
      <div className="file-op-path">{file_path}{rangeLabel}</div>
      {content && (
        <details
          className="file-op-details"
          open={open}
          onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="file-op-toggle">
            <span className="file-op-chevron">{open ? "\u25BE" : "\u25B8"}</span>
            {open
              ? <span>{lineCount} line{lineCount !== 1 ? "s" : ""}</span>
              : <span className="file-op-preview">{content.split("\n")[0]?.slice(0, 100)}</span>
            }
          </summary>
          <pre className="file-op-content"><code>{content}</code></pre>
        </details>
      )}
    </div>
  );
}

registerToolView({
  id: "read",
  label: "File",
  match: (entry) => entry.toolName === "Read" && isRead(entry.toolInput),
  render: ReadViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as ReadInput;
    const lines = entry.toolResult ? entry.toolResult.split("\n").length : 0;
    const name = input.file_path.replace(/\\/g, "/").split("/").pop() ?? input.file_path;
    return `\u{1F4C4} ${name} (${lines} lines)`;
  },
});

// ─── Write view ─────────────────────────────────────────────────

type WriteInput = {
  file_path: string;
  content: string;
};

function isWrite(input: Record<string, unknown>): input is WriteInput {
  return typeof input.file_path === "string" && typeof input.content === "string";
}

function WriteViewRenderer({ entry }: ToolViewProps<WriteInput>) {
  const { file_path, content } = entry.toolInput;
  const [open, setOpen] = useState(entry.status === "running");
  const lineCount = content.split("\n").length;

  return (
    <div className="file-op-view">
      <div className="file-op-path">
        <span className="file-op-badge-new">+</span> {file_path}
      </div>
      <details
        className="file-op-details"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="file-op-toggle">
          <span className="file-op-chevron">{open ? "\u25BE" : "\u25B8"}</span>
          <span>{lineCount} line{lineCount !== 1 ? "s" : ""} written</span>
        </summary>
        <pre className="file-op-content file-op-content-new"><code>{content}</code></pre>
      </details>
    </div>
  );
}

registerToolView({
  id: "write",
  label: "File",
  match: (entry) => entry.toolName === "Write" && isWrite(entry.toolInput),
  render: WriteViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as WriteInput;
    const name = input.file_path.replace(/\\/g, "/").split("/").pop() ?? input.file_path;
    const lines = input.content.split("\n").length;
    return `+ ${name} (${lines} lines)`;
  },
});

// ─── Edit view ──────────────────────────────────────────────────

type EditInput = {
  file_path: string;
  old_string: string;
  new_string: string;
};

function isEdit(input: Record<string, unknown>): input is EditInput {
  return typeof input.file_path === "string" && typeof input.old_string === "string" && typeof input.new_string === "string";
}

function EditViewRenderer({ entry }: ToolViewProps<EditInput>) {
  const { file_path, old_string, new_string } = entry.toolInput;

  return (
    <div className="file-op-view">
      <div className="file-op-path">{file_path}</div>
      <div className="file-op-diff">
        <pre className="file-op-diff-old"><code>{old_string}</code></pre>
        <pre className="file-op-diff-new"><code>{new_string}</code></pre>
      </div>
    </div>
  );
}

registerToolView({
  id: "edit",
  label: "Diff",
  match: (entry) => entry.toolName === "Edit" && isEdit(entry.toolInput),
  render: EditViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as EditInput;
    const name = input.file_path.replace(/\\/g, "/").split("/").pop() ?? input.file_path;
    return `\u270E ${name}`;
  },
});
