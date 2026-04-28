#!/bin/bash
# test.sh — Test cocapn-chat Worker locally with wrangler dev
set -e

echo "══════════════════════════════════════════"
echo " cocapn.ai — Local Test"
echo "══════════════════════════════════════════"

if ! command -v wrangler &>/dev/null; then
  echo "❌ wrangler not found. Install: npm install -g wrangler"
  exit 1
fi

echo "🧪 Starting local Worker (http://localhost:8787)..."
echo "   Press Ctrl+C to stop"
echo ""

wrangler dev --local 2>&1
