/**
 * Lightweight keyword-based sentiment detection for Slack messages.
 *
 * Determines whether an inbound message is a simple acknowledgment,
 * a compliment, or an error report — and maps it to an appropriate
 * emoji reaction. No LLM call required; pure pattern matching.
 *
 * Design principles (from Slack AI best practices):
 *   - Emoji reactions are less jarring than text replies
 *   - Don't react to every message — only clear-signal sentiments
 *   - One reaction per message maximum
 *   - Simple acks ("ok", "thanks") don't need a full agent reply
 *
 * @see https://docs.slack.dev/ai/ai-apps-best-practices/
 */

// ============================================================================
// Types
// ============================================================================

export type MessageSentiment =
  | 'greeting' // Hi/hello — respond with canned greeting, skip agent
  | 'ack' // Simple acknowledgment — react only, skip agent
  | 'compliment' // Positive feedback — react after reply
  | 'frustration' // Error/complaint — react alongside reply
  | 'stop' // Stop/cancel — abort current run
  | null; // No clear sentiment — proceed normally

export interface SentimentResult {
  sentiment: MessageSentiment;
  emoji: string | null;
  /** When true, the message needs no agent reply — a reaction or canned response is enough. */
  reactOnly: boolean;
  /** For greetings: predefined response text to send instead of calling the agent. */
  cannedResponse?: string;
}

// ============================================================================
// Keyword patterns
// ============================================================================

/**
 * Terminal acks — conversation-ending messages that clearly don't need
 * a full agent response. React-only (skip agent to save LLM cost).
 *
 * IMPORTANT: "yes", "ok", "sure" etc. are intentionally excluded because
 * they could be answers to bot questions ("Would you like me to proceed?").
 * Only include phrases that unambiguously close a conversation turn.
 */
const TERMINAL_ACK_EXACT: Set<string> = new Set([
  // Thanks / appreciation
  'thanks',
  'thank you',
  'thx',
  'ty',
  'tysm',
  'thank u',
  'thanks a lot',
  'thanks so much',
  'thank you so much',
  'much appreciated',
  'appreciated',
  'cheers',
  'ta',
  // Closers
  'no problem',
  'no worries',
  'np',
  'nw',
  'all good',
  // Emoji-only
  '🙏',
  '💯',
]);

/**
 * Soft acks — may be answers to bot questions, so DON'T skip agent.
 * Still add a 👍 reaction for friendly acknowledgment.
 */
const SOFT_ACK_EXACT: Set<string> = new Set([
  'ok',
  'okay',
  'k',
  'kk',
  'got it',
  'gotcha',
  'understood',
  'noted',
  'cool',
  'alright',
  'sure',
  'yep',
  'yup',
  'yes',
  'ya',
  'yeah',
  'sounds good',
  'makes sense',
  'will do',
  'roger',
  'roger that',
  'copy',
  'copy that',
  'ack',
  '👍',
  '👌',
  '✅',
  '🫡',
]);

/**
 * Compliment keywords — matched as substrings in longer messages.
 * These indicate positive feedback about the bot's response.
 */
const COMPLIMENT_KEYWORDS: string[] = [
  'great job',
  'good job',
  'nice job',
  'well done',
  'awesome',
  'amazing',
  'fantastic',
  'brilliant',
  'excellent',
  'perfect',
  'love it',
  'love this',
  'impressive',
  'beautiful',
  'exactly what i needed',
  'just what i needed',
  'you rock',
  'nailed it',
  'spot on',
  'super helpful',
  'really helpful',
  'so helpful',
  'very helpful',
  'that helps',
  'this is great',
  "that's great",
  'this is perfect',
  "that's perfect",
  "that's exactly",
  'works perfectly',
  'works great',
  'looks great',
  'looks perfect',
  'looks good',
  'looks amazing',
];

/**
 * Frustration / error-report keywords — matched as substrings.
 * These indicate the user is reporting a problem with the bot's output.
 */
const FRUSTRATION_KEYWORDS: string[] = [
  "that's wrong",
  "that's incorrect",
  "that's not right",
  "that's not what i",
  'this is wrong',
  "doesn't work",
  'does not work',
  "didn't work",
  'did not work',
  "isn't working",
  'is not working',
  'not what i asked',
  'not what i wanted',
  'try again',
  'please fix',
  'still broken',
  'still wrong',
  'you broke',
  'messed up',
  'screwed up',
  'completely wrong',
  'totally wrong',
];

