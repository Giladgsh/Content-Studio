/**
 * Netlify serverless function — proxies authenticated requests to WordPress REST API.
 * WordPress credentials are SaaS-side env vars only; never accept credentials from the browser.
 */

import { json, options, requireClient } from './_supabase.mjs';

const ALLOWED_ENDPOINTS = [
  /^\/wp-json\/wp\/v2\/posts(?:\/\d+)?(?:\?.*)?$/,
  /^\/wp-json\/wp\/v2\/tags(?:\?.*)?$/,
  /^\/wp-json\/wp\/v2\/media(?:\/\d+)?(?:\?.*)?$/,
];

function isAllowedEndpoint(endpoint = '') {
  return ALLOWED_ENDPOINTS.some(rx => rx.test(endpoint));
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return options();
  }

  if (req.method !== 'POST') {
    return json({ error: { message: 'Method not allowed' } }, 405);
  }

  try {
    const body = await req.json();
    const auth = await requireClient(req, body);
    if (auth.error) return auth.error;

    const { endpoint, payload, method = 'POST', isMediaUpload, fileBase64, fileName, altText } = body;
    const wpUrl = (process.env.WP_URL || '').replace(/\/+$/, '').replace(/\/wp-admin\/?$/i, '');
    const wpUser = process.env.WP_USER || '';
    const wpPass = process.env.WP_PASS || '';

    if (!wpUrl || !wpUser || !wpPass) {
      return json(
        { error: { message: 'WordPress credentials not configured — set in Settings or Netlify env vars' } },
        400
      );
    }

    if (!endpoint || !isAllowedEndpoint(endpoint)) {
      return json({ error: { message: 'WordPress endpoint is not allowed' } }, 400);
    }

    const wpAuth = Buffer.from(`${wpUser}:${wpPass}`).toString('base64');
    const url = `${wpUrl}${endpoint}`;
    let response;

    if (isMediaUpload && fileBase64) {
      // Handle image/media upload — reconstruct binary on server side
      const binaryStr = atob(fileBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });

      const headers = {
        'Authorization': `Basic ${wpAuth}`,
        'Content-Disposition': `attachment; filename="${fileName || 'image.png'}"`,
        'Content-Type': 'image/png',
      };

      response = await fetch(url, {
        method: 'POST',
        headers,
        body: blob,
      });

      // If upload succeeded and alt text provided, update the media item
      if (response.ok && altText) {
        try {
          const mediaData = await response.clone().json();
          if (mediaData.id) {
            await fetch(`${wpUrl}/wp-json/wp/v2/media/${mediaData.id}`, {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${wpAuth}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ alt_text: altText }),
            });
          }
        } catch (e) { /* alt text update is best-effort */ }
      }
    } else {
      // Standard JSON request
      const fetchOpts = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${wpAuth}`,
        },
      };

      if (payload && method !== 'GET') {
        // Allow draft or publish — the app controls this via the UI toggle
        // Only block unexpected statuses (e.g. 'private', 'trash')
        if (endpoint.includes('/wp/v2/posts') && method === 'POST' && payload.status) {
          const allowed = ['draft', 'publish', 'pending'];
          if (!allowed.includes(payload.status)) payload.status = 'draft';
        }
        fetchOpts.body = JSON.stringify(payload);
      }

      response = await fetch(url, fetchOpts);
    }

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return Response.json(
        { error: { message: 'Invalid response from WordPress: ' + rawText.substring(0, 200) } },
        { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return Response.json(data, {
      status: response.status,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return json(
      { error: { message: 'Proxy error: ' + (e.message || String(e)) } },
      502
    );
  }
};

export const config = {
  path: '/api/wordpress',
};
