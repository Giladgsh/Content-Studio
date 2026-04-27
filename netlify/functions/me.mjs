import { json, options, requireClient } from './_supabase.mjs';

function appRole(role) {
  if (role === 'platform_owner' || role === 'client_admin') return 'admin';
  if (role === 'reviewer') return 'editor';
  if (role === 'viewer') return 'writer';
  return role || 'writer';
}

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { body = {}; }

  const auth = await requireClient(req, body);
  if (auth.error) return auth.error;

  const { data: client } = await auth.supabase
    .from('clients')
    .select('id, name, slug, status, plan')
    .eq('id', auth.clientId)
    .maybeSingle();

  return json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.user_metadata?.name || auth.user.email,
      role: appRole(auth.membership.role),
      platformRole: auth.membership.role,
      sites: ['obtained', 'nevis'],
    },
    membership: auth.membership,
    client,
  });
};

export const config = {
  path: '/api/me',
};
