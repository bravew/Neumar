export interface DetectionPoint {
  x: number;
  y: number;
  score: number;
}

export function smoothSaliency(
  points: DetectionPoint[],
  smoothing = 0.7,
): DetectionPoint[] {
  const result: DetectionPoint[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (!previous) {
      result.push(point);
      continue;
    }
    result.push({
      x: previous.x * smoothing + point.x * (1 - smoothing),
      y: previous.y * smoothing + point.y * (1 - smoothing),
      score: Math.max(previous.score, point.score),
    });
  }
  return result;
}
