// cocapn-proxy-worker.js — Cloudflare Worker
// OpenAI-compatible API proxy for cocapn.ai
// Users hit this with their Cocapn API key, we route to the right provider.
//
// POST /v1/chat/completions
// GET  /v1/models
//
// This is the CORE of cocapn.ai — the convenience layer.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // Route: chat completions
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      return handleChatCompletion(request, env);
    }

    // Route: model list
    if (path === '/v1/models' && request.method === 'GET') {
      return handleModels(env);
    }

    // Route: health check
    if (path === '/health') {
      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Route: chat UI (serve static HTML)
    if (path === '/' || path === '/chat') {
      return new Response(CHAT_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};

// ─── Provider Routing ───

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
  // 1. Authenticate the Cocapn user
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: { message: 'Missing Authorization header. Use: Bearer your-cocapn-api-key', type: 'auth_error' } }, 401);
  }
  const cocapnKey = authHeader.slice(7);

  // In production: validate key against KV/D1, check rate limits, check subscription tier
  // For now: accept any non-empty key (dev mode)
  if (!cocapnKey || cocapnKey.length < 8) {
    return jsonResponse({ error: { message: 'Invalid API key', type: 'auth_error' } }, 401);
  }

  // 2. Parse request
  const body = await request.json();
  const model = body.model || 'deepseek-chat';
  const messages = body.messages || [];
  const stream = body.stream || false;
  const maxTokens = body.max_tokens || 4096;

  // 3. Resolve provider
  const config = PROVIDERS[model];
  if (!config) {
    return jsonResponse({ error: { message: `Unknown model: ${model}. Available: ${Object.keys(PROVIDERS).join(', ')}`, type: 'invalid_request_error' } }, 400);
  }

  // 4. Get provider API key from env
  const providerKey = env[`${config.provider.toUpperCase()}_API_KEY`];
  if (!providerKey) {
    return jsonResponse({ error: { message: `Provider ${config.provider} is not configured. Contact admin.`, type: 'server_error' } }, 503);
  }

  // 5. Forward to provider
  try {
    if (config.provider === 'anthropic') {
      return await proxyAnthropic(config, messages, providerKey, maxTokens, stream);
    } else {
      return await proxyOpenAI(config, messages, providerKey, maxTokens, stream, body);
    }
  } catch (err) {
    return jsonResponse({ error: { message: `Provider error: ${err.message}`, type: 'server_error' } }, 502);
  }
}

// ─── OpenAI-compatible Proxy (DeepSeek, Google via OpenAI format, OpenAI) ───

async function proxyOpenAI(config, messages, apiKey, maxTokens, stream, body) {
  const upstreamUrl = `${config.base}/v1/chat/completions`;

  const proxyBody = {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    stream,
    temperature: body.temperature,
    top_p: body.top_p,
  };

  const resp = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(proxyBody),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: `Upstream ${resp.status}` } }));
    return jsonResponse(err, resp.status);
  }

  if (stream) {
    // Stream through
    return new Response(resp.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Cocapn-Model': config.model,
        'X-Cocapn-Provider': config.provider,
        ...corsHeaders(),
      },
    });
  }

  const data = await resp.json();

  // Add Cocapn cost metadata
  const tokensIn = data.usage?.prompt_tokens || 0;
  const tokensOut = data.usage?.completion_tokens || 0;
  const costRaw = (tokensIn / 1_000_000) * config.costIn + (tokensOut / 1_000_000) * config.costOut;

  // In production: log usage to D1, update user's daily spend

  return jsonResponse(data, 200, {
    'X-Cocapn-Cost-Raw': costRaw.toFixed(6),
    'X-Cocapn-Tokens': `${tokensIn},${tokensOut}`,
    'X-Cocapn-Model': config.model,
    'X-Cocapn-Provider': config.provider,
  });
}

// ─── Anthropic Proxy ───

