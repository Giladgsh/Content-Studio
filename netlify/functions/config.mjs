import { json, options } from './_supabase.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  return json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    integrations: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      gptzero: !!process.env.GPTZERO_API_KEY,
      copyleaks: !!(process.env.COPYLEAKS_EMAIL && process.env.COPYLEAKS_API_KEY),
      wordpress: !!(process.env.WP_URL && process.env.WP_USER && process.env.WP_PASS),
    },
  });
};

export const config = {
  path: '/api/config',
};
