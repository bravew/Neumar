# Desktop content security policy review

Issue [#207](https://github.com/bravew/Neumar/issues/207). Reviewed against `1bb20406` on 2026-10-14. Status is proposal pending desktop compatibility evidence and maintainer decision. No application configuration or capability has changed.

## Proposed decision

Stage a production CSP in a separate configuration override first. Require a local desktop smoke run before replacing `app.security.csp: null` in [tauri.conf.json](../../src-tauri/tauri.conf.json). Keep the development policy separate so Vite hot reload does not widen production permissions. Do not grant remote OAuth windows application capabilities.

A strict parent policy can also restrict `srcdoc` documents. Generated HTML currently executes inline scripts in sandboxed frames, and trusted video overlays use inline seek shims. A nonce for bundled application scripts does not automatically authorize those generated scripts. Adopting `script-src 'self'` today could break previews. Adding `unsafe-inline` to the parent would also authorize inline injection in the application. Establish an isolated preview origin or a verified per-frame nonce propagation contract before choosing between these policies.

## Current resource and permission inventory

| Surface | Evidence | Policy requirement and verification |
| --- | --- | --- |
| Desktop application and development shell | [tauri.conf.json](../../src-tauri/tauri.conf.json), [API config](../../src/config/index.ts) | Bundled scripts and styles plus Tauri IPC. HTTP API on localhost port 2620 in production and 5126 during development, Vite on 3420 during development. Confirm IPv4 and IPv6 plus HMR WebSockets in the actual WebView. |
| Design and generated artifact previews | [iframe sandbox](../../src/components/artifacts/live/iframe-sandbox.ts), [HTML frame wrapper](../../src/components/artifacts/live/html-frame-srcdoc.ts) | Opaque-origin sandboxed HTML permits inline scripts and remote image, font, and media resources, and blocks network connections in its own CSP. Verify inherited parent policy, download controls, inspection messages, and frame identity checks. |
| Video overlay previews | [sandbox host](../../src/shared/video/overlays/html/sandboxHost.ts) | Built-in overlays allow scripts and same origin. Plugin overlays allow scripts with an opaque origin. Verify the inline seek shim, readiness, fonts, and seek acknowledgements under the candidate policy. |
| File and captured media | [video capture](../../src/shared/lib/video-capture.ts), [media loader](../../src/components/artifacts/media-loader.ts) | Tauri asset protocol plus blob and data media and authorized filesystem reads. Do not broaden filesystem roots merely to make a policy work. |
| Audio waveform worker | [waveform cache](../../src/components/video/timeline/waveformCache.ts) | Worker source and worker loading after bundling. Test the production worker URL and cancellation. |
| External embeds | [link previews](../../src/components/video/ExternalLinkPreviews.tsx) | Inventory supported HTTPS embed providers before allowing frame sources. A blanket HTTPS frame allowance is an interim compatibility choice, not a demonstrated minimum. |
| OAuth windows | [OAuth window helper](../../src/shared/lib/open-oauth-window.ts) | Separate remote WebviewWindow with a system-browser fallback. Main-window creation permission is live. Preserve the absence of a remote capability allowlist and test redirect completion plus popup closure. |
| Desktop settings database | [settings store](../../src/shared/db/settings.ts) | SQL permissions remain live for desktop settings even though the primary application database goes through the API. Do not delete SQL capabilities based only on the API-backed database abstraction. |
| Secret storage and filesystem | [stronghold helper](../../src/shared/lib/stronghold.ts), [attachments](../../src/shared/lib/attachments.ts), [default capability](../../src-tauri/capabilities/default.json) | Stronghold, filesystem, dialog, keychain, and scoped opener permissions have live consumers. Permission removal needs per-command traces and desktop tests. |
| Configuration generation | [brand sync](../../scripts/brand-sync.js) | Brand sync preserves the CSP while rewriting product identity, and it updates filesystem and sidecar scopes. Verify brand sync does not restore removed permissions or widen the policy. |

## Candidate production directives

This is a review candidate, not an enabled configuration. Tauri adds hashes and nonces for bundled assets. Exact source lists still require the smoke matrix below.

```text
default-src 'self' customprotocol: asset:;
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' ipc: http://ipc.localhost http://localhost:2620;
img-src 'self' asset: http://asset.localhost blob: data: https:;
media-src 'self' asset: http://asset.localhost blob: data: https:;
font-src 'self' data: https:;
worker-src 'self' blob:;
frame-src 'self' blob: https: http://localhost:* http://127.0.0.1:*;
object-src 'none';
base-uri 'self';
form-action 'none';
```

`script-src` deliberately has no inline or eval allowance. Generated inline previews therefore need an explicit solution before enabling this policy. Loopback frame wildcards cover dynamically allocated local preview servers, so remove them only after enumerating preview ports and origins. HTTPS resource wildcards require provider inventory before narrowing. Do not claim this list is the final minimum.

The development override would additionally allow `http://localhost:5126`, `http://localhost:3420`, and the Vite loopback WebSocket origin as connection sources. Remote WebUI is served by its own HTTP host, and the Tauri production policy does not govern that browser page.

## Capability diff proposal

Keep the main capability restricted to the `main` window. Preserve the separate video-capture, pet-overlay, and teleprompter window capabilities. Keep remote origins excluded. No capability is removed in this review because current source shows live SQL, filesystem, secret storage, OAuth window, and sidecar consumers. The subsequent narrowing change must list each removed command, its previous callers, and a passing desktop scenario. Absence of a static import is insufficient proof for dynamically loaded commands.

## Smoke matrix and acceptance

- Launch a production-style desktop build with isolated application data and the staged CSP, then check console policy violations and native command failures.
- Send a chat message, open a file attachment, save and reload desktop settings, and exercise secret storage without displaying credentials.
- Open generated design HTML with inline interaction, inspect and select an element, and exercise an intentional preview download.
- Render a built-in and a plugin HTML overlay, seek, and confirm readiness and seek acknowledgement, media, and fonts.
- Open a supported external embed and a local preview server on an allocated loopback port.
- Complete OAuth through the popup and the system-browser fallback, then verify a remote window cannot invoke application commands.
- Exercise capture, teleprompter, and pet windows without adding them to the main capability.
- Repeat the preview and chat scenarios under the development override with HMR.

Source inspection is complete. No desktop smoke was performed in this review. Cargo compilation does not prove WebView CSP compatibility. The existing `csp: null` finding remains open until the maintainer selects the preview-isolation contract and the candidate passes this matrix. A documentation PR alone must not close issue #207.

Official guidance checked on 2026-10-14: [Tauri CSP](https://v2.tauri.app/security/csp/) and [Tauri capabilities](https://v2.tauri.app/security/capabilities/).
