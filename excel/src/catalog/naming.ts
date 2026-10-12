/**
 * Excel function ids for routes: path segments uppercased and joined with ".", the same
 * category/subcategory split the MCP server uses for tool names, e.g.
 * "equity/price/historical" -> "EQUITY.PRICE.HISTORICAL".
 */
export function functionIdForRoute(route: string): string {
  const segments = route
    .split("/")
    .filter((segment) => segment && !segment.includes("{"))
    .map((segment) => segment.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase());
  let id = segments.join(".");
  // Excel function names must start with a letter.
  if (!/^[A-Z]/.test(id)) id = `R_${id}`;
  return id;
}

/** Route for a function id, the inverse of functionIdForRoute for ordinary routes. */
export function routeForFunctionId(functionId: string): string {
  return functionId.toLowerCase().split(".").join("/");
}

/** Make every id unique by suffixing later duplicates with the HTTP method or a counter. */
export function dedupeIds<T extends { functionId: string; method: string }>(entries: T[]): T[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const count = seen.get(entry.functionId) ?? 0;
    seen.set(entry.functionId, count + 1);
    if (count === 0) return entry;
    const suffix = count === 1 ? `_${entry.method.toUpperCase()}` : `_${count}`;
    return { ...entry, functionId: `${entry.functionId}${suffix}` };
  });
}
