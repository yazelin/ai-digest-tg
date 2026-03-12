#!/usr/bin/env bash
# scripts/setup.sh — Automated deployment setup for AI Digest TG
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$PROJECT_DIR/worker"

echo "=== AI Digest TG — Automated Setup ==="
echo ""

# ── Prerequisites ────────────────────────────────────────────
echo "[Check] Prerequisites..."

if ! command -v wrangler >/dev/null 2>&1; then
  echo "  wrangler not found. Installing via npm..."
  npm i -g wrangler
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install it first: https://cli.github.com/"
  exit 1
fi

# Check wrangler is logged in
if ! wrangler whoami >/dev/null 2>&1; then
  echo ""
  echo "You need to log in to Cloudflare first."
  echo "  Run: wrangler login"
  echo "  This will open a browser window for authentication."
  echo ""
  wrangler login
fi

echo "  OK"
echo ""

# ── Step 1: Create KV namespace ──────────────────────────────
echo "[Step 1/8] Creating KV namespace..."

KV_OUTPUT=$(cd "$WORKER_DIR" && wrangler kv namespace create KV 2>&1)
echo "$KV_OUTPUT"

# Extract namespace ID from output
KV_ID=$(echo "$KV_OUTPUT" | grep -oP '"[a-f0-9]{32}"' | tr -d '"' || true)

if [ -z "$KV_ID" ]; then
  # Try alternate format
  KV_ID=$(echo "$KV_OUTPUT" | grep -oP 'id = "[a-f0-9]{32}"' | grep -oP '[a-f0-9]{32}' || true)
fi

if [ -z "$KV_ID" ]; then
  echo ""
  echo "Could not auto-detect namespace ID from output."
  echo "Copy the ID shown above and paste it here:"
  read -r KV_ID
fi

# Update wrangler.jsonc with the real ID
sed -i "s/<REPLACE_WITH_KV_NAMESPACE_ID>/$KV_ID/" "$WORKER_DIR/wrangler.jsonc"
echo "  Updated wrangler.jsonc with KV namespace ID: $KV_ID"
echo ""

# ── Step 2: Collect secrets ──────────────────────────────────
echo "[Step 2/8] Setting up secrets..."
echo ""

# Telegram Bot Token
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  TELEGRAM BOT TOKEN                                     │"
echo "│                                                         │"
echo "│  Get this from @BotFather on Telegram:                  │"
echo "│  1. Open Telegram, search for @BotFather                │"
echo "│  2. Send /newbot (or /mybots to use existing)           │"
echo "│  3. Follow prompts, copy the API token                  │"
echo "│     (looks like: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)  │"
echo "└─────────────────────────────────────────────────────────┘"
echo ""
read -rsp "Paste your Telegram Bot Token: " TELEGRAM_BOT_TOKEN
echo ""

# Bot username (for Web UI)
echo ""
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  TELEGRAM BOT USERNAME                                  │"
echo "│                                                         │"
echo "│  The @username of your bot (without @).                 │"
echo "│  Example: ai_digest_bot                                 │"
echo "└─────────────────────────────────────────────────────────┘"
echo ""
read -rp "Bot username (without @): " BOT_USERNAME

# Admin Telegram ID
echo ""
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  YOUR TELEGRAM USER ID                                  │"
echo "│                                                         │"
echo "│  This is your numeric Telegram ID (not username).       │"
echo "│  Get it by messaging @userinfobot on Telegram.          │"
echo "│  Example: 123456789                                     │"
echo "└─────────────────────────────────────────────────────────┘"
echo ""
read -rp "Your Telegram user ID: " ADMIN_TELEGRAM_ID

# Generate webhook secret
WEBHOOK_SECRET=$(openssl rand -hex 32)
echo ""
echo "  Generated webhook secret: ${WEBHOOK_SECRET:0:8}..."
echo ""

# ── Step 3: Set Worker secrets ───────────────────────────────
echo "[Step 3/8] Setting Cloudflare Worker secrets..."

cd "$WORKER_DIR"
echo "$TELEGRAM_BOT_TOKEN" | wrangler secret put TELEGRAM_BOT_TOKEN
echo "$WEBHOOK_SECRET" | wrangler secret put TELEGRAM_WEBHOOK_SECRET
echo "$ADMIN_TELEGRAM_ID" | wrangler secret put ADMIN_TELEGRAM_ID

echo "  Done"
echo ""

# ── Step 4: Deploy Worker ────────────────────────────────────
echo "[Step 4/8] Deploying Cloudflare Worker..."

DEPLOY_OUTPUT=$(cd "$WORKER_DIR" && wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"

# Extract worker URL
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oP 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1 || true)

if [ -z "$WORKER_URL" ]; then
  echo ""
  echo "Could not auto-detect worker URL. Paste it here:"
  read -rp "Worker URL (e.g. https://ai-digest-tg.xxx.workers.dev): " WORKER_URL
fi

echo "  Worker deployed at: $WORKER_URL"
echo ""

