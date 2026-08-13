/** Format submitted answers (question → answer) into a chat message. */
export function formatDesignQuestionAnswers(
  answers: Record<string, string>,
): string {
  return Object.entries(answers)
    .map(([question, answer]) => `${question} → ${answer}`)
    .join('\n');
}
