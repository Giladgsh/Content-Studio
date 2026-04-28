-- Source model foundation
-- Platform library + client/asset/category overrides.

alter table public.source_sites
  add column if not exists source_type text not null default 'website'
    check (source_type in ('rss', 'website', 'linkedin_page', 'instagram_account', 'x_account', 'newsletter', 'pdf', 'regulator_page', 'google_alert', 'custom')),
  add column if not exists evidence_type text not null default 'media'
    check (evidence_type in ('media', 'official_regulator', 'official_company', 'competitor', 'internal_client', 'community', 'data_provider')),
  add column if not exists library_scope text not null default 'platform'
    check (library_scope in ('platform', 'client_suggested', 'client_private')),
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('approved', 'pending_review', 'rejected', 'blocked')),
  add column if not exists default_categories text[] not null default '{}'::text[],
  add column if not exists default_asset_types text[] not null default '{}'::text[],
  add column if not exists priority text not null default 'secondary'
    check (priority in ('primary', 'secondary', 'watch_only', 'exclude')),
  add column if not exists credibility_tier integer not null default 2
    check (credibility_tier between 1 and 5),
  add column if not exists last_checked_at timestamptz;

alter table public.client_source_preferences
  add column if not exists priority text not null default 'secondary'
    check (priority in ('primary', 'secondary', 'watch_only', 'exclude')),
  add column if not exists evidence_required boolean not null default false,
  add column if not exists suggested_for_platform boolean not null default false,
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists source_sites_default_categories_idx
  on public.source_sites using gin (default_categories);

create index if not exists source_sites_approval_status_idx
  on public.source_sites (approval_status, library_scope, status);

create index if not exists client_source_preferences_scope_idx
  on public.client_source_preferences (client_id, asset_id, category_id, priority, enabled);

create or replace function public.can_manage_client_sources(target_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.client_memberships cm
    where cm.client_id = target_client_id
      and cm.user_id = auth.uid()
      and cm.status = 'active'
      and (
        cm.role in ('platform_owner', 'client_admin', 'editor')
        or cm.permissions ? 'manage_sources'
      )
  );
$$;

drop policy if exists "authenticated users can read approved source sites" on public.source_sites;
create policy "authenticated users can read approved platform source sites" on public.source_sites
  for select using (
    auth.role() = 'authenticated'
    and status = 'active'
    and approval_status = 'approved'
    and library_scope = 'platform'
  );

drop policy if exists "members can read client source sites" on public.source_sites;
create policy "members can read client source sites" on public.source_sites
  for select using (
    added_by_client_id is not null
    and public.is_client_member(added_by_client_id)
    and approval_status in ('approved', 'pending_review')
    and status <> 'blocked'
  );

drop policy if exists "members can write source preferences" on public.client_source_preferences;
create policy "members can write source preferences" on public.client_source_preferences
  for all using (public.can_manage_client_sources(client_id))
  with check (public.can_manage_client_sources(client_id));

drop policy if exists "editors can suggest source sites" on public.source_sites;
create policy "editors can suggest source sites" on public.source_sites
  for insert with check (
    auth.role() = 'authenticated'
    and added_by_client_id is not null
    and public.can_manage_client_sources(added_by_client_id)
    and library_scope in ('client_suggested', 'client_private')
    and approval_status in ('pending_review', 'approved')
  );

drop policy if exists "suggesters can update their pending sources" on public.source_sites;
create policy "suggesters can update their pending sources" on public.source_sites
  for update using (
    added_by_user_id = auth.uid()
    and library_scope in ('client_suggested', 'client_private')
    and approval_status = 'pending_review'
  )
  with check (
    added_by_user_id = auth.uid()
    and library_scope in ('client_suggested', 'client_private')
    and approval_status = 'pending_review'
  );

-- Platform seed sources. These are safe public URLs, not credentials.
insert into public.source_sites
  (url, name, status, source_type, evidence_type, library_scope, approval_status, default_categories, default_asset_types, priority, credibility_tier, metadata)
