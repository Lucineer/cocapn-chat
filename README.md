# cocapn.ai — Chat

The chat interface and API proxy for cocapn.ai. A single Cloudflare Worker that serves both the web UI and the OpenAI-compatible API.

## What It Does

1. **Web chat UI** at `/` — Pick a model, type a message, get a response. See cost in real-time.
2. **OpenAI-compatible API** at `/v1/chat/completions` — Drop-in replacement for OpenAI's API. Works with any client that talks to OpenAI.
3. **Model listing** at `/v1/models` — Shows all available models with cost info.

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

## Quick Start (Dev)

```bash
npm install
node server.js
# Open http://localhost:3000
```

## Deploy to Cloudflare

```bash
# Set provider API keys (one-time, via dashboard)
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GOOGLE_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY

# Deploy
wrangler deploy
```

## API Usage

```bash
# List models
curl https://cocapn.ai/v1/models \
  -H "Authorization: Bearer your-key"

# Chat completion
curl https://cocapn.ai/v1/chat/completions \
  -H "Authorization: Bearer your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Response includes cost headers:
```
X-Cocapn-Cost-Raw: 0.000042
X-Cocapn-Tokens: 15,47
X-Cocapn-Provider: deepseek
```

## Architecture

```
User → cocapn.ai/v1/chat/completions
         ↓
    Cloudflare Worker (this repo)
         ↓
    Route by model name
         ↓
    ┌────────────┬────────────┬────────────┬──────────┐
    │ DeepSeek   │ Google     │ OpenAI     │ Anthropic│
    │ /v1/chat   │ /v1beta/   │ /v1/chat   │ /v1/msg  │
    └────────────┴────────────┴────────────┴──────────┘
```

- Single worker handles routing, auth, and cost tracking
- Provider API keys stored in Cloudflare Secrets (never in code)
- Anthropic responses converted to OpenAI format for compatibility
- Streaming supported (pass `"stream": true`)
- CORS enabled for browser access

## Why This Exists

Most AI API proxies add complexity. Cocapn adds **transparency**:
- You see exactly what each request costs (raw provider cost)
- You can switch models without changing code
- One API key, one endpoint, any model
- The margin is transparent (see pricing)

## Files

- `cocapn-proxy-worker.js` — The Cloudflare Worker (API + chat UI in one file)
- `public/index.html` — Standalone chat UI (for local dev / non-Worker hosting)
- `server.js` — Express dev server (serves public/ locally)
- `wrangler.toml` — Cloudflare Worker config
