// Re-export core types and components (public API)
export { ToolViewTabs, getMatchingViews, registerToolView } from "./core.js";
export type { ToolViewDef, ToolViewProps, ToolChatEntry } from "./core.js";

// Import view modules — side-effect registration
import "./raw.js";
import "./ask-question.js";
import "./agent.js";
import "./tasks.js";
import "./bash.js";
import "./file-ops.js";
import "./search.js";
import "./web.js";
import "./notebook.js";
