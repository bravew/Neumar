export function providerLabel(
  provider: string,
  s: Record<string, string>,
): string {
  switch (provider) {
    case 'immich':
      return s.providerImmich;
    case 'photoprism':
      return s.providerPhotoPrism;
    case 'openverse':
      return s.providerOpenVerse;
    case 'unsplash':
      return s.providerUnsplash;
    case 'pexels':
      return s.providerPexels;
    default:
      return provider;
  }
}
