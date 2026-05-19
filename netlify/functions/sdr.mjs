import { json, logActivity, logAiUsage, options, requireClient } from './_supabase.mjs';

const SDR_TABLES = {
  profiles: 'ai_sdr_profiles',
  audiences: 'sdr_audience_segments',
  companies: 'sdr_companies',
  leads: 'sdr_leads',
  messages: 'sdr_outreach_messages',
  approvals: 'sdr_approval_queue',
  conversations: 'sdr_conversations',
  handovers: 'sdr_handovers',
  claims: 'sdr_prohibited_claims',
};

const DEFAULT_RISK_TRIGGERS = [
  'pricing request',
  'legal or regulatory question',
  'guarantee language',
  'M&A discussion',
  'confidential information',
  'budget mention',
  'banking/payment approval',
  'high-value lead',
  'low AI confidence',
];

function arrayFromText(value) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  return String(value || '')
    .split(/\n|,/)
    .map(s => s.trim())
    .filter(Boolean);
}

function clampScore(value, fallback = 70) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function canManage(auth) {
  const role = auth.membership?.role;
  const perms = Array.isArray(auth.membership?.permissions) ? auth.membership.permissions : [];
  return role === 'platform_owner' || role === 'client_admin' || role === 'sdr_manager' || perms.includes('manage_sdr');
}

