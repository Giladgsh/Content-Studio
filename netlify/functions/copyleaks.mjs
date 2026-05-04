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

function decodeHtml(text = '') {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 32));
}

function extractReadableText(html = '') {
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeHtml(text)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
    .join('\n');

  // For obtained.com blog pages, trim the page chrome around the actual article.
  const h1 = text.search(/Rapyd Raises|Rapyd Acquires|^[^\n]{20,140}$/m);
  const end = text.search(/\nBack to List\n|\nRelevant Post\n|\nRelated Posts\n/i);
  if (h1 >= 0 && end > h1) text = text.slice(h1, end).trim();
  return text;
}

async function detectText(token, document, { sandbox = false, explain = false, sensitivity = 1, language = 'en' } = {}) {
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
      sensitivity: Math.max(1, Math.min(3, Number(sensitivity) || 1)),
      language,
    }),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text.substring(0, 500) }; }
  return { r, data };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }

  const auth = await requireClient(req, body, 'generate_content');
  if (auth.error) return auth.error;

  const { action = 'predict', document, url, sandbox = false, explain = false, sensitivity = 1, language = 'en' } = body;

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

      const { r, data } = await detectText(token, document, { sandbox, explain, sensitivity, language });
      if (!r.ok) {
        return json({ error: data.message || data.error || ('Copyleaks HTTP ' + r.status), status: r.status, details: data }, r.status);
      }
      return json({ ok: true, data });
    }

    if (action === 'predictUrl') {
      if (!url || typeof url !== 'string') return json({ error: 'url required' }, 400);
      const parsed = new URL(url);
      const allowedHosts = ['obtained.com', 'www.obtained.com', 'nevisigaming.com', 'www.nevisigaming.com'];
      if (!allowedHosts.includes(parsed.hostname)) return json({ error: 'Only approved client domains can be used for calibration.' }, 400);
      const page = await fetch(url, { headers: { 'User-Agent': 'ContentStudioBot/1.0' } });
      if (!page.ok) return json({ error: 'Could not fetch article URL: HTTP ' + page.status }, 400);
      const html = await page.text();
      const extracted = extractReadableText(html);
      if (extracted.trim().length < 255) return json({ error: 'Could not extract enough article text from that URL.' }, 400);
      const { r, data } = await detectText(token, extracted, { sandbox, explain, sensitivity, language });
      if (!r.ok) {
        return json({ error: data.message || data.error || ('Copyleaks HTTP ' + r.status), status: r.status, details: data }, r.status);
      }
      return json({ ok: true, data, extractedChars: extracted.length, extractedPreview: extracted.slice(0, 280) });
    }

    return json({ error: 'Unknown action: ' + action }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 502);
  }
};

export const config = { path: '/api/copyleaks' };