# ── Step 5: Set Telegram webhook ─────────────────────────────
echo "[Step 5/8] Setting Telegram webhook..."

WEBHOOK_RESULT=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${WORKER_URL}/webhook\", \"secret_token\": \"${WEBHOOK_SECRET}\"}")

echo "  $WEBHOOK_RESULT"

if echo "$WEBHOOK_RESULT" | grep -q '"ok":true'; then
  echo "  Webhook set successfully!"
else
  echo "  WARNING: Webhook setup may have failed. Check the output above."
fi
echo ""

# ── Step 6: Update Web UI placeholders ───────────────────────
echo "[Step 6/8] Updating Web UI configuration..."

# Update app.js API_BASE
sed -i "s|https://ai-digest-tg.YOUR_SUBDOMAIN.workers.dev|${WORKER_URL}|" "$PROJECT_DIR/web/app.js"

# Update index.html bot username
sed -i "s|YOUR_BOT_USERNAME|${BOT_USERNAME}|" "$PROJECT_DIR/web/index.html"

echo "  Updated web/app.js API_BASE → $WORKER_URL"
echo "  Updated web/index.html bot username → $BOT_USERNAME"
echo ""

# ── Step 7: Set GitHub Actions secrets ───────────────────────
echo "[Step 7/8] Setting GitHub Actions secrets..."

# Check if repo has a remote
if git -C "$PROJECT_DIR" remote get-url origin >/dev/null 2>&1; then
  # Get CF Account ID
  CF_ACCOUNT_ID=$(wrangler whoami 2>&1 | grep -oP 'Account ID.*: \K[a-f0-9]+' || true)
  if [ -z "$CF_ACCOUNT_ID" ]; then
    echo ""
    echo "┌─────────────────────────────────────────────────────────┐"
    echo "│  CLOUDFLARE ACCOUNT ID                                  │"
    echo "│                                                         │"
    echo "│  Find it at: https://dash.cloudflare.com                │"
    echo "│  → Pick your account → right sidebar shows Account ID  │"
    echo "└─────────────────────────────────────────────────────────┘"
    echo ""
    read -rp "Cloudflare Account ID: " CF_ACCOUNT_ID
  fi

  # Generate CF API Token
  echo ""
  echo "┌─────────────────────────────────────────────────────────┐"
  echo "│  CLOUDFLARE API TOKEN                                   │"
  echo "│                                                         │"
  echo "│  Create one at:                                         │"
  echo "│  https://dash.cloudflare.com/profile/api-tokens         │"
  echo "│  → Create Token → Custom Token                          │"
  echo "│  → Permissions: Account / Workers KV Storage / Read     │"
  echo "└─────────────────────────────────────────────────────────┘"
  echo ""
  read -rsp "Cloudflare API Token: " CF_API_TOKEN
  echo ""

  cd "$PROJECT_DIR"
  echo "$CF_API_TOKEN" | gh secret set CF_API_TOKEN
  echo "$CF_ACCOUNT_ID" | gh secret set CF_ACCOUNT_ID
  echo "$KV_ID" | gh secret set CF_KV_NAMESPACE_ID
  echo "$TELEGRAM_BOT_TOKEN" | gh secret set TELEGRAM_BOT_TOKEN
  echo "$ADMIN_TELEGRAM_ID" | gh secret set ADMIN_TELEGRAM_ID

  echo "  GitHub Actions secrets set!"
else
  echo "  No git remote found. Skipping GitHub Actions secrets."
  echo "  After pushing to GitHub, run these manually:"
  echo "    gh secret set CF_API_TOKEN"
  echo "    gh secret set CF_ACCOUNT_ID"
  echo "    gh secret set CF_KV_NAMESPACE_ID"
  echo "    gh secret set TELEGRAM_BOT_TOKEN"
  echo "    gh secret set ADMIN_TELEGRAM_ID"
fi
echo ""

# ── Step 8: Commit config changes ────────────────────────────
echo "[Step 8/8] Committing configuration changes..."

cd "$PROJECT_DIR"
git add worker/wrangler.jsonc web/app.js web/index.html
if git diff --cached --quiet; then
  echo "  No changes to commit."
else
  git commit -m "chore: configure deployment (KV ID, worker URL, bot username)"
  echo "  Committed!"
fi
echo ""

# ── Done! ────────────────────────────────────────────────────
echo "============================================="
echo "  Setup complete!"
echo "============================================="
echo ""
echo "  Worker URL:  $WORKER_URL"
echo "  Bot:         @$BOT_USERNAME"
echo "  Admin ID:    $ADMIN_TELEGRAM_ID"
echo "  KV ID:       $KV_ID"
echo ""
echo "  Next steps:"
echo "  1. Push to GitHub:  git push -u origin main"
echo "  2. Enable GitHub Pages: Settings → Pages → Source: Deploy from branch → /web"
echo "  3. Message your bot on Telegram: /admin_invite"
echo "     → Get an invite code, then /start <code> to register"
echo ""
echo "  Test the bot now by sending /help to @$BOT_USERNAME on Telegram!"
