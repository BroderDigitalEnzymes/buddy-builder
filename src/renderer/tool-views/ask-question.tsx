import React, { useState, useCallback } from "react";
import { answerQuestion } from "../store.js";
import type { AskUserQuestionInput, AskQuestionItem } from "../../ipc.js";
import { registerToolView, type ToolViewProps, type ToolChatEntry } from "./core.js";

// ─── AskUserQuestion view ────────────────────────────────────────

function isAskUserQuestion(input: Record<string, unknown>): input is AskUserQuestionInput {
  return (
    Array.isArray(input.questions) &&
    input.questions.length > 0 &&
    typeof (input.questions as any)[0]?.question === "string"
  );
}

function AskQuestionCard({
  item,
  sendResponse,
  disabled,
}: {
  item: AskQuestionItem;
  sendResponse: (text: string) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleOption = useCallback((label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (selected.size === 0) return;
    sendResponse([...selected].join(", "));
  }, [selected, sendResponse]);

  return (
    <div className="ask-question">
      <div className="ask-header">
        <span className="ask-badge">{item.header}</span>
        <span className="ask-text">{item.question}</span>
      </div>
      <div className="ask-options">
        {item.options.map((opt, i) =>
          item.multiSelect ? (
            <button
              key={i}
              className={`ask-option ask-option-multi ${selected.has(opt.label) ? "selected" : ""}`}
              onClick={() => !disabled && toggleOption(opt.label)}
              disabled={disabled}
            >
              <span className="ask-check">{selected.has(opt.label) ? "\u2713" : ""}</span>
              <span className="ask-option-body">
                <span className="ask-option-label">{opt.label}</span>
                <span className="ask-option-desc">{opt.description}</span>
              </span>
            </button>
          ) : (
            <button
              key={i}
              className="ask-option"
              onClick={() => !disabled && sendResponse(opt.label)}
              disabled={disabled}
            >
              <span className="ask-option-label">{opt.label}</span>
              <span className="ask-option-desc">{opt.description}</span>
            </button>
          ),
        )}
      </div>
      {item.multiSelect && (
        <div className="ask-multi-footer">
          <span className="ask-multi-hint">
            {selected.size === 0 ? "Select one or more options" : `${selected.size} selected`}
          </span>
          <button
            className="ask-submit"
            disabled={disabled || selected.size === 0}
            onClick={handleSubmit}
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}

function AskQuestionViewRenderer({
  entry,
}: ToolViewProps<AskUserQuestionInput>) {
  const input = entry.toolInput;
  const done = entry.status === "done";

  // Route answers through the dedicated answerQuestion IPC (holds the hook)
  const handleAnswer = useCallback(
    (text: string) => answerQuestion(entry.toolUseId, text),
    [entry.toolUseId],
  );

  return (
    <div className={`ask-entry ask-${entry.status}`}>
      {input.questions.map((q, i) => (
        <AskQuestionCard key={i} item={q} sendResponse={handleAnswer} disabled={done} />
      ))}
      {done && entry.toolResult && (
        <div className="ask-answer">
          <span className="ask-answer-label">Answer:</span>
          <span className="ask-answer-value">{entry.toolResult}</span>
        </div>
      )}
    </div>
  );
}

registerToolView({
  id: "ask-user-question",
  label: "Question",
  match: (entry) =>
    entry.toolName === "AskUserQuestion" && isAskUserQuestion(entry.toolInput),
  render: AskQuestionViewRenderer,
  priority: 0,
  fullReplace: true,
  summary: (entry) => {
    if (!entry.toolResult) return null;
    const input = entry.toolInput as AskUserQuestionInput;
    const q = input.questions[0]?.question ?? "Question";
    return `${q} \u2192 ${entry.toolResult}`;
  },
});
