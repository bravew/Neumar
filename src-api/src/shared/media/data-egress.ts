export const MEDIA_DATA_EGRESS = ['local', 'cloud'] as const;

export type MediaDataEgress = (typeof MEDIA_DATA_EGRESS)[number];
