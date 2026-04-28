#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/dankritz/vibestack.git"
INSTALL_DIR="/opt/vibestack"
BASE_DOMAIN="${VIBESTACK_BASE_DOMAIN:-}"
VIBESTACK_HOST="${VIBESTACK_HOST:-}"
TRAEFIK_DASHBOARD_HOST="${TRAEFIK_DASHBOARD_HOST:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
FIRST_ADMIN_EMAIL="${FIRST_ADMIN_EMAIL:-}"
FIRST_ADMIN_PASSWORD="${FIRST_ADMIN_PASSWORD:-}"
TRAEFIK_DASHBOARD_USER="${TRAEFIK_DASHBOARD_USER:-admin}"
TRAEFIK_DASHBOARD_PASSWORD="${TRAEFIK_DASHBOARD_PASSWORD:-}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CLOUDFLARE_ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
SKIP_DNS_CHECK=0
FIRST_ADMIN_PASSWORD_GENERATED=0
TRAEFIK_DASHBOARD_PASSWORD_GENERATED=0

usage() {
  cat <<'USAGE'
Install VibeStack on a Debian/Ubuntu server.

Required flags:
  --domain DOMAIN              Base domain for hosted apps, for example apps.example.com
  --email EMAIL                Let's Encrypt account email
  --admin-email EMAIL          Initial VibeStack platform admin email

Optional flags:
  --admin-password PASSWORD    Initial admin password. Prompts on a TTY, generates otherwise.
  --host HOST                  VibeStack management host. Default: vibestack.DOMAIN
  --traefik-host HOST          Traefik dashboard host. Default: traefik.DOMAIN
  --dashboard-user USER        Traefik dashboard basic-auth user. Default: admin
  --dashboard-password PASS    Traefik dashboard password. Prompts on a TTY, generates otherwise.
  --install-dir DIR            Install directory. Default: /opt/vibestack
  --repo-url URL               Git repository URL. Default: https://github.com/dankritz/vibestack.git
  --cloudflare-api-token TOKEN Optional Cloudflare token for VibeStack DNS provisioning
  --cloudflare-zone-id ID      Optional Cloudflare zone id
  --skip-dns-check             Do not fail if host DNS does not point at this server yet
  -h, --help                   Show this help

Example:
  sudo bash scripts/install-linux.sh \
    --domain apps.example.com \
    --host vibestack.example.com \
    --email admin@example.com \
    --admin-email admin@example.com
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) BASE_DOMAIN="${2:?}"; shift 2 ;;
    --email) LETSENCRYPT_EMAIL="${2:?}"; shift 2 ;;
    --admin-email) FIRST_ADMIN_EMAIL="${2:?}"; shift 2 ;;
    --admin-password) FIRST_ADMIN_PASSWORD="${2:?}"; shift 2 ;;
    --host) VIBESTACK_HOST="${2:?}"; shift 2 ;;
    --traefik-host) TRAEFIK_DASHBOARD_HOST="${2:?}"; shift 2 ;;
    --dashboard-user) TRAEFIK_DASHBOARD_USER="${2:?}"; shift 2 ;;
    --dashboard-password) TRAEFIK_DASHBOARD_PASSWORD="${2:?}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:?}"; shift 2 ;;
    --repo-url) REPO_URL="${2:?}"; shift 2 ;;
    --cloudflare-api-token) CLOUDFLARE_API_TOKEN="${2:?}"; shift 2 ;;
    --cloudflare-zone-id) CLOUDFLARE_ZONE_ID="${2:?}"; shift 2 ;;
    --skip-dns-check) SKIP_DNS_CHECK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this installer as root, for example with sudo." >&2
    exit 1
  fi
}

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "$name is required." >&2
    usage
    exit 2
  fi
}