/**
 * Stop / cancel commands — user wants to abort the current agent run.
 * Exact match only to avoid false positives.
 */
const STOP_EXACT: Set<string> = new Set([
  'stop',
  'cancel',
  'abort',
  'nevermind',
  'never mind',
  'nvm',
  'forget it',
  'stop that',
  'cancel that',
  'hold on',
  'wait',
  'stop please',
  'please stop',
]);

// ============================================================================
// Greetings
// ============================================================================

// ── Greeting categories ─────────────────────────────────────────────────
// Each greeting maps to a response category so "good morning" gets a
// morning-appropriate reply, "hola" gets a Spanish-flavored one, etc.

type GreetingCategory =
  | 'generic'
  | 'casual'
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'howdy'
  | 'availability'
  | 'es'
  | 'fr'
  | 'pt'
  | 'hi_in'
  | 'zh'
  | 'intl';

/**
 * Maps each greeting phrase → response category.
 * Exact match only (after normalization) to avoid false positives on
 * messages like "hi, can you help me with..." which need the agent.
 *
 * @see https://slack.com/resources/using-slack/a-guide-to-slackbot-custom-responses
 */
const GREETING_MAP: Map<string, GreetingCategory> = new Map([
  // ── Standard English → generic ────────────────────────────────────────
  ['hi', 'generic'],
  ['hello', 'generic'],
  ['hey', 'generic'],
  ['hiya', 'generic'],
  ['heya', 'generic'],
  ['greetings', 'generic'],
  ['hi there', 'generic'],
  ['hello there', 'generic'],
  ['hey there', 'generic'],
  ['hey hey', 'generic'],

  // ── Misspellings / elongations → generic ──────────────────────────────
  ['hii', 'generic'],
  ['hiii', 'generic'],
  ['hiiii', 'generic'],
  ['heyy', 'generic'],
  ['heyyy', 'generic'],
  ['helloo', 'generic'],
  ['hellooo', 'generic'],
  ['helloooo', 'generic'],
  ['helo', 'generic'],
  ['henlo', 'generic'],
  ['hewwo', 'generic'],

  // ── Casual / slang → casual ───────────────────────────────────────────
  ['yo', 'casual'],
  ['sup', 'casual'],
  ['whats up', 'casual'],
  ["what's up", 'casual'],
  ['wassup', 'casual'],
  ['wazzup', 'casual'],
  ['wsup', 'casual'],
  ["what's good", 'casual'],
  ['whats good', 'casual'],
  ["what's new", 'casual'],
  ['whats new', 'casual'],

  // ── "How's it going" style → howdy ────────────────────────────────────
  ["how's it going", 'howdy'],
  ['hows it going', 'howdy'],
  ['howdy', 'howdy'],
  ["how's everything", 'howdy'],
  ['hows everything', 'howdy'],

  // ── Availability checks → availability ────────────────────────────────
  ['are you there', 'availability'],
  ['you there', 'availability'],
  ['are you around', 'availability'],
  ['are you online', 'availability'],
  ['are you available', 'availability'],
  ['are you up', 'availability'],
  ['you around', 'availability'],
  ['anyone there', 'availability'],
  ['anybody there', 'availability'],
  ['are you awake', 'availability'],
  ['you awake', 'availability'],
  ['ping', 'availability'],
  ['are you alive', 'availability'],
  ['hello are you there', 'availability'],
  ['hey are you there', 'availability'],
  ['still there', 'availability'],
  ['you still there', 'availability'],
  ['are you still there', 'availability'],

  // ── Morning ───────────────────────────────────────────────────────────
  ['good morning', 'morning'],
  ['morning', 'morning'],
  ['gm', 'morning'],
  ['buenos dias', 'morning'],
  ['buenos días', 'morning'],
  ['buen dia', 'morning'],
  ['buen día', 'morning'],
  ['bom dia', 'morning'],

  // ── Afternoon ─────────────────────────────────────────────────────────
  ['good afternoon', 'afternoon'],
  ['afternoon', 'afternoon'],
  ['good day', 'afternoon'],
  ['buenas tardes', 'afternoon'],
  ['boa tarde', 'afternoon'],

  // ── Evening ───────────────────────────────────────────────────────────
  ['good evening', 'evening'],
  ['evening', 'evening'],
  ['buenas noches', 'evening'],
  ['boa noite', 'evening'],
  ['bonsoir', 'evening'],

  // ── Spanish ───────────────────────────────────────────────────────────
  ['hola', 'es'],
  ['hola que tal', 'es'],
  ['qué tal', 'es'],
  ['que tal', 'es'],

  // ── French ────────────────────────────────────────────────────────────
  ['bonjour', 'fr'],
  ['salut', 'fr'],
  ['coucou', 'fr'],

  // ── Portuguese ────────────────────────────────────────────────────────
  ['oi', 'pt'],
  ['olá', 'pt'],
  ['ola', 'pt'],
  ['e aí', 'pt'],
  ['e ai', 'pt'],

  // ── Hindi ─────────────────────────────────────────────────────────────
  ['namaste', 'hi_in'],
  ['namaskar', 'hi_in'],
  ['नमस्ते', 'hi_in'],

  // ── Chinese ───────────────────────────────────────────────────────────
  ['ni hao', 'zh'],
  ['nǐ hǎo', 'zh'],
  ['你好', 'zh'],
  ['嗨', 'zh'],

  // ── Other languages → intl ────────────────────────────────────────────
  ['ciao', 'intl'],
  ['hej', 'intl'],
  ['hallo', 'intl'],
  ['moin', 'intl'],
  ['ahoj', 'intl'],
  ['cześć', 'intl'],
  ['привет', 'intl'],
  ['مرحبا', 'intl'],
  ['สวัสดี', 'intl'],
  ['こんにちは', 'intl'],
  ['안녕하세요', 'intl'],
  ['xin chào', 'intl'],

  // ── Emoji-only → generic ──────────────────────────────────────────────
  ['👋', 'generic'],
  ['🙋', 'generic'],
  ['🙋‍♂️', 'generic'],
  ['🙋‍♀️', 'generic'],
  ['🤙', 'casual'],
  ['✌️', 'casual'],
]);

