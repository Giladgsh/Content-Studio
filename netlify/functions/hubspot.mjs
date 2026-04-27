/**
 * Netlify serverless function — proxies requests to HubSpot API.
 * Handles blog post creation, file uploads, and social broadcasts.
 * Needed because HubSpot API blocks requests from file:// origins.
 */

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: { message: 'Method not allowed' } }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { token: clientToken, endpoint, method = 'POST', payload, isFormData, fileBase64, fileName } = body;
    const token = clientToken || process.env.HUBSPOT_TOKEN || '';

    if (!token) {
      return Response.json(
        { error: { message: 'No HubSpot token — set HUBSPOT_TOKEN in Netlify env vars or enter one in Settings' } },
        { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const baseUrl = 'https://api.hubapi.com';
    let response;

    if (isFormData && fileBase64) {
      // Handle file upload — reconstruct FormData on server side
      const binaryStr = atob(fileBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/png' });

      // Try PUBLIC_INDEXABLE with overwrite=true first; fall back to PUBLIC_NOT_INDEXABLE if needed
      const makeForm = (access) => {
        const fd = new FormData();
        fd.append('file', blob, fileName || 'image.png');
        fd.append('options', JSON.stringify({ access, overwrite: true }));
        fd.append('folderPath', '/blog-images');
        return fd;
      };

      response = await fetch(baseUrl + endpoint, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: makeForm('PUBLIC_INDEXABLE'),
      });

      // If access level rejected (some portals restrict PUBLIC_INDEXABLE), retry with PUBLIC_NOT_INDEXABLE
      if (response.status === 400 || response.status === 403) {
        const firstBody = await response.text();
        if (/access/i.test(firstBody) || /indexable/i.test(firstBody)) {
          response = await fetch(baseUrl + endpoint, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: makeForm('PUBLIC_NOT_INDEXABLE'),
          });
        } else {
          // Not an access-related error — return the original failure body
          return Response.json({ error: { message: firstBody.substring(0, 500) }, status: response.status }, {
            status: response.status,
            headers: { 'Access-Control-Allow-Origin': '*' },
          });
        }
      }
    } else {
      // Standard JSON request
      const headers = {
        'Authorization': 'Bearer ' + token,
      };
      const fetchOpts = { method, headers };

      if (payload && method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(payload);
      }

      response = await fetch(baseUrl + endpoint, fetchOpts);
    }

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      data = { raw: rawText.substring(0, 500) };
    }

    return Response.json(data, {
      status: response.status,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return Response.json(
      { error: { message: 'HubSpot proxy error: ' + (e.message || String(e)) } },
      { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
};

export const config = {
  path: '/api/hubspot',
};
