-- Obtained AI SDR Engine foundation
-- Adds SDR-specific roles, permissions, tables, RLS policies, and seed personas.

alter table public.client_memberships
  drop constraint if exists client_memberships_role_check;

alter table public.client_memberships
  add constraint client_memberships_role_check
  check (role in ('platform_owner', 'client_admin', 'editor', 'writer', 'reviewer', 'viewer', 'sdr', 'sdr_manager', 'bdm'));

update public.client_memberships cm
set permissions = (
  select jsonb_agg(distinct p)
  from jsonb_array_elements_text(
    coalesce(cm.permissions, '[]'::jsonb)
    || '["use_sdr","manage_sdr","approve_sdr_messages","sync_sdr_hubspot","view_sdr_handovers"]'::jsonb
  ) as p
)
where role in ('platform_owner', 'client_admin');

create or replace function public.can_manage_sdr(target_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.client_memberships cm
    where cm.client_id = target_client_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and (
        cm.role in ('platform_owner', 'client_admin', 'sdr_manager')
        or cm.permissions ? 'manage_sdr'
      )
  );
$$;

create or replace function public.can_use_sdr(target_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.client_memberships cm
    where cm.client_id = target_client_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and (
        cm.role in ('platform_owner', 'client_admin', 'sdr_manager', 'sdr', 'bdm')
        or cm.permissions ? 'use_sdr'
        or cm.permissions ? 'manage_sdr'
      )
  );
$$;

