# Built-in Pet Assets

The built-in pet sprites in this folder are vendored from
`_sample/open-design/assets/community-pets/` and retain the upstream
Apache-2.0 license in `LICENSE.txt`.

Additional built-in pet sprites are vendored from OpenPets Originals:

- `nori`
- `cloud-puff`
- `bitty`
- `raccoon`
- `shadow-kit`
- `azure`
- `bear`
- `penguin`
- `pip-mouse`
- `prickle`
- `planet`
- `fox`
- `robot`
- `patchi`
- `meowbot`
- `dewdrop`
- `budgie-berry`
- `rabbit`

These packages were selected from the OpenPets original gallery rather than
the broader fan-made gallery to avoid third-party character-IP risk. The
OpenPets project license is retained in `LICENSE-OPENPETS.txt`, and each
package keeps its upstream `pet.json` metadata with source URLs.

The Open Design import intentionally excludes `yorha-sit-2b` while we keep
the beta set to assets with lower character-IP risk.

The hatch-pet provider check for Phase 0 is satisfied by the existing
GenAI image generation route and provider registry:

- `apps/web/app/api/genai/image/route.ts`
- `packages/features/agents/src/server/image-generation.ts`
- `packages/features/agents/src/server/image-models.ts`

Those paths already expose Google image models that can request
transparent PNG/WebP output. Phase 5 still needs server-side Sharp
normalization before accepting generated atlases.
