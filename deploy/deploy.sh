#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/deploy.env"
TEMPLATE_FILE="${SCRIPT_DIR}/nginx.site.conf.template"
TMP_DIR=""

cleanup() {
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}

trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command not found: $1" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Error: required file not found: $1" >&2
    exit 1
  fi
}

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Error: required env var is missing: ${name}" >&2
    exit 1
  fi
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'
}

render_template() {
  local input_file="$1"
  local output_file="$2"
  local app_domain web_root ssl_cert_path ssl_key_path

  app_domain="$(escape_sed_replacement "${APP_DOMAIN}")"
  web_root="$(escape_sed_replacement "${WEB_ROOT}")"
  ssl_cert_path="$(escape_sed_replacement "${SSL_CERT_PATH}")"
  ssl_key_path="$(escape_sed_replacement "${SSL_KEY_PATH}")"

  sed \
    -e "s|__APP_DOMAIN__|${app_domain}|g" \
    -e "s|__WEB_ROOT__|${web_root}|g" \
    -e "s|__SSL_CERT_PATH__|${ssl_cert_path}|g" \
    -e "s|__SSL_KEY_PATH__|${ssl_key_path}|g" \
    "${input_file}" > "${output_file}"
}

main() {
  require_command pnpm
  require_command sudo
  require_command nginx
  require_command rsync

  require_file "${ENV_FILE}"
  require_file "${TEMPLATE_FILE}"

  # shellcheck disable=SC1090
  source "${ENV_FILE}"

  require_value APP_DOMAIN
  require_value DEPLOY_ROOT
  require_value WEB_ROOT
  require_value NGINX_SITE_PATH
  require_value SSL_CERT_PATH
  require_value SSL_KEY_PATH

  if [[ "${PROJECT_ROOT}" != "${DEPLOY_ROOT}" ]]; then
    echo "Warning: DEPLOY_ROOT (${DEPLOY_ROOT}) does not match script project root (${PROJECT_ROOT})." >&2
    echo "Continuing with project root ${PROJECT_ROOT}." >&2
  fi

  echo "Installing dependencies..."
  pnpm install --frozen-lockfile

  echo "Building app..."
  pnpm build

  echo "Preparing publish directory..."
  sudo mkdir -p "${WEB_ROOT}"

  echo "Syncing dist to ${WEB_ROOT}..."
  sudo rsync -a --delete "${PROJECT_ROOT}/dist/" "${WEB_ROOT}/"

  TMP_DIR="$(mktemp -d)"
  local rendered_site="${TMP_DIR}/site.conf"

  echo "Rendering nginx config..."
  render_template "${TEMPLATE_FILE}" "${rendered_site}"

  echo "Installing nginx config to ${NGINX_SITE_PATH}..."
  sudo mkdir -p "$(dirname "${NGINX_SITE_PATH}")"
  sudo cp "${rendered_site}" "${NGINX_SITE_PATH}"

  echo "Validating nginx config..."
  sudo nginx -t

  echo "Reloading nginx..."
  sudo systemctl reload nginx

  echo "Deployment complete."
}

main "$@"
