#!/bin/bash
# deploy.sh — Deploy cocapn.ai to Cloudflare Workers
# Run from a machine with wrangler auth
set -e

echo "══════════════════════════════════════════"
echo " cocapn.ai — Deploy to Cloudflare Workers"
echo "══════════════════════════════════════════"
echo ""

# Check wrangler
if ! command -v wrangler &>/dev/null; then
  echo "❌ wrangler not found. Install: npm install -g wrangler"
  exit 1
fi

# Check auth
echo "🔐 Checking Cloudflare auth..."
if ! wrangler whoami 2>/dev/null | grep -q "Account"; then
  echo "❌ Not authenticated. Run: wrangler login"
  exit 1
fi
echo "✅ Authenticated"
echo ""

# KV Namespaces
echo "📦 Setting up KV namespaces..."
for ns in USERS PROVIDER_KEYS USAGE; do
  echo "   Creating $ns..."
  id=$(wrangler kv:namespace create "$ns" 2>&1 | grep -oP 'id = "\K[^"]+')
  echo "   ✅ $ns → $id"
  # Update wrangler.toml
  sed -i "s/# \[\[kv_namespaces\]\]/[[kv_namespaces]]\n# binding = \"$ns\"\n# id = \"$id\"/" wrangler.toml
done
echo ""

# Secrets
echo "🔑 Setting secrets..."
echo "   JWT_SECRET..."
echo -n "Enter JWT secret (random string, press Enter for auto-generated): "
read -r jwt_secret
if [ -z "$jwt_secret" ]; then
  jwt_secret=$(openssl rand -hex 32)
fi
echo "$jwt_secret" | wrangler secret put JWT_SECRET
echo "   ✅ JWT_SECRET set"
echo ""

# Provider keys (optional)
echo "📡 Provider API keys (press Enter to skip each):"
for key in DEEPSEEK_API_KEY GOOGLE_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY; do
  echo -n "   $key: "
  read -r val
  if [ -n "$val" ]; then
    echo "$val" | wrangler secret put "$key"
    echo "   ✅ $key set"
  else
    echo "   ⏭️ Skipped"
  fi
done
echo ""

# Deploy
echo "🚀 Deploying..."
wrangler deploy
echo ""

echo "══════════════════════════════════════════"
echo " ✅ cocapn.ai is live!"
echo "══════════════════════════════════════════"
echo ""
echo " Your worker URL: (shown above)"
echo " API endpoint:    https://your-worker.workers.dev/v1/chat/completions"
echo " Chat UI:         https://your-worker.workers.dev/#/chat"
echo " Dashboard:       https://your-worker.workers.dev/#/dashboard"
echo ""
echo " Next: point cocapn.ai DNS to this worker"
echo "   wrangler domains add cocapn.ai"
