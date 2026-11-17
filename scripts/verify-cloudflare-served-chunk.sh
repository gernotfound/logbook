#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo 'Usage: verify-cloudflare-served-chunk.sh dist/assets/file.js|css origin expected-sha' >&2
  exit 2
fi

file="$1"
origin="$2"
expected_sha="$3"
retry_delay="${CLOUDFLARE_CHUNK_RETRY_DELAY_SECONDS:-3}"

case "$file" in
  dist/assets/*.js|dist/assets/*.css) ;;
  *) echo 'Expected a built JS/CSS chunk under dist/assets' >&2; exit 2 ;;
esac
case "$retry_delay" in
  0|1|2|3|4|5) ;;
  *) echo 'Invalid chunk retry delay' >&2; exit 2 ;;
esac
if [ ! -s "$file" ] || [[ ! "$expected_sha" =~ ^[a-f0-9]{40}$ ]] || [[ ! "$origin" =~ ^https?://[^/]+$ ]]; then
  echo 'Invalid chunk smoke input' >&2
  exit 2
fi

path="/${file#dist/}"
body="$(mktemp)"
headers="$(mktemp)"
trap 'rm -f "$body" "$headers"' EXIT
last_http='unavailable'

# A Worker deployment may briefly serve different asset manifests on
# different edges. Accept only HTTP 200, correct MIME and exact built bytes.
for attempt in 1 2 3 4; do
  : > "$body"
  : > "$headers"
  if last_http="$(curl --silent --show-error --max-time 15 \
    -H 'Accept-Encoding: identity' \
    --dump-header "$headers" --output "$body" \
    --write-out '%{http_code} %{content_type}' "$origin$path")"; then
    case "$file:$last_http" in
      *.js:200\ text/javascript*|*.js:200\ application/javascript*|*.css:200\ text/css*)
        if cmp -s "$file" "$body"; then
          echo "Cloudflare chunk verified on attempt $attempt/4: $path"
          exit 0
        fi
        ;;
    esac
  else
    last_http='network-error'
  fi

  echo "Chunk not yet verified ($attempt/4): $path, HTTP/MIME: $last_http"
  if [ "$attempt" != 4 ]; then sleep "$retry_delay"; fi
done

# Diagnostic reads cannot turn an unverified deployment into success.
script_dir="$(cd "$(dirname "$0")" && pwd)"
bash "$script_dir/cloudflare-asset-mismatch-diagnostics.sh" \
  "$file" "$body" "$headers" "$origin$path" "$expected_sha" "$last_http"