values
  ('https://www.finextra.com/rss/headlines.aspx', 'Finextra', 'active', 'rss', 'media', 'platform', 'approved', array['Fintech'], array['hubspot_blog','wordpress_site'], 'primary', 2, '{"group":"fintech"}'::jsonb),
  ('https://www.paymentsjournal.com/feed/', 'PaymentsJournal', 'active', 'rss', 'media', 'platform', 'approved', array['Fintech'], array['hubspot_blog','wordpress_site'], 'secondary', 2, '{"group":"fintech"}'::jsonb),
  ('https://thepaypers.com/rss', 'The Paypers', 'active', 'rss', 'media', 'platform', 'approved', array['Fintech'], array['hubspot_blog','wordpress_site'], 'primary', 2, '{"group":"fintech"}'::jsonb),
  ('https://www.eba.europa.eu/rss.xml', 'European Banking Authority', 'active', 'rss', 'official_regulator', 'platform', 'approved', array['CASP/VASP','Fintech'], array['hubspot_blog','wordpress_site'], 'primary', 1, '{"group":"official_regulation"}'::jsonb),
  ('https://www.esma.europa.eu/rss.xml', 'ESMA', 'active', 'rss', 'official_regulator', 'platform', 'approved', array['CASP/VASP','Investment'], array['hubspot_blog','wordpress_site'], 'primary', 1, '{"group":"official_regulation"}'::jsonb),
  ('https://www.fca.org.uk/news/rss.xml', 'UK FCA', 'active', 'rss', 'official_regulator', 'platform', 'approved', array['Fintech','CASP/VASP','Investment'], array['hubspot_blog','wordpress_site'], 'primary', 1, '{"group":"official_regulation"}'::jsonb),
  ('https://www.igamingbusiness.com/feed/', 'iGaming Business (IGB)', 'active', 'rss', 'media', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'primary', 2, '{"group":"igaming"}'::jsonb),
  ('https://next.io/feed/', 'Next.io', 'active', 'rss', 'media', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'primary', 2, '{"group":"igaming"}'::jsonb),
  ('https://next.io/news/', 'Next.io News', 'active', 'website', 'media', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'secondary', 2, '{"group":"igaming"}'::jsonb),
  ('https://www.sbcnews.co.uk/feed/', 'SBC News', 'active', 'rss', 'media', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'primary', 2, '{"group":"igaming"}'::jsonb),
  ('https://www.yogonet.com/international/rss/last_news', 'Yogonet', 'active', 'rss', 'media', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'secondary', 2, '{"group":"igaming"}'::jsonb),
  ('https://calvinayre.com/feed/', 'CalvinAyre', 'active', 'rss', 'media', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'secondary', 3, '{"group":"igaming"}'::jsonb),
  ('https://www.gamblingnews.com/feed/', 'GamblingNews.com', 'active', 'rss', 'media', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'secondary', 3, '{"group":"igaming"}'::jsonb),
  ('https://igaming.org/news/feed/', 'iGaming.org', 'active', 'rss', 'media', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'secondary', 3, '{"group":"igaming"}'::jsonb),
  ('https://gamblingcompliance.com/feed', 'GamblingCompliance', 'active', 'rss', 'official_regulator', 'platform', 'approved', array['iGaming'], array['hubspot_blog','wordpress_site'], 'primary', 1, '{"group":"official_regulation"}'::jsonb),
  ('https://obtained.com/blog/feed/', 'Obtained.com Blog', 'active', 'rss', 'internal_client', 'platform', 'approved', array['Fintech','CASP/VASP','iGaming','Investment'], array['hubspot_blog'], 'watch_only', 1, '{"group":"internal"}'::jsonb),
  ('https://obtained.com/feed/', 'Obtained.com Blog (alt)', 'active', 'rss', 'internal_client', 'platform', 'approved', array['Fintech','CASP/VASP','iGaming','Investment'], array['hubspot_blog'], 'watch_only', 1, '{"group":"internal"}'::jsonb)
on conflict (url) do update set
  name = excluded.name,
  source_type = excluded.source_type,
  evidence_type = excluded.evidence_type,
  library_scope = excluded.library_scope,
  approval_status = excluded.approval_status,
  default_categories = excluded.default_categories,
  default_asset_types = excluded.default_asset_types,
  priority = excluded.priority,
  credibility_tier = excluded.credibility_tier,
  metadata = public.source_sites.metadata || excluded.metadata;