validate_inputs() {
  [[ "$LETSENCRYPT_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || {
    echo "--email must be a valid email address." >&2
    exit 2
  }
  [[ "$FIRST_ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || {
    echo "--admin-email must be a valid email address." >&2
    exit 2
  }
  [[ "${#FIRST_ADMIN_PASSWORD}" -ge 8 ]] || {
    echo "Initial admin password must be at least 8 characters." >&2
    exit 2
  }
  [[ "${#TRAEFIK_DASHBOARD_PASSWORD}" -ge 8 ]] || {
    echo "Traefik dashboard password must be at least 8 characters." >&2
    exit 2
  }
}

set_secret() {
  local var_name="$1"
  local label="$2"
  local generated_var="$3"
  local current="${!var_name}"
  if [[ -n "$current" ]]; then
    return
  fi
  if [[ -t 0 ]]; then
    local first second
    read -r -s -p "$label: " first
    echo
    read -r -s -p "Confirm $label: " second
    echo
    if [[ "$first" != "$second" || -z "$first" ]]; then
      echo "Secret values did not match or were empty." >&2
      exit 2
    fi
    printf -v "$var_name" '%s' "$first"
    return
  fi
  printf -v "$var_name" '%s' "$(openssl rand -base64 24)"
  printf -v "$generated_var" '1'
}

random_secret() {
  openssl rand -base64 48 | tr -d '\n'
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git gnupg openssl apache2-utils iproute2 lsb-release rsync
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    systemctl enable --now docker
    return
  fi

  install -m 0755 -d /etc/apt/keyrings
  rm -f /etc/apt/keyrings/docker.gpg
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  local codename
  codename="${VERSION_CODENAME:-$(lsb_release -cs)}"
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${codename} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

check_os() {
  if [[ ! -r /etc/os-release ]]; then
    echo "Cannot detect Linux distribution." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID}" != "ubuntu" && "${ID}" != "debian" ]]; then
    echo "This installer currently supports Debian and Ubuntu only. Detected: ${PRETTY_NAME:-unknown}" >&2
    exit 1
  fi
}

check_ports() {
  for port in 80 443; do
    if ss -ltn "sport = :${port}" | grep -q ":${port}"; then
      echo "Port ${port} is already in use. Stop the conflicting service before installing VibeStack." >&2
      exit 1
    fi
  done
}

public_ip() {
  curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true
}

check_dns() {
  if [[ "$SKIP_DNS_CHECK" -eq 1 ]]; then
    return
  fi
  local ip resolved
  ip="$(public_ip)"
  if [[ -z "$ip" ]]; then
    echo "Could not determine this server's public IP. Re-run with --skip-dns-check after verifying DNS." >&2
    exit 1
  fi
  for host in "$VIBESTACK_HOST" "$TRAEFIK_DASHBOARD_HOST"; do
    resolved="$(getent ahostsv4 "$host" | awk '{print $1}' | sort -u | tr '\n' ' ')"
    if [[ -z "$resolved" || " $resolved " != *" $ip "* ]]; then
      echo "DNS check failed for ${host}. Expected an A record pointing to ${ip}; got: ${resolved:-none}" >&2
      echo "Create DNS records first, or re-run with --skip-dns-check if DNS is intentionally managed later." >&2
      exit 1
    fi
  done
}

prepare_repo() {
  local script_dir repo_root
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(cd "${script_dir}/.." && pwd)"
  if [[ -f "${repo_root}/package.json" && "$(node_name "${repo_root}/package.json")" == "vibestack" ]]; then
    mkdir -p "$INSTALL_DIR"
    if [[ "$(realpath "$repo_root")" != "$(realpath "$INSTALL_DIR")" ]]; then
      rsync -a \
        --delete \
        --exclude '.git' \
        --exclude '.env' \
        --exclude 'secrets' \
        --exclude 'node_modules' \
        --exclude 'dist' \
        --exclude 'build' \
        "$repo_root/" "$INSTALL_DIR/"
    fi
    return
  fi

  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    git -C "$INSTALL_DIR" fetch --tags origin
    git -C "$INSTALL_DIR" pull --ff-only
  elif [[ -e "$INSTALL_DIR" ]]; then
    echo "${INSTALL_DIR} exists but is not a git checkout." >&2
    exit 1
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
}

node_name() {
  sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n 1
}

write_env() {
  mkdir -p "${INSTALL_DIR}/secrets"
  chmod 700 "${INSTALL_DIR}/secrets"
  htpasswd -nbB "$TRAEFIK_DASHBOARD_USER" "$TRAEFIK_DASHBOARD_PASSWORD" >"${INSTALL_DIR}/secrets/traefik_dashboard_users"
  chmod 600 "${INSTALL_DIR}/secrets/traefik_dashboard_users"

  local postgres_password session_secret secret_key
  postgres_password="$(random_secret)"
  session_secret="$(random_secret)"
  secret_key="$(random_secret)"

  cat >"${INSTALL_DIR}/.env" <<ENV
NODE_ENV=production
VIBESTACK_HOST=${VIBESTACK_HOST}
VIBESTACK_PUBLIC_URL=https://${VIBESTACK_HOST}
VIBESTACK_BASE_DOMAIN=${BASE_DOMAIN}
VIBESTACK_DATA_DIR=/var/lib/vibestack
VIBESTACK_SESSION_SECRET=${session_secret}
VIBESTACK_SECRET_KEY=${secret_key}
DATABASE_URL=postgres://vibestack:${postgres_password}@postgres:5432/vibestack
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=vibestack
POSTGRES_PASSWORD=${postgres_password}
POSTGRES_DB=vibestack
REDIS_URL=redis://redis:6379
TRAEFIK_NETWORK=vibestack_apps
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERT_RESOLVER=letsencrypt
TRAEFIK_DASHBOARD_HOST=${TRAEFIK_DASHBOARD_HOST}
LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}
FIRST_ADMIN_EMAIL=${FIRST_ADMIN_EMAIL}
FIRST_ADMIN_PASSWORD=${FIRST_ADMIN_PASSWORD}
RUNTIME_DRIVER=docker
CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
CLOUDFLARE_ZONE_ID=${CLOUDFLARE_ZONE_ID}
ENV
  chmod 600 "${INSTALL_DIR}/.env"
}

start_stack() {
  docker compose --project-directory "$INSTALL_DIR" pull postgres redis traefik
  docker compose --project-directory "$INSTALL_DIR" up -d --build
}

main() {
  require_root
  check_os
  require_value "--domain" "$BASE_DOMAIN"
  require_value "--email" "$LETSENCRYPT_EMAIL"
  require_value "--admin-email" "$FIRST_ADMIN_EMAIL"

  VIBESTACK_HOST="${VIBESTACK_HOST:-vibestack.${BASE_DOMAIN}}"
  TRAEFIK_DASHBOARD_HOST="${TRAEFIK_DASHBOARD_HOST:-traefik.${BASE_DOMAIN}}"

  install_packages
  set_secret FIRST_ADMIN_PASSWORD "Initial VibeStack admin password" FIRST_ADMIN_PASSWORD_GENERATED
  set_secret TRAEFIK_DASHBOARD_PASSWORD "Traefik dashboard password" TRAEFIK_DASHBOARD_PASSWORD_GENERATED
  validate_inputs
  install_docker
  check_ports
  check_dns
  prepare_repo
  write_env
  start_stack

  cat <<SUMMARY

VibeStack v0.1a is installed.

Management URL: https://${VIBESTACK_HOST}
Traefik URL:    https://${TRAEFIK_DASHBOARD_HOST}
Admin user:     ${FIRST_ADMIN_EMAIL}
Install dir:    ${INSTALL_DIR}

Generated passwords are shown only when the installer had to create them non-interactively.
SUMMARY
  if [[ "$FIRST_ADMIN_PASSWORD_GENERATED" -eq 1 ]]; then
    echo "VibeStack admin password: ${FIRST_ADMIN_PASSWORD}"
  fi
  if [[ "$TRAEFIK_DASHBOARD_PASSWORD_GENERATED" -eq 1 ]]; then
    echo "Traefik dashboard password: ${TRAEFIK_DASHBOARD_PASSWORD}"
  fi
}

main "$@"
