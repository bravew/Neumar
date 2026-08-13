# AGENTS.md

Frontend module map for DesignMode critique.

- `CritiqueTheaterMount.tsx` owns rollout gating and the stream subscription. At `M0`, keep the UI hidden while allowing dark-launch subscription unless `VITE_DESIGNMODE_CRITIQUE_DARK_LAUNCH=0`.
- `critique-reducer.ts` is the pure state machine for panel events. Preserve sticky terminal states and run-id guards.
- `use-critique-stream.ts` and `use-critique-replay.ts` feed the same reducer contract.
- `use-critique-rollout.ts` reads and mutates rollout state through `/design/critique/rollout*` routes. Revalidate after mutations; do not use optimistic promotion state.
- `theater/` contains presentation components. All user-visible strings must resolve through `useLanguage()` across `en`, `zh`, `es`, `fr`, `hi`, and `pt`.

Validation:

```bash
pnpm test -- src/__tests__/CritiqueTheaterMount.test.tsx src/__tests__/use-critique-stream.test.tsx
npx oxfmt src/components/design/critique/*.tsx
```
