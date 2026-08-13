import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import svgr from 'vite-plugin-svgr';

import fs from 'fs';
import fsPromises from 'fs/promises';
import { createRequire } from 'node:module';
import path from 'path';

const require = createRequire(import.meta.url);
const pdfjsDistPath = path.dirname(require.resolve('pdfjs-dist/package.json'));
const cMapsDir = normalizePath(path.join(pdfjsDistPath, 'cmaps'));
const workerFile = normalizePath(
  path.join(pdfjsDistPath, 'build/pdf.worker.min.mjs'),
);

const host = process.env.TAURI_DEV_HOST;

// Disable PWA for Tauri builds — service workers conflict with the webview shell
const isTauriBuild = Boolean(process.env.TAURI_ENV_TARGET_TRIPLE);

// Generate build date in YYYY.MM.DD format
const buildDate = new Date().toISOString().slice(0, 10).replace(/-/g, '.');

// Load branding config from the single source of truth
const branding = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'branding.json'), 'utf-8'),
);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    svgr({
      include: '**/*.svg?react',
    }),
    tailwindcss(),
    // Copy pdfjs-dist assets directly instead of vite-plugin-static-copy which
    // leaks pnpm symlink paths (node_modules/) into dist/, breaking Tauri builds.
    {
      name: 'copy-pdfjs-assets',
      async writeBundle() {
        const outDir = path.resolve(__dirname, 'dist');
        const cmapsDest = path.join(outDir, 'cmaps');
        const buildDest = path.join(outDir, 'build');
        await fsPromises.mkdir(cmapsDest, { recursive: true });
        await fsPromises.mkdir(buildDest, { recursive: true });
        const files = await fsPromises.readdir(cMapsDir);
        await Promise.all(
          files.map((f) =>
            fsPromises.copyFile(
              path.join(cMapsDir, f),
              path.join(cmapsDest, f),
            ),
          ),
        );
        await fsPromises.copyFile(
          workerFile,
          path.join(buildDest, 'pdf.worker.min.mjs'),
        );
      },
    },
    VitePWA({
      injectRegister: isTauriBuild ? false : 'auto',
      selfDestroying: isTauriBuild,
      registerType: 'autoUpdate',
      manifest: {
        name: branding.displayName,
        short_name: branding.displayName,
        description: branding.description,
        theme_color: '#3d1a00',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /localhost:\d+\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: /\.(?:js|css|woff2?)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'asset-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],

  // Exclude sample skills from dependency scanning
  optimizeDeps: {
    exclude: ['simli-client', 'three', 'pdfjs-dist'],
    entries: ['src/**/*.{ts,tsx}'],
  },

  define: {
    __BUILD_DATE__: JSON.stringify(buildDate),
    __BRANDING__: JSON.stringify(branding),
    // @ag-ui/client@0.0.49+ references process.env in browser code
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV ?? 'development',
    ),
    'process.env.SUPPRESS_TRANSFORMATION_WARNINGS': JSON.stringify(''),
    'process.env.VITEST_WORKER_ID': JSON.stringify(''),
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 3420,
    strictPort: true,
    // Bind IPv4 localhost explicitly. Without this, Vite/Node 17+ listen only on
    // IPv6 [::1], and browsers that resolve `localhost` -> 127.0.0.1 get ERR_CONNECTION_REFUSED.
    host: host || '127.0.0.1',
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: [
        '**/src-tauri/**',
        '**/src-site/**',
        '**/src-api/**',
        '**/doc/**',
        '**/doc-dev/**',
        '**/branding/**',
        '**/scripts/**',
        '**/skills/**',
        '**/dist/**',
        '**/_sample/**',
        '**/*.md',
      ],
    },
  },

  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 750,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('react-dom') ||
              id.includes('react-router-dom') ||
              id.match(/\/react\//) ||
              id.includes('@radix-ui')
            ) {
              return 'vendor-react';
            }
            if (
              id.includes('react-markdown') ||
              id.includes('react-syntax-highlighter') ||
              id.includes('remark-gfm')
            ) {
              return 'vendor-markdown';
            }
          }
        },
      },
    },
  },
}));
