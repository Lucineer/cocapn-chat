# ⚡ cocapn.ai

**One API for every AI model.** Smart routing, real-time cost tracking, BYOK support. OpenAI-compatible.

[![npm version](https://img.shields.io/npm/v/cocapn.svg)](https://www.npmjs.com/package/cocapn)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Why cocapn?

- **8 models, 1 API** — DeepSeek, Claude, GPT-4o, Llama, Gemini, and more
- **Smart routing** — Automatically picks the cheapest capable model (60-97% cost savings)
- **BYOK** — Bring Your Own Keys, stored encrypted in Cloudflare Secrets
- **Real-time cost tracking** — See exactly what each request costs
- **OpenAI-compatible** — Drop-in replacement for any OpenAI SDK
- **SDKs** — Node.js, Python, Go

## Quick Start

```bash
# Install SDK
npm install cocapn       # Node.js
pip install cocapn       # Python
go get cocapn-go         # Go

# Or use with curl
curl https://cocapn.ai/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Available Models

| Model | Provider | Input $/1M tokens | Output $/1M tokens | Context |
|-------|----------|-------------------|---------------------|---------|
| deepseek-chat | DeepSeek | $0.14 | $0.28 | 128K |
| deepseek-reasoner | DeepSeek | $0.55 | $2.19 | 128K |
| claude-sonnet-4 | Anthropic | $3.00 | $15.00 | 200K |
| claude-haiku-4 | Anthropic | $0.80 | $4.00 | 200K |
| gpt-4o | OpenAI | $2.50 | $10.00 | 128K |
| gpt-4o-mini | OpenAI | $0.15 | $0.60 | 128K |
| llama-4-maverick | Meta | $0.20 | $0.60 | 128K |
| gemini-2.5-flash | Google | $0.15 | $0.60 | 1M |

## Smart Routing

cocapn automatically routes to the cheapest capable model:

| Task | GPT-4o cost | Routed cost | Savings |
|------|-------------|-------------|---------|
| Simple chat | $2.50/$10.00 | $0.14/$0.28 | **94-97%** |
| Code review | $2.50/$10.00 | $0.80/$4.00 | **60-68%** |
| Math/reasoning | $2.50/$10.00 | $0.55/$2.19 | **78-82%** |
| Analysis | $2.50/$10.00 | $0.20/$0.60 | **92-94%** |

## SDKs

### Node.js

```javascript
import { chat, chatStream } from 'cocapn';

const response = await chat({
  apiKey: 'cpn_your_key',
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'deepseek-chat'
});

console.log(response.content);
console.log(response.costUsd); // $0.0000042
```

### Python

```python
from cocapn import Client

client = Client(api_key="cpn_your_key")
response = client.chat(
    messages=[{"role": "user", "content": "Hello!"}],
    model="deepseek-chat"
)
print(response.content)
```

### Go

```go
client := cocapn.NewClient(cocapn.WithAPIKey("cpn_your_key"))
resp, _ := client.Chat(cocapn.WithMessages(cocapn.UserMessage("Hello!")))
fmt.Println(resp.Content)
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions (OpenAI-compatible) |
| `/v1/models` | GET | List available models |
| `/v1/usage` | GET | Usage statistics |
| `/api/auth/signup` | POST | Create account |
| `/api/auth/login` | POST | Login |
| `/api/dashboard` | GET | Dashboard data |
| `/api/settings/keys` | POST | Manage BYOK keys |

Full docs: [cocapn.ai/docs](https://cocapn.ai/docs)

## Pricing

| Plan | Price | Tokens/day | Models | BYOK |
|------|-------|------------|--------|------|
| Free | $0/mo | 100K | 3 | ✗ |
| Builder | $9/mo | 1M | 8 | ✓ |
| Team | $29/mo | 5M | All | ✓ |
| Enterprise | Custom | Unlimited | All | ✓ |

## Tech Stack

- **Runtime:** Cloudflare Workers (single 42KB worker, no build step)
- **Storage:** Cloudflare KV + D1
- **Auth:** PBKDF2 + JWT
- **Secrets:** Cloudflare Secrets Store (BYOK keys never in code)
- **API:** OpenAI-compatible, Anthropic auto-converted

## Architecture

```
Client → Cloudflare CDN → Worker (42KB)
                              ├→ Auth (PBKDF2 + JWT)
                              ├→ Smart Router (task classification)
                              ├→ BYOK Key Resolution (Secrets Store)
                              ├→ Provider Proxy (OpenAI/Anthropic/DeepSeek/Google/Meta)
                              └→ Usage Logging (KV)
```

## Deployment

```bash
# Clone
git clone https://github.com/Lucineer/cocapn-chat.git
cd cocapn-chat

# Deploy (requires Cloudflare account)
./deploy.sh
```

The deploy script handles:
- KV namespace creation
- Secret configuration
- Worker deployment
- Custom domain setup

## Contributing

1. Fork the repo
2. Create your feature branch
3. Commit and push
4. Open a Pull Request

## License

MIT

---

**Built on Cloudflare Workers.** OpenAI-compatible API for every model.
