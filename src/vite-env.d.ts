/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_API_PORT?: string;
  readonly VITE_NEUMA_SIDECAR_PATH?: string;
  readonly VITE_NEUMA_CONNECTORS_PLATFORM_V2?: string;
  readonly VITE_SITE_API_BASE_URL?: string;
  readonly VITE_NEUMAR_PREVIEW_BUILD?: string;
  readonly NEUMA_HOTKEY_STRICT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __BUILD_DATE__: string;
