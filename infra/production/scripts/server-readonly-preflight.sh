#!/usr/bin/env bash
# Read-only production server checks for Hector shared-host deploy.
# Safe: does not restart Docker/Nginx, does not create resources, does not deploy.
#
# Usage (on the server, after SSH authorization):
#   ./infra/production/scripts/server-readonly-preflight.sh
#
# Or paste the printed command block for an operator without this repo checkout.

set -euo pipefail

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

echo "=== Hector read-only preflight (shared host) ==="
echo "Target IP: 62.60.191.119"
echo "Domains: hector.pishete.com / core-hector.pishete.com"
echo "Loopback ports: 127.0.0.1:3100 (web), 127.0.0.1:3101 (api)"
echo

run_check() {
  local title="$1"
  shift
  yellow "--- ${title} ---"
  # shellcheck disable=SC2068
  "$@" || yellow "(command exited non-zero — treat as informational)"
  echo
}

if [[ "${HECTOR_PRINT_ONLY:-}" == "1" ]]; then
  cat <<'EOF'
# Operator command block (read-only) — run on 62.60.191.119
uname -a
nproc
free -h
df -h /
swapon --show
docker version --format '{{.Server.Version}}'
docker compose version
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker network ls
docker volume ls
ss -ltnp '( sport = :3100 or sport = :3101 )'
ss -ltnp '( sport = :80 or sport = :443 )' | head -n 40
ss -ltnp | grep -E '127\.0\.0\.1:(3000|5432|6379)\b' || true
nginx -v 2>&1
sudo nginx -T 2>/dev/null | grep -E 'server_name|listen ' | head -n 80 || true
ls -la /etc/nginx/sites-enabled/ 2>/dev/null || true
dig +short hector.pishete.com A
dig +short core-hector.pishete.com A
getent hosts hector.pishete.com core-hector.pishete.com || true
sudo ufw status verbose 2>/dev/null || sudo iptables -L -n 2>/dev/null | head -n 40 || true
# Confirm existing apps still listed (must not stop them):
docker ps --format '{{.Names}}' | grep -E 'bazarbashe|fanoma|buy' || true
EOF
  exit 0
fi

run_check "OS / CPU" bash -c 'uname -a; nproc'
run_check "Memory / swap" bash -c 'free -h; swapon --show || true'
run_check "Disk" df -h /
if command -v docker >/dev/null 2>&1; then
  run_check "Docker Engine" docker version --format '{{.Server.Version}}'
  run_check "Compose V2" docker compose version
  run_check "Containers" docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  run_check "Networks" docker network ls
  run_check "Volumes" docker volume ls
else
  yellow "docker not available in this shell"
fi

if command -v ss >/dev/null 2>&1; then
  run_check "Hector ports 3100/3101" ss -ltnp '( sport = :3100 or sport = :3101 )'
  run_check "Public 80/443" bash -c "ss -ltnp '( sport = :80 or sport = :443 )' | head -n 40"
else
  yellow "ss not available"
fi

if command -v nginx >/dev/null 2>&1; then
  run_check "Nginx version" nginx -v
else
  yellow "nginx binary not in PATH"
fi

if command -v dig >/dev/null 2>&1; then
  run_check "DNS hector.pishete.com" dig +short hector.pishete.com A
  run_check "DNS core-hector.pishete.com" dig +short core-hector.pishete.com A
else
  yellow "dig not available"
fi

yellow "Port gate: if 3100/3101 show unrelated listeners → STOP. Do not kill processes."
yellow "DNS gate: both A records must resolve to 62.60.191.119 before deploy/TLS."
green "Read-only preflight finished (informational). No services were restarted."
