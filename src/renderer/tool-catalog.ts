// Hard-coded metadata for known Claude Code tools.
// Unknown/MCP tools will show name only.

export type ToolParam = { name: string; desc: string };

export type ToolMeta = {
  description: string;
  category: string;
  params?: ToolParam[];
};

export const TOOL_CATEGORIES = [
  "File Operations",
  "Search",
  "Execution",
  "Web",
  "Planning",
  "Tasks",
  "Workflow",
  "Other",
] as const;

export const TOOL_CATALOG: Record<string, ToolMeta> = {
  Read: {
    description: "Reads a file from the local filesystem. Supports text files, images, PDFs, and Jupyter notebooks.",
    category: "File Operations",
    params: [
      { name: "file_path", desc: "Absolute path to the file to read" },
      { name: "offset", desc: "Line number to start reading from" },
      { name: "limit", desc: "Number of lines to read" },
      { name: "pages", desc: "Page range for PDF files (e.g. '1-5')" },
    ],
  },
  Write: {
    description: "Writes content to a file, creating it if needed or overwriting existing content.",
    category: "File Operations",
    params: [
      { name: "file_path", desc: "Absolute path to the file to write" },
      { name: "content", desc: "The content to write" },
    ],
  },
  Edit: {
    description: "Performs exact string replacements in files. Sends only the diff for efficient editing.",
    category: "File Operations",
    params: [
      { name: "file_path", desc: "Absolute path to the file to modify" },
      { name: "old_string", desc: "The text to replace" },
      { name: "new_string", desc: "The replacement text" },
      { name: "replace_all", desc: "Replace all occurrences (default false)" },
    ],
  },
  NotebookEdit: {
    description: "Replaces, inserts, or deletes cells in a Jupyter notebook (.ipynb file).",
    category: "File Operations",
    params: [
      { name: "notebook_path", desc: "Absolute path to the notebook" },
      { name: "cell_id", desc: "ID of the cell to edit" },
      { name: "new_source", desc: "New source content for the cell" },
      { name: "cell_type", desc: "Cell type: code or markdown" },
      { name: "edit_mode", desc: "replace, insert, or delete" },
    ],
  },
  Glob: {
    description: "Fast file pattern matching. Finds files by glob patterns like '**/*.js'.",
    category: "Search",
    params: [
      { name: "pattern", desc: "Glob pattern to match files against" },
      { name: "path", desc: "Directory to search in" },
    ],
  },
  Grep: {
    description: "Content search using ripgrep. Supports regex, file type filtering, and context lines.",
    category: "Search",
    params: [
      { name: "pattern", desc: "Regex pattern to search for" },
      { name: "path", desc: "File or directory to search in" },
      { name: "glob", desc: "Glob pattern to filter files" },
      { name: "output_mode", desc: "content, files_with_matches, or count" },
    ],
  },
  Bash: {
    description: "Executes bash commands and returns output. Working directory persists between calls.",
    category: "Execution",
    params: [
      { name: "command", desc: "The command to execute" },
      { name: "description", desc: "Description of what the command does" },
      { name: "timeout", desc: "Optional timeout in milliseconds" },
      { name: "run_in_background", desc: "Run in background (true/false)" },
    ],
  },
  WebFetch: {
    description: "Fetches content from a URL, converts HTML to markdown, and processes it with a prompt.",
    category: "Web",
    params: [
      { name: "url", desc: "The URL to fetch content from" },
      { name: "prompt", desc: "Prompt to process the fetched content" },
    ],
  },
  WebSearch: {
    description: "Searches the web and returns results with links. Provides up-to-date information.",
    category: "Web",
    params: [
      { name: "query", desc: "The search query" },
      { name: "allowed_domains", desc: "Only include results from these domains" },
      { name: "blocked_domains", desc: "Exclude results from these domains" },
    ],
  },
  Agent: {
    description: "Launches a specialized sub-agent to handle complex, multi-step tasks autonomously.",
    category: "Workflow",
    params: [
      { name: "prompt", desc: "The task for the agent to perform" },
      { name: "subagent_type", desc: "Type of agent (general-purpose, Explore, Plan, etc.)" },
      { name: "description", desc: "Short description of the task" },
      { name: "model", desc: "Optional model override (sonnet, opus, haiku)" },
    ],
  },
  EnterPlanMode: {
    description: "Transitions into plan mode for designing implementation approaches before writing code.",
    category: "Planning",
    params: [],
  },
  ExitPlanMode: {
    description: "Exits plan mode after the plan is written, requesting user approval to proceed.",
    category: "Planning",
    params: [
      { name: "allowedPrompts", desc: "Prompt-based permissions needed to implement" },
    ],
  },
  AskUserQuestion: {
    description: "Asks the user questions during execution to gather preferences, clarify instructions, or get decisions.",
    category: "Workflow",
    params: [
      { name: "questions", desc: "Array of questions with options (1-4 questions)" },
    ],
  },
  TaskCreate: {
    description: "Creates a structured task in the task list for tracking progress on multi-step work.",
    category: "Tasks",
    params: [
      { name: "subject", desc: "Brief title for the task" },
      { name: "description", desc: "Detailed description of what needs to be done" },
      { name: "activeForm", desc: "Present continuous form shown while in progress" },
    ],
  },
  TaskUpdate: {
    description: "Updates a task's status, description, or dependencies in the task list.",
    category: "Tasks",
    params: [
      { name: "taskId", desc: "ID of the task to update" },
      { name: "status", desc: "New status: pending, in_progress, completed, deleted" },
    ],
  },
  TaskGet: {
    description: "Retrieves full details of a task by its ID, including dependencies.",
    category: "Tasks",
    params: [
      { name: "taskId", desc: "ID of the task to retrieve" },
    ],
  },
  TaskList: {
    description: "Lists all tasks with their status, owner, and blocked-by information.",
    category: "Tasks",
    params: [],
  },
  TaskOutput: {
    description: "Retrieves output from a running or completed background task.",
    category: "Tasks",
    params: [
      { name: "task_id", desc: "The task ID to get output from" },
      { name: "block", desc: "Whether to wait for completion" },
      { name: "timeout", desc: "Max wait time in milliseconds" },
    ],
  },
  TaskStop: {
    description: "Stops a running background task by its ID.",
    category: "Tasks",
    params: [
      { name: "task_id", desc: "The ID of the task to stop" },
    ],
  },
  Skill: {
    description: "Invokes a user-defined skill (slash command) within the conversation.",
    category: "Workflow",
    params: [
      { name: "skill", desc: "The skill name (e.g. 'commit', 'review-pr')" },
      { name: "args", desc: "Optional arguments for the skill" },
    ],
  },
  EnterWorktree: {
    description: "Creates an isolated git worktree and switches the session into it.",
    category: "Workflow",
    params: [
      { name: "name", desc: "Optional name for the worktree" },
    ],
  },
};

/** Get tool metadata, returning a fallback for unknown tools. */
export function getToolMeta(name: string): ToolMeta {
  return TOOL_CATALOG[name] ?? { description: "", category: "Other" };
}
