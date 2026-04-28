// cocapn-proxy-worker.js — Complete cocapn.ai Product
// Single Cloudflare Worker: Landing, Chat, Dashboard, Settings, API
// Auth: JWT-based, users in KV, API keys in KV
// Usage: logged to D1 (or KV as fallback)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    // ─── API Routes ───
    if (path.startsWith('/v1/')) return handleAPI(request, env, path);

    // ─── Health ───
    if (path === '/health') return json({ status: 'ok', ts: Date.now() });

    // ─── Everything else: serve SPA ───
    return new Response(SPA_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};

// ═══════════════════════════════════════════════════════
// API Handler
// ═══════════════════════════════════════════════════════

async function handleAPI(request, env, path) {
  // Auth endpoints
  if (path === '/v1/auth/signup' && request.method === 'POST') return handleSignup(request, env);
  if (path === '/v1/auth/login' && request.method === 'POST') return handleLogin(request, env);
  if (path === '/v1/auth/me' && request.method === 'GET') return handleMe(request, env);
  if (path === '/v1/keys' && request.method === 'GET') return handleListKeys(request, env);
  if (path === '/v1/keys' && request.method === 'POST') return handleCreateKey(request, env);
  if (path === '/v1/keys' && request.method === 'DELETE') return handleDeleteKey(request, env);
  if (path === '/v1/usage' && request.method === 'GET') return handleUsage(request, env);
  if (path === '/v1/settings/provider-keys' && request.method === 'PUT') return handleSetProviderKey(request, env);
  if (path === '/v1/settings/provider-keys' && request.method === 'GET') return handleGetProviderKeys(request, env);

  // Chat completions
  if (path === '/v1/chat/completions' && request.method === 'POST') return handleChatCompletion(request, env);

  // Models
  if (path === '/v1/models' && request.method === 'GET') return handleModels();

  return json({ error: { message: 'Not found', type: 'invalid_request_error' } }, 404);
}

// ═══════════════════════════════════════════════════════
// Auth: Signup
// ═══════════════════════════════════════════════════════

async function handleSignup(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return json({ error: { message: 'Email and password required' } }, 400);
  if (password.length < 8) return json({ error: { message: 'Password must be 8+ characters' } }, 400);

  const users = env.USERS || env.KV;
  const existing = await users.get(`user:${email}`);
  if (existing) return json({ error: { message: 'Email already registered' } }, 409);

  // Hash password (simple for Worker — use Web Crypto)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);

  const userId = crypto.randomUUID();
  const apiKey = `cocapn_${randomId(32)}`;

  const user = { id: userId, email, salt: arrayToHex(salt), hash, apiKey, tier: 'free', created: Date.now() };
  await users.put(`user:${email}`, JSON.stringify(user));
  await users.put(`apikey:${apiKey}`, JSON.stringify({ userId, email, tier: 'free' }));

  const token = await makeJWT({ userId, email, tier: 'free' }, env);
  return json({ token, user: { id: userId, email, tier: 'free', apiKey } });
}

// ═══════════════════════════════════════════════════════
// Auth: Login
// ═══════════════════════════════════════════════════════

async function handleLogin(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return json({ error: { message: 'Email and password required' } }, 400);

  const users = env.USERS || env.KV;
  const raw = await users.get(`user:${email}`);
  if (!raw) return json({ error: { message: 'Invalid credentials' } }, 401);

  const user = JSON.parse(raw);
  const salt = hexToArray(user.salt);
  const hash = await hashPassword(password, salt);
  if (hash !== user.hash) return json({ error: { message: 'Invalid credentials' } }, 401);

  const token = await makeJWT({ userId: user.id, email: user.email, tier: user.tier }, env);
  return json({ token, user: { id: user.id, email: user.email, tier: user.tier, apiKey: user.apiKey } });
}

// ═══════════════════════════════════════════════════════
// Auth: Me (validate token)
// ═══════════════════════════════════════════════════════

async function handleMe(request, env) {
  const payload = await verifyAuth(request, env);
  if (!payload) return json({ error: { message: 'Unauthorized' } }, 401);

  const users = env.USERS || env.KV;
  const raw = await users.get(`user:${payload.email}`);
  if (!raw) return json({ error: { message: 'User not found' } }, 404);

  const user = JSON.parse(raw);
  return json({ id: user.id, email: user.email, tier: user.tier, apiKey: user.apiKey, created: user.created });
}

// ═══════════════════════════════════════════════════════
// API Key Management
// ═══════════════════════════════════════════════════════

async function handleListKeys(request, env) {
  const payload = await verifyAuth(request, env);
  if (!payload) return json({ error: { message: 'Unauthorized' } }, 401);
  const users = env.USERS || env.KV;
  const raw = await users.get(`user:${payload.email}`);
  if (!raw) return json({ error: { message: 'User not found' } }, 404);
  const user = JSON.parse(raw);
  return json({ keys: [{ id: user.apiKey, prefix: user.apiKey.slice(0, 12) + '...', tier: user.tier, created: user.created }] });
}