async function getProfiles(auth) {
  const { data, error } = await auth.supabase
    .from(SDR_TABLES.profiles)
    .select('*')
    .eq('client_id', auth.clientId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function getAudiences(auth) {
  let query = auth.supabase
    .from(SDR_TABLES.audiences)
    .select('*')
    .eq('client_id', auth.clientId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(25);
  if (!canManage(auth)) query = query.or(`owner_user_id.is.null,owner_user_id.eq.${auth.user.id},created_by.eq.${auth.user.id}`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function getMessages(auth) {
  let query = auth.supabase
    .from(SDR_TABLES.messages)
    .select('*, lead:sdr_leads(full_name,title,company,relevant_vertical), profile:ai_sdr_profiles(name,vertical)')
    .eq('client_id', auth.clientId)
    .order('created_at', { ascending: false })
    .limit(25);
  if (!canManage(auth)) query = query.or(`owner_user_id.eq.${auth.user.id},created_by.eq.${auth.user.id}`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

async function overview(auth) {
  const [profiles, audiences, messages] = await Promise.all([
    getProfiles(auth),
    getAudiences(auth),
    getMessages(auth),
  ]);
  const pendingApprovals = messages.filter(m => m.status === 'queued_for_approval' || m.approval_required).length;
  return {
    profiles,
    audiences,
    messages,
    metrics: {
      profiles: profiles.length,
      audiences: audiences.length,
      drafts: messages.length,
      pendingApprovals,
      connectedSources: ['HubSpot CRM-ready', 'Public sources', 'Regulatory registers planned'],
    },
  };
}

async function callOpenAI(auth, messages, operation) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('OpenAI is not configured for this SaaS environment');
  const payload = {
    model: process.env.SDR_OPENAI_MODEL || 'gpt-5-mini',
    messages,
    temperature: 0.35,
    max_completion_tokens: 1800,
  };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid OpenAI response: ' + raw.slice(0, 200));
  }
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI API error ' + response.status);
  await logAiUsage(auth.supabase, {
    client_id: auth.clientId,
    user_id: auth.user.id,
    provider: 'openai',
    model: payload.model,
    operation,
    input_tokens: data?.usage?.prompt_tokens || 0,
    output_tokens: data?.usage?.completion_tokens || 0,
    metadata: { status: response.status },
  });
  return data.choices?.[0]?.message?.content || '';
}

async function buildAudience(auth, body) {
  const profileId = body.profileId || body.profile_id || null;
  let profile = null;
  if (profileId) {
    const { data, error } = await auth.supabase
      .from(SDR_TABLES.profiles)
      .select('*')
      .eq('client_id', auth.clientId)
      .eq('id', profileId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    profile = data;
  }

  const vertical = body.vertical || profile?.vertical || 'iGaming licenses';
  const geography = arrayFromText(body.geography || body.geo || 'Europe, UK, LATAM, UAE');
  const companyTypes = arrayFromText(body.companyTypes || profile?.target_company_types || 'operator, platform, fintech');
  const titles = arrayFromText(body.targetTitles || profile?.target_job_titles || 'Founder, CEO, Head of Compliance');
  const trigger = String(body.trigger || body.buyingSignal || 'licensing, market-entry, payments, banking, or regulatory pressure').trim();
  const sourcePreference = String(body.sourcePreference || 'HubSpot CRM, public regulatory signals, event/company lists, and later Apollo/Sales Navigator').trim();

  const system = `You are the strategy engine for Obtained AI SDR Engine.
Design safe, high-quality B2B audience segments for regulated-market SDRs.
Never propose unauthorized LinkedIn scraping. Prefer approved CRM data, public/company sources, events, regulatory registers, and approved providers.
Output only valid JSON.`;
  const user = `Create one practical audience plan.

Vertical: ${vertical}
Geography: ${geography.join(', ')}
Company types: ${companyTypes.join(', ')}
Target titles: ${titles.join(', ')}
Buying signal / trigger: ${trigger}
Source preference: ${sourcePreference}
Persona: ${profile ? JSON.stringify({
  name: profile.name,
  icp: profile.icp_definition,
  tone: profile.tone_of_voice,
  prohibitedClaims: profile.prohibited_claims,
  approvalTriggers: profile.human_approval_triggers,
  expertise: profile.expertise_areas,
}) : 'No profile selected'}

Return JSON:
{
  "name": "short segment name",
  "vertical": "...",
  "geography": ["..."],
  "companyTypes": ["..."],
  "targetTitles": ["..."],
  "buyingSignals": ["..."],
  "sourceStrategy": {
    "primary": ["..."],
    "secondary": ["..."],
    "doNotUse": ["..."]
  },
  "outreachAngle": "specific value proposition / point of view",
  "riskFlags": [{"type":"...", "reason":"..."}],
  "recommendedNextActions": [{"action":"...", "owner":"SDR|Manager|BDM", "why":"..."}],
  "confidenceScore": 0-100
}`;

  let parsed;
  try {
    const text = await callOpenAI(auth, [{ role: 'system', content: system }, { role: 'user', content: user }], 'sdr_audience_builder');
    parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch (e) {
    parsed = {
      name: vertical + ' audience - ' + geography.slice(0, 2).join(' / '),
      vertical,
      geography,
      companyTypes,
      targetTitles: titles,
      buyingSignals: [trigger],
      sourceStrategy: {
        primary: ['HubSpot CRM reactivation and current client/company data', 'Public regulatory/register signals', 'Event sponsor/exhibitor lists'],
        secondary: ['Apollo and Sales Navigator once connected', 'Partner/referrer lists'],
        doNotUse: ['unauthorized LinkedIn scraping', 'unverified purchased lists'],
      },
      outreachAngle: 'Lead with the commercial pressure behind ' + trigger + ', then qualify whether licensing, payments, banking, or advisory support is relevant.',
      riskFlags: [{ type: 'regulated_claim', reason: 'Avoid guarantees around licensing, banking, PSP approval, or regulator timelines.' }],
      recommendedNextActions: [
        { action: 'Fetch matching HubSpot companies/contacts for reactivation', owner: 'SDR', why: 'Warmest and safest first source.' },
        { action: 'Prepare event/regulatory source list for net-new accounts', owner: 'Manager', why: 'Reduces reliance on manual exports.' },
      ],
      confidenceScore: 68,
      fallbackReason: e.message,
    };
  }

  const insert = {
    client_id: auth.clientId,
    profile_id: profileId,
    owner_user_id: body.ownerUserId || auth.user.id,
    name: String(parsed.name || vertical + ' audience').slice(0, 180),
    vertical: String(parsed.vertical || vertical),
    geography: Array.isArray(parsed.geography) ? parsed.geography : geography,
    company_types: Array.isArray(parsed.companyTypes) ? parsed.companyTypes : companyTypes,
    target_titles: Array.isArray(parsed.targetTitles) ? parsed.targetTitles : titles,
    buying_signals: Array.isArray(parsed.buyingSignals) ? parsed.buyingSignals : [trigger],
    source_strategy: parsed.sourceStrategy || {},
    outreach_angle: parsed.outreachAngle || '',
    risk_flags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
    recommended_next_actions: Array.isArray(parsed.recommendedNextActions) ? parsed.recommendedNextActions : [],
    confidence_score: clampScore(parsed.confidenceScore, 68),
    created_by: auth.user.id,
  };

  const { data, error } = await auth.supabase
    .from(SDR_TABLES.audiences)
    .insert(insert)
    .select('*')
    .single();
  if (error) throw new Error(error.message);

  await logActivity(auth.supabase, {
    client_id: auth.clientId,
    user_id: auth.user.id,
    event_type: 'sdr_audience_created',
    message: 'AI SDR audience created: ' + data.name,
    metadata: { vertical: data.vertical, confidence_score: data.confidence_score },
  });

  return data;
}

async function saveProfile(auth, body) {
  if (!canManage(auth)) throw new Error('Only SDR managers and admins can manage SDR profiles');
  const profile = body.profile || {};
  const payload = {
    client_id: auth.clientId,
    name: String(profile.name || '').trim(),
    vertical: String(profile.vertical || '').trim(),
    persona_type: profile.persona_type || profile.personaType || 'vertical',
    assigned_user_id: profile.assigned_user_id || profile.assignedUserId || null,
    icp_definition: String(profile.icp_definition || profile.icpDefinition || ''),
    target_job_titles: arrayFromText(profile.target_job_titles || profile.targetJobTitles),
    target_company_types: arrayFromText(profile.target_company_types || profile.targetCompanyTypes),
    excluded_audiences: arrayFromText(profile.excluded_audiences || profile.excludedAudiences),
    tone_of_voice: String(profile.tone_of_voice || profile.toneOfVoice || ''),
    qualification_questions: profile.qualification_questions || profile.qualificationQuestions || [],
    prohibited_claims: profile.prohibited_claims || profile.prohibitedClaims || [],
    handover_rules: profile.handover_rules || profile.handoverRules || {},
    human_approval_triggers: profile.human_approval_triggers || profile.humanApprovalTriggers || DEFAULT_RISK_TRIGGERS,
    expertise_areas: arrayFromText(profile.expertise_areas || profile.expertiseAreas),
    operating_mode: profile.operating_mode || profile.operatingMode || 'approval',
    autonomous_enabled: !!profile.autonomous_enabled,
    created_by: auth.user.id,
  };
  if (!payload.name || !payload.vertical) throw new Error('Name and vertical are required');

  const query = profile.id
    ? auth.supabase.from(SDR_TABLES.profiles).update(payload).eq('client_id', auth.clientId).eq('id', profile.id).select('*').single()
    : auth.supabase.from(SDR_TABLES.profiles).insert(payload).select('*').single();
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body = {};
  try { body = await req.json(); } catch {}

  const action = body.action || 'overview';
  const auth = await requireClient(req, body, action === 'saveProfile' ? 'manage_sdr' : 'use_sdr');
  if (auth.error) return auth.error;

  try {
    if (action === 'overview') return json({ ok: true, ...(await overview(auth)) });
    if (action === 'buildAudience') return json({ ok: true, audience: await buildAudience(auth, body) });
    if (action === 'saveProfile') return json({ ok: true, profile: await saveProfile(auth, body) });
    return json({ error: 'Unknown action: ' + action }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 400);
  }
};

export const config = {
  path: '/api/sdr',
};
