-- Run this after creating/inviting Gilad@finmp.com in Supabase Auth.
-- Replace the UUID below with the user id from Authentication > Users.

insert into public.client_memberships (client_id, user_id, role, permissions)
select
  c.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'platform_owner',
  '[
    "manage_clients",
    "manage_users",
    "manage_assets",
    "manage_credentials",
    "manage_billing",
    "manage_competitors",
    "manage_sources",
    "manage_tone_profiles",
    "generate_content",
    "approve_content",
    "publish_content"
  ]'::jsonb
from public.clients c
where c.slug = 'obtained'
on conflict (client_id, user_id) do update
set role = excluded.role,
    permissions = excluded.permissions,
    status = 'active';
