# Implementation plan for the AI factory: OpenBB Excel add-in (remaining M1, then M2/M3)

This plan lets autonomous agents pick up the work from the current branch. Each work
package (WP) lists:

- its goal;
- the files it owns;
- the interfaces it must honour;
- acceptance criteria;
- how to verify the work.

WPs in the same wave can run in parallel without touching the same files.

## 0. Ground rules for every agent

- **Repository and branch:** `NicolasWs/OpenBB`, branch `claude/festive-fermi-1rqvmh`.
  - Work in `excel/` only, unless the WP says otherwise.
  - Make one commit per Linear issue, with the message prefix `NIC-<n>: `.
  - Rebase on the remote before pushing. The owner also pushes fixtures to this branch.
- **Read first:**
  - `excel/docs/adr/0001-excel-addin-architecture.md` (the decisions; do not reopen them);
  - `excel/docs/spike-findings.md` (server behaviour);
  - `excel/docs/coverage-matrix.md` (endpoint shapes);
  - `excel/README.md`.
- **Toolchain:** Node 22 (`lts/*`) and npm.
  - Stay on **vitest 5**: vitest 4 crashes `npm install` with an npm arborist bug (`Cannot read properties of null (reading 'edgesOut')`).
  - Install new packages with `npm install -D <pkg>`, then check that `npm ci` still works.
- **Checks before every push** (all must pass):
  `cd excel && npm run lint && npm run catalog && npm run typecheck && npm test && npm run build`.
  - `npm run validate` needs network access to `validationgateway.omex.office.net`. If it
    is blocked, rely on the CI workflow `.github/workflows/test-excel-addin.yml`.
- **No live server in the cloud.** The test server (nicogeek, `https://nicogeek.tailaaacd4.ts.net`)
  is tailnet-only, so cloud agents cannot reach it. Use the recorded fixtures in
  `excel/fixtures/`:
  - `openapi.json` (8 MB);
  - `widgets.json`;
  - `providers.json`;
  - `responses/*.json`;
  - `spike*/` (probes).

  Live checks are done by the owner on Excel for Mac (WP-H).
- **Repo quirks:**
  - the root `.gitignore` ignores `*.sh`, so add shell scripts with `git add -f`;
  - `docs.openbb.co` is blocked from cloud sessions;
  - parse the 8 MB `openapi.json` once per test run (`tests/helpers.ts` caches it).
- **Server facts the code must handle**, from the probes in `fixtures/spike*/`:

  | Response | Body | Meaning |
  |---|---|---|
  | 200 | OBBject `{results, provider, warnings, chart, extra}` | Data |
  | 204 | **empty** | No data |
  | 400 | `{"detail": "<message>"}` | `OpenBBError`; also missing provider keys: "Missing credential 'fred_api_key' …" |
  | 401 | `{"detail": …}` | Only when Basic auth is enabled |
  | 422 | `{"detail": [{loc, msg, …}]}` | Validation error / bad provider |
  | 500 | `{"detail": "Unexpected Error -> …"}` | Server error |

  - nasdaq historical endpoints always return 204 on nicogeek. Use **cboe** for price-history examples.

## 1. What is already done (do not redo)

| Issue | State | Where |
|---|---|---|
| NIC-71 spike | Done | `docs/spike-findings.md`, `docs/spike-official-addin.md`, `scripts/record-fixtures.sh`, `fixtures/` |
| NIC-70 coverage matrix | Done | `src/catalog/{types,naming,classify,build}.ts`, `scripts/coverage-matrix.ts`, `docs/coverage-matrix.{json,md}` |
| NIC-69 ADR | Proposed, awaiting owner sign-off | `docs/adr/0001-excel-addin-architecture.md` |
| NIC-72 scaffold | Done | `package.json`, configs, `manifest.xml`, `taskpane.html`, `src/main.tsx` (placeholder), CI workflow, README |
| NIC-74 catalog generator | Done | `src/catalog/functionsJson.ts`, `scripts/generate-catalog.ts`; outputs `public/functions.json`, `src/generated/{catalog,signatures}.json` (gitignored, made by `npm run catalog`) |

