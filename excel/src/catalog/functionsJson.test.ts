import { recordedCatalog, recordedOpenApi } from "../../tests/helpers";
import { buildCatalog, type OpenApiDoc } from "./build";
import { buildFunctionsJson, QUERY_FUNCTION_ID, signatureFor } from "./functionsJson";
import { functionIdForRoute } from "./naming";

describe("function naming", () => {
  it("uppercases path segments joined by dots", () => {
    expect(functionIdForRoute("equity/price/historical")).toBe("EQUITY.PRICE.HISTORICAL");
    expect(functionIdForRoute("federal_reserve/dallas/retail")).toBe("FEDERAL_RESERVE.DALLAS.RETAIL");
    expect(functionIdForRoute("tmx/derivatives/options/{id}/view")).toBe("TMX.DERIVATIVES.OPTIONS.VIEW");
  });
});

describe("functions.json from the recorded server", () => {
  const functions = buildFunctionsJson(recordedCatalog()).functions;

  it("always includes the generic OBB.QUERY", () => {
    const query = functions.find((f) => f.id === QUERY_FUNCTION_ID);
    expect(query?.parameters.map((p) => p.name)).toEqual(["route", "params", "provider"]);
  });

  it("generates unique, Excel-valid ids", () => {
    const ids = functions.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z][A-Z0-9_.]*$/);
  });

  it("puts required standard params first, then provider and params", () => {
    const fn = functions.find((f) => f.id === "EQUITY.PRICE.HISTORICAL");
    expect(fn?.parameters.map((p) => p.name)).toEqual(["symbol", "start_date", "end_date", "provider", "params"]);
    expect(fn?.parameters[0].optional).toBe(false);
    expect(fn?.options.cancelable).toBe(true);
  });

  it("only types GET routes that land in cells", () => {
    for (const entry of recordedCatalog().entries.filter((e) => e.typed)) {
      expect(entry.method).toBe("GET");
      expect(["spill", "single-cell"]).toContain(entry.landing);
    }
  });

  it("keeps provider-specific params out of the positional arguments", () => {
    const historical = recordedCatalog().entries.find((e) => e.route === "equity/price/historical")!;
    expect(signatureFor(historical).positional.map((p) => p.name)).not.toContain("interval");
  });
});

describe("new providers need no add-in code change", () => {
  it("picks up a route and provider added to the server's openapi.json", () => {
    const doc = structuredClone(recordedOpenApi()) as OpenApiDoc;
    doc.paths["/api/v1/equity/price/tick"] = {
      get: {
        summary: "Tick data",
        description: "Tick-level trades.",
        parameters: [
          { name: "provider", in: "query", required: true, schema: { enum: ["newprovider"], type: "string" } },
          { name: "symbol", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/OBBject_EquityHistorical" } } },
          },
        },
      },
    };
    const catalog = buildCatalog(doc);
    const added = catalog.entries.find((e) => e.route === "equity/price/tick");
    expect(added).toMatchObject({ functionId: "EQUITY.PRICE.TICK", providers: ["newprovider"], typed: true });
    expect(buildFunctionsJson(catalog).functions.map((f) => f.id)).toContain("EQUITY.PRICE.TICK");
  });
});
