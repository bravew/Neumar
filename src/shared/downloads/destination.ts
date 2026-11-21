/**
 * What the client needs to recognize the download destination question.
 *
 * The question text is fixed by the server and is the key the answer record
 * and the transcript both use, so the card can identify the question without a
 * second field that normalization would drop.
 */
export const DOWNLOAD_DESTINATION_QUESTION =
  'Where should the videos be saved?';