Existing contracts (do not change their shapes without updating every user):

- `Catalog`, `CatalogEntry`, `ParamSpec`, `FieldSpec`, `Shape`, `Landing` in `src/catalog/types.ts`.
- `FunctionSignature { functionId, route, method, positional: ParamSpec[] }` and
  `QUERY_FUNCTION_ID = "QUERY"` in `src/catalog/functionsJson.ts`.
- Excel argument order:
  - typed: `=OBB.<ID>(<up to 6 standard params, required first>, provider, params)`;
  - generic: `=OBB.QUERY(route, params, provider)`.
- `params`: either a `"name=value; name=value"` string or a 2-column range.
  - Names starting with `_` are **mapper options**: `_columns`, `_sort`, `_limit`, `_headers`, `_orient`, `_dates`.
  - All other names are API query parameters.

## 2. Work packages

### Wave 1: start in parallel

#### WP-A · NIC-76 Response-to-range mapper (pure functions, no Office APIs)

- **Files:** `src/mapper/toMatrix.ts`, `src/mapper/options.ts`, `src/mapper/*.test.ts`.
- **Interface:**
  ```ts
  export type Cell = string | number | boolean;
  export interface MapperOptions {
    columns?: string[];                       // keep and order these columns
    sort?: { column: string; desc: boolean }; // "_sort=close:desc"
    limit?: number;                           // max data rows
    headers: boolean;                         // default true
    orient: "auto" | "row" | "column";        // single records: auto = key/value rows
    dates: "iso" | "serial";                  // default iso
  }
  export function toMatrix(results: unknown, fieldOrder?: string[], options?: Partial<MapperOptions>): Cell[][];
  export function parseParams(input: unknown): { api: Record<string, string>; mapper: Partial<MapperOptions> };
  export function excelSerialToIso(serial: number): string; // 1899-12-30 epoch, date part only
  ```
- **Behaviour (each rule needs a test):**
  - **Lists of records:**
    - header row first;
    - column order is the `fieldOrder` names that appear, then extra keys in order of first appearance. This handles the Fed `pivot_wide` tables, whose columns exist only at runtime.
  - **Single objects** (`results` is an object, or a list of length 1 with `orient=column`):
    - two columns, `field | value`;
    - `orient=row` gives one header row plus one value row.
  - **Columnar objects** (every value is an array of the same length): zip them into rows.
  - **Lists of scalars:** one column named `value`.
  - **Nested values:**
    - dicts are flattened to `parent.child`, depth 2;
    - lists and deeper values become compact JSON text.
  - **Value conversions:**
    - `null`/`undefined` become `""`;
    - non-finite numbers become `""`;
    - booleans stay booleans;
    - strings longer than 32,767 characters are cut to 32,766 + `…`.
  - **Dates:**
    - ISO date or datetime strings stay strings by default;
    - with `dates=serial`, `YYYY-MM-DD[THH:MM…]` becomes an Excel serial number (days since 1899-12-30, fraction for time).
  - **Empty results:** return `[["No data"]]`. The runtime normally turns 204 into an error first.
  - **Shape:** the output is always rectangular (pad rows with `""`) and never empty.
  - **`parseParams`:**
    - accepts `null`/`undefined`;
    - accepts a string split on `;` then the first `=`, trimming whitespace;
    - accepts a 2-column matrix (skip blank rows; numbers become strings; booleans become `true`/`false`).
    - `_columns` is comma separated, `_sort` is `col[:desc]`, `_limit` is an integer, and `_headers` is `false|0|no`.
  - **Fixtures:** test with `fixtures/responses/equity_price_historical_cboe.json`, `equity_profile_tmx.json` (wide record), `index_snapshots_cboe.json` (large) and `etf_holdings_nasdaq.json`.
