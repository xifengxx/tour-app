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

describe("路线知识选路（v91 分级 + 完整度）", () => {
  const richResearch = {
    destination_name: "示例山",
    aliases: ["示例山"],
    model: {
      zones: [{ id: "z1", name: "北峰" }],
      trails: [{
        id: "t1", aliases: ["示例山"], scenicName: "示例山",
        notes: "索道上山",
        stops: [
          { name: "游客中心", lat: 27.1, lng: 100.2, required: true, evidenceBound: true },
          { name: "索道站", lat: 27.12, lng: 100.21, required: true, evidenceBound: true },
          { name: "北峰顶", lat: 27.13, lng: 100.22, required: true, evidenceBound: true },
        ],
      }],
      edges: [
        { from: "游客中心", to: "索道站", mode: "cableway" },
        { from: "索道站", to: "北峰顶", mode: "walk" },
      ],
    },
    source: "auto-research",
    confidence: 0.8,
  };
  const thinCurated = {
    destination_name: "示例山",
    aliases: ["示例山"],
    model: {
      zones: [],
      trails: [{ id: "t0", aliases: ["示例山"], stops: [{ name: "入口" }, { name: "山顶" }] }],
      edges: [],
    },
    source: "creator-confirmed",
    confidence: 0.85,
  };

  it("来源权威优先于完整度：机器抽取的漂亮数据不能压过人工确认", () => {
    const knowledge = selectRouteKnowledge([richResearch, thinCurated], "示例山");
    expect(knowledge.source).toBe("creator-confirmed");
    // tier 判定为 L3，但这份知识太薄：交通断言不会开放
    expect(knowledge.quality).toBeDefined();
    expect(knowledge.quality!.transportCoverage).toBe(0);
  });

  it("同一分级内按可解释完整度排序，而不是历史 confidence 字段", () => {
    // 两条都是 auto-research。旧行 confidence 0.8（按证据条数算的虚高值），
    // 新行 confidence 0.3 但坐标与交通边齐全 → 应选新行。
    const richCopy = {
      ...richResearch,
      confidence: 0.2,
      model: {
        ...richResearch.model,
        trails: [{
          id: "t1", aliases: ["示例山"], scenicName: "示例山", notes: "索道上山",
          stops: richResearch.model.trails[0].stops.map((s: any) => ({ ...s })),
        }],
      },
    };
    const stale = {
      ...richResearch,
      confidence: 0.8,
      model: {
        zones: [] as unknown[],
        trails: [{ id: "t9", aliases: ["示例山"], stops: [{ name: "只有一处" }, { name: "再一处" }] }],
        edges: [],
      },
    };
    const knowledge = selectRouteKnowledge([stale, richCopy], "示例山");
    expect(knowledge.trails[0].id).toBe("t1");
    expect(knowledge.quality!.parts.coordCoverage).toBe(1);
    expect(knowledge.quality!.transportCoverage).toBeGreaterThanOrEqual(0.6);
  });
});
