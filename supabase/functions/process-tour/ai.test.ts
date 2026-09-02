import { describe, expect, it } from "vitest";
import { parseDeepseekJson } from "./ai.ts";

describe("parseDeepseekJson", () => {
  it("解析普通 JSON", () => {
    expect(parseDeepseekJson('{"locations":[]}')).toEqual({ locations: [] });
  });

  it("解析模型包裹的 markdown JSON", () => {
    expect(parseDeepseekJson('```json\n{"subtitle":"山行"}\n```')).toEqual({ subtitle: "山行" });
  });

  it("非法 JSON 抛出错误交给重试层处理", () => {
    expect(() => parseDeepseekJson("not-json")).toThrow();
  });
});
