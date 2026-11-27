// Accounts and cloud sync (Supabase free tier). Optional: with no config the site stays local-only.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
let client = null, user = null, listeners = [], pushTimer = null, lastPushed = "";

let clientP = null;
function sb() {
  if (!cloudEnabled) return Promise.resolve(null);
  if (!clientP) clientP = (async () => {                // one shared client, even if called concurrently
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    client.auth.onAuthStateChange((ev, session) => { user = session ? session.user : null; listeners.forEach(f => f(user, ev)); });
    return client;
  })();
  return clientP;
}

export function currentUser() { return user; }
export function onAuth(fn) { listeners.push(fn); }
export function displayName(u = user) { return u ? (u.user_metadata && u.user_metadata.name) || u.email.split("@")[0] : ""; }

export async function init() {
  const c = await sb(); if (!c) return null;
  const { data } = await c.auth.getSession();
  user = data.session ? data.session.user : null;
  return user;
}

const redirect = () => location.origin + location.pathname;
export async function signUp(email, password, name) {
  const c = await sb();
  const { data, error } = await c.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: redirect() } });
  if (error) throw error;
  return { needsConfirm: !data.session, user: data.user };
}
export async function signIn(email, password) {
  const c = await sb();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function magicLink(email) {
  const c = await sb();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect() } });
  if (error) throw error;
}
export async function resetPassword(email) {
  const c = await sb();
  const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: redirect() + "#/account" });
  if (error) throw error;
}
export async function updatePassword(password) {
  const c = await sb();
  const { error } = await c.auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() { const c = await sb(); if (c) await c.auth.signOut(); user = null; }
export async function deleteAccount() {
  const c = await sb();
  const { error } = await c.rpc("delete_my_account");
  if (error) throw error;
  await c.auth.signOut(); user = null;
}

// ---------------- progress sync ----------------
export async function pull() {
  const c = await sb(); if (!c || !user) return null;
  const { data, error } = await c.from("progress").select("data, updated_at").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}
export async function push(db) {
  const c = await sb(); if (!c || !user) return;
  const body = JSON.stringify(db);
  if (body === lastPushed) return;
  const { error } = await c.from("progress").upsert({ user_id: user.id, data: db, updated_at: new Date().toISOString() });
  if (error) throw error;
  lastPushed = body;
}
export function schedulePush(db, onState) {
  if (!cloudEnabled || !user) return;
  clearTimeout(pushTimer);
  onState && onState("saving");
  pushTimer = setTimeout(async () => {
    try { await push(db); onState && onState("saved"); } catch (e) { onState && onState("error", e); }
  }, 1500);
}