async function proxyAnthropic(config, messages, apiKey, maxTokens, stream) {
  // Convert OpenAI messages to Anthropic format
  const systemMsg = messages.find(m => m.role === 'system');
  const anthropicMsgs = messages.filter(m => m.role !== 'system');

  const proxyBody = {
    model: config.model,
    max_tokens: maxTokens,
    messages: anthropicMsgs,
    stream,
  };
  if (systemMsg) proxyBody.system = systemMsg.content;

  const resp = await fetch(`${config.base}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(proxyBody),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: `Anthropic ${resp.status}` } }));
    return jsonResponse(err, resp.status);
  }

  if (stream) {
    return new Response(resp.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...corsHeaders(),
      },
    });
  }

  const data = await resp.json();

  // Convert Anthropic response to OpenAI format
  const tokensIn = data.usage?.input_tokens || 0;
  const tokensOut = data.usage?.output_tokens || 0;
  const costRaw = (tokensIn / 1_000_000) * config.costIn + (tokensOut / 1_000_000) * config.costOut;

  const openaiResponse = {
    id: data.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: config.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: data.content[0]?.text || '' },
      finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason,
    }],
    usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: tokensIn + tokensOut },
  };

  return jsonResponse(openaiResponse, 200, {
    'X-Cocapn-Cost-Raw': costRaw.toFixed(6),
    'X-Cocapn-Tokens': `${tokensIn},${tokensOut}`,
  });
}

// ─── Models Endpoint ───

async function handleModels(env) {
  const models = Object.entries(PROVIDERS).map(([id, cfg]) => ({
    id,
    object: 'model',
    created: 1700000000,
    owned_by: cfg.provider,
    cocapn_cost_in: cfg.costIn,
    cocapn_cost_out: cfg.costOut,
  }));
  return jsonResponse({ object: 'list', data: models });
}

// ─── Helpers ───

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

// ─── Chat HTML (embedded for single-worker deployment) ───
// In production this would be a separate static site or Pages project

const CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cocapn — AI Chat</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0B1426;--surface:#1E293B;--border:#334155;--text:#E2E8F0;--dim:#94A3B8;--accent:#00D4AA;--user:#1E3A5F;--danger:#EF4444}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0}
.hdr h1{font-size:18px}.hdr h1 span{color:var(--accent)}
.hdr-r{display:flex;align-items:center;gap:12px}
select{background:var(--bg);color:var(--text);border:1px solid var(--border);padding:6px 12px;border-radius:6px;font-size:13px}
.chat{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px}
.msg{max-width:720px;width:100%;margin:0 auto;animation:fi .2s ease}
.msg-u{margin-left:auto}.msg-u .b{background:var(--user);border-radius:16px 16px 4px 16px;padding:10px 16px}
.msg-a .b{background:var(--surface);border:1px solid var(--border);border-radius:16px 16px 16px 4px;padding:10px 16px;white-space:pre-wrap;word-break:break-word;line-height:1.6}
.msg-e .b{border:1px solid var(--danger);color:var(--danger)}
.meta{font-size:11px;color:var(--dim);margin-top:4px;text-align:right}
.typing{display:none;max-width:720px;width:100%;margin:0 auto}
.typing.on{display:block}
.typing .b{background:var(--surface);border:1px solid var(--border);border-radius:16px 16px 16px 4px;padding:12px 18px;color:var(--dim);font-size:13px}
.inp{padding:16px 20px;border-top:1px solid var(--border);background:var(--surface);flex-shrink:0}
.inp-r{max-width:720px;margin:0 auto;display:flex;gap:8px}
.inp-r textarea{flex:1;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;padding:10px 16px;font-size:14px;font-family:inherit;resize:none;line-height:1.5}
.inp-r textarea:focus{outline:none;border-color:var(--accent)}
.inp-r textarea::placeholder{color:var(--dim)}
.btn{background:var(--accent);color:var(--bg);border:none;border-radius:12px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer}
.btn:disabled{opacity:.4;cursor:not-allowed}
.bar{text-align:center;padding:6px;font-size:11px;color:var(--dim);background:var(--bg);border-top:1px solid var(--border)}
.bar strong{color:var(--accent)}
.welcome{text-align:center;padding:60px 20px;color:var(--dim)}
.welcome h2{font-size:24px;color:var(--text);margin-bottom:8px}
.welcome p{max-width:400px;margin:0 auto 24px;line-height:1.6}
.qa{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.qa button{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 16px;border-radius:20px;font-size:13px;cursor:pointer}
.qa button:hover{border-color:var(--accent);color:var(--accent)}
@keyframes fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:600px){.msg,.inp-r,.typing,.welcome{max-width:100%}}
</style>
</head>
<body>
<div class="hdr"><h1><span>cocapn</span>.ai</h1><div class="hdr-r"><select id="ms"></select></div></div>
<div class="chat" id="chat">
<div class="welcome" id="w"><h2>What can I help with?</h2><p>Chat with any AI model. Switch freely. See what it costs.</p>
<div class="qa"><button onclick="si('Explain quantum computing simply')">Quantum computing</button><button onclick="si('Write a Python sort function')">Sort function</button><button onclick="si('REST API best practices')">REST APIs</button><button onclick="si('Help me debug a TypeError')">Debug error</button></div></div>
<div class="typing" id="ty"><div class="b">● ● ●</div></div></div>
<div class="inp"><div class="inp-r"><textarea id="ui" rows="1" placeholder="Message cocapn.ai..." onkeydown="hk(event)"></textarea><button class="btn" id="sb" onclick="send()">Send</button></div></div>
<div class="bar" id="cb">Tokens: <strong>0</strong></div>
<script>
const M=[{id:'deepseek-chat',n:'DeepSeek V3',ci:0.14,co:0.28},{id:'deepseek-reasoner',n:'DeepSeek R1',ci:0.55,co:2.19},{id:'gemini-2.5-flash',n:'Gemini Flash',ci:0.15,co:0.6},{id:'gemini-2.5-pro',n:'Gemini Pro',ci:1.25,co:10},{id:'gpt-4o-mini',n:'GPT-4o Mini',ci:0.15,co:0.6},{id:'gpt-4o',n:'GPT-4o',ci:2.5,co:10},{id:'claude-3-5-haiku',n:'Claude Haiku',ci:0.8,co:4},{id:'claude-3-5-sonnet',n:'Claude Sonnet',ci:3,co:15}];
let msgs=[],cm=M[0],ti=0,to=0,cr=0;
const sel=document.getElementById('ms');
M.forEach((m,i)=>{const o=document.createElement('option');o.value=i;o.textContent=m.n;sel.appendChild(o)});
sel.onchange=()=>cm=M[sel.value];
const ta=document.getElementById('ui');
ta.oninput=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px'};
function si(t){ta.value=t;ta.focus()}
function hk(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}
function am(r,c,mt){const ch=document.getElementById('chat'),ty=document.getElementById('ty'),w=document.getElementById('w');if(w)w.style.display='none';const d=document.createElement('div');d.className='msg msg-'+r;d.innerHTML='<div class="b">'+esc(c)+'</div>'+(mt?'<div class="meta">'+mt+'</div>':'');ch.insertBefore(d,ty);ch.scrollTop=ch.scrollHeight}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML}
function st(s){document.getElementById('ty').classList.toggle('on',s);document.getElementById('chat').scrollTop=999999}
function uc(){document.getElementById('cb').innerHTML='Cost: <strong>$'+cr.toFixed(4)+'</strong> | Tokens: <strong>'+ti.toLocaleString()+' in / '+to.toLocaleString()+' out</strong>'}
async function send(){const t=ta.value.trim();if(!t)return;ta.value='';ta.style.height='auto';document.getElementById('sb').disabled=true;msgs.push({role:'user',content:t});am('u',t);st(true);try{const r=await fetch('/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+lk()},body:JSON.stringify({model:cm.id,messages:msgs,max_tokens:4096})});const d=await r.json();st(false);if(d.error){am('e',d.error.message);msgs.pop();return}const txt=d.choices[0].message.content;msgs.push({role:'assistant',content:txt});const ni=d.usage.prompt_tokens,no=d.usage.completion_tokens;ti+=ni;to+=no;const c=(ni/1e6)*cm.ci+(no/1e6)*cm.co;cr+=c;uc();am('a',txt,cm.n+' · '+(ni+no)+' tok · $'+c.toFixed(4))}catch(e){st(false);am('e',e.message);msgs.pop()}document.getElementById('sb').disabled=false;ta.focus()}
function lk(){let k=localStorage.getItem('ck');if(!k){k=prompt('Enter your Cocapn API key (or any key for demo):');if(k)localStorage.setItem('ck',k)}return k||'demo'}
</script>
</body>
</html>`;
