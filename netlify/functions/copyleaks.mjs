/**
 * Netlify serverless function — proxies authenticated requests to Copyleaks AI Detector.
 * Copyleaks credentials stay SaaS-side in Netlify environment variables.
 */

import { json, options, requireClient } from './_supabase.mjs';

let cachedToken = null;
let cachedTokenExpires = 0;

async function getCopyleaksToken() {
  const email = process.env.COPYLEAKS_EMAIL || '';
  const key = process.env.COPYLEAKS_API_KEY || '';
  if (!email || !key) throw new Error('Copyleaks is not configured for this SaaS environment.');

  const now = Date.now();
  if (cachedToken && cachedTokenExpires > now + 5 * 60 * 1000) return cachedToken;

  const r = await fetch('https://id.copyleaks.com/v3/account/login/api', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, key }),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text.substring(0, 500) }; }
  if (!r.ok || !data.access_token) {
    throw new Error(data.message || data.error || ('Copyleaks login failed HTTP ' + r.status));
  }

  cachedToken = data.access_token;
  cachedTokenExpires = data['.expires'] ? Date.parse(data['.expires']) : now + 47 * 60 * 60 * 1000;
  return cachedToken;
}

function scanId() {
  return ('cs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10))
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 36);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }

  const auth = await requireClient(req, body, 'generate_content');
  if (auth.error) return auth.error;

  const { action = 'predict', document, sandbox = false, explain = false, sensitivity = 2, language = 'en' } = body;

  try {
    const token = await getCopyleaksToken();

    if (action === 'testConnection') {
      return json({ ok: true, provider: 'copyleaks' });
    }

    if (action === 'predict') {
      if (!document || typeof document !== 'string') {
        return json({ error: 'document (string) required' }, 400);
      }
      if (document.trim().length < 255) {
        return json({ error: 'Copyleaks requires at least 255 characters for AI detection.' }, 400);
      }

      const r = await fetch(`https://api.copyleaks.com/v2/writer-detector/${scanId()}/check`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: document.slice(0, 25000),
          sandbox: !!sandbox,
          explain: !!explain,
          sensitivity: Math.max(1, Math.min(3, Number(sensitivity) || 2)),
          language,
        }),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { data = { raw: text.substring(0, 500) }; }
      if (!r.ok) {
        return json({ error: data.message || data.error || ('Copyleaks HTTP ' + r.status), status: r.status, details: data }, r.status);
      }
      return json({ ok: true, data });
    }

    return json({ error: 'Unknown action: ' + action }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 502);
  }
};

export const config = { path: '/api/copyleaks' };
