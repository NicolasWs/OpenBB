#!/usr/bin/env bash
# Record catalog sources, sample responses and spike probes from a running openbb-api.
#
# Usage:
#   excel/scripts/record-fixtures.sh [BASE_URL]
#
# Environment:
#   OBB_USER / OBB_PASS  Basic auth credentials, when the server runs with OPENBB_API_AUTH=true.
#   ORIGIN               Origin used for the CORS probes (default https://localhost:3000).
#   CURL_CA              CA bundle to trust for an https BASE_URL (e.g. the office-addin dev CA).
#   SPIKE_DIR            Sub-directory of fixtures/ for probe output (default spike), e.g. spike-https.
#
# Writes into excel/fixtures/ (catalog + responses) and excel/fixtures/spike/ (probe headers).
set -uo pipefail

BASE="${1:-http://127.0.0.1:6900}"
BASE="${BASE%/}"
ORIGIN="${ORIGIN:-https://localhost:3000}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$HERE/fixtures"
SPIKE="$OUT/${SPIKE_DIR:-spike}"
mkdir -p "$OUT/responses" "$SPIKE"

CURL=(curl -sS --max-time 120)
[ -n "${CURL_CA:-}" ] && CURL+=(--cacert "$CURL_CA")
AUTH=()
[ -n "${OBB_USER:-}" ] && AUTH=(-u "${OBB_USER}:${OBB_PASS:-}")

fetch() { # fetch <outfile> <path-and-query>
  local out="$1" path="$2" code
  code=$("${CURL[@]}" "${AUTH[@]}" -o "$out" -w '%{http_code}' "$BASE$path")
  printf '%-4s %s\n' "$code" "$path"
}

probe() { # probe <name> <curl args...>  -> headers + body of a request, for the spike findings
  local name="$1"
  shift
  "${CURL[@]}" -i "$@" >"$SPIKE/$name.txt" 2>&1
  printf 'probe %-28s %s\n' "$name" "$(head -n1 "$SPIKE/$name.txt" | tr -d '\r')"
}

echo "== catalog sources from $BASE"
fetch "$OUT/openapi.json" "/openapi.json"
fetch "$OUT/command_model.json" "/api/v1/coverage/command_model"
fetch "$OUT/providers.json" "/api/v1/coverage/providers"
fetch "$OUT/commands.json" "/api/v1/coverage/commands"

echo "== equity / etf / index sample responses (keyless providers)"
R="$OUT/responses"
fetch "$R/equity_price_historical_nasdaq.json" "/api/v1/equity/price/historical?symbol=AAPL&start_date=2026-08-03&end_date=2026-08-28&provider=nasdaq"
fetch "$R/equity_price_historical_cboe.json" "/api/v1/equity/price/historical?symbol=AAPL&start_date=2026-08-03&end_date=2026-08-28&provider=cboe"
fetch "$R/equity_price_historical_multi_nasdaq.json" "/api/v1/equity/price/historical?symbol=AAPL,MSFT&start_date=2026-08-24&end_date=2026-08-28&provider=nasdaq"
fetch "$R/equity_price_quote_nasdaq.json" "/api/v1/equity/price/quote?symbol=AAPL,MSFT&provider=nasdaq"
fetch "$R/equity_price_quote_cboe.json" "/api/v1/equity/price/quote?symbol=AAPL&provider=cboe"
fetch "$R/equity_profile_nasdaq.json" "/api/v1/equity/profile?symbol=AAPL&provider=nasdaq"
fetch "$R/equity_profile_tmx.json" "/api/v1/equity/profile?symbol=RY&provider=tmx"
fetch "$R/equity_search_nasdaq.json" "/api/v1/equity/search?query=apple&provider=nasdaq"
fetch "$R/etf_historical_nasdaq.json" "/api/v1/etf/historical?symbol=SPY&start_date=2026-08-03&end_date=2026-08-28&provider=nasdaq"
fetch "$R/etf_info_nasdaq.json" "/api/v1/etf/info?symbol=SPY&provider=nasdaq"
fetch "$R/etf_info_tmx.json" "/api/v1/etf/info?symbol=XIU&provider=tmx"
fetch "$R/etf_holdings_nasdaq.json" "/api/v1/etf/holdings?symbol=SPY&provider=nasdaq"
fetch "$R/etf_search_nasdaq.json" "/api/v1/etf/search?query=s%26p&provider=nasdaq"
fetch "$R/index_price_historical_cboe.json" "/api/v1/index/price/historical?symbol=SPX&start_date=2026-08-03&end_date=2026-08-28&provider=cboe"
fetch "$R/index_constituents_cboe.json" "/api/v1/index/constituents?symbol=SPX&provider=cboe"
fetch "$R/index_snapshots_cboe.json" "/api/v1/index/snapshots?provider=cboe"
fetch "$R/index_search_cboe.json" "/api/v1/index/search?query=nasdaq&provider=cboe"

echo "== spike probes"
probe cors_preflight -X OPTIONS "$BASE/api/v1/equity/price/quote?symbol=AAPL" \
  -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization"
probe cors_preflight_pna -X OPTIONS "$BASE/api/v1/equity/price/quote?symbol=AAPL" \
  -H "Origin: https://excel.officeapps.live.com" -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" -H "Access-Control-Request-Private-Network: true"
probe cors_simple_get "${AUTH[@]}" -H "Origin: $ORIGIN" "$BASE/api/v1/coverage/providers" -o /dev/null -D -
probe no_auth_header -H "Origin: $ORIGIN" "$BASE/api/v1/coverage/providers" -o /dev/null -D -
probe bad_auth -u "wrong:wrong" -H "Origin: $ORIGIN" "$BASE/api/v1/equity/price/quote?symbol=AAPL&provider=nasdaq"
probe empty_204 "${AUTH[@]}" "$BASE/api/v1/equity/price/historical?symbol=ZZZZNOTREAL&provider=nasdaq"
probe validation_422 "${AUTH[@]}" "$BASE/api/v1/equity/price/historical?provider=nasdaq"
probe bad_provider "${AUTH[@]}" "$BASE/api/v1/equity/price/historical?symbol=AAPL&provider=nope"
probe missing_key_fred "${AUTH[@]}" "$BASE/api/v1/economy/fred_series?symbol=GDP&provider=fred"

echo "Done. Fixtures in $OUT"
