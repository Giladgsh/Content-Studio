/**
 * Netlify serverless function — authenticated SaaS-owned OpenAI image proxy.
 */

import { json, logAiUsage, options, requireClient } from './_supabase.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: { message: 'Method not allowed' } }, 405);

  try {
    const body = await req.json();
    const auth = await requireClient(req, body, 'generate_content');
    if (auth.error) return auth.error;

    const { prompt, n = 3, size = '1792x1024' } = body;
    const apiKey = process.env.OPENAI_API_KEY || '';

    if (!apiKey) return json({ error: { message: 'OpenAI image generation is not configured for this SaaS environment.' } }, 500);
    if (!prompt || typeof prompt !== 'string') return json({ error: { message: 'prompt is required' } }, 400);

    const results = [];
    for (let i = 0; i < Math.min(n, 3); i++) {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size,
          response_format: 'b64_json',
          quality: 'standard',
        }),
      });

      const rawText = await response.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        return json({ error: { message: 'Invalid response from OpenAI: ' + rawText.substring(0, 200) } }, 502);
      }

      if (!response.ok) {
        return json({ error: { message: data?.error?.message || 'OpenAI error (HTTP ' + response.status + ')' } }, response.status);
      }

      if (data.data && data.data[0]) {
        results.push({
          b64: data.data[0].b64_json,
          revised_prompt: data.data[0].revised_prompt || prompt,
        });
      }
    }

    await logAiUsage(auth.supabase, {
      client_id: auth.clientId,
      user_id: auth.user.id,
      provider: 'openai',
      model: 'dall-e-3',
      operation: 'image_generation',
      input_tokens: 0,
      output_tokens: 0,
      metadata: { image_count: results.length, size },
    });

    return json({ images: results });
  } catch (e) {
    return json({ error: { message: 'Proxy error: ' + (e.message || String(e)) } }, 502);
  }
};

export const config = {
  path: '/api/dalle',
};