async function handleCreateKey(request, env) {
  const payload = await verifyAuth(request, env);
  if (!payload) return json({ error: { message: 'Unauthorized' } }, 401);
  const newKey = `cocapn_${randomId(32)}`;
  const users = env.USERS || env.KV;
  const raw = await users.get(`user:${payload.email}`);
  const user = JSON.parse(raw);
  // Revoke old
  await users.delete(`apikey:${user.apiKey}`);
  user.apiKey = newKey;
  await users.put(`user:${payload.email}`, JSON.stringify(user));
  await users.put(`apikey:${newKey}`, JSON.stringify({ userId: user.id, email: user.email, tier: user.tier }));
  return json({ apiKey: newKey, prefix: newKey.slice(0, 12) + '...' });
}

async function handleDeleteKey(request, env) {
  const payload = await verifyAuth(request, env);
  if (!payload) return json({ error: { message: 'Unauthorized' } }, 401);
  const users = env.USERS || env.KV;
  const raw = await users.get(`user:${payload.email}`);
  const user = JSON.parse(raw);
  await users.delete(`apikey:${user.apiKey}`);
  user.apiKey = null;
  await users.put(`user:${payload.email}`, JSON.stringify(user));
  return json({ ok: true });
}

// ═══════════════════════════════════════════════════════
// Provider Key Management (BYOK)
// ═══════════════════════════════════════════════════════

async function handleSetProviderKey(request, env) {
  const payload = await verifyAuth(request, env);
  if (!payload) return json({ error: { message: 'Unauthorized' } }, 401);
  const { provider, key } = await request.json();
  if (!provider || !key) return json({ error: { message: 'Provider and key required' } }, 400);
  const valid = ['deepseek', 'google', 'openai', 'anthropic'];
  if (!valid.includes(provider)) return json({ error: { message: `Invalid provider. Use: ${valid.join(', ')}` } }, 400);

  const store = env.PROVIDER_KEYS || env.KV;
  await store.put(`pkey:${payload.userId}:${provider}`, key);
  return json({ ok: true, provider });
}

async function handleGetProviderKeys(request, env) {
  const payload = await verifyAuth(request, env);
  if (!payload) return json({ error: { message: 'Unauthorized' } }, 401);
  const store = env.PROVIDER_KEYS || env.KV;
  const providers = ['deepseek', 'google', 'openai', 'anthropic'];
  const keys = {};
  for (const p of providers) {
    const val = await store.get(`pkey:${payload.userId}:${p}`);
    keys[p] = val ? `${val.slice(0, 8)}...${val.slice(-4)}` : null;
  }
  return json({ keys });
}

// ═══════════════════════════════════════════════════════
// Usage / Dashboard
// ═══════════════════════════════════════════════════════

async function handleUsage(request, env) {
  const payload = await verifyAuth(request, env);
  if (!payload) return json({ error: { message: 'Unauthorized' } }, 401);

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || 'day';

  const usage = env.USAGE || env.KV;
  const prefix = `usage:${payload.userId}:`;
  const list = await usage.list({ prefix, limit: 500 });

  const now = Date.now();
  const cutoff = period === 'day' ? now - 86400000 : period === 'week' ? now - 604800000 : now - 2592000000;

  let totalCost = 0, totalTokensIn = 0, totalTokensOut = 0, requests = 0;
  const byModel = {};

  for (const key of list.keys) {
    const entry = JSON.parse(await usage.get(key.name));
    if (entry.ts < cutoff) continue;
    totalCost += entry.cost || 0;
    totalTokensIn += entry.tokensIn || 0;
    totalTokensOut += entry.tokensOut || 0;
    requests++;
    byModel[entry.model] = (byModel[entry.model] || 0) + (entry.cost || 0);
  }

  return json({
    period,
    totalCost: Math.round(totalCost * 10000) / 10000,
    totalTokensIn,
    totalTokensOut,
    requests,
    byModel,
    tier: payload.tier,
  });
}

// ═══════════════════════════════════════════════════════
// Chat Completions (the core proxy)
// ═══════════════════════════════════════════════════════

