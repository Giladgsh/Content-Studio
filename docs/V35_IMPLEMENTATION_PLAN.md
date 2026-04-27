# v35 Supabase Foundation Plan

## Product Decisions

- Repo: `https://github.com/Giladgsh/Content-Studio`
- Supabase project: `tkydroxlfsakctqesynr` in an EU region
- Auth: Supabase Auth replaces the custom users/session backend
- Deployment: Netlify remains the deploy target
- Initial platform admin: `Gilad@finmp.com`
- App name: Content Studio

## Phase 1 - Security Stabilization

- Remove unauthenticated admin reset endpoint.
- Stop rewriting the admin password on every server invocation.
- Require authenticated Supabase sessions before using platform AI keys.
- Use SaaS-owned OpenAI/Anthropic/GPTZero keys from Netlify env vars only.
- Redact sensitive settings for non-admin users.

## Phase 2 - Supabase Schema

Create the foundation tables:

- `clients`
- `client_memberships`
- `assets`
- `asset_categories`
- `tone_profiles`
- `competitors`
- `source_sites`
- `client_source_preferences`
- `approval_workflows`
- `content_items`
- `integration_credentials`
- `ai_usage_events`
- `activity_logs`

Every tenant-owned row includes `client_id`.

## Phase 3 - Auth Migration

- Open the Supabase SQL editor for project `tkydroxlfsakctqesynr`.
- Apply the SQL migration in `supabase/migrations`.
- Create/invite `Gilad@finmp.com` in Supabase Auth.
- Add a `client_memberships` row that links Gilad to the `obtained` client as `platform_owner`.
- Replace the old frontend login with Supabase Auth sign-in/session handling.
- Send the Supabase access token to Netlify functions in the `Authorization: Bearer <token>` header.

Do not paste service role keys, provider API keys, or access tokens into chat or commit them to GitHub.

## Phase 4 - Asset Model

Model current publishing targets as assets:

- Obtained HubSpot Blog
- Nevis WordPress Blog

Then move per-asset settings into Supabase:

- content categories
- competitors
- tone profiles
- publishing rules
- approval workflow
- client-owned integration credentials

## Phase 5 - Usage and Billing Foundation

- Log every platform AI call in `ai_usage_events`.
- Include `client_id`, `user_id`, provider, model, operation, and token counts.
- Add cost calculation later once model pricing is finalized.

## Deferred From v35

- Stripe billing
- SSO/SAML
- configurable workflow builder
- LinkedIn/Instagram/Webflow publishing
- full white-label theming
- multi-client platform admin dashboard

These should come after the v35 foundation is deployed and stable.
