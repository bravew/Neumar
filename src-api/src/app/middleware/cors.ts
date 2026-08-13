import { cors } from 'hono/cors';

const ALLOWED_ORIGINS = [
  'http://localhost:3420', // Vite dev server
  'http://127.0.0.1:3420', // Vite dev server via IPv4 loopback
  'http://localhost:5173', // Vite fallback
  'http://127.0.0.1:5173', // Vite fallback via IPv4 loopback
  'http://localhost:2620', // Production API
  'http://127.0.0.1:2620', // Production API via IPv4 loopback
  'tauri://localhost', // Tauri webview (macOS)
  'https://tauri.localhost', // Tauri webview (Windows)
  'http://tauri.localhost', // Tauri webview (Linux)
];

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return '*'; // Allow non-browser requests (sidecar)
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    return ''; // Reject unknown origins
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Neuma-Admin-Origin'],
});
