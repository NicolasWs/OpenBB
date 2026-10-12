# OpenBB Data for Excel (self-hosted)

An Office.js Excel add-in that pulls data from **your own `openbb-api` server** into
worksheets, through:

- **custom functions** in the `OBB` namespace;
- **a task pane** to connect to the server, browse datasets, preview them and insert them.

No OpenBB account or cloud service is involved. Excel talks straight to your server.

Status: M1 (core add-in). Design decisions are in
[`docs/adr/0001-excel-addin-architecture.md`](docs/adr/0001-excel-addin-architecture.md).

## 1. Run the server with HTTPS

Excel only calls HTTPS endpoints with a trusted certificate. Pick one setup:

- **Tailscale (recommended for a home server):** run
  `sudo tailscale serve --bg --https=443 http://127.0.0.1:6900` on the server. Excel then uses
  `https://<machine>.<tailnet>.ts.net`, which has a real certificate and is reachable only on your tailnet.
- **Local machine:** start `openbb-api --ssl-keyfile <key> --ssl-certfile <cert>` with a
  locally trusted certificate (for example from `mkcert`, or the `npm run certs` pair below).

Optional Basic auth: set `OPENBB_API_AUTH=true`, `OPENBB_API_USERNAME` and
`OPENBB_API_PASSWORD` on the server, and enter the same credentials in the add-in's settings.

Provider API keys (FRED, BLS, EIA, CFTC, Congress) stay on the server, in
`~/.openbb_platform/user_settings.json` or in environment variables. The add-in never stores them.

## 2. Run the add-in (development)

```bash
cd excel
npm ci
npm run certs        # once: trusted localhost certificate for https://localhost:3000
npm run catalog      # builds the function catalog from fixtures/openapi.json
npm run dev          # serves the add-in on https://localhost:3000
```

To build the catalog from your own server instead, so its providers and routes become typed functions, run
`npm run catalog:server -- https://<your-server>`.

## 3. Sideload into Excel

- **Excel for Mac:** run `npm run start:mac`, which copies `manifest.xml` into Excel's `wef` folder.
  Restart Excel, then choose **Home → Add-ins → OpenBB Data (self-hosted)**.
- **Excel on the web:** choose **Home → Add-ins → More Settings → Upload My Add-in**, then pick
  `manifest.xml`. Chrome and Edge also need the server to accept Private Network Access
  preflights (see `docs/spike-findings.md`).
- **Excel for Windows:** add a shared-folder catalog in **Trust Center → Trusted Add-in Catalogs**
  that contains `manifest.xml`, then use **Insert → My Add-ins → Shared Folder**.

Open the task pane from **Data → OpenBB Data**. Then:

1. Set the server URL and test the connection.
2. Browse a dataset, preview it, and insert it as a formula or as a static table.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run validate
```

`npm run validate` calls Microsoft's online manifest validation service, so it needs network access.
