/** How an endpoint's response is shaped, as far as the OpenAPI schema tells us. */
export type Shape =
  | "table" // list of records with declared fields
  | "table-dynamic" // list of records whose columns are only known at runtime
  | "record" // a single object
  | "columnar" // one object whose fields are parallel lists (e.g. options chains)
  | "nested" // records with object or list fields
  | "document" // text, markdown or HTML content
  | "file" // binary/base64 downloads or document viewers
  | "chart" // chart-only routes (Plotly JSON)
  | "scalar" // a single number or string
  | "range-input" // POST analytics that take a data range as input
  | "helper"; // option lists used by parameter pickers, not data

/** Where the result lands in Excel. */
export type Landing = "spill" | "single-cell" | "chart" | "file" | "range-input" | "none";

export type ParamType = "string" | "number" | "integer" | "boolean" | "date" | "any";

export interface ParamSpec {
  name: string;
  description: string;
  required: boolean;
  type: ParamType;
  /** Accepts a comma separated list for at least one provider. */
  multiple: boolean;
  choices?: (string | number)[];
  default?: unknown;
  /** Providers this parameter applies to; undefined means every provider. */
  providers?: string[];
}

export interface FieldSpec {
  name: string;
  type: string;
  description?: string;
}

export interface CatalogEntry {
  /** Route without the API prefix, e.g. "equity/price/historical". */
  route: string;
  /** Full request path, e.g. "/api/v1/equity/price/historical". */
  path: string;
  method: "GET" | "POST";
  /** Excel function id inside the OBB namespace, e.g. "EQUITY.PRICE.HISTORICAL". */
  functionId: string;
  /** First path segment, e.g. "equity" or "federal_reserve". */
  category: string;
  summary: string;
  description: string;
  providers: string[];
  params: ParamSpec[];
  /** Declared result fields per provider ("*" when the schema is not provider specific). */
  fields: Record<string, FieldSpec[]>;
  shape: Shape;
  landing: Landing;
  /** Providers of this route that need an API key configured on the server. */
  needsKey: string[];
  /** Whether a typed =OBB.<functionId>() function is generated for it. */
  typed: boolean;
}

export interface Catalog {
  version: 1;
  source: string;
  apiPrefix: string;
  entries: CatalogEntry[];
}
