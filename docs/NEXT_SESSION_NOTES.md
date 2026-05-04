# Content Studio Next Session Notes

Date saved: 2026-04-30

## Current State

- The combined release was prepared locally.
- The user uploaded:
  - `index.html`
  - `netlify/functions/config.mjs`
  - `netlify/functions/openai.mjs`
  - `netlify/functions/wordpress.mjs`
  - `docs/AI_MODEL_ROUTING_PLAN.md`
  - `docs/COMBINED_RELEASE_NOTES.md`
- Netlify should deploy from GitHub after each upload/commit.

## Latest Local Update Not Yet Confirmed Uploaded

After GPTZero calibration returned:

`Calibration: human sample 100% AI (AI_ONLY, high), AI-like sample 100% AI (AI_ONLY, high) — review before trusting as hard gate`

`index.html` was updated so GPTZero is not used as a hard blocker when calibration fails. In that case:

- GPTZero is treated as advisory only.
- The pipeline falls back to an internal detector estimate.
- The app logs that GPTZero was skipped as a hard gate due to failed calibration.

Suggested commit message for that specific follow-up:

`Guard GPTZero hard gate when calibration fails`

## Detector Direction

Recommended next detector to evaluate:

1. Copyleaks — implementation added as `/api/copyleaks`
2. Winston AI
3. ZeroGPT only as a light/free comparison signal

Recommended product rule:

- Do not let one detector alone block publishing.
- Use detector consensus:
  - Two high-risk detector results: block/rewrite.
  - Mixed detector results: Needs review.
  - Failed calibration: advisory only.
- Long-term quality gate should combine:
  - AI detection
  - plagiarism/source similarity
  - factual/evidence support
  - compliance sensitivity

## Key Product Decisions Still Open

- Add Copyleaks API or another detector provider.
- Improve research preservation from Add Topic and Daily Brief into Queue.
- Build richer evidence briefs before drafting articles.
- Create client, asset, team, role, and category configuration screens.
- Add asset-specific queues and content pipeline filtering.
- Improve competitor model by vertical/category and add competitor scanning.
- Improve source upload/edit flow, including priority and category assignment.

## Files Currently Changed Locally

- `index.html`
- `netlify/functions/copyleaks.mjs`
- `netlify/functions/config.mjs`
- `netlify/functions/openai.mjs`
- `netlify/functions/wordpress.mjs`
- `docs/AI_MODEL_ROUTING_PLAN.md`
- `docs/COMBINED_RELEASE_NOTES.md`
- `docs/NEXT_SESSION_NOTES.md`

## Suggested First Step Next Session

Confirm what is deployed on Netlify and whether the latest `index.html` with the GPTZero hard-gate guard was uploaded. Then decide whether to integrate Copyleaks as the second detector or first improve the article research/evidence brief flow.

## Copyleaks Integration Added 2026-05-04

- Netlify env vars required:
  - `COPYLEAKS_EMAIL`
  - `COPYLEAKS_API_KEY`
- New function:
  - `netlify/functions/copyleaks.mjs`
- App changes:
  - Copyleaks appears in Settings > Supported integrations.
  - Admins can test the Copyleaks connection.
  - Article AI detection uses Copyleaks first when configured.
  - GPTZero remains available but is secondary/advisory when calibration fails.
  - If Copyleaks is unavailable, the pipeline falls back to GPTZero or the internal estimate.
