---
summary: "Development and production port assignments for all services"
read_when:
  - Looking up port numbers
  - Debugging connection issues
  - Configuring development environment
title: "Port Reference"
---

# Port Reference

| Port | Environment | Service |
|------|-------------|---------|
| `3420` | Development | Vite dev server (frontend) |
| `1421` | Development | Vite HMR WebSocket |
| `5126` | Development | API server (Node.js) |
| `2620` | Production | API sidecar (native binary) |

## Port Configuration Files

- **Frontend:** `src/config/index.ts`
- **Backend:** `src-api/src/config/constants.ts`

---

*See also: [System Overview](../system/overview.md) · [Build & Deployment](../build/index.md)*