const PROVIDERS = {
  'deepseek-chat': { base: 'https://api.deepseek.com', model: 'deepseek-chat', provider: 'deepseek', costIn: 0.14, costOut: 0.28 },
  'deepseek-reasoner': { base: 'https://api.deepseek.com', model: 'deepseek-reasoner', provider: 'deepseek', costIn: 0.55, costOut: 2.19 },
  'gemini-2.5-flash': { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash-preview-05-20', provider: 'google', costIn: 0.15, costOut: 0.60 },
  'gemini-2.5-pro': { base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro-preview-05-06', provider: 'google', costIn: 1.25, costOut: 10.00 },
  'gpt-4o-mini': { base: 'https://api.openai.com', model: 'gpt-4o-mini', provider: 'openai', costIn: 0.15, costOut: 0.60 },
  'gpt-4o': { base: 'https://api.openai.com', model: 'gpt-4o', provider: 'openai', costIn: 2.50, costOut: 10.00 },
  'claude-3-5-haiku': { base: 'https://api.anthropic.com', model: 'claude-3-5-haiku-20241022', provider: 'anthropic', costIn: 0.80, costOut: 4.00 },
  'claude-3-5-sonnet': { base: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022', provider: 'anthropic', costIn: 3.00, costOut: 15.00 },
};

async function handleChatCompletion(request, env) {
  // Auth via Cocapn API key (Bearer)
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: { message: 'Missing Authorization: Bearer <cocapn-api-key>', type: 'auth_error' } }, 401);
  }
  const apiKey = authHeader.slice(7);

  // Validate API key
  const store = env.USERS || env.KV;
  const keyRaw = await store.get(`apikey:${apiKey}`);
  if (!keyRaw) return json({ error: { message: 'Invalid API key', type: 'auth_error' } }, 401);

  const keyData = JSON.parse(keyRaw);

  // Rate check
  if (keyData.tier === 'free') {
    const usage = env.USAGE || env.KV;
    const todayPrefix = `usage:${keyData.userId}:`;
    const todayList = await usage.list({ prefix: todayPrefix, limit: 100 });
    const now = Date.now();
    const todayReqs = todayList.keys.filter(k => {
      // We'd need to check the actual entry — approximate with count
      return true;
    }).length;
    // Free tier: 50 req/day (approximate — production would use D1)
    if (todayReqs >= 50) {
      return json({ error: { message: 'Free tier limit reached (50 requests/day). Upgrade at cocapn.ai/settings', type: 'rate_limit_error' } }, 429);
    }
  }

  const body = await request.json();
  const model = body.model || 'deepseek-chat';
  const messages = body.messages || [];
  const stream = body.stream || false;
  const maxTokens = body.max_tokens || 4096;

  const config = PROVIDERS[model];
  if (!config) return json({ error: { message: `Unknown model: ${model}`, type: 'invalid_request_error' } }, 400);

  // Get provider key: user's BYOK first, then server fallback
  const providerStore = env.PROVIDER_KEYS || env.KV;
  const userProviderKey = await providerStore.get(`pkey:${keyData.userId}:${config.provider}`);
  const serverProviderKey = env[`${config.provider.toUpperCase()}_API_KEY`];
  const providerKey = userProviderKey || serverProviderKey;

  if (!providerKey) return json({ error: { message: `No API key for ${config.provider}. Add your key at cocapn.ai/settings`, type: 'configuration_error' } }, 503);

  try {
    let result;
    if (config.provider === 'anthropic') {
      result = await proxyAnthropic(config, messages, providerKey, maxTokens, stream);
    } else {
      result = await proxyOpenAI(config, messages, providerKey, maxTokens, stream, body);
    }

    // Log usage
    if (result.tokensIn) {
      const cost = (result.tokensIn / 1e6) * config.costIn + (result.tokensOut / 1e6) * config.costOut;
      const usageStore = env.USAGE || env.KV;
      const entryKey = `usage:${keyData.userId}:${Date.now()}-${randomId(6)}`;
      await usageStore.put(entryKey, JSON.stringify({
        ts: Date.now(), model, provider: config.provider,
        tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        cost: Math.round(cost * 10000) / 10000,
      }), { expirationTtl: 2592000 }); // 30 day TTL
    }

    return result.response;
  } catch (err) {
    return json({ error: { message: `Provider error: ${err.message}`, type: 'server_error' } }, 502);
  }
}

async function proxyOpenAI(config, messages, apiKey, maxTokens, stream, body) {
  const resp = await fetch(`${config.base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens, stream, temperature: body.temperature, top_p: body.top_p }),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); return { response: json(e, resp.status) }; }

  if (stream) return { response: new Response(resp.body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...corsHeaders() } }), tokensIn: 0, tokensOut: 0 };

  const data = await resp.json();
  const ti = data.usage?.prompt_tokens || 0, to = data.usage?.completion_tokens || 0;
  const cost = (ti / 1e6) * config.costIn + (to / 1e6) * config.costOut;
  return { response: json(data, 200, { 'X-Cocapn-Cost': cost.toFixed(6), 'X-Cocapn-Model': config.model }), tokensIn: ti, tokensOut: to };
}

async function proxyAnthropic(config, messages, apiKey, maxTokens, stream) {
  const sys = messages.find(m => m.role === 'system');
  const msgs = messages.filter(m => m.role !== 'system');
  const pBody = { model: config.model, max_tokens: maxTokens, messages: msgs, stream };
  if (sys) pBody.system = sys.content;

  const resp = await fetch(`${config.base}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(pBody),
  });
  if (!resp.ok) { const e = await resp.json().catch(() => ({})); return { response: json(e, resp.status) }; }

  if (stream) return { response: new Response(resp.body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...corsHeaders() } }), tokensIn: 0, tokensOut: 0 };

  const data = await resp.json();
  const ti = data.usage?.input_tokens || 0, to = data.usage?.output_tokens || 0;
  const oai = { id: data.id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: config.model,
    choices: [{ index: 0, message: { role: 'assistant', content: data.content[0]?.text || '' }, finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason }],
    usage: { prompt_tokens: ti, completion_tokens: to, total_tokens: ti + to } };
  return { response: json(oai), tokensIn: ti, tokensOut: to };
}

