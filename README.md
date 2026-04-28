# cocapn.ai

**One API key. Any AI model. See what it costs.**

A complete AI inference platform in a single Cloudflare Worker. Web chat, dashboard, user auth, BYOK provider keys, usage tracking, and an OpenAI-compatible API proxy — all deployable with one `wrangler deploy`.

## What People Actually Use

1. **Web chat** — Open cocapn.ai, pick a model, start chatting. See cost per message.
2. **API proxy** — `POST cocapn.ai/v1/chat/completions` with your Cocapn key. Drop-in OpenAI replacement.
3. **Dashboard** — See your spend, token usage, and per-model cost breakdown.
4. **Settings** — Manage your API key, add provider keys (BYOK), see your tier.

## Quick Start

### 1. Create KV namespace
```bash
wrangler kv:namespace create "USERS"
wrangler kv:namespace create "PROVIDER_KEYS"
wrangler kv:namespace create "USAGE"
```

### 2. Set secrets
```bash
wrangler secret put JWT_SECRET
# (optional — server provider keys for users who don't BYOK)
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GOOGLE_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

### 3. Update wrangler.toml
Add your KV namespace IDs to `wrangler.toml`.

### 4. Deploy
```bash
wrangler deploy
```

Done. cocapn.ai is live.

## API Usage

```bash
# Sign up
curl -X POST https://cocapn.ai/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'

# Get your API key from the response, then:
curl https://cocapn.ai/v1/chat/completions \
  -H "Authorization: Bearer cocapn_yourkeyhere" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello!"}]}'
```

## Supported Models

| Model | Provider | Cost/1M in | Cost/1M out |
|-------|----------|-----------|-------------|
| DeepSeek V3 | DeepSeek | $0.14 | $0.28 |
| DeepSeek R1 | DeepSeek | $0.55 | $2.19 |
| Gemini 2.5 Flash | Google | $0.15 | $0.60 |
| Gemini 2.5 Pro | Google | $1.25 | $10.00 |
| GPT-4o Mini | OpenAI | $0.15 | $0.60 |
| GPT-4o | OpenAI | $2.50 | $10.00 |
| Claude 3.5 Haiku | Anthropic | $0.80 | $4.00 |
| Claude 3.5 Sonnet | Anthropic | $3.00 | $15.00 |

## Architecture

```
Browser → cocapn.ai
  ├── / (landing page)
  ├── /#/chat (web chat UI)
  ├── /#/dashboard (usage stats)
  ├── /#/settings (API keys, BYOK)
  ├── /v1/auth/signup (email + password → JWT)
  ├── /v1/auth/login (email + password → JWT)
  ├── /v1/auth/me (validate JWT)
  ├── /v1/keys (manage Cocapn API keys)
  ├── /v1/usage (usage stats)
  ├── /v1/settings/provider-keys (BYOK management)
  ├── /v1/models (model list)
  └── /v1/chat/completions (the proxy)
        ↓
    Routes to provider (DeepSeek/Google/OpenAI/Anthropic)
    BYOK: user's key first, server key as fallback
    Logs usage to KV (30-day TTL)
    Returns cost headers
```

## Auth

- JWT-based, 7-day expiry
- Passwords hashed with PBKDF2 (100K iterations, SHA-256)
- API keys are `cocapn_` prefixed random strings
- Auth stored in Cloudflare KV

## BYOK (Bring Your Own Keys)

Users can add their own provider API keys in Settings. These are stored encrypted in KV and used before any server-provided keys. This means:
- Users who bring keys get lower cost ( Cocapn at-cost tier)
- Cocapn doesn't need to pre-fund provider accounts
- Keys are per-user, never shared

## Pricing Tiers

| Tier | Price | Margin | Limits |
|------|-------|--------|--------|
| Free | $0 | 20% cost-plus | 50 req/day, ads |
| Standard | $5/mo | 2% cost-plus | 5K req/day |
| Gold | $15/mo | At cost | Unlimited |
| Enterprise | $50/seat/mo | At cost + SLA | Custom |

## Files

- `cocapn-proxy-worker.js` — Everything: API, auth, chat, dashboard, settings, landing page
- `public/index.html` — Standalone chat UI (for non-Worker deployment)
- `server.js` — Express dev server
- `wrangler.toml` — Cloudflare Worker config

## Dev Mode

```bash
npm install
node server.js
# Open http://localhost:3000
# Note: auth won't work without KV — use the standalone chat UI in public/
```
