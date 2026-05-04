# Content Studio Combined Release Notes

Date: 2026-04-30
Release type: Combined update

## Summary

This combined release packages the previously pending Content Studio updates into one upload-ready set. It includes the FinMP-aligned UI refresh, model-routing changes, WordPress server-side publishing support, and the GPTZero calibration/scoring correction.

## Included Updates

### App Design and Workspace UI

- Updated the login screen to use the FinMP Content Studio visual direction.
- Added SaaS-oriented workspace sections for dashboard, assets, team, sources, competitors, and settings.
- Cleaned end-user settings language so platform AI keys are shown as server-side integrations instead of editable browser fields.

### Model Routing

- Added central model-routing behavior for the article pipeline.
- Moved topic scanning toward the GPT-5 mini route with fallback support.
- Routed humanisation and editorial rewrite toward Claude Sonnet.
- Reserved higher-reasoning models for regulated or higher-risk review paths.
- Added clearer internal activity log messages for model route and fallback behavior.

### GPTZero Calibration and AI Detection

- Corrected GPTZero score parsing so the app uses the actual AI probability instead of selecting the highest available probability field.
- Improved calibration samples so the human and AI-like checks are longer and more meaningful.
- Added clearer calibration diagnostics showing score, predicted class, and confidence.
- Kept strict AI-detection blocking behavior in place for now.
- Added Copyleaks as the primary AI detector when `COPYLEAKS_EMAIL` and `COPYLEAKS_API_KEY` are configured in Netlify.
- GPTZero remains secondary/advisory when calibration fails.

### WordPress Publishing

- Added authenticated server-side WordPress proxy support.
- WordPress credentials remain server-side in Netlify environment variables.
- Added WordPress integration status to the settings/config check.
- Added endpoint allow-listing for WordPress posts, tags, and media routes.

### Documentation

- Added the AI model routing plan for review and future SaaS configuration work.
- Added this combined release note so the pending updates can be committed and deployed together.

## Files to Upload

- `index.html`
- `netlify/functions/config.mjs`
- `netlify/functions/openai.mjs`
- `netlify/functions/wordpress.mjs`
- `netlify/functions/copyleaks.mjs`
- `docs/AI_MODEL_ROUTING_PLAN.md`
- `docs/COMBINED_RELEASE_NOTES.md`

## Suggested GitHub Commit Message

`Combined Content Studio UI, model routing, WordPress, and GPTZero update`

## Post-Deploy Checks

1. Log in and confirm the new FinMP login screen appears.
2. Open Settings and confirm OpenAI, Anthropic, GPTZero, and WordPress connection statuses.
3. Run GPTZero calibration and confirm the human sample is meaningfully lower than the AI-like sample.
4. Generate a short test topic and confirm model route logs appear in the pipeline.
5. Create a WordPress draft from a Nevis article and confirm the draft appears in WordPress.
