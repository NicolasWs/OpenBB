import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCatalog, type OpenApiDoc } from "../src/catalog/build";
import type { Catalog } from "../src/catalog/types";

export const FIXTURES = join(__dirname, "..", "fixtures");

export function readFixture<T = unknown>(relativePath: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, relativePath), "utf8")) as T;
}

let cachedDoc: OpenApiDoc | undefined;
let cachedCatalog: Catalog | undefined;

/** The /openapi.json recorded from the nicogeek server (8 MB, parsed once per run). */
export function recordedOpenApi(): OpenApiDoc {
  cachedDoc ??= readFixture<OpenApiDoc>("openapi.json");
  return cachedDoc;
}

export function recordedCatalog(): Catalog {
  cachedCatalog ??= buildCatalog(recordedOpenApi(), {
    knownProviders: Object.keys(readFixture<Record<string, unknown>>("providers.json")),
  });
  return cachedCatalog;
}

export function entry(route: string, method: "GET" | "POST" = "GET") {
  const found = recordedCatalog().entries.find((e) => e.route === route && e.method === method);
  if (!found) throw new Error(`No catalog entry for ${method} ${route}`);
  return found;
}
