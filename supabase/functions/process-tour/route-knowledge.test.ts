import { describe, expect, it } from "vitest";
import { researchedToKnowledge, selectRouteKnowledge } from "./route-knowledge.ts";

describe("destination route knowledge", () => {
  const row = {
    destination_name: "嵩山",
    aliases: ["嵩山", "中岳嵩山", "太室山", "少室山"],
    model: {
      zones: [{ id: "taishi", name: "太室山" }],
      trails: [
        {
          id: "songshan-taishi",
          aliases: ["嵩山", "太室山"],
          scenicName: "太室山",
          stops: [{ name: "嵩阳书院" }, { name: "峻极峰" }],
        },
      ],
      edges: [{ from: "嵩阳书院", to: "老母洞", mode: "walk" }],
    },
    source: "official",
    confidence: 0.95,
  };

  it("按目的地或别名选择高置信路线知识", () => {
    const knowledge = selectRouteKnowledge([row], "河南嵩山之旅");
    expect(knowledge.source).toBe("official");
    expect(knowledge.trails[0].scenicName).toBe("太室山");
    expect(knowledge.edges).toHaveLength(1);
  });

  it("数据库未命中或模型无效时回退内置策展数据", () => {
    expect(selectRouteKnowledge([], "未知山").source).toBe("builtin");
    expect(selectRouteKnowledge([{ destination_name: "无效", model: {} }], "未知山").source).toBe("builtin");
  });

  it("自动研究结果进入低置信数据层", () => {
    const knowledge = researchedToKnowledge({
      destination_name: "未知山",
      aliases: ["未知山"],
      zones: [],
      trails: [{ id: "auto-1", aliases: ["未知山"], stops: [{ name: "入口" }, { name: "中亭" }, { name: "主峰" }] }],
      edges: [],
      confidence: 0.75,
    });
    expect(knowledge.source).toBe("auto-research");
    expect(knowledge.confidence).toBeLessThanOrEqual(0.8);
    expect(knowledge.trails[0].stops).toHaveLength(3);
  });

  it("创作者确认知识优先于自动研究，但不覆盖官方/精选知识", () => {
    const creatorConfirmed = {
      destination_name: "武功山",
      aliases: ["武功山", "萍乡武功山"],
      model: {
        zones: [],
        trails: [{ id: "confirmed-main", aliases: ["武功山"], stops: [{ name: "游客中心" }, { name: "金顶" }] }],
        edges: [{ from: "游客中心", to: "中庵", mode: "shuttle" }],
      },
      source: "creator-confirmed",
      confidence: 0.85,
    };
    const autoResearch = {
      ...creatorConfirmed,
      source: "auto-research",
      confidence: 0.78,
      model: { ...creatorConfirmed.model, trails: [{ ...creatorConfirmed.model.trails[0], id: "auto-main" }] },
    };
    expect(selectRouteKnowledge([autoResearch, creatorConfirmed], "武功山").source).toBe("creator-confirmed");

    const curated = {
      ...creatorConfirmed,
      source: "curated",
      confidence: 0.92,
      model: { ...creatorConfirmed.model, trails: [{ ...creatorConfirmed.model.trails[0], id: "curated-main" }] },
    };
    expect(selectRouteKnowledge([creatorConfirmed, curated], "武功山").source).toBe("curated");
  });
});