- **Done when:** 100% branch coverage of the rules above, and no Office types are imported.

#### WP-B1 · NIC-75 (part 1) API client, errors, cache, limiter (pure, mockable `fetch`)

- **Files:** `src/api/client.ts`, `src/api/errors.ts`, `src/api/cache.ts`, `src/api/limiter.ts`, `src/api/*.test.ts`.
- **Interface:**
  ```ts
  export interface ObbResponse { results: unknown; provider?: string | null;
    warnings?: { category: string; message: string }[] | null; extra?: Record<string, unknown> }
  export type ObbErrorKind = "no-data" | "auth" | "bad-request" | "missing-key" | "network" | "server";
  export class ObbError extends Error { kind: ObbErrorKind; status?: number }
  export interface ClientDeps { getSettings: () => Promise<Settings>; fetchImpl?: typeof fetch; now?: () => number }
  export class ObbClient {
    constructor(deps: ClientDeps);
    query(route: string, params: Record<string, string>, provider?: string, signal?: AbortSignal): Promise<ObbResponse>;
    providers(signal?: AbortSignal): Promise<Record<string, string[]>>; // GET /api/v1/coverage/providers
    openapi(signal?: AbortSignal): Promise<unknown>;                     // GET /openapi.json
  }
  ```
  (`Settings` comes from WP-C; until it lands, import the type from `src/shared/settings.ts` as a stub.)
- **Behaviour:**
  - **URL:** `${serverUrl}/api/v1/${route}?<params>&provider=<p>`, with the trailing slash trimmed, values encoded and empty values dropped.
  - **Auth:** send `Authorization: Basic …` only when a username is set. Never send cookies (`credentials: "omit"`).
  - **Dedupe:** concurrent identical requests (same URL and auth) share one fetch.
  - **Cache:**
    - LRU keyed by URL;
    - TTL is `settings.cacheTtlSeconds` (default 300);
    - holds at most 200 entries;
    - 204 and errors are not cached.
  - **Concurrency:** at most `settings.maxConcurrency` (default 4) requests in flight; the rest queue in FIFO order.
  - **Retries:**
    - retry 429 and 503 and network errors up to 3 attempts in total;
    - exponential backoff (500 ms, 1 s, 2 s) plus ±20% jitter;
    - honour `Retry-After` in seconds;
    - never retry 4xx except 429.
  - **Cancellation:** abort via `AbortSignal`. A cancelled request rejects with `AbortError` and leaves no cache entry.
  - **Error mapping** to `ObbError`:

    | Response | Kind |
    |---|---|
    | 204 | `no-data` |
    | 401 | `auth` |
    | 400 with "Missing credential" | `missing-key` |
    | other 400/422 | `bad-request` (message = `detail`, or the first `detail[].msg` with its `loc`) |
    | 5xx | `server` |
    | `TypeError` from fetch | `network` ("Cannot reach OpenBB server at <url>") |

- **Tests:** use a fake `fetch` that serves the fixture files and the `fixtures/spike/*.txt` cases (status plus body). Use fake timers for the backoff and TTL.
- **Done when:** every row of the error table and every cache, limiter, retry and cancel rule has a test.

#### WP-C · NIC-73 Settings storage and settings pane

- **Files:** `src/shared/settings.ts`, `src/shared/settings.test.ts`, `src/taskpane/Settings.tsx`.
- **Interface:**
  ```ts
  export interface Settings { serverUrl: string; username?: string; password?: string;
    cacheTtlSeconds: number; maxConcurrency: number }
  export const DEFAULT_SETTINGS: Settings; // serverUrl "https://127.0.0.1:6900", 300, 4
  export function loadSettings(): Promise<Settings>;
  export function saveSettings(settings: Settings): Promise<void>;
  export function onSettingsChanged(listener: (s: Settings) => void): () => void; // same-runtime event
  ```
