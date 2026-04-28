# Source Model

## Decisions

- Sources can exist in two layers:
  - platform library: approved defaults available to clients
  - client/asset/category overrides: client-specific sources, exclusions, and priority changes
- User-added sources are submitted as suggestions to the platform library. They can still be used by the client while pending if an editor/admin adds them as a client source.
- Source preferences resolve in this order:
  1. platform defaults
  2. client defaults
  3. asset overrides
  4. category overrides
- Asset-level category settings override client-level category settings.
- Priority values:
  - `primary`
  - `secondary`
  - `watch_only`
  - `exclude`
- Evidence types:
  - `media`
  - `official_regulator`
  - `official_company`
  - `competitor`
  - `internal_client`
  - `community`
  - `data_provider`
- Supported source types are designed for expansion:
  - RSS
  - website pages
  - LinkedIn pages
  - Instagram accounts
  - X/Twitter accounts
  - newsletters
  - PDFs
  - regulator pages
  - Google Alerts
  - custom sources
- Source management is available to admins and editors.

## Daily Brief Behavior

Daily brief generation should run per category to reduce token usage and improve relevance. A user can still request “update all,” but internally that should run category-by-category.

For regulated categories, each category scan should include at least one official/regulatory source when available. If no official source returns items, the brief should show that transparently rather than inventing a regulatory update.

Every generated topic should carry source evidence:

- source name
- source URL
- source headline/title
- date found, when available
- category
- source evidence type
- why the topic matters

## Initial Platform Library

### Fintech

Media:
- Finextra
- PaymentsJournal
- The Paypers

Official/regulatory:
- European Banking Authority
- UK FCA

### CASP/VASP

Official/regulatory:
- European Banking Authority
- ESMA
- UK FCA

Media:
- Finextra
- PaymentsJournal
- The Paypers

### iGaming

Media:
- iGaming Business
- Next.io
- Next.io News
- SBC News
- Yogonet
- CalvinAyre
- GamblingNews.com
- iGaming.org

Official/regulatory:
- GamblingCompliance

### Investment / Funds

Official/regulatory:
- ESMA
- UK FCA

Media:
- Finextra

Still not strong enough. Needs a dedicated funds/investment source set before this category should be considered production-grade.

## Implementation Notes

- The database migration `202604280001_source_model.sql` expands `source_sites` and `client_source_preferences`.
- The Netlify `news-scan` function now supports category-based scans by passing `category` or `categories`.
- The legacy `groups` mode remains for compatibility with the current topic scan UI.