create table if not exists public.ai_sdr_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  vertical text not null,
  persona_type text not null default 'vertical' check (persona_type in ('vertical', 'individual')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  icp_definition text,
  target_job_titles text[] not null default '{}'::text[],
  target_company_types text[] not null default '{}'::text[],
  excluded_audiences text[] not null default '{}'::text[],
  tone_of_voice text,
  qualification_questions jsonb not null default '[]'::jsonb,
  prohibited_claims jsonb not null default '[]'::jsonb,
  handover_rules jsonb not null default '{}'::jsonb,
  hubspot_owner_id text,
  source_preferences jsonb not null default '{}'::jsonb,
  event_focus text[] not null default '{}'::text[],
  operating_mode text not null default 'approval' check (operating_mode in ('copilot', 'approval', 'autonomous')),
  autonomous_enabled boolean not null default false,
  daily_activity_limits jsonb not null default '{"drafts":25,"messages":0}'::jsonb,
  human_approval_triggers jsonb not null default '[]'::jsonb,
  expertise_areas text[] not null default '{}'::text[],
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sdr_audience_segments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  profile_id uuid references public.ai_sdr_profiles(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  vertical text not null,
  geography text[] not null default '{}'::text[],
  company_types text[] not null default '{}'::text[],
  target_titles text[] not null default '{}'::text[],
  buying_signals text[] not null default '{}'::text[],
  source_strategy jsonb not null default '{}'::jsonb,
  outreach_angle text,
  risk_flags jsonb not null default '[]'::jsonb,
  recommended_next_actions jsonb not null default '[]'::jsonb,
  confidence_score integer not null default 0 check (confidence_score between 0 and 100),
  status text not null default 'draft' check (status in ('draft', 'approved', 'active', 'paused', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sdr_companies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  audience_segment_id uuid references public.sdr_audience_segments(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  website text,
  linkedin_url text,
  country text,
  industry text,
  company_type text,
  vertical text,
  likely_service_interest text,
  source text,
  source_url text,
  regulatory_signal text,
  hubspot_company_id text,
  duplicate_status text not null default 'unchecked' check (duplicate_status in ('unchecked', 'unique', 'possible_duplicate', 'duplicate')),
  enrichment_confidence integer not null default 0 check (enrichment_confidence between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sdr_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  company_id uuid references public.sdr_companies(id) on delete set null,
  audience_segment_id uuid references public.sdr_audience_segments(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  full_name text,
  title text,
  company text,
  company_website text,
  linkedin_url text,
  sales_navigator_url text,
  apollo_url text,
  email text,
  country text,
  industry text,
  company_type text,
  relevant_vertical text,
  likely_service_interest text,
  source text,
  event_association text,
  regulatory_signal text,
  hubspot_contact_id text,
  hubspot_company_id text,
  duplicate_status text not null default 'unchecked' check (duplicate_status in ('unchecked', 'unique', 'possible_duplicate', 'duplicate')),
  enrichment_confidence integer not null default 0 check (enrichment_confidence between 0 and 100),
  engagement_status text not null default 'new' check (engagement_status in ('new', 'researched', 'drafted', 'sent', 'engaged', 'qualified', 'disqualified', 'handover')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sdr_lead_scores (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.sdr_leads(id) on delete cascade,
  company_id uuid references public.sdr_companies(id) on delete cascade,
  icp_fit_score integer not null default 0 check (icp_fit_score between 0 and 100),
  vertical_relevance_score integer not null default 0 check (vertical_relevance_score between 0 and 100),
  commercial_potential_score integer not null default 0 check (commercial_potential_score between 0 and 100),
  urgency_score integer not null default 0 check (urgency_score between 0 and 100),
  engagement_score integer not null default 0 check (engagement_score between 0 and 100),
  ai_confidence_score integer not null default 0 check (ai_confidence_score between 0 and 100),
  meeting_readiness_score integer not null default 0 check (meeting_readiness_score between 0 and 100),
  total_lead_score integer not null default 0 check (total_lead_score between 0 and 100),
  rationale text,
  scoring_rules jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sdr_outreach_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  profile_id uuid references public.ai_sdr_profiles(id) on delete set null,
  lead_id uuid references public.sdr_leads(id) on delete cascade,
  company_id uuid references public.sdr_companies(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  channel text not null default 'linkedin' check (channel in ('linkedin', 'email', 'hubspot_task', 'phone', 'other')),
  message_type text not null check (message_type in ('connection', 'first_message', 'follow_up_1', 'follow_up_2', 'event_based', 'referral', 'reactivation', 'reply_suggestion')),
  subject text,
  body text not null,
  reason text,
  confidence_score integer not null default 0 check (confidence_score between 0 and 100),
  risk_flags jsonb not null default '[]'::jsonb,
  approval_required boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'queued_for_approval', 'approved', 'rejected', 'sent', 'archived')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sdr_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.sdr_leads(id) on delete cascade,
  company_id uuid references public.sdr_companies(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  stage text not null default 'new',
  last_message text,
  ai_summary text,
  detected_intent text,
  qualification_progress jsonb not null default '{}'::jsonb,
  missing_qualification_fields text[] not null default '{}'::text[],
  suggested_next_action text,
  human_approval_required boolean not null default false,
  handover_recommended boolean not null default false,
  bdm_handover_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sdr_approval_queue (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  message_id uuid references public.sdr_outreach_messages(id) on delete cascade,
  lead_id uuid references public.sdr_leads(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  approval_reason text not null,
  risk_flags jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'edited', 'sent', 'archived')),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.sdr_hubspot_sync_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.sdr_leads(id) on delete set null,
  company_id uuid references public.sdr_companies(id) on delete set null,
  action text not null,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'skipped')),
  hubspot_contact_id text,
  hubspot_company_id text,
  error_message text,
  payload_summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sdr_handovers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  lead_id uuid references public.sdr_leads(id) on delete set null,
  company_id uuid references public.sdr_companies(id) on delete set null,
  from_user_id uuid references auth.users(id) on delete set null,
  to_user_id uuid references auth.users(id) on delete set null,
  reason text not null,
  summary text,
  status text not null default 'open' check (status in ('open', 'accepted', 'closed', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sdr_audience_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  profile_id uuid references public.ai_sdr_profiles(id) on delete set null,
  audience_segment_id uuid references public.sdr_audience_segments(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  task_type text not null,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed', 'archived')),
  due_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sdr_prohibited_claims (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  vertical text,
  claim text not null,
  severity text not null default 'block' check (severity in ('watch', 'approval_required', 'block')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create index if not exists ai_sdr_profiles_client_idx on public.ai_sdr_profiles (client_id, vertical, status);
create index if not exists sdr_audience_segments_client_idx on public.sdr_audience_segments (client_id, vertical, status);
create index if not exists sdr_leads_owner_idx on public.sdr_leads (client_id, owner_user_id, engagement_status);
create index if not exists sdr_companies_owner_idx on public.sdr_companies (client_id, owner_user_id, vertical);
create index if not exists sdr_outreach_messages_status_idx on public.sdr_outreach_messages (client_id, owner_user_id, status, approval_required);
create index if not exists sdr_approval_queue_status_idx on public.sdr_approval_queue (client_id, status, owner_user_id);

alter table public.ai_sdr_profiles enable row level security;
alter table public.sdr_audience_segments enable row level security;
alter table public.sdr_companies enable row level security;
alter table public.sdr_leads enable row level security;
alter table public.sdr_lead_scores enable row level security;
alter table public.sdr_outreach_messages enable row level security;
alter table public.sdr_conversations enable row level security;
alter table public.sdr_approval_queue enable row level security;
alter table public.sdr_hubspot_sync_logs enable row level security;
alter table public.sdr_handovers enable row level security;
alter table public.sdr_audience_tasks enable row level security;
alter table public.sdr_prohibited_claims enable row level security;

create policy "sdr profiles readable by sdr users" on public.ai_sdr_profiles
  for select using (public.can_use_sdr(client_id));
create policy "sdr profiles manageable by managers" on public.ai_sdr_profiles
  for all using (public.can_manage_sdr(client_id)) with check (public.can_manage_sdr(client_id));

create policy "sdr audiences readable by assigned or managers" on public.sdr_audience_segments
  for select using (public.can_manage_sdr(client_id) or (public.can_use_sdr(client_id) and (owner_user_id is null or owner_user_id = auth.uid() or created_by = auth.uid())));
create policy "sdr audiences writable by users" on public.sdr_audience_segments
  for insert with check (public.can_use_sdr(client_id) and (owner_user_id is null or owner_user_id = auth.uid() or public.can_manage_sdr(client_id)));
create policy "sdr audiences updatable by assigned or managers" on public.sdr_audience_segments
  for update using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid())
  with check (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());

create policy "sdr companies readable by assigned or managers" on public.sdr_companies
  for select using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());
create policy "sdr companies writable by assigned or managers" on public.sdr_companies
  for all using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid())
  with check (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());

create policy "sdr leads readable by assigned or managers" on public.sdr_leads
  for select using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());
create policy "sdr leads writable by assigned or managers" on public.sdr_leads
  for all using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid())
  with check (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());

create policy "sdr score readable by assigned or managers" on public.sdr_lead_scores
  for select using (public.can_manage_sdr(client_id) or created_by = auth.uid());
create policy "sdr score writable by assigned or managers" on public.sdr_lead_scores
  for all using (public.can_manage_sdr(client_id) or created_by = auth.uid())
  with check (public.can_manage_sdr(client_id) or created_by = auth.uid());

create policy "sdr outreach readable by assigned or managers" on public.sdr_outreach_messages
  for select using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());
create policy "sdr outreach writable by assigned or managers" on public.sdr_outreach_messages
  for all using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid())
  with check (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());

create policy "sdr conversations readable by assigned or managers" on public.sdr_conversations
  for select using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());
create policy "sdr conversations writable by assigned or managers" on public.sdr_conversations
  for all using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid())
  with check (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());

create policy "sdr approval readable by assigned or managers" on public.sdr_approval_queue
  for select using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid());
create policy "sdr approval writable by users" on public.sdr_approval_queue
  for all using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid())
  with check (public.can_manage_sdr(client_id) or owner_user_id = auth.uid());

create policy "sdr sync logs readable by assigned or managers" on public.sdr_hubspot_sync_logs
  for select using (public.can_manage_sdr(client_id) or created_by = auth.uid());
create policy "sdr sync logs writable by users" on public.sdr_hubspot_sync_logs
  for insert with check (public.can_use_sdr(client_id));

create policy "sdr handovers readable by involved or managers" on public.sdr_handovers
  for select using (public.can_manage_sdr(client_id) or from_user_id = auth.uid() or to_user_id = auth.uid());
create policy "sdr handovers writable by involved or managers" on public.sdr_handovers
  for all using (public.can_manage_sdr(client_id) or from_user_id = auth.uid() or to_user_id = auth.uid())
  with check (public.can_manage_sdr(client_id) or from_user_id = auth.uid() or to_user_id = auth.uid());

create policy "sdr audience tasks readable by assigned or managers" on public.sdr_audience_tasks
  for select using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());
create policy "sdr audience tasks writable by assigned or managers" on public.sdr_audience_tasks
  for all using (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid())
  with check (public.can_manage_sdr(client_id) or owner_user_id = auth.uid() or created_by = auth.uid());

create policy "sdr prohibited claims readable by sdr users" on public.sdr_prohibited_claims
  for select using (client_id is null or public.can_use_sdr(client_id));
create policy "sdr prohibited claims manageable by managers" on public.sdr_prohibited_claims
  for all using (client_id is null or public.can_manage_sdr(client_id))
  with check (client_id is null or public.can_manage_sdr(client_id));

insert into public.ai_sdr_profiles
  (client_id, name, vertical, persona_type, icp_definition, target_job_titles, target_company_types, excluded_audiences, tone_of_voice, qualification_questions, prohibited_claims, human_approval_triggers, expertise_areas, operating_mode, daily_activity_limits)
select
  c.id,
  seed.name,
  seed.vertical,
  'vertical',
  seed.icp_definition,
  seed.target_job_titles,
  seed.target_company_types,
  seed.excluded_audiences,
  seed.tone_of_voice,
  seed.qualification_questions::jsonb,
  seed.prohibited_claims::jsonb,
  seed.human_approval_triggers::jsonb,
  seed.expertise_areas,
  'approval',
  '{"drafts":25,"messages":0,"connection_requests":0}'::jsonb
from public.clients c
cross join (
  values
  (
    'iGaming Licensing SDR',
    'iGaming licenses',
    'Operators, founders, legal/compliance leaders, and platform owners evaluating regulated iGaming licensing routes, especially where speed, credibility, cost, and banking readiness matter.',
    array['Founder','CEO','COO','General Counsel','Head of Compliance','Head of Legal','Licensing Manager','Commercial Director'],
    array['online casino operator','sportsbook','B2B gaming platform','prediction market','game studio','payment provider serving gaming'],
    array['players','affiliates without operator relationships','job seekers','unlicensed grey-market operators'],
    'Direct, commercially useful, regulatory-aware. Short messages, no hype, no guaranteed outcomes.',
    '["What jurisdiction are they evaluating?","Are they pre-launch or already operating?","Do they need licensing, banking, payments, or all three?","What timeline pressure exists?"]',
    '["guaranteed license approval","guaranteed banking","guaranteed regulator timelines","bypassing AML/KYC or source-of-funds checks"]',
    '["pricing request","legal or regulatory question","guarantee language","banking/payment approval","high-value operator","low AI confidence"]',
    array['Nevis iGaming','Malta/Cyprus comparisons','licensing route selection','operator market entry']
  ),
  (
    'Financial Institutions SDR',
    'Financial Institutions',
    'Founders, compliance leaders, and executives building or expanding EMI, PI, MSB, safeguarding, or regulated payment institution operations.',
    array['Founder','CEO','COO','CFO','General Counsel','Head of Compliance','MLRO','Payments Director'],
    array['EMI','PI','MSB','money remittance','embedded finance provider','fintech platform','payment institution'],
    array['consumers','unregulated investment schemes','job seekers'],
    'Precise, trust-building, compliance-aware. Lead with operational pressure and practical market-entry value.',
    '["Which licence type are they considering?","Which market/jurisdiction matters?","Are they dealing with safeguarding, banking, or compliance readiness?","What is the timeline?"]',
    '["guaranteed EMI approval","guaranteed PI approval","legal advice without approval","guaranteed safeguarding or banking"]',
    '["pricing request","legal/regulatory question","budget mention","banking/safeguarding approval","high-value lead","low AI confidence"]',
    array['EMI','PI','safeguarding','financial institution licensing','regulated fintech']
  )
) as seed(name, vertical, icp_definition, target_job_titles, target_company_types, excluded_audiences, tone_of_voice, qualification_questions, prohibited_claims, human_approval_triggers, expertise_areas)
where c.slug = 'obtained'
  and not exists (
    select 1 from public.ai_sdr_profiles p
    where p.client_id = c.id and p.name = seed.name
  );

insert into public.sdr_prohibited_claims (client_id, vertical, claim, severity)
select c.id, v.vertical, v.claim, v.severity
from public.clients c
cross join (
  values
  ('all','guaranteed license approval','block'),
  ('all','guaranteed banking or PSP approval','block'),
  ('all','guaranteed regulator timelines','block'),
  ('all','ability to bypass AML, KYC, KYB, or source-of-funds checks','block'),
  ('all','legal advice unless specifically approved by an authorized human reviewer','approval_required'),
  ('all','confidential buyer, seller, client, or regulator relationship names without approval','block'),
  ('all','guaranteed acquisition closing or risk-free outcome','block')
) as v(vertical, claim, severity)
where c.slug = 'obtained'
  and not exists (
    select 1 from public.sdr_prohibited_claims pc
    where pc.client_id = c.id and pc.claim = v.claim
  );