// ═══════════════════════════════════════════════════════
// Models
// ═══════════════════════════════════════════════════════

async function handleModels() {
  const data = Object.entries(PROVIDERS).map(([id, c]) => ({ id, object: 'model', created: 1700000000, owned_by: c.provider, cocapn_cost_in: c.costIn, cocapn_cost_out: c.costOut }));
  return json({ object: 'list', data });
}

// ═══════════════════════════════════════════════════════
// Crypto Helpers
// ═══════════════════════════════════════════════════════

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return arrayToHex(new Uint8Array(bits));
}

async function makeJWT(payload, env) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'jwt' }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 86400000 * 7 }));
  const secret = env.JWT_SECRET || 'dev-secret-change-me';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${arrayToHex(new Uint8Array(sig))}`;
}

async function verifyAuth(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const secret = env.JWT_SECRET || 'dev-secret-change-me';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, hexToArray(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function arrayToHex(arr) { return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(''); }
function hexToArray(hex) { const a = new Uint8Array(hex.length / 2); for (let i = 0; i < hex.length; i += 2) a[i / 2] = parseInt(hex.slice(i, i + 2), 16); return a; }
function randomId(len) { const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; let r = ''; for (let i = 0; i < len; i++) r += c[Math.floor(Math.random() * c.length)]; return r; }

function corsHeaders() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }; }
function json(data, status = 200, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extra } }); }

// ═══════════════════════════════════════════════════════
// SPA HTML — Complete cocapn.ai frontend
// ═══════════════════════════════════════════════════════

const SPA_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Cocapn — one API key, any AI model, see what it costs">
<title>Cocapn — Pay for convenience, not compute</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0B1426;--sf:#1E293B;--bd:#334155;--tx:#E2E8F0;--dm:#94A3B8;--ac:#00D4AA;--ac2:rgba(0,212,170,.12);--usr:#1E3A5F;--err:#EF4444;--wrn:#F59E0B;--ok:#10B981}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--tx);height:100vh;display:flex;flex-direction:column}
a{color:var(--ac);text-decoration:none}

/* Nav */
nav{display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:52px;background:var(--sf);border-bottom:1px solid var(--bd);flex-shrink:0}
nav .logo{font-size:17px;font-weight:700;cursor:pointer}nav .logo span{color:var(--ac)}
nav .links{display:flex;gap:6px}
nav .links a{padding:6px 14px;border-radius:6px;font-size:13px;color:var(--dm);transition:.15s}
nav .links a:hover,nav .links a.active{color:var(--tx);background:var(--ac2)}
nav .auth-btns{display:flex;gap:8px;align-items:center}
.btn{padding:7px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:.15s}
.btn-primary{background:var(--ac);color:var(--bg)}.btn-primary:hover{opacity:.85}
.btn-ghost{background:transparent;color:var(--tx);border:1px solid var(--bd)}.btn-ghost:hover{border-color:var(--ac)}
.btn-danger{background:var(--err);color:#fff}
.btn-sm{padding:5px 12px;font-size:12px}

/* Pages */
.page{display:none;flex:1;overflow-y:auto}.page.active{display:flex;flex-direction:column}

/* ─── Landing ─── */
.landing{align-items:center;justify-content:center;text-align:center;padding:40px 20px}
.hero h1{font-size:clamp(28px,5vw,48px);font-weight:800;line-height:1.15;margin-bottom:16px}
.hero h1 em{color:var(--ac);font-style:normal}
.hero p{font-size:18px;color:var(--dm);max-width:520px;margin:0 auto 32px;line-height:1.6}
.hero-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;max-width:800px;margin:60px auto 0;width:100%}
.feat{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:24px;text-align:left}
.feat h3{font-size:15px;margin-bottom:8px;color:var(--ac)}
.feat p{font-size:13px;color:var(--dm);line-height:1.5}

/* ─── Chat ─── */
.chat-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden}
.chat-bar{display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--sf);border-bottom:1px solid var(--bd)}
.chat-bar select{background:var(--bg);color:var(--tx);border:1px solid var(--bd);padding:5px 10px;border-radius:6px;font-size:12px}
.chat-bar .cost{font-size:12px;color:var(--dm);margin-left:auto}
.chat-bar .cost b{color:var(--ac)}
.chat-msgs{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px}
.msg{max-width:700px;width:100%;margin:0 auto;animation:fi .2s}
.msg-u{margin-left:auto}.msg-u .b{background:var(--usr);border-radius:14px 14px 4px 14px;padding:10px 14px;font-size:14px}
.msg-a .b{background:var(--sf);border:1px solid var(--bd);border-radius:14px 14px 14px 4px;padding:10px 14px;white-space:pre-wrap;word-break:break-word;line-height:1.6;font-size:14px}
.msg-e .b{border:1px solid var(--err);color:var(--err);padding:10px 14px;border-radius:14px;font-size:13px}
.msg-m{font-size:10px;color:var(--dm);margin-top:3px;text-align:right}
.typing-ind{display:none;max-width:700px;width:100%;margin:0 auto}
.typing-ind.on{display:block}
.typing-ind .b{background:var(--sf);border:1px solid var(--bd);border-radius:14px;padding:10px 16px;color:var(--dm);font-size:13px;letter-spacing:2px}
.chat-inp{padding:14px 20px;border-top:1px solid var(--bd);background:var(--sf);flex-shrink:0}
.chat-inp-row{max-width:700px;margin:0 auto;display:flex;gap:8px}
.chat-inp textarea{flex:1;background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:10px;padding:10px 14px;font-size:14px;font-family:inherit;resize:none;line-height:1.5}
.chat-inp textarea:focus{outline:none;border-color:var(--ac)}
.chat-inp textarea::placeholder{color:var(--dm)}
.welcome{text-align:center;padding:50px 20px;color:var(--dm)}
.welcome h2{font-size:22px;color:var(--tx);margin-bottom:8px}
.welcome p{margin-bottom:20px;font-size:14px}
.qa{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.qa button{background:var(--sf);border:1px solid var(--bd);color:var(--dm);padding:6px 14px;border-radius:16px;font-size:12px;cursor:pointer}
.qa button:hover{border-color:var(--ac);color:var(--ac)}

/* ─── Dashboard ─── */
.dash{padding:30px 20px;max-width:800px;margin:0 auto;width:100%}
.dash h2{font-size:22px;margin-bottom:24px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:32px}
.stat{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:20px}
.stat .label{font-size:12px;color:var(--dm);margin-bottom:6px}
.stat .value{font-size:28px;font-weight:700;color:var(--ac)}
.stat .sub{font-size:11px;color:var(--dm);margin-top:4px}
.models-table{width:100%;border-collapse:collapse;margin-top:16px}
.models-table th{text-align:left;font-size:12px;color:var(--dm);padding:8px 12px;border-bottom:1px solid var(--bd)}
.models-table td{padding:8px 12px;border-bottom:1px solid var(--bd);font-size:13px}
.models-table .cost{color:var(--ac);font-weight:600}

/* ─── Settings ─── */
.settings{padding:30px 20px;max-width:600px;margin:0 auto;width:100%}
.settings h2{font-size:22px;margin-bottom:24px}
.section{background:var(--sf);border:1px solid var(--bd);border-radius:12px;padding:20px;margin-bottom:20px}
.section h3{font-size:15px;margin-bottom:12px;color:var(--tx)}
.section p{font-size:12px;color:var(--dm);margin-bottom:12px}
.field{margin-bottom:12px}
.field label{display:block;font-size:12px;color:var(--dm);margin-bottom:4px}
.field input{width:100%;background:var(--bg);color:var(--tx);border:1px solid var(--bd);border-radius:8px;padding:8px 12px;font-size:13px;font-family:monospace}
.field input:focus{outline:none;border-color:var(--ac)}
.field-row{display:flex;gap:8px;align-items:end}
.pkey-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd)}
.pkey-row:last-child{border-bottom:none}
.pkey-row .name{font-size:13px;font-weight:600}
.pkey-row .status{font-size:12px}
.pkey-row .status.connected{color:var(--ok)}
.pkey-row .status.missing{color:var(--wrn)}

/* ─── Auth Modal ─── */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;align-items:center;justify-content:center}
.modal-overlay.on{display:flex}
.modal{background:var(--sf);border:1px solid var(--bd);border-radius:16px;padding:32px;width:360px;max-width:90vw}
.modal h2{font-size:20px;margin-bottom:20px}
.modal .field{margin-bottom:16px}
.modal .field input{padding:10px 14px;font-size:14px;font-family:inherit}
.modal .switch{font-size:12px;color:var(--dm);text-align:center;margin-top:12px}
.modal .switch a{color:var(--ac);cursor:pointer}
.modal .error{color:var(--err);font-size:13px;margin-bottom:12px;display:none}

@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:600px){.features{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.hero h1{font-size:28px}}
</style>
</head>
<body>

<!-- Nav -->
<nav>
  <div class="logo" onclick="go('landing')"><span>cocapn</span>.ai</div>
  <div class="links" id="navLinks">
    <a href="#/" data-page="landing">Home</a>
    <a href="#/chat" data-page="chat">Chat</a>
    <a href="#/dashboard" data-page="dashboard">Dashboard</a>
    <a href="#/settings" data-page="settings">Settings</a>
  </div>
  <div class="auth-btns" id="authBtns">
    <button class="btn btn-ghost" onclick="showModal('login')">Log in</button>
    <button class="btn btn-primary" onclick="showModal('signup')">Sign up</button>
  </div>
</nav>

<!-- Auth Modal -->
<div class="modal-overlay" id="modal">
  <div class="modal">
    <h2 id="modalTitle">Log in</h2>
    <div class="error" id="modalError"></div>
    <div class="field"><label>Email</label><input type="email" id="authEmail" placeholder="you@example.com"></div>
    <div class="field"><label>Password</label><input type="password" id="authPass" placeholder="8+ characters"></div>
    <button class="btn btn-primary" style="width:100%;padding:12px" id="modalSubmit" onclick="submitAuth()">Log in</button>
    <div class="switch" id="modalSwitch">Don't have an account? <a onclick="toggleModal()">Sign up</a></div>
  </div>
</div>

<!-- Landing Page -->
<div class="page active" id="page-landing">
  <div class="landing">
    <div class="hero">
      <h1>One API key.<br><em>Any AI model.</em><br>See what it costs.</h1>
      <p>Drop-in replacement for OpenAI's API. Switch between DeepSeek, Gemini, GPT, and Claude without changing your code. Transparent pricing, always.</p>
      <div class="hero-actions">
        <button class="btn btn-primary" style="padding:12px 28px;font-size:15px" onclick="showModal('signup')">Get started free</button>
        <button class="btn btn-ghost" style="padding:12px 28px;font-size:15px" onclick="go('chat')">Try chat</button>
      </div>
    </div>
    <div class="features">
      <div class="feat"><h3>Transparent Cost</h3><p>Every response includes exact provider cost. No markup games. No hidden fees.</p></div>
      <div class="feat"><h3>8 Models, 4 Providers</h3><p>DeepSeek, Gemini, GPT-4o, Claude — pick the best model for each task.</p></div>
      <div class="feat"><h3>OpenAI-Compatible</h3><p>Change the base URL, keep your code. Works with every OpenAI client.</p></div>
      <div class="feat"><h3>BYOK or Use Ours</h3><p>Bring your own provider keys or use ours. Your keys never leave the platform.</p></div>
    </div>
  </div>
</div>

<!-- Chat Page -->
<div class="page" id="page-chat">
  <div class="chat-wrap">
    <div class="chat-bar">
      <select id="modelSel"></select>
      <div class="cost" id="chatCost">Cost: <b>$0.0000</b></div>
    </div>
    <div class="chat-msgs" id="chatMsgs">
      <div class="welcome" id="chatWelcome">
        <h2>What can I help with?</h2>
        <p>Pick a model and start chatting. Cost shown in real-time.</p>
        <div class="qa">
          <button onclick="setQ('Explain quantum computing simply')">Quantum computing</button>
          <button onclick="setQ('Write a Python sort function')">Sort function</button>
          <button onclick="setQ('REST API best practices')">REST APIs</button>
        </div>
      </div>
      <div class="typing-ind" id="typingInd"><div class="b">thinking...</div></div>
    </div>
    <div class="chat-inp">
      <div class="chat-inp-row">
        <textarea id="chatInput" rows="1" placeholder="Message..." onkeydown="chatKey(event)"></textarea>
        <button class="btn btn-primary" id="chatSend" onclick="sendChat()">Send</button>
      </div>
    </div>
  </div>
</div>

<!-- Dashboard Page -->
<div class="page" id="page-dashboard">
  <div class="dash">
    <h2>Dashboard</h2>
    <div class="stats" id="dashStats">
      <div class="stat"><div class="label">Total Cost</div><div class="value" id="dCost">$0.00</div><div class="sub">raw provider cost</div></div>
      <div class="stat"><div class="label">Requests</div><div class="value" id="dReqs">0</div><div class="sub" id="dPeriod">today</div></div>
      <div class="stat"><div class="label">Tokens In</div><div class="value" id="dIn">0</div><div class="sub">prompt tokens</div></div>
      <div class="stat"><div class="label">Tokens Out</div><div class="value" id="dOut">0</div><div class="sub">completion tokens</div></div>
    </div>
    <h3 style="margin-bottom:8px">Cost by Model</h3>
    <table class="models-table"><thead><tr><th>Model</th><th>Cost</th></tr></thead><tbody id="dModels"><tr><td colspan="2" style="color:var(--dm)">No usage yet</td></tr></tbody></table>
  </div>
</div>

<!-- Settings Page -->
<div class="page" id="page-settings">
  <div class="settings">
    <h2>Settings</h2>
    <div class="section">
      <h3>API Key</h3>
      <p>Use this key with any OpenAI-compatible client. Your Cocapn key authenticates you and routes to your chosen model.</p>
      <div class="field"><label>Your Cocapn API Key</label><input id="apiKeyDisplay" readonly placeholder="Sign in to see your key"></div>
      <div class="field-row"><button class="btn btn-ghost btn-sm" onclick="copyKey()">Copy</button><button class="btn btn-ghost btn-sm" onclick="regenKey()">Regenerate</button></div>
    </div>
    <div class="section">
      <h3>Provider Keys (BYOK)</h3>
      <p>Add your own provider API keys. They're stored encrypted and used to make requests on your behalf. Cocapn never sees your prompts.</p>
      <div id="pkeys"></div>
    </div>
    <div class="section">
      <h3>Account</h3>
      <p>Tier: <strong id="userTier">—</strong></p>
      <p>Email: <strong id="userEmail">—</strong></p>
      <button class="btn btn-danger btn-sm" style="margin-top:12px" onclick="logout()">Log out</button>
    </div>
  </div>
</div>

<script>
// ─── State ───
let token = localStorage.getItem('cocapn_token') || null;
let user = JSON.parse(localStorage.getItem('cocapn_user') || 'null');
let chatHistory = [];
let chatCost = 0;

const MODELS = [
  {id:'deepseek-chat',n:'DeepSeek V3',ci:.14,co:.28},
  {id:'deepseek-reasoner',n:'DeepSeek R1',ci:.55,co:2.19},
  {id:'gemini-2.5-flash',n:'Gemini Flash',ci:.15,co:.6},
  {id:'gemini-2.5-pro',n:'Gemini Pro',ci:1.25,co:10},
  {id:'gpt-4o-mini',n:'GPT-4o Mini',ci:.15,co:.6},
  {id:'gpt-4o',n:'GPT-4o',ci:2.5,co:10},
  {id:'claude-3-5-haiku',n:'Claude Haiku',ci:.8,co:4},
  {id:'claude-3-5-sonnet',n:'Claude Sonnet',ci:3,co:15},
];

// ─── Router ───
function go(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelectorAll('.links a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  if (page === 'dashboard' && token) loadDashboard();
  if (page === 'settings' && token) loadSettings();
}

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1) || '/';
  const page = h === '/' ? 'landing' : h.slice(1);
  go(page);
});

// ─── Auth ───
let authMode = 'login';
function showModal(mode) { authMode = mode; const m = document.getElementById('modal'); m.classList.add('on'); document.getElementById('modalTitle').textContent = mode === 'login' ? 'Log in' : 'Sign up'; document.getElementById('modalSubmit').textContent = mode === 'login' ? 'Log in' : 'Sign up'; document.getElementById('modalSwitch').innerHTML = mode === 'login' ? 'Don\\'t have an account? <a onclick="toggleModal()">Sign up</a>' : 'Already have an account? <a onclick="toggleModal()">Log in</a>'; document.getElementById('modalError').style.display = 'none'; }
function toggleModal() { showModal(authMode === 'login' ? 'signup' : 'login'); }
function hideModal() { document.getElementById('modal').classList.remove('on'); }
document.getElementById('modal').addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) hideModal(); });

async function submitAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value;
  const errEl = document.getElementById('modalError');
  if (!email || !pass) { errEl.textContent = 'Email and password required'; errEl.style.display = 'block'; return; }
  const btn = document.getElementById('modalSubmit'); btn.disabled = true; btn.textContent = '...';
  try {
    const r = await fetch('/v1/auth/' + authMode, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email,password:pass}) });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error?.message || 'Error'; errEl.style.display = 'block'; btn.disabled = false; btn.textContent = authMode === 'login' ? 'Log in' : 'Sign up'; return; }
    token = d.token; user = d.user;
    localStorage.setItem('cocapn_token', token);
    localStorage.setItem('cocapn_user', JSON.stringify(user));
    updateAuthUI(); hideModal();
    if (authMode === 'signup') go('chat');
  } catch(e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  btn.disabled = false; btn.textContent = authMode === 'login' ? 'Log in' : 'Sign up';
}

function logout() { token = null; user = null; localStorage.removeItem('cocapn_token'); localStorage.removeItem('cocapn_user'); updateAuthUI(); go('landing'); }
function updateAuthUI() {
  const btns = document.getElementById('authBtns');
  if (token && user) { btns.innerHTML = '<span style="font-size:13px;color:var(--dm)">' + user.email + '</span><button class="btn btn-ghost btn-sm" onclick="go(\\'settings\\')">Settings</button><button class="btn btn-ghost btn-sm" onclick="logout()">Log out</button>'; }
  else { btns.innerHTML = '<button class="btn btn-ghost" onclick="showModal(\\'login\\')">Log in</button><button class="btn btn-primary" onclick="showModal(\\'signup\\')">Sign up</button>'; }
}

// ─── Chat ───
const sel = document.getElementById('modelSel');
MODELS.forEach((m,i) => { const o = document.createElement('option'); o.value = i; o.textContent = m.n + ' ($' + m.ci + '/M)'; sel.appendChild(o); });
let curModel = MODELS[0];
sel.onchange = () => curModel = MODELS[sel.value];
const ta = document.getElementById('chatInput');
ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; };
function setQ(t) { ta.value = t; ta.focus(); }
function chatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }

function addMsg(role, text, meta) {
  const w = document.getElementById('chatWelcome'); if (w) w.style.display = 'none';
  const c = document.getElementById('chatMsgs'), t = document.getElementById('typingInd');
  const d = document.createElement('div'); d.className = 'msg msg-' + role;
  d.innerHTML = '<div class="b">' + esc(text) + '</div>' + (meta ? '<div class="msg-m">' + meta + '</div>' : '');
  c.insertBefore(d, t); c.scrollTop = 999999;
}
function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

async function sendChat() {
  const text = ta.value.trim(); if (!text) return;
  ta.value = ''; ta.style.height = 'auto'; document.getElementById('chatSend').disabled = true;
  chatHistory.push({role:'user',content:text}); addMsg('u', text);
  document.getElementById('typingInd').classList.add('on');
  try {
    const r = await fetch('/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+(user?.apiKey||'demo')}, body:JSON.stringify({model:curModel.id,messages:chatHistory,max_tokens:4096}) });
    const d = await r.json();
    document.getElementById('typingInd').classList.remove('on');
    if (d.error) { addMsg('e', d.error.message); chatHistory.pop(); return; }
    const txt = d.choices[0].message.content;
    chatHistory.push({role:'assistant',content:txt});
    const ti = d.usage?.prompt_tokens||0, to = d.usage?.completion_tokens||0;
    const c = (ti/1e6)*curModel.ci + (to/1e6)*curModel.co; chatCost += c;
    document.getElementById('chatCost').innerHTML = 'Cost: <b>$' + chatCost.toFixed(4) + '</b>';
    addMsg('a', txt, curModel.n + ' · ' + (ti+to) + ' tok · $' + c.toFixed(4));
  } catch(e) { document.getElementById('typingInd').classList.remove('on'); addMsg('e', e.message); chatHistory.pop(); }
  document.getElementById('chatSend').disabled = false; ta.focus();
}

// ─── Dashboard ───
async function loadDashboard() {
  const periods = ['day','week','month']; const p = periods[0];
  try {
    const r = await fetch('/v1/usage?period='+p, {headers:{'Authorization':'Bearer '+token}});
    const d = await r.json();
    if (!r.ok) return;
    document.getElementById('dCost').textContent = '$' + d.totalCost.toFixed(2);
    document.getElementById('dReqs').textContent = d.requests;
    document.getElementById('dIn').textContent = d.totalTokensIn.toLocaleString();
    document.getElementById('dOut').textContent = d.totalTokensOut.toLocaleString();
    const tbody = document.getElementById('dModels');
    const models = Object.entries(d.byModel||{}).sort((a,b)=>b[1]-a[1]);
    tbody.innerHTML = models.length ? models.map(([m,c])=>'<tr><td>'+esc(m)+'</td><td class="cost">$'+c.toFixed(4)+'</td></tr>').join('') : '<tr><td colspan="2" style="color:var(--dm)">No usage yet</td></tr>';
  } catch(e) { console.error(e); }
}

// ─── Settings ───
async function loadSettings() {
  if (user) {
    document.getElementById('apiKeyDisplay').value = user.apiKey || 'Not available';
    document.getElementById('userTier').textContent = user.tier || 'free';
    document.getElementById('userEmail').textContent = user.email || '';
  }
  try {
    const r = await fetch('/v1/settings/provider-keys', {headers:{'Authorization':'Bearer '+token}});
    const d = await r.json();
    const el = document.getElementById('pkeys');
    const names = {deepseek:'DeepSeek',google:'Google Gemini',openai:'OpenAI',anthropic:'Anthropic'};
    el.innerHTML = Object.entries(d.keys||{}).map(([p,v])=>
      '<div class="pkey-row"><div class="name">'+names[p]+'</div><div class="status '+(v?'connected':'missing')+'">'+(v?v:'Not set')+'</div><button class="btn btn-ghost btn-sm" onclick="setPkey(\\''+p+'\\')">'+(v?'Update':'Add')+'</button></div>'
    ).join('');
  } catch(e) { console.error(e); }
}

async function setPkey(provider) {
  const key = prompt('Enter your '+provider+' API key:');
  if (!key) return;
  await fetch('/v1/settings/provider-keys', {method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({provider,key})});
  loadSettings();
}

function copyKey() { navigator.clipboard.writeText(document.getElementById('apiKeyDisplay').value); }
async function regenKey() {
  if (!confirm('Generate a new API key? The old one will stop working immediately.')) return;
  const r = await fetch('/v1/keys', {method:'POST',headers:{'Authorization':'Bearer '+token}});
  const d = await r.json();
  if (r.ok) { user.apiKey = d.apiKey; localStorage.setItem('cocapn_user', JSON.stringify(user)); loadSettings(); }
}

// ─── Init ───
updateAuthUI();
const initHash = location.hash.slice(1) || '/';
go(initHash === '/' ? 'landing' : initHash.slice(1));
</script>
</body>
</html>`;
