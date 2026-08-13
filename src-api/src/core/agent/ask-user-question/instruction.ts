/**
 * Shared prompt instruction for adapters that don't expose Claude Code's
 * native AskUserQuestion tool. When prepended to the model prompt it asks
 * the model to emit a fenced `neuma:ask_user_question` JSON block whenever
 * it needs the user to pick between 2-4 finite options.
 *
 * Schema mirrors Anthropic's AskUserQuestionTool input (questions[1..4],
 * options[2..4], header≤12 chars, description, multiSelect) so future
 * migration to a native tool is mechanical.
 *
 * References:
 *   - Anthropic upstream: _sample/claude-code/packages/builtin-tools/src/
 *     tools/AskUserQuestionTool
 *   - Docs: https://code.claude.com/docs/en/agent-sdk/user-input
 */

export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion';

/** Fence language identifier; matches ASK_USER_QUESTION_FENCE_RE below. */
export const ASK_USER_QUESTION_FENCE_LANG = 'neuma:ask_user_question';

/**
 * Match the entire fenced block, including the trailing closing fence.
 * Captures the JSON body in group 1. Tolerant of CRLF line endings.
 */
export const ASK_USER_QUESTION_FENCE_RE =
  /```neuma:ask_user_question\s*\r?\n([\s\S]*?)\r?\n```/;

export const ASK_USER_QUESTION_TAG_NAMES = [
  'question-form',
  'ask-question',
] as const;

export const ASK_USER_QUESTION_TAG_RE =
  /<(question-form|ask-question)>\s*([\s\S]*?)\s*<\/\1>/g;

export const ASK_USER_QUESTION_INSTRUCTION = `## Interactive question protocol

If — and only if — you need the user to pick between 2-4 finite options before continuing, DO NOT enumerate the questions as numbered markdown. Instead, end your turn with exactly one fenced code block tagged \`${ASK_USER_QUESTION_FENCE_LANG}\` containing JSON matching this schema:

\`\`\`${ASK_USER_QUESTION_FENCE_LANG}
{
  "questions": [
    {
      "question": "Full question, ends with ?",
      "header": "Short label (<=12 chars)",
      "options": [
        { "label": "Option A", "description": "What this means" },
        { "label": "Option B", "description": "What this means" }
      ],
      "multiSelect": false,
      "policy": {
        "behavior": "manual or optional",
        "gate": "approval, cost, rights, upload, or destructive_edit when applicable",
        "defaultOptionLabel": "Required only for optional behavior"
      }
    }
  ]
}
\`\`\`

Rules:
- 1-4 questions per block, each with 2-4 options.
- The block must be the entire response — no prose, headers, or follow-up text around it.
- Use this format when the user explicitly asks to be questioned, or when you genuinely need to pick between discrete alternatives. Otherwise just answer normally.
- Mark a question optional only when continuing with the named default is safe. Approval, cost, rights, upload, and destructive-edit gates must be manual and must never declare a default.
- If policy is uncertain, omit it; the host treats missing or invalid policy as manual.`;