/**
 * Response pools per category — picked randomly so it never feels canned.
 * Each pool has enough variety for daily use without obvious repeats.
 */
const GREETING_RESPONSES: Record<GreetingCategory, string[]> = {
  generic: [
    'Hey! What can I help you with?',
    'Hi there! How can I help you today?',
    'Hello! Let me know what you need.',
    "Hey! Ready to help — what's on your mind?",
    "Hi! What are you working on? I'm here to help.",
    'Hello! What can I do for you?',
    "Hi! Go ahead, I'm listening.",
    'Hey there! What do you need help with?',
    "Hi! What's the plan? I'm ready.",
    'Hello! Got something for me to work on?',
    'Hey! Tell me what you need.',
    'Hi there! Anything I can help with?',
    'Hello! What are we doing today?',
  ],
  casual: [
    'Yo! What do you need?',
    "Hey! What's up? Need anything?",
    'Sup! What can I help with?',
    'Hey hey! What are we working on?',
    'Yo! Ready when you are.',
    "What's good! I'm here — fire away.",
    "Sup! Go ahead, I'm all ears.",
    'Yo! Lay it on me — what do you need?',
    "Hey! What's the move?",
    'Sup! What are we getting into?',
    "Yo! I'm around — what's up?",
  ],
  morning: [
    'Good morning! What can I help you with today?',
    'Morning! Ready to get things done — what do you need?',
    "Good morning! What's on the agenda?",
    'Morning! How can I help you start the day?',
    'Good morning! What are we tackling today?',
    "Morning! Let's get to it — what do you need?",
    "Good morning! What's first on the list?",
    "Morning! I'm up and ready — what can I do?",
    'Good morning! What are we starting with?',
    'Morning! Fresh day — what do you need help with?',
  ],
  afternoon: [
    'Good afternoon! What can I help with?',
    'Afternoon! What do you need?',
    'Good afternoon! What are we working on?',
    'Hey, good afternoon! How can I help?',
    "Good afternoon! I'm here — what do you need?",
    "Afternoon! What's on your plate?",
    'Good afternoon! What can I do for you?',
    'Afternoon! Got something for me?',
    'Good afternoon! Ready to help — go ahead.',
    'Afternoon! What are we looking at?',
  ],
  evening: [
    'Good evening! What can I help you with?',
    'Evening! Need anything before the day wraps up?',
    'Good evening! What do you need?',
    'Hey, good evening! How can I help?',
    'Good evening! Still here — what do you need?',
    'Evening! What can I do for you?',
    'Good evening! What are we working on?',
    "Evening! I'm around — let me know what you need.",
    'Good evening! Anything I can help with?',
    "Evening! Go ahead, I'm listening.",
  ],
  availability: [
    "Yep, I'm here! What do you need?",
    "I'm here! How can I help?",
    'Right here! What can I do for you?',
    "Yes, I'm online! What do you need?",
    "I'm around! Go ahead.",
    "Here! What's up?",
    'Present! What do you need help with?',
    "I'm here and ready — what do you need?",
    'Yep! What can I help you with?',
    "Still here! What's on your mind?",
  ],
  howdy: [
    'Going great! What can I help you with?',
    'All good here! What do you need?',
    "Doing well! What's on your mind?",
    "Can't complain! What can I do for you?",
    'Good, thanks! Ready to help — what do you need?',
    'Pretty good! What are you working on?',
    'All good! What can I help with?',
    'Not bad! What do you need?',
    'Doing great! Got something for me?',
    'Going well! Tell me what you need.',
  ],
  es: [
    '¡Hola! ¿En qué te puedo ayudar? / What can I help you with?',
    '¡Hola! Dime, ¿qué necesitas? / Let me know what you need.',
    '¡Hey! ¿Qué puedo hacer por ti? / What can I do for you?',
    '¡Hola! Estoy listo para ayudar. / Ready to help!',
    "¡Hola! ¿Qué tienes en mente? / What's on your mind?",
    '¡Hola! Cuéntame, ¿en qué te ayudo? / Tell me, how can I help?',
    "¡Hey! Aquí estoy — ¿qué necesitas? / I'm here — what do you need?",
    '¡Hola! ¿En qué andamos? / What are we working on?',
    "¡Hola! Dale, te escucho. / Go ahead, I'm listening.",
  ],
  fr: [
    "Salut ! Comment je peux t'aider ? / How can I help?",
    "Bonjour ! Qu'est-ce que je peux faire pour toi ? / What can I do for you?",
    "Coucou ! Dis-moi ce qu'il te faut. / Let me know what you need.",
    "Salut ! Je suis prêt — qu'est-ce qu'on fait ? / Ready — what are we working on?",
    "Bonjour ! Qu'est-ce qu'on regarde aujourd'hui ? / What are we looking at today?",
    "Salut ! Vas-y, je t'écoute. / Go ahead, I'm listening.",
    "Coucou ! Qu'est-ce que tu as pour moi ? / What do you have for me?",
    "Bonjour ! Je suis là — de quoi as-tu besoin ? / I'm here — what do you need?",
    "Salut ! Qu'est-ce qui t'amène ? / What brings you here?",
  ],
  pt: [
    'Oi! Como posso ajudar? / How can I help?',
    'E aí! O que você precisa? / What do you need?',
    'Olá! No que posso te ajudar? / What can I help you with?',
    'Oi! Estou pronto — pode mandar! / Ready — fire away!',
    'Oi! Me diz, o que você precisa? / Tell me, what do you need?',
    'E aí! No que estamos trabalhando? / What are we working on?',
    "Olá! Pode falar — estou ouvindo. / Go ahead — I'm listening.",
    'Oi! O que temos pra hoje? / What do we have for today?',
    'E aí! Em que posso ajudar? / How can I help?',
  ],
  hi_in: [
    'Namaste! Kaise madad kar sakta hoon? / How can I help?',
    'Namaste! Bataiye, kya chahiye? / Let me know what you need.',
    "Namaste! Main yahaan hoon — kya karna hai? / I'm here — what do you need?",
    "Namaste! Boliye, main sun raha hoon. / Go ahead, I'm listening.",
    "Namaste! Kya kaam hai aaj? / What's the task today?",
    'Namaste! Bataiye kya help chahiye? / Tell me what help you need.',
    'Namaste! Tayyar hoon — shuru karein? / Ready — shall we start?',
    'Namaste! Aaj kya karna hai? / What are we doing today?',
  ],
  zh: [
    '你好！有什么我能帮你的？/ How can I help?',
    '嗨！需要什么帮助吗？/ What do you need?',
    '你好！我准备好了，请说吧。/ Ready — go ahead!',
    '你好！今天做什么？/ What are we working on today?',
    "嗨！说吧，我在听。/ Go ahead, I'm listening.",
    '你好！有什么任务吗？/ Got a task for me?',
    "嗨！我在这里，需要什么？/ I'm here — what do you need?",
    '你好！告诉我怎么帮你。/ Tell me how I can help.',
  ],
  intl: [
    'Hey! What can I help you with?',
    'Hello! How can I help you today?',
    'Hi there! Let me know what you need.',
    "Hey! I'm ready — what do you need?",
    'Hi! What are you working on?',
    "Hello! Go ahead, I'm listening.",
    'Hey there! Anything I can help with?',
    'Hi! What can I do for you?',
    "Hello! What's on your mind?",
  ],
};

