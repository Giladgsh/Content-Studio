/**
 * Netlify serverless function — proxies requests to the GPTZero API for AI-content detection.
 * Uses admin-configured API key from shared settings blob.
 *
 * Endpoint: POST https://api.gptzero.me/v2/predict/text
 * Auth: x-api-key header
 */

import { getStore } from "@netlify/blobs";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SHARED_KEY = 'shared-settings';

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

async function getGptzeroKey(store) {
  try {
    const s = await store.get(SHARED_KEY, { type: 'json' });
    return s && s.gptzeroKey ? s.gptzeroKey : null;
  } catch (e) { return null; }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);

  const store = getStore('content-studio');

  let body;
  try { body = await req.json(); } catch (e) { return respond({ error: 'Invalid JSON' }, 400); }

  const { action, token, document, multilingual } = body;

  const auth = await validateAuth(store, token);
  if (!auth) return respond({ error: 'Not authenticated' }, 401);

  const apiKey = await getGptzeroKey(store);
  if (!apiKey) {
    return respond({ error: 'GPTZero API key not configured. Admin can set it in Settings → API credentials.' }, 400);
  }

  // Action: predict — run an AI-content detection scan on a piece of text
  if (action === 'predict' || !action) {
    if (!document || typeof document !== 'string') {
      return respond({ error: 'document (string) required' }, 400);
    }
    try {
      const r = await fetch('https://api.gptzero.me/v2/predict/text', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ document, multilingual: !!multilingual }),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text.substring(0, 500) }; }
      if (!r.ok) {
        return respond({ error: data.error || data.message || ('GPTZero HTTP ' + r.status), status: r.status, details: data }, r.status);
      }
      return respond({ ok: true, data });
    } catch (e) {
      return respond({ error: 'GPTZero proxy error: ' + (e.message || String(e)) }, 502);
    }
  }

  // Action: testConnection — lightweight check
  if (action === 'testConnection') {
    try {
      const r = await fetch('https://api.gptzero.me/v2/predict/text', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ document: 'Testing GPTZero API connection. This is a short sample used only to validate the API key.' }),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text.substring(0, 300) }; }
      return respond({ ok: r.ok, status: r.status, data }, r.ok ? 200 : r.status);
    } catch (e) {
      return respond({ error: 'Test failed: ' + (e.message || String(e)) }, 502);
    }
  }

  return respond({ error: 'Unknown action: ' + action }, 400);
};

export const config = { path: '/api/gptzero' };
