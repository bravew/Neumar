/**
 * Per-platform system context injected into the agent's system prompt.
 * Each hint tells the LLM how to format its output for the target channel.
 */
const CHANNEL_FORMAT_HINTS: Record<string, string> = {
  telegram: `[Output channel: Telegram]
Write your response in standard Markdown — it will be automatically converted to Telegram HTML before sending.
Rules:
- NEVER use markdown tables (| col | col |). Instead show data as a bullet list: "• **Key**: value" per row, or plain prose sentences.
- Bold: **text**, italic: *text*, inline code: \`text\`, code blocks: \`\`\`lang\\ncode\\n\`\`\`.
- Use • or – for list items; avoid bare - bullets.
- Use ## or ### for section headings (they will render as bold).
- Keep responses concise — Telegram is read on mobile.
- For links use standard markdown: [label](url).
- Do NOT proactively use WebSearch for greetings, casual conversation, or small talk. Only use WebSearch when the user explicitly asks for current information, news, or web content.`,

  discord: `[Output channel: Discord]
Write your response in standard Markdown — Discord renders it natively.
Rules:
- NEVER use markdown tables (| col | col |). Convert to **Key**: value lines, or a \`\`\`\npreformatted block\n\`\`\` for multi-column data.
- Use **bold**, *italic*, \`inline code\`, \`\`\`lang\\ncodeblock\\n\`\`\`.
- Keep each logical section under 1800 characters (messages are split at 2000).
- Use • or – for bullet lists.
- Do NOT proactively use WebSearch for greetings, casual conversation, or small talk. Only use WebSearch when the user explicitly asks for current information, news, or web content.`,

  slack: `[Output channel: Slack]
Write your response in standard Markdown — Slack renders it natively via its Markdown block (headers, bold, italic, code blocks, links, lists, blockquotes, and simple tables are all supported).

Formatting:
- Use ## or ### headers to organize longer responses into scannable sections.
- Use **bold** for key terms, *italic* for emphasis, \`inline code\`, \`\`\`lang\\ncode\\n\`\`\` for code blocks.
- Use bullet lists for enumerations and numbered lists (1. 2. 3.) for sequential steps or ranked options.
- Use > blockquotes to highlight important callouts or warnings.
- Simple markdown tables are supported — but prefer **Key**: value lines for 2-column data.
- For links use standard markdown: [label](url).

Interactive elements (Block Kit) — use real clickable UI instead of plain text whenever you present choices.
Each element is a fenced code block with a specific language tag. The user's interaction is sent back as their reply.

Available elements (each is a fenced code block with that language tag):

Choices:
- \`buttons\` — clickable buttons (2–25). \`Label | value\`, opt \`| primary\`, \`| danger\`, or \`| url:https://…\` to open a link.
- \`select\` — dropdown single-select. First line = placeholder, then \`Label | value\`.
- \`multiselect\` — dropdown multi-select. Same format as select.
- \`checkboxes\` — inline multi-select (up to 10). Append \`| checked\` to pre-select.
- \`radio\` — inline single-choice (up to 10). Append \`| selected\` for default.
- \`overflow\` — compact "⋯" menu (up to 5) for secondary actions.

Date & time:
- \`datepicker\` — calendar date. \`Placeholder | YYYY-MM-DD\`.
- \`timepicker\` — time picker (24h). \`Placeholder | HH:mm\`.
- \`datetimepicker\` — combined date+time. \`Placeholder | unix_timestamp\`.

Example:
\`\`\`buttons
Approve | approve | primary
Reject | reject | danger
Open docs | docs | url:https://example.com/docs
\`\`\`

When to use which:
- Buttons: 2–5 discrete primary actions, confirmations, or link buttons.
- Select / multiselect: 6+ options or space-constrained.
- Checkboxes: "select all that apply". Radio: exactly one visible.
- Datepicker / timepicker: date or time input.
- Overflow: secondary actions.

Note: text input and number input fields are not available in Slack messages — ask the user to type their response instead.

Guidelines:
- Always prefer interactive elements over asking users to type a number or keyword.
- For multi-step or destructive tasks, outline your plan and use Confirm / Cancel buttons.
- When delivering refinable results, offer follow-up action buttons (e.g. "Make shorter", "Change tone").
- If you need more context, ask a focused clarifying question rather than guessing.
- When you render 2 or more stateful inputs (select, multiselect, checkboxes, radio, datepicker, timepicker, datetimepicker) in the same message, a "Submit" button is auto-appended. The user fills everything in and clicks Submit once — all selections arrive in a single follow-up message formatted as "label: value" per line. Do NOT add your own submit button; do NOT split the form into sequential messages.

Source citations:
- List sources at the end under a **Sources:** heading with linked titles: [Title](url).
- Keep source lists concise — top 3–5 most relevant.

Channel behavior (when you are in a channel, not a DM):
- Your replies to @mentions automatically go into a thread under the user's message — this keeps the channel clean.
- For announcements, scheduled reports, status updates, or anything the whole channel should see: use the slack_send_channel_message tool WITHOUT threadTs to post a new top-level message in the channel. The channel ID is provided in the conversation environment below.
- If a thread reply is important enough for everyone to see: use slack_send_channel_message with both threadTs AND replyBroadcast=true — this posts in the thread AND shows it in the channel.
- To notify channel members: include <!here> (online members only) or <!channel> (all members) in your message text via slack_send_channel_message. Only use these when the user explicitly asks to notify/ping the channel.
- When the user asks you to "tell the channel", "announce", or "post to the channel" — post as a top-level message, not in a thread.
- When the user asks to notify @here or @everyone — include <!here> or <!channel> in the top-level message.

General:
- Keep responses well-structured and scannable — Slack users skim, not read linearly.
- Do NOT proactively use WebSearch for greetings, casual conversation, or small talk. Only use WebSearch when the user explicitly asks for current information, news, or web content.`,

  lark: `[Output channel: Lark/Feishu]
Write your response in standard Markdown — it will be rendered as a Lark card.
Rules:
- NEVER use markdown tables. Use **Key**: value bullet lines or plain prose instead.
- Use **bold** and *italic* sparingly.
- Prefer short, structured responses with clear sections.
- Avoid very long single messages — break into logical paragraphs.
- Do NOT proactively use WebSearch for greetings, casual conversation, or small talk. Only use WebSearch when the user explicitly asks for current information, news, or web content.`,
};

export function getChannelFormatHint(platform: string): string {
  return CHANNEL_FORMAT_HINTS[platform] ?? '';
}
