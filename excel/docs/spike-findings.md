# NIC-71 spike findings

Server: nicogeek `openbb-api` (openbb-core 2.0.1, openbb-platform-api 2.0.1), recorded on
2026-10-12 over `http://127.0.0.1:6900` (`fixtures/spike/`) and over
`https://nicogeek.tailaaacd4.ts.net` through `tailscale serve` (`fixtures/spike-https/`).

## Server-side results (recorded)

| # | Check | Result | Impact for Excel | Fix / action |
|---|---|---|---|---|
| 1 | HTTPS via `tailscale serve` | Works (HTTP/2, real certificate). Headers and status codes match plain HTTP | Excel for Mac and the official add-in can use the ts.net URL | None |
| 2 | CORS preflight with `Authorization` | 200, `allow-origin: *`, `allow-headers: authorization` | Browser and webview calls are allowed | None |
| 3 | Private Network Access preflight (`Access-Control-Request-Private-Network: true`) | **400 "Disallowed CORS private-network"** over HTTP and HTTPS | Blocks Chromium-based clients that send PNA preflights to a private address (Excel on the web in Chrome/Edge, possibly Excel for Windows/WebView2). Excel for Mac (WKWebView) does not send them | Add `allow_private_network` to `api_settings.cors` and pass it to Starlette's `CORSMiddleware` (small core change), or answer PNA preflights in a `[middleware] hooks` entry. Needed only if Web/Windows are in scope |
| 4 | Basic auth | Not enabled: `bad_auth` returns 200 | Fine on a tailnet-only URL; required if the server is ever made public (`tailscale funnel`) | Set `OPENBB_API_AUTH`, `OPENBB_API_USERNAME` and `OPENBB_API_PASSWORD` in the CasaOS app settings before any public exposure |
| 5 | No data | 204, empty body | The client must treat 204 as "no data", not as a JSON parse error | Map to `#N/A` "No data" |
| 6 | Validation error / bad provider | 422, `{"detail":[{loc,msg,...}]}`; the message lists the valid providers | Readable cell error possible | Show the first `msg` |
| 7 | Missing provider key (FRED) | **400** (not 502), `detail` = "Missing credential 'fred_api_key' ..." | A clear message can be shown in the cell | Keys are configured server-side |
| 8 | `/api/v1/coverage/command_model` | **422 "Circular reference detected"**: server bug (the JSON fallback serializer in `core/openbb_core/api/router/coverage.py` returns unserializable objects unchanged) | The per-provider field catalog is unavailable | The catalog uses `openapi.json` (1,088 paths: 974 GET, 114 POST) + `widgets.json` (971 widgets) instead. Bug fix suggested as a separate task |
| 9 | Nasdaq historical prices (equity, multi-symbol, ETF) | **204** for every request; cboe historical works; nasdaq quote/profile/info/holdings/search work | Some provider and endpoint pairs return nothing on this server | Track in the coverage matrix; recheck without dates and with other symbols |

## Excel-side results (Excel for Mac + official add-in)

| Check | Result |
|---|---|
| Install the official add-in from the Office store | Works: the OpenBB ribbon tab and task pane load in Excel for Mac (Microsoft 365) |
| Sign in to the add-in with the OpenBB account | **Fails**: "Something went wrong" |
| Register nicogeek as a Workspace custom backend | **Blocked**: pro.openbb.co is unavailable to the owner |

The official add-in reaches data only through a signed-in Workspace account and the
backends registered there. With both blocked, the 13-case matrix in
`spike-official-addin.md` could not run. The owner chose to build our own add-in
(see ADR 0001) and to ask OpenBB support about Workspace access in parallel.

## Blockers and fixes for our own add-in

| Blocker | Fix | Status |
|---|---|---|
| Excel needs HTTPS with a trusted certificate (Excel for Mac blocks plain HTTP) | `tailscale serve` on nicogeek: real certificate, tailnet only | Done |
| Browser cross-origin calls from the add-in | Default `api_settings.cors` allows any origin with `Authorization` | Verified (probe) |
| Chromium Private Network Access preflight rejected | Add `allow_private_network` to the CORS settings (core change) or a middleware hook | Not needed for Excel for Mac; required before supporting Excel on the web or Windows |
| No auth on the server | `OPENBB_API_AUTH` + username/password in the CasaOS app settings; the add-in sends Basic auth | Optional on the tailnet; required for any public exposure |
| `/coverage/command_model` returns 422 | Build the catalog from `openapi.json` instead | Worked around; core fix suggested separately |
| Empty results come back as a bodiless 204 | Client maps 204 to `#N/A` "No data" | Handled in the runtime (NIC-75) |

## Still to verify in Excel for Mac (with our add-in)

These steps need real Excel and the owner's machine:

- sideload `manifest.xml`;
- open the task pane;
- set the server to `https://nicogeek.tailaaacd4.ts.net` and test the connection;
- `=OBB.EQUITY.PRICE.HISTORICAL("AAPL",,,"cboe")` spills a table;
- `=OBB.QUERY("index/price/historical","symbol=SPX","cboe")` spills a table;
- a bad symbol shows `#N/A` with "No data";
- a FRED call without a key shows `#VALUE!` with the missing-credential message.
