#!/usr/bin/env bash
# scripts/setup.sh — Initial deployment setup
set -euo pipefail

echo "=== AI Digest TG Setup ==="

command -v wrangler >/dev/null || { echo "Install wrangler: npm i -g wrangler"; exit 1; }
command -v gh >/dev/null || { echo "Install gh CLI"; exit 1; }

echo ""
echo "1. Create KV namespace"
echo "   Run: wrangler kv namespace create KV"
echo "   Then update worker/wrangler.jsonc with the namespace ID"
echo ""
echo "2. Set worker secrets"
echo "   wrangler secret put TELEGRAM_BOT_TOKEN"
echo "   wrangler secret put TELEGRAM_WEBHOOK_SECRET"
echo "   wrangler secret put ADMIN_TELEGRAM_ID"
echo ""
echo "3. Deploy worker"
echo "   cd worker && wrangler deploy"
echo ""
echo "4. Set Telegram webhook"
echo '   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \'
echo '     -H "Content-Type: application/json" \'
echo '     -d "{\"url\": \"https://ai-digest-tg.<subdomain>.workers.dev/webhook\", \"secret_token\": \"<WEBHOOK_SECRET>\"}"'
echo ""
echo "5. Set GitHub Actions secrets"
echo "   gh secret set CF_API_TOKEN"
echo "   gh secret set CF_ACCOUNT_ID"
echo "   gh secret set CF_KV_NAMESPACE_ID"
echo "   gh secret set TELEGRAM_BOT_TOKEN"
echo "   gh secret set ADMIN_TELEGRAM_ID"
echo ""
echo "6. Update web/app.js API_BASE with your worker URL"
echo "7. Update web/index.html bot username"
echo "8. Enable GitHub Pages for the /web directory"
echo ""
echo "Done! Generate your first invite code via /admin_invite in Telegram."
