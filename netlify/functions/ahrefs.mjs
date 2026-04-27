/**
 * Ahrefs API v3 proxy for Content Studio.
 *
 * - Authenticates the caller via the same session token pattern as settings/users.mjs
 * - Pulls the admin-configured Ahrefs API key from the shared settings blob
 * - Forwards to Ahrefs (Authorization: Bearer) and returns the JSON response
 * - Caches GET responses in a Netlify blob with a per-action TTL to conserve API units
 * - Exposes a named-action map so the client doesn't need to know endpoint paths
 *
 * Actions supported (all GET unless noted):
 *   keywordOverview   — /v3/keywords-explorer/overview      (7d cache)
 *   relatedTerms      — /v3/keywords-explorer/related-terms (7d cache)
 *   siteOverview      — /v3/site-explorer/overview          (30d cache)
 *   topPages          — /v3/site-explorer/top-pages         (30d cache)
 *   serpOverview      — /v3/serp-overview/serp              (24h cache — good for rank checks)
 *   rankCheck         — /v3/serp-overview/serp              (no cache; forces live lookup)
 *   usageSummary      — /v3/subscription-info/limits-and-usage (5m cache, costs 0 units per Ahrefs docs)
 *   raw               — pass-through: body.path + body.method + body.params for ad-hoc calls
 */

import { getStore } from "@netlify/blobs";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SHARED_KEY = 'shared-settings';
const AHREFS_BASE = 'https://api.ahrefs.com/v3';

function respond(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

async function validateAuth(store, token) {
  if (!token) return null;
  try {
    const sessions = await store.get('sessions', { type: 'json' }) || {};
    const sess = sessions[token];
    if (!sess || sess.expires < Date.now()) return null;
    const users = await store.get('users', { type: 'json' }) || [];
    const user = users.find(u => u.id === sess.userId);
    if (!user || !user.active) return null;
    return { user, session: sess };
  } catch (e) { return null; }
}

async function getAhrefsKey(store) {
  try {
    const s = await store.get(SHARED_KEY, { type: 'json' });
    return s && s.ahrefsKey ? s.ahrefsKey : null;
  } catch (e) { return null; }
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Action map: name → { path, method, ttlMs }
// ttlMs=0 means no caching (always live)
const ACTIONS = {
  keywordOverview:  { path: '/keywords-explorer/overview',      method: 'GET', ttl: 7 * DAY },
  relatedTerms:     { path: '/keywords-explorer/related-terms', method: 'GET', ttl: 7 * DAY },
  // Confirmed v3 path — there is no consolidated "overview" endpoint in v3; we combine signals via backlinks-stats + metrics.
  backlinksStats:   { path: '/site-explorer/backlinks-stats',   method: 'GET', ttl: 30 * DAY },
  siteMetrics:      { path: '/site-explorer/metrics',           method: 'GET', ttl: 30 * DAY },
  topPages:         { path: '/site-explorer/top-pages',         method: 'GET', ttl: 30 * DAY },
  // Kept for back-compat; routed to backlinks-stats which returns dr + refdomains, then client enriches.
  siteOverview:     { path: '/site-explorer/backlinks-stats',   method: 'GET', ttl: 30 * DAY },
  serpOverview:     { path: '/serp-overview/serp',              method: 'GET', ttl: 1 * DAY },
  rankCheck:        { path: '/serp-overview/serp',              method: 'GET', ttl: 0 },
  // CONFIRMED v3 endpoint: /subscription/limits-and-usage (not /subscription-info/…)
  usageSummary:     { path: '/subscription/limits-and-usage',   method: 'GET', ttl: 5 * MINUTE },
};

function cacheKey(action, params) {
  try { return 'ahrefs-cache:' + action + ':' + JSON.stringify(params || {}); }
  catch (e) { return 'ahrefs-cache:' + action + ':unhashable'; }
}

async function getCached(store, action, params) {
  try {
    const k = cacheKey(action, params);
    const entry = await store.get(k, { type: 'json' });
    if (entry && entry.expiresAt > Date.now()) return entry.value;
  } catch (e) { /* ignore */ }
  return null;
}

async function setCached(store, action, params, value, ttlMs) {
  try {
    const k = cacheKey(action, params);
    await store.setJSON(k, { value, expiresAt: Date.now() + ttlMs });
  } catch (e) { /* ignore */ }
}

function buildUrl(basePath, params) {
  if (!params || !Object.keys(params).length) return AHREFS_BASE + basePath;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qs.append(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const q = qs.toString();
  return AHREFS_BASE + basePath + (q ? '?' + q : '');
}

async function ahrefsRequest({ method, path, params, apiKey }) {
  const url = method === 'GET' ? buildUrl(path, params) : AHREFS_BASE + path;
  const init = {
    method,
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Accept': 'application/json',
    },
  };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(params || {});
  }
  const r = await fetch(url, init);
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { status: r.status, ok: r.ok, data };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);

  const store = getStore('content-studio');

  let body;
  try { body = await req.json(); } catch (e) { return respond({ error: 'Invalid JSON' }, 400); }

  const { action, params = {}, token, skipCache = false } = body;

  const auth = await validateAuth(store, token);
  if (!auth) return respond({ error: 'Not authenticated' }, 401);

  const apiKey = await getAhrefsKey(store);
  if (!apiKey) {
    return respond({
      error: 'Ahrefs API key not configured. Admin can set it in Settings → API credentials.'
    }, 400);
  }

  // RAW passthrough — admin-only, for debugging / unlisted endpoints
  if (action === 'raw') {
    if (auth.user.role !== 'admin') return respond({ error: 'raw passthrough is admin-only' }, 403);
    const path = body.path;
    const method = (body.method || 'GET').toUpperCase();
    if (!path || !path.startsWith('/')) return respond({ error: 'path must start with /' }, 400);
    const result = await ahrefsRequest({ method, path, params, apiKey });
    return respond({ ok: result.ok, status: result.status, data: result.data, cached: false });
  }

  const def = ACTIONS[action];
  if (!def) return respond({ error: 'Unknown action: ' + action }, 400);

  // Try cache
  if (def.ttl > 0 && !skipCache) {
    const cached = await getCached(store, action, params);
    if (cached !== null) {
      return respond({ ok: true, cached: true, data: cached });
    }
  }

  // Live call
  const result = await ahrefsRequest({ method: def.method, path: def.path, params, apiKey });
  if (!result.ok) {
    // Forward Ahrefs error details so the UI can show them
    return respond({
      error: (result.data && (result.data.error || result.data.message)) || ('Ahrefs API error (HTTP ' + result.status + ')'),
      status: result.status,
      details: result.data,
    }, result.status);
  }

  if (def.ttl > 0) await setCached(store, action, params, result.data, def.ttl);
  return respond({ ok: true, cached: false, data: result.data });
};

export const config = { path: '/api/ahrefs' };
