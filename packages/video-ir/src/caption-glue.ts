/**
 * Glued caption words: one spoken word a transcriber split into abutting
 * pieces, such as "Tra" + "nsformer.".
 *
 * Caption data keeps one `words` entry per transcript word, because cutting
 * and correcting match a caption word by its own edges and text. Readers that
 * show words to a viewer (the cue text, the animated caption styles) join a
 * glued run back into one word with the helpers here, so every reader agrees
 * on where a word begins.
 */

export interface CaptionGlueWord {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * A leading soft hyphen marks a continuation glued to the previous piece.
 * Shown text drops the mark. Producers that emit plain word text are
 * recognized from the timing seam instead.
 */
export const CAPTION_GLUE_MARK = '­';

// A vowel, including "y".
const WORD_VOWEL = /[aeiouy]/i;
const LATIN_OR_DIGIT = /[A-Za-z0-9]/;

/** A word's text as it is shown: no glue mark, no surrounding space. */
export function captionWordText(text: string): string {
  return text.replaceAll(CAPTION_GLUE_MARK, '').trim();
}

/**
 * A transcriber-split Latin or digit run. Some producers mark the continuation
 * with a leading glue character. Unmarked producers emit the tail as plain text
 * that cannot begin a word, such as "nsformer", starting exactly where the
 * previous piece ends. An ordinary word with an unusual opening, and a
 * vowelless abbreviation such as "Mr", can stand alone, so abutting timings do
 * not glue it. A zero-duration word is a collapsed timing, not half of a split
 * word, and can share an instant with its neighbour without being glued.
 */
export function captionWordGluedToPrevious(
  previous: CaptionGlueWord,
  next: CaptionGlueWord,
): boolean {
  const previousText = captionWordText(previous.text);
  const nextText = captionWordText(next.text);
  const last = previousText.at(-1);
  const first = nextText[0];
  if (
    last === undefined ||
    first === undefined ||
    !LATIN_OR_DIGIT.test(last) ||
    !LATIN_OR_DIGIT.test(first)
  ) {
    return false;
  }
  if (next.text.startsWith(CAPTION_GLUE_MARK)) return true;
  return (
    cannotStartWord(nextText) &&
    previous.endMs > previous.startMs &&
    next.endMs > next.startMs &&
    next.startMs === previous.endMs
  );
}

/**
 * A tail such as "nsformer": it has a vowel, but its opening cluster cannot
 * begin an English word. A pair that merely looks unusual, such as "xb" in
 * "Xbox", can still begin an ordinary word, so it keeps its space.
 */
function cannotStartWord(token: string): boolean {
  const leading = /^[A-Za-z]+/.exec(token)?.[0] ?? '';
  if (!WORD_VOWEL.test(leading) || leading.length < 2) return false;
  const first = leading[0]!;
  const second = leading[1]!;
  if (WORD_VOWEL.test(first) || WORD_VOWEL.test(second)) return false;
  // A lowercase "n" before another consonant does not open an English word,
  // so this pair is a split tail. Every other unmarked pair keeps its space:
  // "xb" can open "Xbox", and the letters alone cannot prove otherwise. A
  // capitalized token is more likely a word than a tail, so it keeps its space.
  return first === 'n';
}

/** The words as one line of text: spaces between words, none inside a glued run. */
export function joinCaptionWords(words: readonly CaptionGlueWord[]): string {
  return words
    .map((word, index) => {
      const token = captionWordText(word.text);
      if (!token) return '';
      const previous = index > 0 ? words[index - 1] : undefined;
      if (previous && !captionWordGluedToPrevious(previous, word)) {
        return ` ${token}`;
      }
      return token;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The words as a viewer sees them: each glued run becomes one word spanning
 * from its first piece's start to its last piece's end. For display only;
 * stored caption words keep one entry per transcript word.
 */
export function groupGluedCaptionWords(
  words: readonly CaptionGlueWord[],
): CaptionGlueWord[] {
  const grouped: CaptionGlueWord[] = [];
  words.forEach((word, index) => {
    const previous = index > 0 ? words[index - 1] : undefined;
    const last = grouped.at(-1);
    if (previous && last && captionWordGluedToPrevious(previous, word)) {
      last.text = `${captionWordText(last.text)}${captionWordText(word.text)}`;
      last.endMs = Math.max(last.endMs, word.endMs);
      return;
    }
    grouped.push({
      text: word.text,
      startMs: word.startMs,
      endMs: word.endMs,
    });
  });
  return grouped;
}
