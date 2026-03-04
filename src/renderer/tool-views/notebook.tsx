import React from "react";
import { basename } from "../utils.js";
import { registerToolView, type ToolViewProps } from "./core.js";

// ─── NotebookEdit view ──────────────────────────────────────────

type NotebookEditInput = {
  notebook_path: string;
  new_source?: string;
  cell_number?: number;
  cell_id?: string;
  cell_type?: string;
  edit_mode?: string;
};

function isNotebookEdit(input: Record<string, unknown>): input is NotebookEditInput {
  return typeof input.notebook_path === "string";
}

function NotebookEditViewRenderer({ entry }: ToolViewProps<NotebookEditInput>) {
  const { notebook_path, new_source, cell_number, cell_type, edit_mode } = entry.toolInput;
  const mode = edit_mode ?? "replace";
  const modeLabel = mode === "insert" ? "Insert" : mode === "delete" ? "Delete" : "Edit";

  return (
    <div className="file-op-view">
      <div className="file-op-path">
        <span className="notebook-badge">{modeLabel}</span> {notebook_path}
        {cell_number != null && <span className="notebook-cell"> cell {cell_number}</span>}
        {cell_type && <span className="notebook-type"> ({cell_type})</span>}
      </div>
      {new_source && mode !== "delete" && (
        <pre className={`file-op-content ${mode === "insert" ? "file-op-content-new" : ""}`}>
          <code>{new_source}</code>
        </pre>
      )}
    </div>
  );
}

registerToolView({
  id: "notebook-edit",
  label: "Notebook",
  match: (entry) => entry.toolName === "NotebookEdit" && isNotebookEdit(entry.toolInput),
  render: NotebookEditViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as NotebookEditInput;
    const name = basename(input.notebook_path);
    const mode = input.edit_mode ?? "edit";
    return `\u{1F4D3} ${name} (${mode} cell${input.cell_number != null ? ` ${input.cell_number}` : ""})`;
  },
});
