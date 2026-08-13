export function loadImageSource(
  cache: Map<string, Promise<HTMLImageElement>>,
  src: string,
): Promise<HTMLImageElement> {
  const cached = cache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image decode failed: ${src}`));
    image.src = src;
  }).catch((error) => {
    if (cache.get(src) === promise) cache.delete(src);
    throw error;
  });
  cache.set(src, promise);
  return promise;
}

export function copyDecodedCanvas(
  source: HTMLCanvasElement | OffscreenCanvas,
): HTMLCanvasElement {
  const canvas = window.document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D unavailable');
  ctx.drawImage(source, 0, 0);
  return canvas;
}
