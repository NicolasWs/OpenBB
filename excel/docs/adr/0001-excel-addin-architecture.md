# ADR 0001: Excel add-in architecture

- **Status:** Proposed. The owner signs off to accept it (NIC-69).
- **Date:** 2026-10-12
- **Issues:** NIC-69 (this decision), with evidence from NIC-71 (spike) and NIC-70 (coverage matrix)

## Context

We want OpenBB data in Excel worksheets. The repo has no Excel code. A self-hosted
`openbb-api` already serves every installed route over REST, plus `/openapi.json` and
`/widgets.json`. The test server, nicogeek, runs it in Docker on CasaOS:

- openbb-core 2.0.1;
- 1,085 endpoints;
- 971 Workspace widgets.

Five decisions were open. The spike evidence is in `spike-findings.md`.

## Decisions

### 1. Build our own add-in rather than extend the official OpenBB add-in

OpenBB ships an Excel add-in for Workspace Pro/Enterprise. It reaches data only through a
signed-in Workspace account and the backends registered there. In the spike:

- the add-in installed in Excel for Mac;
- sign-in failed ("Something went wrong");
- pro.openbb.co was unavailable, so nicogeek could not be registered as a backend.

The official add-in is closed source, so we could not change any of this.

**Decision:** build our own Office.js add-in in `excel/`. The official add-in stays an
optional alternative. If OpenBB support restores access, we compare the two before M3.
We reuse its formula idea (one generic function plus typed functions) so users find it familiar.

### 2. Backend: a self-hosted `openbb-api`, reached over HTTPS

The add-in talks directly to the user's `openbb-api`. No OpenBB cloud is involved.

- Excel requires HTTPS with a trusted certificate. On nicogeek, `tailscale serve` provides
  this with a real certificate, reachable on the tailnet only. On a laptop,
  `openbb-api --ssl-certfile/--ssl-keyfile` works with a locally trusted certificate.
- CORS: the default `api_settings.cors` (`allow_origins: *`) works with an explicit
  `Authorization` header, and the probe confirmed it. No cookies or credentials mode are used.
- Auth: optional Basic auth (`OPENBB_API_AUTH`). It is required before any public
  exposure, such as `tailscale funnel`.
- A hosted multi-user backend is out of scope for v1.

### 3. Platform scope: Excel for Mac first, then the web and Windows

The owner tests on Excel for Mac (Microsoft 365). The add-in uses a shared runtime
(SharedRuntime 1.1), which Mac, Windows and the web all support.

Excel on the web in Chrome/Edge, and possibly Windows (WebView2), sends Private Network
Access preflights. The server currently rejects them with 400. Supporting those platforms
needs a small core change: add `allow_private_network` to `api_settings.cors`, or answer
those preflights in a `[middleware] hooks` entry. That work is tracked for M3.

### 4. Distribution: sideload now, centralized deployment later

- **Development:** the manifest points to `https://localhost:3000`. On Mac it is sideloaded
  through the `wef` folder (`npm run start:mac`). On the web it is uploaded through "Upload My Add-in".
- **Team use (M3, NIC-92):** host the built add-in on HTTPS and deploy through Microsoft 365
  centralized deployment.
- AppSource is not planned. The add-in targets self-hosted servers, which AppSource review handles poorly.

### 5. Provider keys stay on the server

`openbb-api` has no per-request credential mechanism. Custom headers are dropped, and
credentials come from `user_settings.json` or env vars on the server.

**Decision:** the add-in never stores or sends provider keys. Missing keys surface as the
server's own message, for example "Missing credential 'fred_api_key'". The settings pane
marks the providers that need keys (fred, bls, eia, cftc, congress_gov) and links to the
server-side setup.

The add-in stores only the server URL and the optional Basic auth credentials, in
`OfficeRuntime.storage` (per user and machine, not in the workbook). Formulas and
workbooks never contain credentials.

## Architecture

```
Excel (Mac / Web / Windows)
 ├─ custom functions  =OBB.<ROUTE>(...) and =OBB.QUERY(route, params, provider, options)
 └─ task pane          settings · data browser · preview · insert formula/table
        │  one shared runtime: settings, request cache and concurrency limiter are shared
        ▼  HTTPS + optional Basic auth
openbb-api (self-hosted)  /api/v1/<route> · /openapi.json · /api/v1/coverage/providers
```

### Catalog

- **Generation:** the catalog is generated from `/openapi.json`. `/coverage/command_model`
  would add per-provider field lists, but it returns 422 on the current server (a bug,
  fixed separately).
- **Typed functions:** the build writes `functions.json` (the Excel function metadata)
  from the catalog. It creates typed functions for the standard routers (125 today),
  following the classification in the coverage matrix.
- **Generic function:** `=OBB.QUERY` covers every endpoint that lands in cells (914). A
  newly installed provider therefore works without any add-in code change.
- **Task pane:** reads the live `/openapi.json`, so it always shows what the server has.

### Results

- Results become a 2D array with a header row, which Excel spills.
- Nested objects flatten to `a.b` columns. Lists become JSON text.
- Dynamic columns (the Fed `pivot_wide` tables) are discovered at runtime.

### Errors

Errors are readable cell errors:

| Server response | Cell error |
|---|---|
| 204 | `#N/A` "No data" |
| 400/422 | `#VALUE!` with the server's message |
| 401 | `#VALUE!` "auth failed" |
| Network failure | `#N/A` "Cannot reach …" |

## Consequences

- **Positive:** no vendor login or cloud dependency, and data stays on the user's network.
  Coverage follows the server automatically.
- **Negative:** we own the add-in's maintenance, hosting and deployment. Chromium-based
  Excel needs the PNA server fix. Files, charts and range-input analytics (152 endpoints)
  need separate UX (M2).
- **Follow-ups:**
  - Linear issue for range-input analytics (104 endpoints);
  - core fixes for `command_model` and `allow_private_network`;
  - re-evaluate the official add-in if Workspace access returns.