- **Storage:**
  - use `OfficeRuntime.storage` (key `obb.settings`, JSON) when it exists, otherwise `localStorage` for tests and dev;
  - **never** use `Office.context.document.settings` (it would put credentials in the workbook);
  - validate on save: the URL must be `https://`, or `http://localhost`/`127.0.0.1` with a warning.
- **Pane:**
  - fields for the server URL, username and password (masked), cache TTL and max concurrency;
  - a **Test connection** button that calls `ObbClient.providers()`. On success it lists the providers with a "needs key" badge for `fred, bls, eia, cftc, congress_gov` and a link to the server-side key setup in the README.
  - **Failure messages:**

    | Failure | Message |
    |---|---|
    | Network or TLS | "Cannot reach the server. Check the URL, HTTPS certificate and Tailscale connection." |
    | 401 | "Wrong username/password." |
    | 400 "Disallowed CORS private-network" | "Server rejects Private Network Access: see spike-findings.md." |

- **Done when:**
  - storage round-trips in tests (mock `OfficeRuntime.storage`);
  - React tests cover success and each failure (add `@testing-library/react` + `jsdom` environment per file);
  - credentials never appear in any workbook API call (grep test: `Office.context.document.settings` is not referenced).

### Wave 2: after the Wave 1 interfaces exist (stubs are fine)

#### WP-B2 · NIC-75 (part 2) Custom-function registration and argument handling

- **Files:** `src/functions/register.ts`, `src/functions/args.ts`, `src/functions/*.test.ts`, `src/main.tsx` (wiring only).
- **Behaviour:**
  - **Registration:**
    - at module load (not inside `Office.onReady`), call `CustomFunctions.associate(id, handler)` for every entry of `src/generated/signatures.json` and for `QUERY`;
    - IDs must match `public/functions.json` exactly, because both come from the same `npm run catalog`.
  - **Typed handler** `(…positional, provider, params, invocation)`:
    - map positional values to `signature.positional[i].name`;
    - for params with `type === "date"`, convert numbers with `excelSerialToIso`;
    - `true`/`false` stay booleans;
    - blank or `null` arguments are omitted;
    - merge with `parseParams(params).api`; explicit positional values win;
    - call `client.query`, then `toMatrix(results, fieldOrderFor(entry, provider), mapperOptions)`.
  - **`QUERY` handler:** `(route, params, provider, invocation)`. Strip a leading `/` and an `/api/v1/` prefix from `route`.
  - **Provider default:** if `provider` is blank, use the first of `entry.providers`, or omit it.
  - **Cancellation:** wire `invocation.onCanceled` to an `AbortController`.
  - **Errors:** convert `ObbError` to `new CustomFunctions.Error(code, message)`:

    | Kind | Code | Message |
    |---|---|---|
    | `no-data` | `notAvailable` | "No data" |
    | `network` | `notAvailable` | network message |
    | `auth` | `invalidValue` | "Auth failed: check OpenBB Data settings" |
    | `missing-key` | `invalidValue` | the server message |
    | `bad-request` | `invalidValue` | the server message |
    | `server` | `invalidValue` | "Server error: …" |

    Truncate messages to 255 characters.
  - **Warnings:** push OBBject `warnings` to an in-memory log (`src/shared/log.ts`, a ring buffer of 200) that the task pane shows. Warnings never go in cells.
  - **Shared runtime:** one `ObbClient` instance (shared cache and limiter) for both functions and the pane, exported from `src/shared/runtime.ts`.
- **Tests:**
  - mock the `CustomFunctions` global (`associate`, `Error`, `ErrorCode`);
  - drive handlers with recorded responses;
  - assert argument mapping, date conversion, provider default, cancellation and error codes.
- **Done when:** registering the recorded catalog's signatures produces 126 `associate` calls, and the handlers return rectangular matrices for every fixture.

