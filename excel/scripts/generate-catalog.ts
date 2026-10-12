/**
 * NIC-74: generate the add-in's function catalog from an openbb-api description.
 *
 *   npx tsx scripts/generate-catalog.ts --openapi fixtures/openapi.json
 *   npx tsx scripts/generate-catalog.ts --server https://nicogeek.example.ts.net [--user u --password p]
 *   add --all to generate typed functions for provider routers too (default: standard routers).
 *
 * Writes public/functions.json (Excel metadata) and src/generated/{catalog,signatures}.json.
 * Adding a provider to the server needs no code change: re-run this script.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildCatalog, type OpenApiDoc } from "../src/catalog/build";
import { buildFunctionsJson, buildSignatures } from "../src/catalog/functionsJson";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function fetchJson(url: string): Promise<unknown> {
  const user = arg("user");
  const headers: Record<string, string> = {};
  if (user) headers.Authorization = `Basic ${Buffer.from(`${user}:${arg("password") ?? ""}`).toString("base64")}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const server = arg("server")?.replace(/\/$/, "");
  const openapiPath = arg("openapi") ?? "fixtures/openapi.json";
  let doc: OpenApiDoc;
  let knownProviders: string[] | undefined;
  let source: string;

  if (server) {
    doc = (await fetchJson(`${server}/openapi.json`)) as OpenApiDoc;
    knownProviders = Object.keys((await fetchJson(`${server}/api/v1/coverage/providers`)) as object);
    source = server;
  } else {
    doc = JSON.parse(readFileSync(openapiPath, "utf8")) as OpenApiDoc;
    const providersPath = join(dirname(openapiPath), "providers.json");
    if (existsSync(providersPath)) knownProviders = Object.keys(JSON.parse(readFileSync(providersPath, "utf8")));
    source = openapiPath;
  }

  const catalog = buildCatalog(doc, {
    source,
    knownProviders,
    typedScope: process.argv.includes("--all") ? "all" : "standard",
  });
  const functionsJson = buildFunctionsJson(catalog);

  mkdirSync("public", { recursive: true });
  mkdirSync("src/generated", { recursive: true });
  writeFileSync("public/functions.json", JSON.stringify(functionsJson));
  // The bundled copy drops field descriptions to keep the task pane light.
  const compact = {
    ...catalog,
    entries: catalog.entries.map((entry) => ({
      ...entry,
      fields: Object.fromEntries(
        Object.entries(entry.fields).map(([provider, fields]) => [
          provider,
          fields.map(({ name, type }) => ({ name, type })),
        ]),
      ),
    })),
  };
  writeFileSync("src/generated/catalog.json", JSON.stringify(compact));
  writeFileSync("src/generated/signatures.json", JSON.stringify(buildSignatures(catalog)));
  console.log(
    `Catalog from ${source}: ${catalog.entries.length} endpoints, ` +
      `${functionsJson.functions.length} functions (incl. OBB.QUERY).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
