# Content Studio

Content Studio is moving from an internal single-company app to a hosted SaaS foundation.

## v35 Direction

- Source control: private GitHub repo `https://github.com/Giladgsh/Content-Studio`
- Auth: Supabase Auth
- Database: Supabase Postgres with tenant-scoped tables and RLS
- Deployment: Netlify
- Supabase project: `tkydroxlfsakctqesynr` in EU
- First client: Obtained
- First platform admin: `Gilad@finmp.com`

## Local Project Contents

- `index.html` - current single-file app shell from v34
- `netlify/functions` - server endpoints
- `supabase/migrations` - v35 SaaS foundation schema
- `.env.example` - required Netlify/Supabase environment variables
- `docs/V35_IMPLEMENTATION_PLAN.md` - concrete rollout plan

## Required Environment Variables

Copy `.env.example` into the Netlify environment and fill in:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GPTZERO_API_KEY`

Client-owned publishing credentials should move into Supabase-backed credential storage as the asset model is connected.

Never commit local `.env` files, provider tokens, Supabase service role keys, or client publishing credentials.
