# Content Studio AI Model Routing Plan

Date: 2026-04-29
Status: Proposal for review before implementation

## Purpose

Content Studio currently uses a mixed OpenAI and Claude article pipeline, but recent testing showed two issues:

1. Hosted function timeouts during longer article generation.
2. Article drafts repeatedly failing AI-detection gates, even after several rewrite rounds.

This plan proposes a clearer model-routing architecture for a scalable SaaS product serving clients across regulated and non-regulated industries.

The goal is not simply to pick the strongest model for every step. The goal is to use the right model for each task:

- Fast models for scanning and metadata.
- Strong reasoning models for factual, regulated, and compliance-sensitive review.
- Claude Sonnet for editorial rewrite and humanisation.
- Claude Opus only where its higher cost and deeper reasoning are justified.

## Recommended Pipeline

### 1. Daily Brief Scan

Primary model:

- `gpt-5-mini`

Fallback:

- `gpt-4o-mini`

Role:

- Scan source headlines and source snippets.
- Identify topic candidates per category.
- Group candidates by asset, category, urgency, and source type.
- Keep token and cost usage low.

Reasoning:

Daily brief scanning is high-frequency and does not require the most expensive model. The output should be concise topic intelligence, not final article prose.

### 2. Topic and Angle Shaping

Primary model:

- `gpt-5-mini`

Fallback:

- `claude-sonnet-4-20250514`

Role:

- Convert scanned signals into editorial angles.
- Adapt angle suggestions to the selected tone of voice.
- Suggest why a topic matters commercially, strategically, or from a regulatory perspective.

Reasoning:

OpenAI should handle structured topic planning first. Claude Sonnet can be useful as an editorial fallback when we need more natural framing or alternative angles.

### 3. Evidence and Fact Brief

Primary model:

- Current strongest available GPT-5 flagship model, for example `gpt-5.5` where available.

Fallback:

- `claude-opus-4-1-20250805`

Role:

- Build a fact brief before article drafting.
- Identify source-backed claims.
- Separate verified facts from editorial interpretation.
- Highlight missing evidence.
- Identify regulated claims requiring careful wording.

Reasoning:

This step matters most for fintech, crypto, payments, licensing, iGaming, and other high-sensitivity categories. For these topics, research quality and factual caution are more important than raw speed.

### 4. Full Article Draft

Primary model:

- Current strongest available GPT-5 flagship model, for example `gpt-5.5` where available.

Fallback:

- `gpt-5-mini` for faster/lower-cost generation.
- `claude-sonnet-4-20250514` if OpenAI draft generation fails or times out.

Role:

- Draft a complete article from the fact brief, topic angle, selected tone of voice, source context, category rules, and publishing rules.
- Preserve structure, citations/claims, SEO/AEO goals, and client voice.

Reasoning:

OpenAI should own the first full draft because we want strong structure, source discipline, and consistency with the fact brief. If the request times out, fallback should be visible in the internal activity log.

### 5. Humanisation and Editorial Rewrite

Primary model:

- `claude-sonnet-4-20250514`

Fallback:

- `gpt-5-mini`

Role:

- Rewrite article sections that are too formulaic.
- Improve rhythm, sentence variation, transitions, and editorial judgment.
- Preserve all facts, claims, source-backed details, SEO targets, and compliance-sensitive wording.
- Focus rewrite work on flagged segments rather than rewriting the whole article by default.

Reasoning:

Claude Sonnet should be the main model for humanisation and editorial rewrite. This is where Claude is likely to be most useful in the pipeline. The purpose is not to make content casual or vague, but to make it read like a strong human industry writer.

### 6. AI Detection and Rewrite Loop

Detector:

- GPTZero or equivalent detector configured server-side.

Rewrite model:

- `claude-sonnet-4-20250514`

Fallback rewrite model:

- `gpt-5-mini`

Role:

- Detect high-risk segments.
- Rewrite only flagged sections where possible.
- Re-scan after each rewrite round.
- Stop after the configured number of rounds.
- Move article to "Needs Human Edit" if the threshold is still exceeded.

Recommended behavior:

- Keep the current strict blocker for now.
- If the article fails after five rounds, do not approve or publish.
- Move the article into a visible Human Edit queue.
- Show flagged segments, AI score, and rewrite history.
- Allow a human editor to edit and re-check.

### 7. SEO and AEO Metadata

Primary model:

- `gpt-5-mini`

Fallback:

- `gpt-4o-mini`

Role:

- Generate SEO title.
- Generate meta description.
- Generate slug.
- Generate AEO/answer-engine summary.
- Generate social captions.
- Suggest internal links.

Reasoning:

This is structured output and does not require the most expensive model.

### 8. Compliance and Factual Review Gate

Primary model:

- Current strongest available GPT-5 flagship model, for example `gpt-5.5` where available.

Fallback:

- `claude-opus-4-1-20250805`

Role:

- Review the article for factual risk.
- Review regulated claims.
- Check whether claims are supported by sources.
- Flag language that could be misleading, too promotional, or too absolute.
- Recommend required human/legal review when relevant.

Reasoning:

Claude Opus 4.1 should not be used for routine writing. It should be reserved for regulated review gates or premium/high-risk categories where the higher cost is justified.

### 9. Emergency Fast Fallback

Primary model:

- `gpt-4o-mini`