/** Pick a response from the appropriate category pool. */
function pickGreeting(category: GreetingCategory): string {
  const pool = GREETING_RESPONSES[category];
  return pool[Math.floor(Math.random() * pool.length)] ?? pool[0] ?? '';
}

// ============================================================================
// Detection
// ============================================================================

/** Max message length to analyze — longer messages are real conversations. */
const MAX_ANALYZE_LENGTH = 200;

/** Minimum word count to skip exact-match ack check (prevents false positives). */
const ACK_MAX_WORDS = 6;

/**
 * Detect the sentiment of a user message and return the appropriate
 * emoji reaction. Returns null sentiment for messages with no clear signal.
 *
 * @param text  Raw user message text
 * @returns     Sentiment result with emoji and reactOnly flag
 */
export function detectSentiment(text: string): SentimentResult {
  const normalized = text
    .trim()
    .toLowerCase()
    // Strip trailing punctuation clusters like "!!!" or "..."
    .replace(/[.!?]+$/, '')
    .trim();

  if (!normalized || normalized.length > MAX_ANALYZE_LENGTH) {
    return { sentiment: null, emoji: null, reactOnly: false };
  }

  const wordCount = normalized.split(/\s+/).length;

  // ── Greetings (short messages only) ──────────────────────────────────
  // Must be checked before acks — "hey" is a greeting, not an ack.
  const greetingCategory =
    wordCount <= 4 ? GREETING_MAP.get(normalized) : undefined;
  if (greetingCategory) {
    return {
      sentiment: 'greeting',
      emoji: null,
      reactOnly: true,
      cannedResponse: pickGreeting(greetingCategory),
    };
  }

  // ── Stop / cancel (short messages only) ────────────────────────────────
  if (wordCount <= 3 && STOP_EXACT.has(normalized)) {
    return { sentiment: 'stop', emoji: null, reactOnly: true };
  }

  // ── Exact-match acks (short messages only) ────────────────────────────
  if (wordCount <= ACK_MAX_WORDS) {
    // Terminal acks: react with ❤️ and skip agent — clearly conversation-ending
    if (TERMINAL_ACK_EXACT.has(normalized)) {
      return { sentiment: 'ack', emoji: 'heart', reactOnly: true };
    }
    // Soft acks: react with 👍 but still run agent (may be answer to bot question)
    if (SOFT_ACK_EXACT.has(normalized)) {
      return { sentiment: 'ack', emoji: 'thumbsup', reactOnly: false };
    }
  }

  // ── Compliment keywords (substring match) ─────────────────────────────
  // Word-count guard avoids false positives like "not perfect" or
  // "this doesn't look good to me" in longer complaint messages.
  if (
    wordCount <= 10 &&
    COMPLIMENT_KEYWORDS.some((kw) => normalized.includes(kw))
  ) {
    return { sentiment: 'compliment', emoji: 'heart', reactOnly: false };
  }

  // ── Frustration keywords (substring match) ────────────────────────────
  if (FRUSTRATION_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return { sentiment: 'frustration', emoji: 'bow', reactOnly: false };
  }

  return { sentiment: null, emoji: null, reactOnly: false };
}
