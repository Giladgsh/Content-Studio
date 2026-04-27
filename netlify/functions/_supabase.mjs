import { createClient } from '@supabase/supabase-js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

export function options() {
  return new Response(null, { status: 204, headers: CORS });
}

export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function bearerToken(req, body = {}) {
  const header = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : (body.access_token || body.supabaseToken || body.token || '');
}

export async function requireUser(req, body = {}) {
  const token = bearerToken(req, body);
  if (!token) return { error: json({ error: 'Not authenticated' }, 401) };

  const supabase = getServiceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: json({ error: 'Invalid or expired session' }, 401) };

  return { supabase, user: data.user, token };
}

export async function requireClient(req, body = {}, permission = null) {
  const auth = await requireUser(req, body);
  if (auth.error) return auth;

  const requestedClientId = body.client_id || body.clientId || req.headers.get('x-client-id') || null;
  let query = auth.supabase
    .from('client_memberships')
    .select('client_id, role, permissions, status')
    .eq('user_id', auth.user.id)
    .eq('status', 'active');

  if (requestedClientId) query = query.eq('client_id', requestedClientId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error || !data) return { error: json({ error: 'No active client access' }, 403) };

  const permissions = Array.isArray(data.permissions) ? data.permissions : [];
  const isPlatformOwner = data.role === 'platform_owner';
  const hasPermission = !permission || isPlatformOwner || permissions.includes(permission);
  if (!hasPermission) return { error: json({ error: 'Permission denied' }, 403) };

  return { ...auth, clientId: data.client_id, membership: data };
}

export async function logActivity(supabase, event) {
  try {
    await supabase.from('activity_logs').insert(event);
  } catch (e) {
    console.warn('activity log failed', e);
  }
}

export async function logAiUsage(supabase, event) {
  try {
    await supabase.from('ai_usage_events').insert(event);
  } catch (e) {
    console.warn('ai usage log failed', e);
  }
}
