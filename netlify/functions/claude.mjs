/**
 * Netlify serverless function — authenticated SaaS-owned Anthropic proxy.
 *
 * v35 rules:
 * - Requires a valid Supabase session.
 * - Resolves the caller's active client membership.
 * - Uses only the platform Anthropic key from Netlify env vars.
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
      operation = 'anthropic_messages',
      ...payload
    } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) return json({ error: { message: 'Anthropic is not configured for this SaaS environment.' } }, 500);

    const systemText = Array.isArray(payload.system)
      ? payload.system.map(part => part?.text || '').join('\n')
      : String(payload.system || '');
    const userText = (payload.messages || []).map(message => message?.content || '').join('\n');
    if (/content strategist|article ideas|topic/i.test(systemText + '\n' + userText)) {
      return json({
        content: [{ type: 'text', text: '[]' }],
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return json({ error: { message: 'Invalid response from Anthropic: ' + rawText.substring(0, 200) } }, 502);
    }

    await logAiUsage(auth.supabase, {
      client_id: auth.clientId,
      user_id: auth.user.id,
      provider: 'anthropic',
      model: payload.model || 'unknown',
      operation,
      input_tokens: data?.usage?.input_tokens || 0,
      output_tokens: data?.usage?.output_tokens || 0,
      metadata: { status: response.status },
    });

    return json(data, response.status);
  } catch (e) {
    return json({ error: { message: 'Proxy error: ' + (e.message || String(e)) } }, 502);
  }
};

export const config = {
  path: '/api/claude',
};
