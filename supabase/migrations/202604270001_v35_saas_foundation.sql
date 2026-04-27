create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'trial', 'suspended', 'archived')),
  plan text not null default 'internal',
  default_timezone text not null default 'Europe/Nicosia',
  usage_markup numeric(8,4) not null default 1.0000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_memberships (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('platform_owner', 'client_admin', 'editor', 'writer', 'reviewer', 'viewer')),
  permissions jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  unique (client_id, user_id)
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  type text not null check (type in ('hubspot_blog', 'wordpress_site', 'webflow_site', 'linkedin_page', 'instagram_account', 'google_doc', 'custom')),
  name text not null,
  domain text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  name text not null,
  description text,
  publishing_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (asset_id, name)
);

create table if not exists public.tone_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  name text not null,
  description text,
  rules jsonb not null default '{}'::jsonb,
  samples jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  category_id uuid references public.asset_categories(id) on delete cascade,
  name text not null,
  url text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.source_sites (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  name text,
  status text not null default 'active' check (status in ('active', 'blocked', 'pending_review')),
  added_by_client_id uuid references public.clients(id) on delete set null,
  added_by_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.client_source_preferences (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  category_id uuid references public.asset_categories(id) on delete cascade,
  source_site_id uuid not null references public.source_sites(id) on delete cascade,
  weight integer not null default 1,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, asset_id, category_id, source_site_id)
);

create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  name text not null,
  steps jsonb not null default '[]'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete set null,
  category_id uuid references public.asset_categories(id) on delete set null,
  tone_profile_id uuid references public.tone_profiles(id) on delete set null,
  title text not null,
  status text not null default 'draft' check (status in ('topic', 'draft', 'in_review', 'approved', 'published', 'rejected', 'archived', 'error')),
  body_markdown text,
  body_html text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  provider text not null,
  label text not null,
  encrypted_payload text not null,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  model text not null,
  operation text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost numeric(12,6),
  markup_cost numeric(12,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;
alter table public.client_memberships enable row level security;
alter table public.assets enable row level security;
alter table public.asset_categories enable row level security;
alter table public.tone_profiles enable row level security;
alter table public.competitors enable row level security;
alter table public.source_sites enable row level security;
alter table public.client_source_preferences enable row level security;
alter table public.approval_workflows enable row level security;
alter table public.content_items enable row level security;
alter table public.integration_credentials enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.activity_logs enable row level security;

create or replace function public.is_client_member(target_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.client_memberships cm
    where cm.client_id = target_client_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  );
$$;

create policy "members can read own clients" on public.clients
  for select using (public.is_client_member(id));

create policy "members can read memberships in own clients" on public.client_memberships
  for select using (public.is_client_member(client_id));

create policy "members can read assets" on public.assets
  for select using (public.is_client_member(client_id));

create policy "members can read categories" on public.asset_categories
  for select using (public.is_client_member(client_id));

create policy "members can read tone profiles" on public.tone_profiles
  for select using (public.is_client_member(client_id));

create policy "members can read competitors" on public.competitors
  for select using (public.is_client_member(client_id));

create policy "authenticated users can read approved source sites" on public.source_sites
  for select using (auth.role() = 'authenticated' and status = 'active');

create policy "members can read source preferences" on public.client_source_preferences
  for select using (public.is_client_member(client_id));

create policy "members can read workflows" on public.approval_workflows
  for select using (public.is_client_member(client_id));

create policy "members can read content" on public.content_items
  for select using (public.is_client_member(client_id));

create policy "members can read activity logs" on public.activity_logs
  for select using (public.is_client_member(client_id));

insert into public.clients (name, slug, plan)
values ('Obtained', 'obtained', 'internal')
on conflict (slug) do nothing;
