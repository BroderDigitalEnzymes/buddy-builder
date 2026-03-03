import React from "react";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";
import { RawViewRenderer } from "./raw.js";

// ─── Shared status icons ─────────────────────────────────────────

const STATUS_ICON: Record<string, string> = {
  completed: "\u2713",     // ✓
  in_progress: "\u25CF",   // ●
  pending: "\u25CB",       // ○
  deleted: "\u2715",       // ✕
};

// ─── TodoWrite view (legacy full-list replacement) ────────────────

type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
};

type TodoWriteInput = { todos: TodoItem[] };

function isTodoWrite(input: Record<string, unknown>): input is TodoWriteInput {
  return (
    Array.isArray(input.todos) &&
    input.todos.length > 0 &&
    typeof (input.todos as any)[0]?.content === "string"
  );
}

function TodoWriteViewRenderer({ entry }: ToolViewProps<TodoWriteInput>) {
  const { todos } = entry.toolInput;
  const completed = todos.filter((t) => t.status === "completed").length;
  const active = todos.find((t) => t.status === "in_progress");
  const pct = Math.round((completed / todos.length) * 100);

  return (
    <div className="todo-view">
      <div className="todo-header">
        <div className="todo-progress-bar">
          <div className="todo-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="todo-progress-label">{completed}/{todos.length}</span>
      </div>
      {active && entry.status === "running" && (
        <div className="todo-active">
          <span className="tool-icon spinning" />
          <span className="todo-active-text">{active.activeForm ?? active.content}</span>
        </div>
      )}
      <div className="todo-items">
        {todos.map((t, i) => (
          <div key={i} className={`todo-item todo-${t.status}`}>
            <span className="todo-check">{STATUS_ICON[t.status] ?? STATUS_ICON.pending}</span>
            <span className="todo-content">{t.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

registerToolView({
  id: "todo-write",
  label: "Tasks",
  match: (entry) => entry.toolName === "TodoWrite" && isTodoWrite(entry.toolInput),
  render: TodoWriteViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as TodoWriteInput;
    const done = input.todos.filter((t) => t.status === "completed").length;
    const active = input.todos.find((t) => t.status === "in_progress");
    if (active) return `${active.activeForm ?? active.content} (${done}/${input.todos.length})`;
    return `Tasks: ${done}/${input.todos.length} complete`;
  },
});

// ─── TaskCreate view ────────────────────────────────────────────

type TaskCreateInput = {
  subject: string;
  description: string;
  activeForm?: string;
};

function isTaskCreate(input: Record<string, unknown>): input is TaskCreateInput {
  return typeof input.subject === "string";
}

function TaskCreateViewRenderer({ entry }: ToolViewProps<TaskCreateInput>) {
  const { subject, description, activeForm } = entry.toolInput;
  return (
    <div className="task-view">
      <div className="task-row">
        <span className="todo-check">{"\u25CB"}</span>
        <div className="task-info">
          <span className="task-subject">{subject}</span>
          {description && <span className="task-desc">{description}</span>}
        </div>
      </div>
      {activeForm && entry.status === "running" && (
        <div className="todo-active">
          <span className="tool-icon spinning" />
          <span className="todo-active-text">{activeForm}</span>
        </div>
      )}
    </div>
  );
}

registerToolView({
  id: "task-create",
  label: "Task",
  match: (entry) => entry.toolName === "TaskCreate" && isTaskCreate(entry.toolInput),
  render: TaskCreateViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as TaskCreateInput;
    return `+ ${input.subject}`;
  },
});

// ─── TaskUpdate view ────────────────────────────────────────────

type TaskUpdateInput = {
  taskId: string;
  status?: string;
  subject?: string;
  activeForm?: string;
};

function isTaskUpdate(input: Record<string, unknown>): input is TaskUpdateInput {
  return typeof input.taskId === "string";
}

function TaskUpdateViewRenderer({ entry }: ToolViewProps<TaskUpdateInput>) {
  const { taskId, status, activeForm } = entry.toolInput;
  const icon = STATUS_ICON[status ?? ""] ?? "\u25CF";
  return (
    <div className="task-view">
      <div className={`task-row task-${status ?? "pending"}`}>
        <span className="todo-check">{icon}</span>
        <span className="task-subject">Task #{taskId}</span>
        {status && <span className="task-status-badge">{status}</span>}
      </div>
      {activeForm && status === "in_progress" && entry.status === "running" && (
        <div className="todo-active">
          <span className="tool-icon spinning" />
          <span className="todo-active-text">{activeForm}</span>
        </div>
      )}
    </div>
  );
}

registerToolView({
  id: "task-update",
  label: "Task",
  match: (entry) => entry.toolName === "TaskUpdate" && isTaskUpdate(entry.toolInput),
  render: TaskUpdateViewRenderer,
  priority: 5,
  fullReplace: true,
  summary: (entry) => {
    const input = entry.toolInput as TaskUpdateInput;
    const icon = STATUS_ICON[input.status ?? ""] ?? "";
    return `${icon} Task #${input.taskId} \u2192 ${input.status ?? "updated"}`;
  },
});

// ─── TaskList view ──────────────────────────────────────────────

registerToolView({
  id: "task-list",
  label: "Tasks",
  match: (entry) => entry.toolName === "TaskList",
  render: RawViewRenderer,
  priority: 5,
  summary: (entry) => {
    if (!entry.toolResult) return null;
    return "Task list";
  },
});
