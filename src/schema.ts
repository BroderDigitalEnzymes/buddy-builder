import { z } from "zod/v4";

// ─── Content Blocks ─────────────────────────────────────────────

export const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const ContentBlockSchema = z.union([
  TextBlockSchema,
  ToolUseBlockSchema,
  z.object({ type: z.string() }).catchall(z.unknown()),
]);

export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

// ─── Usage ──────────────────────────────────────────────────────

export const UsageSchema = z
  .object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  })
  .catchall(z.unknown());

export type Usage = z.infer<typeof UsageSchema>;

// ─── Output Messages (stdout NDJSON) ────────────────────────────

export const InitMessageSchema = z
  .object({
    type: z.literal("system"),
    subtype: z.literal("init"),
    session_id: z.string(),
    model: z.string(),
    tools: z.array(z.string()),
    cwd: z.string(),
    mcp_servers: z
      .array(z.object({ name: z.string(), status: z.string() }).catchall(z.unknown()))
      .optional(),
    claude_code_version: z.string().optional(),
    agents: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

export const AssistantMessageSchema = z
  .object({
    type: z.literal("assistant"),
    message: z
      .object({
        id: z.string(),
        model: z.string(),
        role: z.literal("assistant"),
        content: z.array(ContentBlockSchema),
        stop_reason: z.string().nullable(),
        usage: UsageSchema,
      })
      .catchall(z.unknown()),
    session_id: z.string(),
  })
  .catchall(z.unknown());

export const ResultMessageSchema = z
  .object({
    type: z.literal("result"),
    subtype: z.string(),
    is_error: z.boolean(),
    result: z.string(),
    session_id: z.string(),
    total_cost_usd: z.number(),
    num_turns: z.number(),
    duration_ms: z.number(),
    duration_api_ms: z.number(),
  })
  .catchall(z.unknown());

export const RateLimitEventSchema = z
  .object({
    type: z.literal("rate_limit_event"),
    rate_limit_info: z
      .object({
        status: z.string(),
        resetsAt: z.number(),
      })
      .catchall(z.unknown()),
  })
  .catchall(z.unknown());

export const UserEchoSchema = z
  .object({
    type: z.literal("user"),
    message: z
      .object({
        role: z.literal("user"),
        content: z.array(z.unknown()),
      })
      .catchall(z.unknown()),
  })
  .catchall(z.unknown());

export type InitMessage = z.infer<typeof InitMessageSchema>;
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;
export type ResultMessage = z.infer<typeof ResultMessageSchema>;
export type RateLimitEvent = z.infer<typeof RateLimitEventSchema>;
export type UserEcho = z.infer<typeof UserEchoSchema>;

export type OutputMessage =
  | InitMessage
  | AssistantMessage
  | ResultMessage
  | RateLimitEvent
  | UserEcho;

// ─── Hook Payloads ──────────────────────────────────────────────

const HookBaseSchema = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    hook_event_name: z.string(),
    permission_mode: z.string(),
    transcript_path: z.string(),
  })
  .catchall(z.unknown());

export const PreToolUsePayloadSchema = HookBaseSchema.extend({
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
  tool_use_id: z.string(),
});

export const PostToolUsePayloadSchema = HookBaseSchema.extend({
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()),
  tool_use_id: z.string(),
  tool_response: z.unknown(),
});

export const StopPayloadSchema = HookBaseSchema.extend({
  stop_hook_active: z.boolean(),
  last_assistant_message: z.string(),
});

export const NotificationPayloadSchema = HookBaseSchema.catchall(z.unknown());

export type PreToolUsePayload = z.infer<typeof PreToolUsePayloadSchema>;
export type PostToolUsePayload = z.infer<typeof PostToolUsePayloadSchema>;
export type StopPayload = z.infer<typeof StopPayloadSchema>;
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

// ─── Session Config ─────────────────────────────────────────────

export const SessionConfigSchema = z.object({
  model: z.string().optional(),
  cwd: z.string().optional(),
  claudePath: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
  appendSystemPrompt: z.string().optional(),
  permissionMode: z
    .enum(["default", "plan", "acceptEdits", "bypassPermissions"])
    .optional(),
  maxTurns: z.number().positive().optional(),
  noSessionPersistence: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type SessionConfig = z.infer<typeof SessionConfigSchema>;

// ─── Tool Policy ────────────────────────────────────────────────

export type ToolAction =
  | { readonly action: "allow" }
  | { readonly action: "block"; readonly reason: string };

export type ToolPolicy = (
  toolName: string,
  toolInput: Record<string, unknown>,
) => ToolAction | Promise<ToolAction>;

// ─── Session State ──────────────────────────────────────────────

export const SessionStates = ["idle", "busy", "dead"] as const;
export type SessionState = (typeof SessionStates)[number];
