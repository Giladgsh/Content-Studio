/**
 * Netlify serverless function — authenticated SaaS-owned OpenAI proxy.
 *
 * v35 rules:
 * - Requires a valid Supabase session.
 * - Resolves the caller's active client membership.
 * - Uses only the platform OpenAI key from Netlify env vars.
 * - Logs token usage for client billing.
 */

import { json, logAiUsage, options, requireClient } from './_supabase.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  try {
    const body = await req.json();
    const auth = await requireClient(req, body, 'generate_content');
    if (auth.error) return auth.error;

    const {
      apiKey: _ignoredClientKey,
      access_token: _accessToken,
      supabaseToken: _supabaseToken,
      token: _legacyToken,
      client_id: _clientId,
      clientId: _clientId2,
      operation = 'openai_chat',
      ...payload
    } = body;

    const apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey) return json({ error: { message: 'OpenAI is not configured for this SaaS environment.' } }, 500);

    if (operation === 'topic_scan') {
      payload.model = payload.model || 'gpt-5-mini';
      payload.max_tokens = Math.min(Number(payload.max_tokens) || 2200, 2200);
      payload.temperature = Math.min(Number(payload.temperature) || 0.7, 0.7);
    }

    if (/^gpt-5/i.test(String(payload.model || '')) && payload.max_tokens && !payload.max_completion_tokens) {
      payload.max_completion_tokens = payload.max_tokens;
      delete payload.max_tokens;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return json({ error: { message: 'Invalid response from OpenAI: ' + rawText.substring(0, 200) } }, 502);
    }

    await logAiUsage(auth.supabase, {
      client_id: auth.clientId,
      user_id: auth.user.id,
      provider: 'openai',
      model: payload.model || 'unknown',
      operation,
      input_tokens: data?.usage?.prompt_tokens || 0,
      output_tokens: data?.usage?.completion_tokens || 0,
      metadata: { status: response.status },
    });

    return json(data, response.status);
  } catch (e) {
    return json({ error: { message: 'Proxy error: ' + (e.message || String(e)) } }, 502);
  }
};

export const config = {
  path: '/api/openai',
};
