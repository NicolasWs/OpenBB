import { classifyShape, landingForShape, type ResponseInfo } from "./classify";
import { dedupeIds, functionIdForRoute } from "./naming";
import type { Catalog, CatalogEntry, FieldSpec, ParamSpec, ParamType } from "./types";

/* Minimal OpenAPI shapes: only what the catalog reads. */
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: (string | number)[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  description?: string;
  [key: string]: unknown;
}

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: JsonSchema;
  description?: string;
}

interface OpenApiOperation {
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: unknown;
  responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }>;
}

export interface OpenApiDoc {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, JsonSchema> };
}

export interface BuildOptions {
  apiPrefix?: string;
  /** "standard": typed functions for the extension routers only; "all": every eligible route. */
  typedScope?: "standard" | "all";
  source?: string;
  /** Provider names from /coverage/providers, used to attribute provider-router routes. */
  knownProviders?: string[];
}

/** Providers whose endpoints need an API key configured on the server. */
export const KEYED_PROVIDERS = new Set(["fred", "bls", "eia", "cftc", "congress_gov"]);

/** Routers shipped as openbb_platform/extensions (the standard, provider-agnostic surface). */
export const STANDARD_CATEGORIES = new Set([
  "commodity",
  "crypto",
  "currency",
  "derivatives",
  "economy",
  "equity",
  "etf",
  "fixedincome",
  "index",
  "news",
  "regulators",
]);

const SKIPPED_CATEGORIES = new Set(["coverage", "system", "user"]);
/** Provider-router categories whose name differs from the provider they serve. */
const CATEGORY_PROVIDERS: Record<string, string> = {
  uscongress: "congress_gov",
  ustreasury: "us_treasury",
};
const SKIPPED_PARAMS = new Set(["chart"]);
const MULTI_HINT = /Multiple comma separated items allowed/i;
const PROVIDER_HINT = /\(provider: ([^)]+)\)\s*$/;

function refName(ref: string): string {
  return ref.split("/").pop() ?? ref;
}

function resolve(doc: OpenApiDoc, schema: JsonSchema | undefined): JsonSchema | undefined {
  if (schema?.$ref) return doc.components?.schemas?.[refName(schema.$ref)];
  return schema;
}

/** Non-null alternatives of a schema (unwraps anyOf: [X, null]). */
function variants(schema: JsonSchema | undefined): JsonSchema[] {
  if (!schema) return [];
  if (schema.anyOf) return schema.anyOf.filter((s) => s.type !== "null");
  return [schema];
}

function fieldType(schema: JsonSchema | undefined): string {
  const options = variants(schema);
  if (options.length === 0) return "any";
  const first = options[0];
  if (first.$ref) return "object";
  if (first.format === "date") return "date";
  if (first.format === "date-time") return "datetime";
  const type = Array.isArray(first.type) ? first.type[0] : first.type;
  return type ?? (first.properties ? "object" : "any");
}

function paramType(schema: JsonSchema | undefined): ParamType {
  const type = fieldType(schema);
  switch (type) {
    case "number":
    case "integer":
    case "boolean":
    case "string":
    case "date":
      return type;
    case "datetime":
      return "date";
    default:
      return "any";
  }
}

