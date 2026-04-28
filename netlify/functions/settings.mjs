/**
 * SHARED ORG settings for Content Studio.
 *
 * Design: ONE set of settings (API keys, defaults, CTA, etc.) shared across
 * the whole organization. Admins write; anyone authenticated can read.
 *
 * Actions:
 *   get   — fetch shared org settings (any authenticated user)
 *   save  — fully replace shared org settings (admin only)
 *   merge — partial-update shared org settings (admin only)
 *   clear — wipe shared org settings (admin only)
 *
 * Backward-compatible migration: if `get` is called and there are no shared
 * settings yet, but the caller is an admin AND a per-user blob exists for that
 * admin (from earlier per-user version), promote the per-user blob to shared
 * so org-wide keys are seeded automatically.
 */

import { getStore } from "@netlify/blobs";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SHARED_KEY = 'shared-settings';
const SENSITIVE_SETTING_KEYS = [
  'anthropicKey',
  'openaiKey',
  'sapling',
  'hsToken',
  'li',
  'fb',
  'wpUrl',
  'wpUser',
  'wpPass',
  'ahrefsKey',
  'gptzeroKey',
];

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

async function loadShared(store) {
  try {
    const data = await store.get(SHARED_KEY, { type: 'json' });
    return data || null;
  } catch (e) { return null; }
}

async function saveShared(store, settings, by) {
  await store.setJSON(SHARED_KEY, {
    ...settings,
    _updatedAt: Date.now(),
    _updatedBy: by || null,
  });
}

function redactSettings(settings, isAdmin) {
  if (!settings || isAdmin) return settings || null;
  const safe = { ...settings };
  SENSITIVE_SETTING_KEYS.forEach(k => {
    if (safe[k]) safe[k] = '__configured__';
  });
  return safe;
}

// Per-user blob key from the previous per-user version (used for one-time migration)
function perUserKey(email) {
  return 'settings-' + String(email || '').toLowerCase();
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);

  const store = getStore('content-studio');

  let body;
  try { body = await req.json(); } catch (e) { return respond({ error: 'Invalid JSON' }, 400); }

  const { action, token, settings } = body;

  const auth = await validateAuth(store, token);
  if (!auth) return respond({ error: 'Not authenticated' }, 401);
  const isAdmin = auth.user.role === 'admin';

  // GET — anyone authenticated can read; with optional one-time migration
  if (action === 'get') {
    let shared = await loadShared(store);

    // If no shared settings yet and caller is admin, migrate their per-user blob if present
    if (!shared && isAdmin) {
      try {
        const perUser = await store.get(perUserKey(auth.user.email), { type: 'json' });
        if (perUser && Object.keys(perUser).some(k => k !== '_updatedAt' && perUser[k])) {
          await saveShared(store, perUser, auth.user.email);
          shared = await loadShared(store);
        }
      } catch (e) { /* ignore */ }
    }
    return respond({ ok: true, settings: redactSettings(shared, isAdmin), isAdmin });
  }

  // SAVE — admin only
  if (action === 'save') {
    if (!isAdmin) return respond({ error: 'Only admins can edit org-wide settings' }, 403);
    if (!settings || typeof settings !== 'object') return respond({ error: 'settings object required' }, 400);
    await saveShared(store, settings, auth.user.email);
    return respond({ ok: true });
  }

  // MERGE — admin only
  if (action === 'merge') {
    if (!isAdmin) return respond({ error: 'Only admins can edit org-wide settings' }, 403);
    if (!settings || typeof settings !== 'object') return respond({ error: 'settings object required' }, 400);
    const existing = (await loadShared(store)) || {};
    const merged = { ...existing, ...settings };
    await saveShared(store, merged, auth.user.email);
    return respond({ ok: true, settings: merged });
  }

  // CLEAR — admin only
  if (action === 'clear') {
    if (!isAdmin) return respond({ error: 'Only admins can clear org-wide settings' }, 403);
    try { await store.delete(SHARED_KEY); } catch (e) {}
    return respond({ ok: true });
  }

  // SAVE_COMPETITORS — admin + editor. Overwrites ONLY the competitors array in the shared blob
  // without touching API keys, CTAs, or any other admin-only settings.
  if (action === 'saveCompetitors') {
    const role = auth.user.role;
    if (role !== 'admin' && role !== 'editor') {
      return respond({ error: 'Only admins and editors can edit competitors' }, 403);
    }
    const { competitors } = body;
    if (!Array.isArray(competitors)) {
      return respond({ error: 'competitors array required' }, 400);
    }
    for (const c of competitors) {
      if (!c || typeof c !== 'object') return respond({ error: 'Invalid competitor entry' }, 400);
      if (!c.name || typeof c.name !== 'string') return respond({ error: 'Each competitor needs a name' }, 400);
      if (!c.url || typeof c.url !== 'string') return respond({ error: 'Each competitor needs a URL' }, 400);
      if (!c.site || typeof c.site !== 'string') return respond({ error: 'Each competitor needs a site' }, 400);
      if (!Array.isArray(c.verticals)) return respond({ error: 'Each competitor needs a verticals array' }, 400);
    }
    const existing = (await loadShared(store)) || {};
    existing.competitors = competitors;
    existing._updatedAt = Date.now();
    existing._updatedBy = auth.user.email;
    await store.setJSON(SHARED_KEY, existing);
    return respond({ ok: true, competitors });
  }

  // SAVE_SOURCES — admin + editor. Stores client-suggested source preferences in the shared blob
  // without touching provider credentials or other admin-only settings.
  if (action === 'saveSources') {
    const role = auth.user.role;
    if (role !== 'admin' && role !== 'editor') {
      return respond({ error: 'Only admins and editors can edit sources' }, 403);
    }
    const { sources } = body;
    if (!Array.isArray(sources)) {
      return respond({ error: 'sources array required' }, 400);
    }
    for (const s of sources) {
      if (!s || typeof s !== 'object') return respond({ error: 'Invalid source entry' }, 400);
      if (!s.name || typeof s.name !== 'string') return respond({ error: 'Each source needs a name' }, 400);
      if (!s.url || typeof s.url !== 'string') return respond({ error: 'Each source needs a URL' }, 400);
      if (!Array.isArray(s.categories) || !s.categories.length) return respond({ error: 'Each source needs at least one category' }, 400);
    }
    const existing = (await loadShared(store)) || {};
    existing.sourceSuggestions = sources;
    existing._updatedAt = Date.now();
    existing._updatedBy = auth.user.email;
    await store.setJSON(SHARED_KEY, existing);
    return respond({ ok: true, sources });
  }

  return respond({ error: 'Unknown action' }, 400);
};

export const config = { path: '/api/settings' };