#### WP-D · NIC-77 Task pane data browser

- **Files:**
  - `src/taskpane/App.tsx` (tabs: Browse · Settings · Log);
  - `Browser.tsx`, `ParamForm.tsx`, `Preview.tsx`;
  - `formula.ts`, `insert.ts`, plus tests.
- **Catalog source:**
  - by default, lazily `import("../generated/catalog.json")` in its own chunk;
  - a **Refresh from server** button calls `client.openapi()` + `providers()` and runs `buildCatalog(...)` in the browser, keeping the result in memory;
  - show the source and endpoint count.
- **Browse:**
  - filters for category (first path segment), provider and shape;
  - text search over route, summary and description;
  - hide `helper` entries; show `file`/`chart`/`range-input` entries greyed out with "coming in M2".
- **ParamForm:**
  - generated from `ParamSpec`: text, number, date picker, select from `choices`, checkbox for booleans, and comma-separated input for `multiple`;
  - provider select from `entry.providers`;
  - changing the provider shows that provider's params (`providers` includes it) and hides the others;
  - required fields are validated.
- **Preview:** runs the query through the shared client and shows the first 50 rows of `toMatrix` in an HTML table, plus warnings.
- **Insert formula** (`formula.ts`, pure and tested):
  - typed entries give `=OBB.<ID>(…)`; others give `=OBB.QUERY("route","k=v; …","provider")`;
  - strings are double-quoted with `"` escaped as `""`;
  - numbers and booleans are written bare;
  - trailing empty arguments are dropped, middle ones left blank;
  - provider-specific params go into the `params` string;
  - written with `Excel.run(ctx => ctx.workbook.getActiveCell().formulas = [[f]])`.
- **Insert static table** (`insert.ts`):
  - writes the matrix to `range.values` from the active cell;
  - optionally converts it to an Excel table (`sheet.tables.add`, header row) named `OBB_<route>`, made unique;
  - warns above 100,000 cells.
- **Tests:**
  - `formula.ts` exhaustively;
  - `insert.ts` with a mocked `Excel.run`;
  - a component test that renders Browser on the recorded catalog, searches "historical", fills symbol AAPL and provider cboe, previews with the mocked client, and inserts a formula.
- **Done when:** the scenario test passes, and the bundle keeps the catalog in a separate chunk (check `vite build` output).

### Wave 3

#### WP-E · NIC-78 Vertical slice: Equity + ETF + Index, end to end

- **Files:** `tests/contract.test.ts`, the README "Formulas" section, the manual checklist in `docs/spike-findings.md`.
- **Contract tests:** run catalog → handler → client (fake fetch serving `fixtures/responses/*.json`) → mapper for:
  - equity: price historical (cboe), quote (nasdaq, cboe), profile (nasdaq, tmx), search;
  - ETF: historical, info (nasdaq, tmx), holdings, search;
  - index: price historical (cboe), constituents, snapshots, search. The recorded `index_constituents_cboe.json` is an error (SPX is not a Cboe constituents symbol); re-record it with `symbol=BUK100P`;
  - error cases: 204, 422, missing key.

  Assert the header rows and row counts against the fixture data.
- **README:** list sample formulas per asset class (cboe/tmx/nasdaq, keyless), the `params` syntax, mapper options and an error reference.
- **Manual checklist for the owner** (WP-H): exact formulas with expected results.
- **Done when:** contract tests pass and the README examples match the function signatures in `public/functions.json`.

### Side lanes: any time, separate PRs against `develop` (Python, not in `excel/`)

- **WP-F1: fix `/coverage/command_model` 422.**
  - In `openbb_platform/core/openbb_core/api/router/coverage.py`, the `json.dumps` `default=` serializer returns unserializable objects unchanged, which raises "Circular reference detected".
  - Make it return JSON-safe values (types, dates, enums, `PydanticUndefined`, callables), and add a unit test.
  - Once fixed, the catalog can add per-provider field lists from it (optional enhancement in `build.ts`).