function firstSentence(text: string | undefined, max = 250): string {
  const clean = (text ?? "").split("\n\n")[0].replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function normalize(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function fieldsOf(
  doc: OpenApiDoc,
  schema: JsonSchema | undefined,
): { fields: FieldSpec[]; open: boolean; isArray: boolean } {
  let resolved = resolve(doc, schema);
  // Some Data models serialize to a list of records (e.g. options chains).
  const isArray = resolved?.type === "array" && resolved.items !== undefined;
  if (isArray) resolved = resolve(doc, resolved?.items);
  const properties = resolved?.properties ?? {};
  const fields = Object.entries(properties).map(([name, prop]) => ({
    name,
    type: fieldType(prop),
    description: typeof prop.description === "string" ? prop.description : undefined,
  }));
  return { fields, open: resolved?.additionalProperties === true, isArray };
}

function providerForSchema(name: string, providers: string[]): string {
  const key = normalize(name);
  // Longest match first so "federal_reserve" wins over a shorter prefix.
  const match = [...providers]
    .sort((a, b) => b.length - a.length)
    .find((provider) => key.startsWith(normalize(provider)));
  return match ?? "*";
}

function responseInfo(
  doc: OpenApiDoc,
  op: OpenApiOperation,
  providers: string[],
): { info: ResponseInfo; byProvider: Record<string, FieldSpec[]> } {
  const content = op.responses?.["200"]?.content ?? {};
  const byProvider: Record<string, FieldSpec[]> = {};
  const empty = { info: { kind: "none", fields: [], dynamic: false } as ResponseInfo, byProvider };
  if (content["text/html"]) return { ...empty, info: { ...empty.info, kind: "html" } };
  const schema = content["application/json"]?.schema;
  if (!schema) return empty;

  if (schema.$ref && /obbject/i.test(refName(schema.$ref))) {
    const obb = resolve(doc, schema);
    const results = variants(obb?.properties?.results)[0];
    let kind: ResponseInfo["kind"] = "obb-untyped";
    let dataSchemas: JsonSchema[] = [];
    if (results?.type === "array" && results.items) {
      kind = "obb-list";
      dataSchemas = results.items.oneOf ?? [results.items];
    } else if (results?.$ref) {
      kind = "obb-single";
      dataSchemas = [results];
    } else if (results?.oneOf) {
      kind = "obb-single";
      dataSchemas = results.oneOf;
    }
    let anyOpen = false;
    const union = new Map<string, FieldSpec>();
    for (const dataSchema of dataSchemas) {
      if (!dataSchema.$ref) continue;
      const { fields, open, isArray } = fieldsOf(doc, dataSchema);
      anyOpen = anyOpen || open;
      if (isArray) kind = "obb-list";
      byProvider[providerForSchema(refName(dataSchema.$ref), providers)] = fields;
      for (const field of fields) if (!union.has(field.name)) union.set(field.name, field);
    }
    const fields = [...union.values()];
    const declared = fields.filter((field) => !["date", "symbol"].includes(field.name));
    if (kind !== "obb-untyped" && dataSchemas.every((s) => !s.$ref)) kind = "obb-untyped";
    return { info: { kind, fields, dynamic: anyOpen && declared.length <= 1 }, byProvider };
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "array") return { ...empty, info: { ...empty.info, kind: "json-array" } };
  if (type === "object" || schema.$ref) return { ...empty, info: { ...empty.info, kind: "json-object" } };
  if (type === "number" || type === "integer" || type === "string" || type === "boolean") {
    return { ...empty, info: { ...empty.info, kind: "json-scalar" } };
  }
  return { ...empty, info: { ...empty.info, kind: "json-untyped" } };
}

function buildParam(param: OpenApiParameter): ParamSpec {
  const schema = param.schema ?? {};
  const description = param.description ?? (typeof schema.description === "string" ? schema.description : "");
  const options = variants(schema);
  const choices = schema.enum ?? options.find((option) => option.enum)?.enum;
  const providerMatch = description.match(PROVIDER_HINT);
  const perProviderMulti = Object.values(schema).some(
    (value) => typeof value === "object" && value !== null && (value as JsonSchema).multiple_items_allowed === true,
  );
  return {
    name: param.name,
    description: firstSentence(description.replace(PROVIDER_HINT, "")),
    required: param.required === true,
    type: paramType(schema),
    multiple: perProviderMulti || MULTI_HINT.test(description),
    ...(choices ? { choices } : {}),
    ...(schema.default !== undefined && schema.default !== null ? { default: schema.default } : {}),
    ...(providerMatch ? { providers: providerMatch[1].split(",").map((p) => p.trim()) } : {}),
  };
}

/** Build the normalized catalog from a running server's /openapi.json. */
export function buildCatalog(doc: OpenApiDoc, options: BuildOptions = {}): Catalog {
  const apiPrefix = options.apiPrefix ?? "/api/v1";
  const typedScope = options.typedScope ?? "standard";
  const entries: CatalogEntry[] = [];

  for (const [path, operations] of Object.entries(doc.paths)) {
    if (!path.startsWith(`${apiPrefix}/`)) continue;
    const route = path.slice(apiPrefix.length + 1);
    const category = route.split("/")[0];
    if (SKIPPED_CATEGORIES.has(category)) continue;

    for (const [verb, op] of Object.entries(operations)) {
      const method = verb.toUpperCase();
      if (method !== "GET" && method !== "POST") continue;

      const parameters = (op.parameters ?? []).filter((p) => p.in === "query");
      const providerParam = parameters.find((p) => p.name === "provider");
      const providerSchema = providerParam?.schema;
      const declared = (
        providerSchema?.enum ??
        variants(providerSchema)[0]?.enum ??
        (typeof providerSchema?.const === "string" ? [providerSchema.const] : [])
      ).map(String);
      // Provider routers (e.g. /eia/..., /bls/...) often omit the provider parameter.
      const providers = declared.length ? declared : [CATEGORY_PROVIDERS[category] ?? category].filter(
        (provider) => options.knownProviders?.includes(provider) ?? KEYED_PROVIDERS.has(provider),
      );
      const params = parameters
        .filter((p) => p.name !== "provider" && !SKIPPED_PARAMS.has(p.name))
        .map(buildParam);

      const { info, byProvider } = responseInfo(doc, op, providers);
      const shape = classifyShape(route, method, op.requestBody !== undefined, info);
      const landing = landingForShape(shape);
      const typedEligible =
        method === "GET" && (landing === "spill" || landing === "single-cell");

      entries.push({
        route,
        path,
        method,
        functionId: functionIdForRoute(route),
        category,
        summary: firstSentence(op.summary, 120),
        description: firstSentence(op.description || op.summary),
        providers,
        params,
        fields: byProvider,
        shape,
        landing,
        needsKey: providers.filter((provider) => KEYED_PROVIDERS.has(provider)),
        typed: typedEligible && (typedScope === "all" || STANDARD_CATEGORIES.has(category)),
      });
    }
  }

  entries.sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method));
  return { version: 1, source: options.source ?? "openapi.json", apiPrefix, entries: dedupeIds(entries) };
}
