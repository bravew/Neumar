# Third-Party Notices

## Project Inspirations

Neumar's overall shape draws on ideas from these open-source projects. No source was vendored from them; each is credited for the concept area it influenced.

- [WorkAny](https://github.com/workany-ai/workany) (WorkAny Community License) — desktop AI agent workspace shape: streaming task runs, workspace-scoped file access, provider/runtime management.
- [Open Design](https://github.com/nexu-io/open-design) (Apache License 2.0) — Design Mode: project-based artifact creation, prompt templates, critique/preview workflows.
- [OpenCut](https://github.com/OpenCut-app/OpenCut) (MIT License) — Video Mode: timeline editing concepts and render pipeline structure.

## Video Mode References

- `video-use` hard render rules: MIT-licensed reference material. The rules are adapted into `src-api/src/shared/video/pipeline.ts`.
- `Pika-Plugins` tool schema references: Apache 2.0 reference material. Video Mode uses the concept of MCP-exposed media tools; provider calls remain behind configured credentials.
- `auto-subs` transcription-engine: MIT reference for future embedded STT work. Current Phase 6 code keeps a local deterministic transcription fallback until the crate is vendored.
- `flycut-caption`: MIT plus attribution reference for caption editing patterns. Current UI does not vendor its source.
- `IndexTTS`: license-gated optional provider. Keep disabled unless `INDEXTTS_LICENSE_OK` and project-specific permission are confirmed.

Suno and Udio are intentionally excluded from Video Mode integrations. OpenAI Sora/Videos is not offered as a launch provider while its deprecation/shutdown notice remains active.
