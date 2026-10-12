import { entry } from "../../tests/helpers";
import { classifyShape, landingForShape, type ResponseInfo } from "./classify";

const info = (overrides: Partial<ResponseInfo>): ResponseInfo => ({
  kind: "obb-list",
  fields: [],
  dynamic: false,
  ...overrides,
});
const field = (name: string, type = "number") => ({ name, type });

describe("classifyShape", () => {
  it("treats POST analytics with a body as range input", () => {
    expect(classifyShape("technical/sma", "POST", true, info({}))).toBe("range-input");
  });

  it("treats non-OBBject bodies and viewers as files", () => {
    expect(classifyShape("usda/bell_report", "POST", true, info({ kind: "json-untyped" }))).toBe("file");
    expect(classifyShape("tmx/etf/fund_info/view", "GET", false, info({ kind: "json-untyped" }))).toBe("file");
  });

  it("recognises chart, html, helper and scalar routes", () => {
    expect(classifyShape("cboe/options/smile", "GET", false, info({ kind: "json-untyped" }))).toBe("chart");
    expect(classifyShape("eia/rss_feed", "GET", false, info({ kind: "html" }))).toBe("document");
    expect(classifyShape("cboe/equity/symbol_choices", "GET", false, info({ kind: "json-array" }))).toBe("helper");
    expect(classifyShape("deribit/reference/server_time", "GET", false, info({ kind: "json-scalar" }))).toBe("scalar");
  });

  it("separates tables, dynamic tables, nested, columnar and documents", () => {
    const ohlc = [field("date", "date"), field("open"), field("close")];
    expect(classifyShape("a/b", "GET", false, info({ fields: ohlc }))).toBe("table");
    expect(classifyShape("a/b", "GET", false, info({ fields: [field("date", "date")], dynamic: true }))).toBe(
      "table-dynamic",
    );
    expect(classifyShape("a/b", "GET", false, info({ fields: [...ohlc, field("tags", "array")] }))).toBe("nested");
    expect(
      classifyShape("a/b", "GET", false, info({ kind: "obb-single", fields: [field("strike", "array"), field("bid", "array")] })),
    ).toBe("columnar");
    expect(classifyShape("a/b", "GET", false, info({ fields: [field("url", "string"), field("content", "string")] }))).toBe(
      "document",
    );
    expect(classifyShape("a/b", "GET", false, info({ kind: "obb-single", fields: ohlc }))).toBe("record");
  });

  it("maps shapes to landings", () => {
    expect(landingForShape("table-dynamic")).toBe("spill");
    expect(landingForShape("document")).toBe("single-cell");
    expect(landingForShape("helper")).toBe("none");
  });
});

describe("classification of recorded nicogeek routes", () => {
  it.each([
    ["equity/price/historical", "GET", "table"],
    ["index/price/historical", "GET", "table"],
    ["derivatives/options/chains", "GET", "table"],
    ["currency/reference_rates", "GET", "record"],
    ["federal_reserve/dallas/agricultural_survey", "GET", "table-dynamic"],
    ["sec/htm_file", "GET", "document"],
    ["cboe/options/smile", "GET", "chart"],
    ["econometrics/ols_regression_summary", "POST", "range-input"],
    ["cboe/equity/symbol_choices", "GET", "helper"],
  ] as const)("%s %s is %s", (route, method, shape) => {
    expect(entry(route, method).shape).toBe(shape);
  });

  it("flags keyed providers on provider routers without a provider parameter", () => {
    expect(entry("economy/fred_series").needsKey).toContain("fred");
    expect(entry("cftc/cot").needsKey).toContain("cftc");
  });
});
