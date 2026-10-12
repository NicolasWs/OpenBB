# NIC-71 spike: official OpenBB Excel add-in against a self-hosted openbb-api

Goal: decide build vs extend (NIC-69). If the official OpenBB Add-in for Excel can pull
data from our own `openbb-api` through OpenBB Workspace, most of M1 (NIC-72 to NIC-77)
becomes configuration, coverage checks and docs instead of new code.

## Test environment

| Role | Where | Detail |
|---|---|---|
| Backend | nicogeek (CasaOS), container `openbb-api` | image `openbb-platform:local`, openbb-core 2.0.1, openbb-platform-api 2.0.1, port 6900, 971 widgets in `/widgets.json` |
| HTTPS | nicogeek, `tailscale serve` | `https://nicogeek.tailaaacd4.ts.net` → `http://127.0.0.1:6900`, tailnet only, real certificate |
| Server config | `$OPENBB_CONFIG` in the container | `[launcher] host/port` only: default CORS (all origins), no auth, no middleware |
| Workspace | Mac browser, OpenBB Workspace Pro | custom backend pointing at the ts.net URL |
| Excel | Excel for Mac (Microsoft 365), on the tailnet | official OpenBB add-in from the Office Add-ins store |

## Steps

1. **Backend reachable over HTTPS.** On the Mac, open
   `https://nicogeek.tailaaacd4.ts.net/widgets.json`: valid padlock, JSON loads.
2. **Connect Workspace.** In Workspace, add a custom backend (data connector) named
   `nicogeek` with URL `https://nicogeek.tailaaacd4.ts.net`. Record how many widgets appear
   and whether any fail to load.
3. **Install the add-in.** Excel for Mac → Home → Add-ins → search "OpenBB" → Add → sign in
   with the Workspace account.
4. **Get a formula.** In Workspace, open a widget from the nicogeek backend → ⋮ →
   **Excel formula** → copy, then paste it into a cell in Excel.
5. **Work through the test matrix below**, filling in the result and notes columns.

## Test matrix

Use keyless providers first (nasdaq, cboe, tmx, sec, federal_reserve, oecd, imf).

| # | Case | Widget / input | Expected | Result | Notes |
|---|---|---|---|---|---|
| 1 | Plain table | equity price historical, AAPL, nasdaq | spilled table with headers | | |
| 2 | Parameters change | same, edit symbol/dates in the formula | table updates | | |
| 3 | Single record | equity profile, AAPL, nasdaq | one row or key/value | | |
| 4 | ETF and index | etf historical SPY (nasdaq); index historical SPX (cboe) | tables | | |
| 5 | Wide table | a federal_reserve regional table (e.g. Dallas) | many columns, known only at runtime | | |
| 6 | Nested fields | an SEC or Deribit widget with nested fields | flattened or JSON text | | |
| 7 | Document / markdown | an SEC filing or markdown widget | text in a cell, or not supported | | |
| 8 | Chart widget | a cboe options chart route | not supported, or an image | | |
| 9 | Missing provider key | a FRED widget, no key on the server | readable error | | |
| 10 | No data | bad symbol `ZZZZNOTREAL` | readable error, not a crash | | |
| 11 | Large result | long equity history, or an index constituents list | completes; note time and row count | | |
| 12 | Refresh | recalculate the workbook; reopen the file | data refreshes | | |
| 13 | Off-tailnet | disconnect Tailscale on the Mac, recalculate | error; tells us the request path (below) | | |

## Key question: which path do requests take?

Test 13 answers it.

- **Excel calls the backend directly from the Mac.** Off the tailnet, cells error. A
  tailnet-only URL is enough, and the data never leaves our network.
- **Excel goes through OpenBB's cloud.** The formulas fail even on the tailnet, because
  OpenBB's servers can't reach a tailnet URL. A public endpoint would then be needed
  (`tailscale funnel` with `OPENBB_API_AUTH` turned on), which goes into the ADR as a
  security trade-off.

## Recordings for the cloud session

From a clone of this branch on nicogeek:

```bash
bash excel/scripts/record-fixtures.sh http://127.0.0.1:6900
SPIKE_DIR=spike-https bash excel/scripts/record-fixtures.sh https://nicogeek.tailaaacd4.ts.net
```

These feed the coverage matrix (NIC-70) and record CORS and error behaviour behind the HTTPS proxy.

## Outcome (fill in)

- Official add-in works with the self-hosted backend: yes / partly / no
- Request path: direct / via OpenBB cloud
- Shapes not supported (from the matrix):
- Decision for NIC-69: extend (configure the official add-in, then fill the gaps) / build our own
