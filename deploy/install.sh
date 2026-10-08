#!/usr/bin/env bash
# Hector one-time production install (shared-host).
#
# Usage (on the server):
#   cd /opt/hector/app
#   ./deploy/install.sh
#
# Requires: /opt/hector/env/production.env (secrets filled)
# Does not modify Bazarbashe / Fanoma / Buy Box.

set -euo pipefail
# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

confirm_install() {
  echo "This will install Hector on this host:"
  echo "  Compose project: hector"
  echo "  Postgres volume: hector_postgres_data (created if missing; never wiped)"
  echo "  Ports: 127.0.0.1:3100 (web), 127.0.0.1:3101 (api)"
  echo "  Nginx sites: hector.pishete.com, core-hector.pishete.com"
  echo
  read -r -p "Continue? [y/N] " ans
  [[ "${ans:-}" == "y" || "${ans:-}" == "Y" ]] || die "Aborted"
}

bootstrap_admin() {
  local user_count
  user_count="$(compose_hector exec -T postgres \
    psql -U "${POSTGRES_USER:-hector_app}" -d "${POSTGRES_DB:-hector}" -Atc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='users';" 2>/dev/null || echo 0)"

  if [[ "$user_count" == "1" ]]; then
    local n
    n="$(compose_hector exec -T postgres \
      psql -U "${POSTGRES_USER:-hector_app}" -d "${POSTGRES_DB:-hector}" -Atc \
      "SELECT count(*) FROM users WHERE deleted_at IS NULL;" 2>/dev/null || echo 0)"
    if [[ "${n:-0}" -gt 0 ]]; then
      yellow "Users already exist (${n}) — skipping bootstrap."
      return 0
    fi
  fi

  echo
  yellow "Create initial OWNER admin (password is not printed or logged)."
  local email pass pass2
  read -r -p "Admin email: " email
  [[ -n "$email" ]] || die "Admin email required"
  read -r -s -p "Admin password (min 16 chars): " pass
  echo
  read -r -s -p "Confirm password: " pass2
  echo
  [[ "$pass" == "$pass2" ]] || die "Passwords do not match"
  [[ "${#pass}" -ge 16 ]] || die "Password must be at least 16 characters"

  yellow "Running production bootstrap…"
  compose_hector run --rm --no-deps \
    -e NODE_ENV=production \
    -e "DATABASE_URL=${DATABASE_URL}" \
    -e "HECTOR_BOOTSTRAP_ADMIN_EMAIL=${email}" \
    -e "HECTOR_BOOTSTRAP_ADMIN_PASSWORD=${pass}" \
    -e "HECTOR_BOOTSTRAP_COMPANY_NAME=${HECTOR_BOOTSTRAP_COMPANY_NAME:-Pishteh}" \
    -e "HECTOR_BOOTSTRAP_COMPANY_SLUG=${HECTOR_BOOTSTRAP_COMPANY_SLUG:-pishteh}" \
    migrate \
    sh -c 'cd /app/packages/database && exec /app/node_modules/.bin/tsx scripts/production-bootstrap.ts'

  unset pass pass2
  green "Bootstrap completed (rotate password after first login)."
}

install_nginx_http() {
  command -v nginx >/dev/null 2>&1 || die "nginx not found. Install host nginx first (do not use apt from this script)."

  if sudo nginx -T 2>/dev/null | grep -qE 'server_name\s+hector\.pishete\.com|server_name\s+core-hector\.pishete\.com'; then
    if [[ ! -e /etc/nginx/sites-enabled/hector.pishete.com \
       && ! -e /etc/nginx/sites-enabled/core-hector.pishete.com ]]; then
      die "Conflicting server_name for Hector domains found outside expected sites-enabled files. Resolve manually."
    fi
  fi

  sudo mkdir -p /var/www/certbot
  sudo mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

  local web_src="${HOST_NGINX_SRC}/hector.pishete.com.conf"
  local api_src="${HOST_NGINX_SRC}/core-hector.pishete.com.conf"
  local web_dst="/etc/nginx/sites-available/hector.pishete.com"
  local api_dst="/etc/nginx/sites-available/core-hector.pishete.com"

  # Backup existing Hector site files only
  for f in "$web_dst" "$api_dst"; do
    if [[ -f "$f" ]]; then
      sudo cp -a "$f" "${f}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    fi
  done

  sudo cp "$web_src" "$web_dst"
  sudo cp "$api_src" "$api_dst"
  sudo ln -sfn "$web_dst" /etc/nginx/sites-enabled/hector.pishete.com
  sudo ln -sfn "$api_dst" /etc/nginx/sites-enabled/core-hector.pishete.com

  sudo nginx -t
  sudo systemctl reload nginx
  green "Nginx HTTP sites installed (Hector only) and reloaded"
}

