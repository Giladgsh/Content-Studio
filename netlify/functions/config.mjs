import { json, options } from './_supabase.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  return json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
};

export const config = {
  path: '/api/config',
};