Fallback:

- `claude-3-5-haiku-20241022`

Role:

- Prevent complete workflow failure for low-risk tasks.
- Generate compact summaries, labels, classifications, or draft placeholders.

Reasoning:

This should not be used for final regulated articles. It is a resilience layer only.

## Proposed SaaS Settings Exposure

The model-routing system should not expose raw model names to normal client users. That would create confusion and make the product feel technical.

Instead, expose model behavior through simple content-quality modes.

### Recommended Client-Facing Modes

#### Standard

For:

- General blogs.
- Non-regulated content.
- Lower-risk marketing content.

Behavior:

- Uses fast/cost-efficient models for scanning, drafting, and metadata.
- Uses standard AI-detection and originality gates.
- Human review optional depending on client workflow.

#### Research-Heavy

For:

- Thought leadership.
- Data-backed posts.
- Competitive analysis.
- Professional services content.

Behavior:

- Requires stronger source grounding.
- Builds a fact brief before drafting.
- Uses stronger model routing for evidence and claim quality.
- More detailed source and claim checks.

#### Regulated / Compliance-Sensitive

For:

- Fintech.
- Crypto.
- Payments.
- Licensing.
- iGaming.
- Financial services.
- Legal/regulatory topics.

Behavior:

- Requires official or primary source inclusion where available.
- Requires evidence brief before drafting.
- Requires compliance/factual review gate.
- Uses strongest review model.
- Blocks publishing if factual/compliance review fails.
- Human approval required before publish.

#### Premium Quality

For:

- Strategic reports.
- Executive publications.
- High-value articles.
- Important client campaigns.

Behavior:

- Uses stronger models across more stages.
- More rewrite/refinement rounds.
- Stronger editorial review.
- Higher cost and slower generation expected.

## Recommended UI/UX

### Where Settings Should Live

Model behavior should be configured in three places:

1. Client-level policy
2. Asset-level override
3. Category-level override

This allows a client to say:

- "All our content is Standard by default."
- "Our payments category is Regulated."
- "Our thought-leadership asset is Premium Quality."

### Client-Level Settings

Screen:

- Admin > Clients > Client Profile > AI & Compliance Policy

Fields:

- Default content mode: Standard / Research-Heavy / Regulated / Premium Quality
- AI detection threshold
- Duplicate/originality threshold
- Human approval required: yes/no
- Compliance approval required: yes/no
- Official source required for regulated topics: yes/no

### Asset-Level Settings

Screen:

- Assets > Asset Profile > Publishing & AI Rules

Fields:

- Override client default mode: yes/no
- Asset content mode
- Publishing destination
- Allowed source library
- Required approval flow
- Tone of voice options

### Category-Level Settings

Screen:

- Categories > Category Profile > Research & Review Rules

Fields:

- Category content mode
- Required source types
- Competitor scan enabled
- Regulated claims sensitivity
- Required fact-check depth
- Human review required

## Internal Activity Log

For now, fallback behavior should appear in the internal activity log.

Examples:

- "OpenAI draft timed out. Retrying with compact OpenAI draft path."
- "OpenAI draft failed. Switching to Claude Sonnet fallback."
- "Claude Sonnet used for editorial humanisation."
- "Regulated review gate escalated to Claude Opus 4.1 fallback."

Later, when client-facing logs are polished, these technical messages can be hidden from client users and shown only to FinMP ops/admin users.

## Implementation Notes

### Immediate Code Changes

1. Create a central model routing object in the app.
2. Replace hardcoded model names across the article pipeline.
3. Update the OpenAI draft path to use the recommended primary/fallback models.
4. Update Claude rewrite path to use Claude Sonnet 4.
5. Reserve Claude Opus 4.1 for regulated review fallback only.
6. Add clear internal activity logs when fallbacks happen.
7. Keep current strict blocker behavior for AI detection.

### Longer-Term Architecture

The current Netlify function flow is still vulnerable to hosted function timeouts during long article generation.

The scalable SaaS architecture should move article generation into background jobs:

- User starts generation.
- Job is created in Supabase.
- Server worker processes each stage.
- UI polls/subscribes to progress.
- Failed stages can be retried.
- Long model calls no longer depend on a single browser request staying open.

This is the proper architecture for multi-stage article generation.

## Open Questions for Claude Review

1. Is the proposed OpenAI/Claude division sensible?
2. Should Claude Sonnet be used only for humanisation, or also as a fallback full-article drafter?
3. Is Opus 4.1 worth reserving for regulated review gates, or should it be avoided unless a client pays for Premium Quality?
4. Should the regulated review gate happen before or after humanisation?
5. Should the article be blocked on AI-detection score alone, or should AI detection be combined with originality, source support, and human review status?
6. How should the product expose model quality without showing raw model names to client users?
7. Is the proposed background job architecture the right next infrastructure step?

## Proposed Decision

Proceed with this model-routing strategy:

- OpenAI GPT-5 family for research, fact brief, structure, compliance, SEO/AEO.
- Claude Sonnet 4 for humanisation and editorial rewrite.
- Claude Opus 4.1 only for regulated/high-risk review gates.
- GPT-4o-mini or Claude Haiku only as emergency fallback for low-risk utility work.
- Expose client-facing controls as quality/compliance modes, not model names.
- Show technical fallback logs internally for now.

