export interface RuntimeContext {
  timezone?: string;
  locale?: string;
  platform?: { os?: string; version?: string; arch?: string };
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
}
