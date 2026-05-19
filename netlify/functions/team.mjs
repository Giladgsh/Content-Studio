import { json, options, requireClient } from './_supabase.mjs';

function appRole(role) {
  if (role === 'platform_owner' || role === 'client_admin') return 'admin';
  if (role === 'reviewer') return 'editor';
  if (role === 'viewer') return 'writer';
  if (role === 'sdr_manager') return 'sdr_manager';
  if (role === 'sdr') return 'sdr';
  if (role === 'bdm') return 'bdm';
  return role || 'writer';
}

function platformRole(role) {
  if (role === 'admin') return 'client_admin';
  if (role === 'editor') return 'editor';
  if (role === 'writer') return 'writer';
  if (role === 'sdr_manager') return 'sdr_manager';
  if (role === 'sdr') return 'sdr';
  if (role === 'bdm') return 'bdm';
  return role || 'writer';
}

function defaultPermissions(role) {
  if (role === 'platform_owner' || role === 'client_admin') {
    return ['manage_users', 'manage_assets', 'manage_credentials', 'manage_competitors', 'manage_sources', 'manage_tone_profiles', 'generate_content', 'approve_content', 'publish_content', 'use_sdr', 'manage_sdr', 'approve_sdr_messages', 'sync_sdr_hubspot', 'view_sdr_handovers'];
  }
  if (role === 'editor') return ['manage_sources', 'generate_content', 'approve_content', 'publish_content'];
  if (role === 'writer') return ['generate_content'];
  if (role === 'reviewer') return ['approve_content'];
  if (role === 'sdr_manager') return ['use_sdr', 'manage_sdr', 'approve_sdr_messages', 'sync_sdr_hubspot'];
  if (role === 'sdr') return ['use_sdr'];
  if (role === 'bdm') return ['use_sdr', 'view_sdr_handovers'];
  return [];
}

async function authUsersById(supabase, ids) {
  const out = new Map();
  let page = 1;
  while (ids.length && page < 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) break;
    for (const user of data?.users || []) {
      if (ids.includes(user.id)) out.set(user.id, user);
    }
    if (!data?.users?.length || out.size >= ids.length) break;
    page += 1;
  }
  return out;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { body = {}; }

  const action = body.action || 'getUsers';
  const needsManage = action !== 'getUsers';
  const auth = await requireClient(req, body, needsManage ? 'manage_users' : null);
  if (auth.error) return auth.error;

  if (action === 'getUsers') {
    const { data, error } = await auth.supabase
      .from('client_memberships')
      .select('user_id, role, permissions, status, created_at')
      .eq('client_id', auth.clientId)
      .order('created_at', { ascending: true });
    if (error) return json({ error: error.message }, 500);

    const ids = (data || []).map(m => m.user_id);
    const usersById = await authUsersById(auth.supabase, ids);
    const users = (data || []).map(m => {
      const u = usersById.get(m.user_id);
      return {
        id: m.user_id,
        name: u?.user_metadata?.name || u?.email || 'Team member',
        email: u?.email || '',
        role: appRole(m.role),
        platformRole: m.role,
        active: m.status === 'active',
        sites: ['obtained', 'nevis'],
      };
    });
    return json({ ok: true, users });
  }

  if (action === 'createUser') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const role = platformRole(body.role);
    if (!email || !email.includes('@')) return json({ error: 'Valid email is required' }, 400);
    if (!password || password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
    if (!name) return json({ error: 'Name is required' }, 400);

    const created = await auth.supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (created.error) return json({ error: created.error.message }, 400);

    const { error } = await auth.supabase.from('client_memberships').upsert({
      client_id: auth.clientId,
      user_id: created.data.user.id,
      role,
      permissions: defaultPermissions(role),
      status: 'active',
    }, { onConflict: 'client_id,user_id' });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, userId: created.data.user.id });
  }

  if (action === 'updateUser') {
    const userId = body.userId;
    const updates = body.updates || {};
    if (!userId) return json({ error: 'userId required' }, 400);
    const membershipPatch = {};
    const authPatch = {};
    if (updates.role) {
      membershipPatch.role = platformRole(updates.role);
      membershipPatch.permissions = defaultPermissions(membershipPatch.role);
    }
    if (typeof updates.active === 'boolean') membershipPatch.status = updates.active ? 'active' : 'disabled';
    if (updates.email) authPatch.email = String(updates.email).trim().toLowerCase();
    if (updates.name) authPatch.user_metadata = { name: String(updates.name).trim() };

    if (Object.keys(authPatch).length) {
      const { error } = await auth.supabase.auth.admin.updateUserById(userId, authPatch);
      if (error) return json({ error: error.message }, 400);
    }
    if (Object.keys(membershipPatch).length) {
      const { error } = await auth.supabase
        .from('client_memberships')
        .update(membershipPatch)
        .eq('client_id', auth.clientId)
        .eq('user_id', userId);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true });
  }

  if (action === 'resetPassword') {
    if (!body.userId || !body.newPassword || String(body.newPassword).length < 6) {
      return json({ error: 'userId and a 6+ character password are required' }, 400);
    }
    const { error } = await auth.supabase.auth.admin.updateUserById(body.userId, { password: String(body.newPassword) });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === 'deleteUser') {
    if (!body.userId) return json({ error: 'userId required' }, 400);
    const { error } = await auth.supabase
      .from('client_memberships')
      .update({ status: 'disabled' })
      .eq('client_id', auth.clientId)
      .eq('user_id', body.userId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action: ' + action }, 400);
};

export const config = {
  path: '/api/team',
};
