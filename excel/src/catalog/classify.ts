import type { FieldSpec, Landing, Shape } from "./types";

/** What the OpenAPI schema says about a route's 200 response. */
export interface ResponseInfo {
  kind:
    | "obb-list" // OBBject whose results are a list of Data models
    | "obb-single" // OBBject whose results are one Data model
    | "obb-untyped" // OBBject with results: Any
    | "json-array"
    | "json-object"
    | "json-scalar"
    | "json-untyped"
    | "html"
    | "none";
  /** Union of declared result fields across providers. */
  fields: FieldSpec[];
  /** True when the Data models declare almost nothing and allow extra fields. */
  dynamic: boolean;
}

const CHART_SEGMENTS = new Set(["smile", "surface", "term_structure", "payoff", "stats"]);
const DOCUMENT_FIELDS = new Set(["content", "markdown", "html"]);
const INDEX_FIELDS = new Set(["date", "symbol", "period", "timestamp"]);

function isFileSegment(segment: string): boolean {
  return (
    segment === "view" ||
    segment.endsWith("_view") ||
    segment.endsWith("_viewer") ||
    segment.endsWith("_download")
  );
}

export function landingForShape(shape: Shape): Landing {
  switch (shape) {
    case "table":
    case "table-dynamic":
    case "record":
    case "columnar":
    case "nested":
      return "spill";
    case "document":
    case "scalar":
      return "single-cell";
    case "file":
      return "file";
    case "chart":
      return "chart";
    case "range-input":
      return "range-input";
    case "helper":
      return "none";
  }
}

/** Classify a route by how its result can land in a worksheet. */
export function classifyShape(
  route: string,
  method: "GET" | "POST",
  hasBody: boolean,
  info: ResponseInfo,
): Shape {
  const last = route.split("/").filter(Boolean).pop() ?? "";
  const isObb = info.kind.startsWith("obb");

  if (hasBody) return isObb && method === "POST" ? "range-input" : "file";
  if (info.kind === "html") return "document";
  if (last.endsWith("choices")) return "helper";
  if (isFileSegment(last)) return "file";
  if (CHART_SEGMENTS.has(last) && info.kind === "json-untyped") return "chart";

  switch (info.kind) {
    case "json-scalar":
      return "scalar";
    case "json-object":
      return "record";
    case "json-array":
    case "json-untyped":
    case "obb-untyped":
      return "table-dynamic";
    case "none":
      return "table-dynamic";
    default:
      break;
  }

  const names = info.fields.map((field) => field.name);
  if (names.includes("content") && names.includes("filename")) return "file";
  if (names.some((name) => DOCUMENT_FIELDS.has(name)) && names.length <= 8) return "document";
  if (names.includes("summary") && names.length <= 2) return "document";

  const valueFields = info.fields.filter((field) => !INDEX_FIELDS.has(field.name));
  if (valueFields.length >= 2 && valueFields.every((field) => field.type === "array")) {
    return "columnar";
  }
  if (info.dynamic) return "table-dynamic";
  if (info.fields.some((field) => field.type === "object" || field.type === "array")) {
    return "nested";
  }
  return info.kind === "obb-single" ? "record" : "table";
}
