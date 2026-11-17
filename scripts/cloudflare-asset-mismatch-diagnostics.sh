#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 6 ]; then
  echo 'Usage: cloudflare-asset-mismatch-diagnostics.sh expected-file received-file response-headers asset-url expected-sha response-status-and-type' >&2
  exit 2
fi

expected_file="$1"
received_file="$2"
headers_file="$3"
asset_url="$4"
expected_sha="$5"
initial_http="$6"
retry_delay="${CLOUDFLARE_DIAG_RETRY_DELAY_SECONDS:-3}"

case "${retry_delay}" in
  0|1|2|3|4|5) ;;
  *) echo 'Invalid diagnostic retry delay' >&2; exit 2 ;;
esac

describe_file() {
  local label="$1" file="$2"
  if [ ! -f "${file}" ]; then
    echo "${label}: no response body"
    return
  fi
  echo "${label}: bytes=$(wc -c < "${file}" | tr -d ' ') sha256=$(sha256sum "${file}" | cut -d' ' -f1)"
}

describe_headers() {
  local file="$1"
  if [ -f "${file}" ]; then
    grep -Ei '^(HTTP/[0-9]|(content-type|content-length|content-encoding|cache-control|cf-cache-status|cf-ray|age|etag|date|vary):)' "${file}" | tr -d '\r' || true
  fi
}

echo "Cloudflare initial asset mismatch on ${asset_url}"
echo "Deployed commit: ${expected_sha}"
echo "Initial HTTP: ${initial_http}"
describe_file 'Expected' "${expected_file}"
describe_file 'Received initially' "${received_file}"
describe_headers "${headers_file}"

# Two diagnostic probes only, and only after the initial byte mismatch.
# Neither a recovered response nor a cache-busted response changes the gate outcome.
for probe in exact cache-busted; do
  sleep "${retry_delay}"
  probe_url="${asset_url}"
  if [ "${probe}" = 'cache-busted' ]; then
    case "${probe_url}" in
      *\?*) probe_url="${probe_url}&__logbook_diagnostic=${expected_sha}" ;;
      *) probe_url="${probe_url}?__logbook_diagnostic=${expected_sha}" ;;
    esac
  fi
  probe_body="$(mktemp)"
  probe_headers="$(mktemp)"
  if response="$(curl --silent --show-error --max-time 15 \
      -H 'Accept-Encoding: identity' -H 'Cache-Control: no-cache' \
      --dump-header "${probe_headers}" --output "${probe_body}" \
      --write-out '%{http_code} %{content_type}' "${probe_url}")"; then
    echo "${probe} HTTP: ${response}"
    describe_file "${probe} received" "${probe_body}"
    describe_headers "${probe_headers}"
    if cmp -s "${expected_file}" "${probe_body}"; then
      echo "${probe}: bytes recovered; the initial mismatch still fails this deployment"
    else
      echo "${probe}: byte mismatch persists"
    fi
  else
    echo "${probe}: network request failed; the initial mismatch still fails this deployment"
  fi
  rm -f "${probe_body}" "${probe_headers}"
done

echo 'Deployment rejected because at least one response differed from the exact build artifact'
exit 1
