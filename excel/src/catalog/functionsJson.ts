import type { Catalog, CatalogEntry, ParamSpec } from "./types";

/** Positional standard parameters per typed function, before `provider` and `params`. */
export const MAX_POSITIONAL = 6;

export interface FunctionSignature {
  functionId: string;
  route: string;
  method: "GET" | "POST";
  /** API parameter names bound to the positional arguments, in order. */
  positional: ParamSpec[];
}

/** Excel custom-function metadata (functions.json), as documented for Office add-ins. */
export interface FunctionsJson {
  functions: {
    id: string;
    name: string;
    description: string;
    result: { type: "any"; dimensionality: "matrix" };
    parameters: {
      name: string;
      description: string;
      type: "any" | "string" | "number" | "boolean";
      dimensionality: "scalar" | "matrix";
      optional: boolean;
    }[];
    options: { cancelable: boolean };
  }[];
}

const PARAMS_HELP =
  'Extra parameters as "name=value; name=value" or a 2-column range. Prefix with _ for output options: _columns, _sort, _limit, _headers, _orient, _dates.';

/** Standard (provider-agnostic) parameters become positional arguments: required first. */
export function signatureFor(entry: CatalogEntry): FunctionSignature {
  const standard = entry.params.filter((param) => param.providers === undefined);
  const ordered = [...standard.filter((p) => p.required), ...standard.filter((p) => !p.required)];
  return {
    functionId: entry.functionId,
    route: entry.route,
    method: entry.method,
    positional: ordered.slice(0, MAX_POSITIONAL),
  };
}

function describeParam(param: ParamSpec): string {
  const parts = [param.description || param.name];
  if (param.choices?.length) parts.push(`One of: ${param.choices.slice(0, 12).join(", ")}.`);
  if (param.type === "date") parts.push("Date or YYYY-MM-DD.");
  if (param.multiple && !/comma separated/i.test(param.description)) parts.push("Comma separated list allowed.");
  return parts.join(" ").slice(0, 250);
}

/** Office caps descriptions; keep them short and single-line. */
function short(text: string, max = 250): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export const QUERY_FUNCTION_ID = "QUERY";

export function buildFunctionsJson(catalog: Catalog): FunctionsJson {
  const functions: FunctionsJson["functions"] = catalog.entries
    .filter((entry) => entry.typed)
    .map((entry) => {
      const signature = signatureFor(entry);
      const providers = entry.providers.length ? ` Providers: ${entry.providers.join(", ")}.` : "";
      return {
        id: entry.functionId,
        name: entry.functionId,
        description: short(`${entry.description || entry.summary}${providers}`),
        result: { type: "any", dimensionality: "matrix" },
        parameters: [
          ...signature.positional.map((param) => ({
            name: param.name,
            description: describeParam(param),
            type: "any" as const,
            dimensionality: "scalar" as const,
            optional: !param.required,
          })),
          {
            name: "provider",
            description: short(
              entry.providers.length
                ? `Data provider: ${entry.providers.join(", ")}. Defaults to the first.`
                : "Data provider.",
            ),
            type: "string",
            dimensionality: "scalar",
            optional: true,
          },
          { name: "params", description: PARAMS_HELP, type: "any", dimensionality: "matrix", optional: true },
        ],
        options: { cancelable: true },
      };
    });

  functions.push({
    id: QUERY_FUNCTION_ID,
    name: QUERY_FUNCTION_ID,
    description:
      "Query any openbb-api endpoint, e.g. =OBB.QUERY(\"equity/price/historical\", \"symbol=AAPL\", \"cboe\").",
    result: { type: "any", dimensionality: "matrix" },
    parameters: [
      {
        name: "route",
        description: 'Endpoint path without /api/v1, e.g. "index/price/historical".',
        type: "string",
        dimensionality: "scalar",
        optional: false,
      },
      { name: "params", description: PARAMS_HELP, type: "any", dimensionality: "matrix", optional: true },
      { name: "provider", description: "Data provider.", type: "string", dimensionality: "scalar", optional: true },
    ],
    options: { cancelable: true },
  });

  return { functions };
}

/** What the runtime needs at load time: one signature per typed function. */
export function buildSignatures(catalog: Catalog): FunctionSignature[] {
  return catalog.entries.filter((entry) => entry.typed).map(signatureFor);
}