- **WP-F2: Private Network Access support.**
  - Add `allow_private_network: bool = False` to `Cors` in `core/openbb_core/app/model/api_settings.py`.
  - Pass it to `CORSMiddleware` in `core/openbb_core/api/rest_api.py` and `extensions/platform_api/openbb_platform_api/app/bootstrap.py`.
  - Test that a preflight with `Access-Control-Request-Private-Network: true` returns 200 with `Access-Control-Allow-Private-Network: true` when enabled.
  - Needed for Excel on the web in Chrome/Edge and possibly Windows.
- **WP-G: Linear hygiene** (needs Linear access; confirm with the owner before writing):
  - move NIC-70, 71, 72, 74 to Done and NIC-69 to In Review, linking the commits;
  - create an M2 issue "Range-input analytics (quantitative, technical, econometrics): 104 POST endpoints" from `coverage-matrix.md`;
  - create an M3 issue "Server PNA support" linked to WP-F2.

### WP-H · Owner checks on Excel for Mac (human, after WP-B2 + WP-D)

1. On the Mac, run `cd excel && npm ci && npm run certs && npm run catalog:server -- https://nicogeek.tailaaacd4.ts.net && npm run dev`.
2. Run `npm run start:mac` and restart Excel. If an old version sticks, clear Excel's add-in cache: quit Excel and empty the `Wef` cache folder under `~/Library/Containers/com.microsoft.Excel/Data/`.
3. In **Data → OpenBB Data → Settings**, set the URL to `https://nicogeek.tailaaacd4.ts.net`, test the connection and check the provider list.
4. Check the formulas:
   - `=OBB.EQUITY.PRICE.HISTORICAL("AAPL",,,"cboe")` spills OHLCV;
   - `=OBB.QUERY("index/price/historical","symbol=SPX","cboe")` spills;
   - `=OBB.EQUITY.PROFILE("RY","tmx")` spills one row;
   - a bad symbol gives `#N/A` "No data";
   - `=OBB.QUERY("economy/fred_series","symbol=GDP")` gives `#VALUE!` "Missing credential…".
5. In Browse, search "constituents", preview BUK100P via cboe (Cboe constituents only cover European indices), then insert it as a static table.
6. Record the results in `docs/spike-findings.md`. Then sign off ADR 0001 by changing its status to Accepted.

## 3. Dependency graph

```
Wave 1:  WP-A mapper ─┐   WP-B1 client ─┐   WP-C settings ─┐
Wave 2:               └──► WP-B2 functions ◄─┘            │
                          WP-D task pane ◄─────────────────┘ (uses A, B1, C)
Wave 3:  WP-E slice (needs A, B1, B2) ─► WP-H owner checks on Mac
Side:    WP-F1, WP-F2 (Python core), WP-G (Linear)
```

## 4. After M1: M2 and M3 entry points

Use `docs/coverage-matrix.json` to drive these.

- **M2 (NIC-79 to NIC-86):** for each domain, filter the matrix by category, record 3 to 5
  responses per endpoint group from nicogeek (`scripts/record-fixtures.sh` can be
  extended), and add contract tests. Mapper exceptions get new rules in WP-A's module.
  New UX is needed for:
  - documents (single cell, plus a "save as file" action in the pane);
  - files (download from the pane);
  - charts (insert an Excel chart from the spilled range, or skip);
  - range-input analytics (a new issue; send the selected range as the `data` body).
- **M3 (NIC-87 to NIC-93):**
  - refresh (volatile toggle, "Refresh all OBB" using cache bypass);
  - large results (`_limit`, paging, size warnings);
  - security review (ADR decision 5, WP-F2, auth);
  - tests (an Excel smoke test on Mac);
  - docs (generate a function reference from `functions.json`);
  - packaging (production manifest with the hosted URL, centralized deployment);
  - opt-in telemetry.
