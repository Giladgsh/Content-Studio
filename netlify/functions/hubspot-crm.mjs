import { json, options, requireClient, logActivity } from './_supabase.mjs';

const HUBSPOT_BASE = 'https://api.hubapi.com';

function hubspotToken() {
  return process.env.HUBSPOT_TOKEN || process.env.HUBSPOT_CRM_TOKEN || '';
}

async function hubspotFetch(path, opts = {}) {
  const token = hubspotToken();
  if (!token) throw new Error('HubSpot CRM token is not configured');
  const res = await fetch(HUBSPOT_BASE + path, {
    method: opts.method || 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw: raw.slice(0, 1000) }; }
  if (!res.ok) throw new Error(data.message || data.error?.message || 'HubSpot CRM API error ' + res.status);
  return data;
}

async function findContactByEmail(email) {
  const data = await hubspotFetch('/crm/v3/objects/contacts/search', {
    body: {
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['email', 'firstname', 'lastname', 'company', 'jobtitle'],
      limit: 1,
    },
  });
  return data.results?.[0] || null;
}

async function findCompanyByDomain(domain) {
  const data = await hubspotFetch('/crm/v3/objects/companies/search', {
    body: {
      filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
      properties: ['name', 'domain', 'industry'],
      limit: 1,
    },
  });
  return data.results?.[0] || null;
}

function contactProperties(input = {}) {
  const props = {};
  if (input.email) props.email = String(input.email).trim();
  if (input.fullName) {
    const parts = String(input.fullName).trim().split(/\s+/);
    props.firstname = parts.shift() || '';
    props.lastname = parts.join(' ');
  }
  if (input.title) props.jobtitle = String(input.title).trim();
  if (input.company) props.company = String(input.company).trim();
  if (input.linkedinUrl) props.linkedinbio = String(input.linkedinUrl).trim();
  return props;
}

function companyProperties(input = {}) {
  const props = {};
  if (input.name || input.company) props.name = String(input.name || input.company).trim();
  if (input.website || input.domain) props.domain = String(input.website || input.domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (input.industry) props.industry = String(input.industry).trim();
  return props;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body = {};
  try { body = await req.json(); } catch {}

  const auth = await requireClient(req, body, 'sync_sdr_hubspot');
  if (auth.error) return auth.error;

  try {
    const action = body.action || '';

    if (action === 'searchContact') {
      const email = String(body.email || '').trim();
      if (!email) return json({ error: 'email is required' }, 400);
      const data = await hubspotFetch('/crm/v3/objects/contacts/search', {
        body: {
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
          properties: ['email', 'firstname', 'lastname', 'company', 'jobtitle'],
          limit: 5,
        },
      });
      return json({ ok: true, results: data.results || [] });
    }

    if (action === 'searchCompany') {
      const domain = String(body.domain || body.website || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
      if (!domain) return json({ error: 'domain is required' }, 400);
      const data = await hubspotFetch('/crm/v3/objects/companies/search', {
        body: {
          filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
          properties: ['name', 'domain', 'industry'],
          limit: 5,
        },
      });
      return json({ ok: true, results: data.results || [] });
    }

    if (action === 'upsertContact') {
      const props = contactProperties(body.contact || body);
      if (!props.email) return json({ error: 'email is required to sync a contact' }, 400);
      const existing = await findContactByEmail(props.email);
      const data = existing
        ? await hubspotFetch('/crm/v3/objects/contacts/' + existing.id, { method: 'PATCH', body: { properties: props } })
        : await hubspotFetch('/crm/v3/objects/contacts', { body: { properties: props } });
      await logActivity(auth.supabase, {
        client_id: auth.clientId,
        user_id: auth.user.id,
        event_type: 'sdr_hubspot_contact_synced',
        message: 'AI SDR contact synced to HubSpot',
        metadata: { hubspot_contact_id: data.id, mode: existing ? 'updated' : 'created' },
      });
      return json({ ok: true, contact: data, mode: existing ? 'updated' : 'created' });
    }

    if (action === 'upsertCompany') {
      const props = companyProperties(body.company || body);
      if (!props.name && !props.domain) return json({ error: 'company name or domain is required' }, 400);
      const existing = props.domain ? await findCompanyByDomain(props.domain) : null;
      const data = existing
        ? await hubspotFetch('/crm/v3/objects/companies/' + existing.id, { method: 'PATCH', body: { properties: props } })
        : await hubspotFetch('/crm/v3/objects/companies', { body: { properties: props } });
      await logActivity(auth.supabase, {
        client_id: auth.clientId,
        user_id: auth.user.id,
        event_type: 'sdr_hubspot_company_synced',
        message: 'AI SDR company synced to HubSpot',
        metadata: { hubspot_company_id: data.id, mode: existing ? 'updated' : 'created' },
      });
      return json({ ok: true, company: data, mode: existing ? 'updated' : 'created' });
    }

    if (action === 'createNote') {
      const note = String(body.note || body.summary || '').trim();
      if (!note) return json({ error: 'note is required' }, 400);
      const data = await hubspotFetch('/crm/v3/objects/notes', {
        body: {
          properties: {
            hs_note_body: note,
            hs_timestamp: new Date().toISOString(),
          },
        },
      });
      return json({ ok: true, note: data });
    }

    return json({ error: 'Unknown HubSpot CRM action' }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 502);
  }
};

export const config = {
  path: '/api/hubspot-crm',
};
