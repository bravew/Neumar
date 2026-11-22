/**
 * What the client needs to recognize the download destination question.
 *
 * The question text is the key the answer record and the transcript both use,
 * so the card can identify the question without a second field that
 * normalization would drop. It comes from the shared package the server also
 * imports, so a server-side edit cannot silently stop the card matching.
 */
export { DOWNLOAD_DESTINATION_QUESTION } from '@neumar/video-ir';