configure_https() {
  local web_cert="/etc/letsencrypt/live/hector.pishete.com/fullchain.pem"
  local api_cert="/etc/letsencrypt/live/core-hector.pishete.com/fullchain.pem"

  if [[ -f "$web_cert" && -f "$api_cert" ]]; then
    yellow "TLS certificates already present — enabling HTTPS vhosts."
  else
    if ! command -v certbot >/dev/null 2>&1; then
      yellow "Certbot is not installed."
      echo "Install with (Ubuntu):"
      echo "  sudo apt-get update && sudo apt-get install -y certbot"
      echo "Then re-run: ./deploy/install.sh"
      echo "HTTP sites are already active; you can finish TLS later."
      return 0
    fi

    yellow "Checking DNS…"
    local a1 a2
    a1="$(dig +short hector.pishete.com A | tail -n1 || true)"
    a2="$(dig +short core-hector.pishete.com A | tail -n1 || true)"
    echo "hector.pishete.com -> ${a1:-none}"
    echo "core-hector.pishete.com -> ${a2:-none}"
    [[ "$a1" == "62.60.191.119" && "$a2" == "62.60.191.119" ]] \
      || die "DNS must point both names to 62.60.191.119 before Certbot"

    yellow "Requesting Let's Encrypt certificates (webroot)…"
    sudo certbot certonly --webroot -w /var/www/certbot \
      -d hector.pishete.com --non-interactive --agree-tos \
      --register-unsafely-without-email || \
      sudo certbot certonly --webroot -w /var/www/certbot \
        -d hector.pishete.com

    sudo certbot certonly --webroot -w /var/www/certbot \
      -d core-hector.pishete.com --non-interactive --agree-tos \
      --register-unsafely-without-email || \
      sudo certbot certonly --webroot -w /var/www/certbot \
        -d core-hector.pishete.com
  fi

  [[ -f "$web_cert" && -f "$api_cert" ]] || die "Certificates missing after Certbot"

  local web_https="/etc/nginx/sites-available/hector.pishete.com-https"
  local api_https="/etc/nginx/sites-available/core-hector.pishete.com-https"
  sudo cp "${HOST_NGINX_SRC}/hector.pishete.com.https.conf.template" "$web_https"
  sudo cp "${HOST_NGINX_SRC}/core-hector.pishete.com.https.conf.template" "$api_https"
  sudo ln -sfn "$web_https" /etc/nginx/sites-enabled/hector.pishete.com-https
  sudo ln -sfn "$api_https" /etc/nginx/sites-enabled/core-hector.pishete.com-https

  # HTTP → HTTPS redirect (keep ACME location)
  sudo tee /etc/nginx/sites-available/hector.pishete.com >/dev/null <<'EOF'
upstream hector_web_upstream {
  server 127.0.0.1:3100;
  keepalive 16;
}
server {
  listen 80;
  listen [::]:80;
  server_name hector.pishete.com;
  location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
    default_type "text/plain";
    allow all;
  }
  location / {
    return 301 https://$host$request_uri;
  }
}
EOF

  sudo tee /etc/nginx/sites-available/core-hector.pishete.com >/dev/null <<'EOF'
upstream hector_api_upstream {
  server 127.0.0.1:3101;
  keepalive 16;
}
server {
  listen 80;
  listen [::]:80;
  server_name core-hector.pishete.com;
  location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
    default_type "text/plain";
    allow all;
  }
  location / {
    return 301 https://$host$request_uri;
  }
}
EOF

  if ! sudo nginx -t; then
    red "nginx -t failed — restoring previous Hector HTTP configs if backups exist"
    local bak
    bak="$(ls -1t /etc/nginx/sites-available/hector.pishete.com.bak.* 2>/dev/null | head -n1 || true)"
    [[ -n "$bak" ]] && sudo cp -a "$bak" /etc/nginx/sites-available/hector.pishete.com
    bak="$(ls -1t /etc/nginx/sites-available/core-hector.pishete.com.bak.* 2>/dev/null | head -n1 || true)"
    [[ -n "$bak" ]] && sudo cp -a "$bak" /etc/nginx/sites-available/core-hector.pishete.com
    sudo rm -f /etc/nginx/sites-enabled/hector.pishete.com-https \
               /etc/nginx/sites-enabled/core-hector.pishete.com-https
    sudo nginx -t
    die "HTTPS enablement failed; HTTP restored where possible"
  fi
  sudo systemctl reload nginx
  green "HTTPS enabled for Hector domains"
}

main() {
  hector_init
  require_docker
  confirm_install
  ensure_simple_image_vars_in_env
  hector_init
  validate_env_secrets
  check_resources
  check_ports_free_or_ours

  compose_hector config --quiet
  assert_shared_host_resolved_config

  build_images
  start_postgres
  backup_before_migrate
  run_migrate
  start_apps
  bootstrap_admin

  install_nginx_http
  configure_https

  curl -fsS "http://127.0.0.1:${HECTOR_API_HOST_PORT:-3101}/health" >/dev/null
  curl -fsS "http://127.0.0.1:${HECTOR_WEB_HOST_PORT:-3100}/health" >/dev/null
  green "Loopback health OK"

  # Non-fatal public checks
  curl -fsSI "https://hector.pishete.com/health" >/dev/null 2>&1 \
    && green "Public web HTTPS health OK" \
    || yellow "Public web HTTPS not verified yet (DNS/TLS/propagation)"
  curl -fsSI "https://core-hector.pishete.com/health" >/dev/null 2>&1 \
    && green "Public API HTTPS health OK" \
    || yellow "Public API HTTPS not verified yet"

  print_status
  green "Install finished."
  yellow "Existing apps (Bazarbashe etc.) were not modified."
}

main "$@"
