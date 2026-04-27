/**
 * Netlify serverless function — proxies requests to the GPTZero API for AI-content detection.
 * Uses the SaaS-owned GPTZero API key from Netlify environment variables.
 *
 * Endpoint: POST https://api.gptzero.me/v2/predict/text
 * Auth: x-api-key header
 */

import { json, options, requireClient } from './_supabase.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }

  const { action, document, multilingual } = body;

  const auth = await requireClient(req, body, 'generate_content');
  if (auth.error) return auth.error;

  const apiKey = process.env.GPTZERO_API_KEY || '';
  if (!apiKey) {
    return json({ error: 'GPTZero is not configured for this SaaS environment.' }, 500);
  }

  // Action: predict — run an AI-content detection scan on a piece of text
  if (action === 'predict' || !action) {
    if (!document || typeof document !== 'string') {
      return json({ error: 'document (string) required' }, 400);
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
        return json({ error: data.error || data.message || ('GPTZero HTTP ' + r.status), status: r.status, details: data }, r.status);
      }
      return json({ ok: true, data });
    } catch (e) {
      return json({ error: 'GPTZero proxy error: ' + (e.message || String(e)) }, 502);
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
      return json({ ok: r.ok, status: r.status, data }, r.ok ? 200 : r.status);
    } catch (e) {
      return json({ error: 'Test failed: ' + (e.message || String(e)) }, 502);
    }
  }

  return json({ error: 'Unknown action: ' + action }, 400);
};

export const config = { path: '/api/gptzero' };
