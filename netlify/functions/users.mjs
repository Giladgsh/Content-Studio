/**
 * Netlify serverless function — shared user management backend.
 * Uses Netlify Blobs for persistent storage across all browsers/devices.
 *
 * Endpoints (via POST body { action: ... }):
 *   login        — authenticate user, return session token
 *   getUsers     — list all users (admin only, excludes hashes)
 *   getUser      — get single user by ID (admin or self)
 *   createUser   — add a new user (admin only)
 *   updateUser   — edit user fields: name, email, role, sites, active (admin only)
 *   resetPassword— change user password (admin or self)
 *   deleteUser   — remove a user (admin only)
 *   validateSession — check if a session token is still valid
 */

import { getStore } from "@netlify/blobs";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

// SHA-256 hash (same as client-side)
async function hashPw(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Simple session token
function genToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── Blob helpers ──
async function getUsers(store) {
  try {
    const data = await store.get('users', { type: 'json' });
    return data || [];
  } catch (e) { return []; }
}

async function saveUsers(store, users) {
  await store.setJSON('users', users);
}

async function getSessions(store) {
  try {
    const data = await store.get('sessions', { type: 'json' });
    return data || {};
  } catch (e) { return {}; }
}

async function saveSessions(store, sessions) {
  await store.setJSON('sessions', sessions);
}

// Validate session, return user object (without hash) + session data
async function validateAuth(store, token) {
  if (!token) return null;
  const sessions = await getSessions(store);
  const sess = sessions[token];
  if (!sess || sess.expires < Date.now()) {
    if (sess) { delete sessions[token]; await saveSessions(store, sessions); }
    return null;
  }
  const users = await getUsers(store);
  const user = users.find(u => u.id === sess.userId);
  if (!user || !user.active) return null;
  return { user, session: sess };
}

// Legacy fallback admin for pre-Supabase local migration only. v35 production auth
// should be handled by Supabase Auth and seeded with Gilad@finmp.com.
const DEFAULT_ADMIN_HASH = '80bbf246422213100a8641a24f70126ed9c799410242d6ea2ba184950a109124';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function seedIfEmpty(store) {
  const users = await getUsers(store);
  if (!users.length) {
    await saveUsers(store, [{
      id: 'u1',
      name: 'Gilad Shalem',
      email: 'Gilad@finmp.com',
      hash: DEFAULT_ADMIN_HASH,
      role: 'admin',
      active: true,
      sites: ['obtained', 'nevis'],
      createdAt: Date.now()
    }]);
  }
}

// Strip sensitive data before returning user to client
function safeUser(u) {
  const { hash, ...safe } = u;
  return safe;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);

  const store = getStore('content-studio');
  await seedIfEmpty(store);

  let body;
  try { body = await req.json(); } catch (e) { return respond({ error: 'Invalid JSON' }, 400); }

  const { action, token } = body;

  // ── LOGIN ──
  if (action === 'login') {
    const { email, password } = body;
    if (!email || !password) return respond({ error: 'Email and password required' }, 400);
    const hash = await hashPw(password);
    const users = await getUsers(store);
    let user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.hash === hash && u.active);
    if (!user) return respond({ error: 'Invalid email or password, or account is deactivated' }, 401);
    // Create session
    const sessToken = genToken();
    const sessions = await getSessions(store);
    // Clean expired sessions
    for (const [k, v] of Object.entries(sessions)) {
      if (v.expires < Date.now()) delete sessions[k];
    }
    sessions[sessToken] = {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      sites: user.sites || ['obtained', 'nevis'],
      expires: Date.now() + SESSION_TTL
    };
    await saveSessions(store, sessions);
    return respond({
      token: sessToken,
      user: safeUser(user),
      session: sessions[sessToken]
    });
  }

  // ── VALIDATE SESSION ──
  if (action === 'validateSession') {
    const auth = await validateAuth(store, token);
    if (!auth) return respond({ error: 'Invalid or expired session' }, 401);
    return respond({ user: safeUser(auth.user), session: auth.session });
  }

  // ── LOGOUT ──
  if (action === 'logout') {
    if (token) {
      const sessions = await getSessions(store);
      delete sessions[token];
      await saveSessions(store, sessions);
    }
    return respond({ ok: true });
  }

  // ── GET USERS (admin only) ──
  if (action === 'getUsers') {
    const auth = await validateAuth(store, token);
    if (!auth) return respond({ error: 'Not authenticated' }, 401);
    if (auth.user.role !== 'admin') return respond({ error: 'Admin access required' }, 403);
    const users = await getUsers(store);
    return respond({ users: users.map(safeUser) });
  }

  // ── GET SINGLE USER ──
  if (action === 'getUser') {
    const auth = await validateAuth(store, token);
    if (!auth) return respond({ error: 'Not authenticated' }, 401);
    const { userId } = body;
    // Allow self-access or admin
    if (auth.user.id !== userId && auth.user.role !== 'admin') return respond({ error: 'Access denied' }, 403);
    const users = await getUsers(store);
    const u = users.find(x => x.id === userId);
    if (!u) return respond({ error: 'User not found' }, 404);
    return respond({ user: safeUser(u) });
  }

  // ── CREATE USER (admin only) ──
  if (action === 'createUser') {
    const auth = await validateAuth(store, token);
    if (!auth) return respond({ error: 'Not authenticated' }, 401);
    if (auth.user.role !== 'admin') return respond({ error: 'Admin access required' }, 403);
    const { name, email, password, role, sites } = body;
    if (!name) return respond({ error: 'Name is required' }, 400);
    if (!email || !email.includes('@')) return respond({ error: 'Valid email required' }, 400);
    if (!password || password.length < 6) return respond({ error: 'Password must be at least 6 characters' }, 400);
    if (!['writer', 'editor', 'admin'].includes(role)) return respond({ error: 'Invalid role' }, 400);
    if (!sites || !sites.length) return respond({ error: 'Select at least one site' }, 400);
    const users = await getUsers(store);
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return respond({ error: 'A user with this email already exists' }, 409);
    }
    const hash = await hashPw(password);
    const newUser = { id: 'u' + Date.now(), name, email, hash, role, sites, active: true, createdAt: Date.now() };
    users.push(newUser);
    await saveUsers(store, users);
    return respond({ user: safeUser(newUser) });
  }

  // ── UPDATE USER (admin only, or self for name) ──
  if (action === 'updateUser') {
    const auth = await validateAuth(store, token);
    if (!auth) return respond({ error: 'Not authenticated' }, 401);
    const { userId, updates } = body;
    if (!userId || !updates) return respond({ error: 'userId and updates required' }, 400);
    const isSelf = auth.user.id === userId;
    const isAdmin = auth.user.role === 'admin';
    if (!isAdmin && !isSelf) return respond({ error: 'Access denied' }, 403);
    const users = await getUsers(store);
    const u = users.find(x => x.id === userId);
    if (!u) return respond({ error: 'User not found' }, 404);
    // What can be updated
    if (isAdmin && !isSelf) {
      // Admin can update everything except hash (use resetPassword for that)
      if (updates.name !== undefined) u.name = updates.name;
      if (updates.email !== undefined) {
        if (users.find(x => x.id !== userId && x.email.toLowerCase() === updates.email.toLowerCase())) {
          return respond({ error: 'Email already in use by another user' }, 409);
        }
        u.email = updates.email;
      }
      if (updates.role !== undefined && ['writer', 'editor', 'admin'].includes(updates.role)) u.role = updates.role;
      if (updates.sites !== undefined && Array.isArray(updates.sites) && updates.sites.length) u.sites = updates.sites;
      if (updates.active !== undefined) u.active = updates.active;
    } else if (isSelf) {
      // Self can only update name
      if (updates.name !== undefined) u.name = updates.name;
    }
    await saveUsers(store, users);
    // Also update any active sessions for this user
    const sessions = await getSessions(store);
    for (const [k, v] of Object.entries(sessions)) {
      if (v.userId === userId) {
        v.name = u.name;
        v.role = u.role;
        v.sites = u.sites;
      }
    }
    await saveSessions(store, sessions);
    return respond({ user: safeUser(u) });
  }

  // ── RESET PASSWORD ──
  if (action === 'resetPassword') {
    const auth = await validateAuth(store, token);
    if (!auth) return respond({ error: 'Not authenticated' }, 401);
    const { userId, newPassword, oldPassword } = body;
    if (!userId || !newPassword || newPassword.length < 6) return respond({ error: 'Password must be at least 6 characters' }, 400);
    const isSelf = auth.user.id === userId;
    const isAdmin = auth.user.role === 'admin';
    if (!isAdmin && !isSelf) return respond({ error: 'Access denied' }, 403);
    // If self, require old password
    if (isSelf && !isAdmin) {
      if (!oldPassword) return respond({ error: 'Current password required' }, 400);
      const oldHash = await hashPw(oldPassword);
      if (auth.user.hash !== oldHash) return respond({ error: 'Current password is incorrect' }, 401);
    }
    const users = await getUsers(store);
    const u = users.find(x => x.id === userId);
    if (!u) return respond({ error: 'User not found' }, 404);
    u.hash = await hashPw(newPassword);
    await saveUsers(store, users);
    return respond({ ok: true });
  }

  // ── DELETE USER (admin only) ──
  if (action === 'deleteUser') {
    const auth = await validateAuth(store, token);
    if (!auth) return respond({ error: 'Not authenticated' }, 401);
    if (auth.user.role !== 'admin') return respond({ error: 'Admin access required' }, 403);
    const { userId } = body;
    if (auth.user.id === userId) return respond({ error: 'Cannot delete your own account' }, 400);
    const users = await getUsers(store);
    const u = users.find(x => x.id === userId);
    if (!u) return respond({ error: 'User not found' }, 404);
    await saveUsers(store, users.filter(x => x.id !== userId));
    // Remove their sessions
    const sessions = await getSessions(store);
    for (const [k, v] of Object.entries(sessions)) {
      if (v.userId === userId) delete sessions[k];
    }
    await saveSessions(store, sessions);
    return respond({ ok: true, deleted: safeUser(u) });
  }

  return respond({ error: 'Unknown action: ' + action }, 400);
};

export const config = {
  path: '/api/users',
};
