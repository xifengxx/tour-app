import { describe, expect, it } from "vitest";
import { qualityGaps, scoreKnowledge, transportCoverage } from "./knowledge-quality.ts";
import type { DestinationRouteKnowledge } from "./route-knowledge-types.ts";

// 数值取自 scripts/research-knowledge.ts 对玉龙雪山的真实产出
const realResearch: DestinationRouteKnowledge = {
  destinationName: "玉龙雪山",
  aliases: ["玉龙雪山"],
  zones: [{ id: "zone_glacier_park", name: "冰川公园" }, { id: "zone_blue_moon_valley", name: "蓝月谷" }],
  trails: [
    {
      id: "trail_glacier_park", zoneId: "zone_glacier_park", scenicName: "冰川公园", aliases: ["玉龙雪山"],
      notes: "从游客中心乘景区接驳车至索道候车厅，再乘大索道上冰川公园。",
      stops: [
        { name: "玉龙雪山国家级风景名胜区游客服务中心", lat: 27.09752, lng: 100.25875, required: true, evidenceBound: true },
        { name: "索道候车厅", lat: 27.12717, lng: 100.23471, required: true, evidenceBound: true },
        { name: "玉龙雪山国家级风景名胜区冰川公园", lat: 27.13, lng: 100.23, required: true, evidenceBound: true },
      ],
    },
    {
      id: "trail_blue_moon_valley", zoneId: "zone_blue_moon_valley", scenicName: "蓝月谷", aliases: ["玉龙雪山"],
      stops: [
        { name: "蓝月谷导览驿站", lat: 27.12624, lng: 100.24754, required: true, evidenceBound: true },
        { name: "蓝月谷二级坝旅游厕所", lat: 27.12561, lng: 100.24812, required: true, evidenceBound: true },
        { name: "蓝月谷游览车-候车厅", lat: 27.1259, lng: 100.2479, required: true },
      ],
    },
  ],
  edges: [
    { from: "玉龙雪山国家级风景名胜区游客服务中心", to: "索道候车厅", mode: "cableway", source: "research" },
    { from: "索道候车厅", to: "玉龙雪山国家级风景名胜区冰川公园", mode: "cableway", source: "research" },
  ],
  source: "auto-research",
  confidence: 0.75,
};

const curatedNoEdges: DestinationRouteKnowledge = {
  destinationName: "泰山", aliases: ["泰山"], zones: [],
  trails: [{ id: "t", aliases: ["泰山"], stops: [{ name: "红门宫" }, { name: "中天门" }, { name: "南天门" }, { name: "玉皇顶" }] }],
  edges: [], source: "curated", confidence: 0.9,
};

describe("scoreKnowledge", () => {
  it("逐项打分，不再用证据条数冒充可信度", () => {
    const q = scoreKnowledge(realResearch);
    expect(q.parts).toEqual({
      sourceTrust: 0.55,
      coordCoverage: 1,          // 6 个站点全部有坐标
      evidenceCoverage: 0.83,     // 5/6：「蓝月谷游览车-候车厅」只有模型给的坐标
      sitePurity: 0.83,         // 只有厕所算噪声；索道候车厅/游览车候车厅/游客中心是登乘点
      structureCompleteness: 1,
    });
    expect(q.transportCoverage).toBeCloseTo(0.5, 5); // 4 个相邻站点对里 2 条有显式索道边
    expect(q.grade).toBe("usable");
    expect(q.stops).toBe(6);
  });

  it("登乘点不算噪声，厕所才算", () => {
    expect(scoreKnowledge(realResearch).parts.sitePurity).toBeLessThan(1);
    const clean: DestinationRouteKnowledge = {
      ...realResearch,
      trails: realResearch.trails.map(t => ({ ...t, stops: t.stops.filter(s => !/厕所/.test(s.name)) })),
    };
    expect(scoreKnowledge(clean).parts.sitePurity).toBe(1);
  });

  it("人工策展但缺坐标与交通边，权威度仍高", () => {
    const q = scoreKnowledge(curatedNoEdges);
    expect(q.parts.sourceTrust).toBe(1);
    expect(q.parts.coordCoverage).toBe(0);
    expect(q.transportCoverage).toBe(0);
    expect(q.grade).toBe("weak");
    // 权威度与完整度是两个问题：这里不完整，但来源仍是 L3（由 knowledge-tier 判定）
  });

  it("没有 trail 时不炸，且分数落到 unusable", () => {
    const q = scoreKnowledge({ destinationName: "空", aliases: [], zones: [], trails: [], edges: [], source: "none", confidence: 0 });
    expect(q.stops).toBe(0);
    expect(q.grade).toBe("unusable");
    expect(q.parts.coordCoverage).toBe(0);
    expect(q.parts.sitePurity).toBe(0);
  });

  it("trail 默认生成的 walk 边不算交通覆盖", () => {
    // buildRouteGraph 会给相邻站补 source:"trail:*" 的默认边，那是"资料没说方式"，
    // 不是"资料主张步行"，不能算作已记录交通关系。
    expect(transportCoverage(curatedNoEdges)).toBe(0);
  });
});

describe("qualityGaps", () => {
  it("把低分项翻译成人能看懂的缺口", () => {
    const gaps = qualityGaps(scoreKnowledge(realResearch));
    expect(gaps).toEqual([
      expect.stringContaining("非游览设施点"),
      expect.stringContaining("显式交通边"),
    ]);
    // 坐标与证据可追溯率都达标时不报，避免把"够用"误报成"有问题"
    expect(gaps.some(g => g.includes("坐标"))).toBe(false);
    expect(gaps.some(g => g.includes("外部证据"))).toBe(false);
  });

  it("人工确认、交通边齐全且无设施噪声时不报缺口", () => {
    const complete: DestinationRouteKnowledge = {
      destinationName: "玉龙雪山", aliases: ["玉龙雪山"],
      zones: [{ id: "z1", name: "冰川公园" }],
      trails: [{
        id: "t1", aliases: ["玉龙雪山"], zoneId: "z1", scenicName: "冰川公园", notes: "游客中心乘索道上冰川公园",
        stops: [
          { name: "玉龙雪山国家级风景名胜区游客服务中心", lat: 27.09, lng: 100.25, required: true, evidenceBound: true },
          { name: "索道候车厅", lat: 27.12, lng: 100.23, required: true, evidenceBound: true },
          { name: "玉龙雪山国家级风景名胜区冰川公园", lat: 27.13, lng: 100.23, required: true, evidenceBound: true },
        ],
      }],
      edges: [
        { from: "玉龙雪山国家级风景名胜区游客服务中心", to: "索道候车厅", mode: "cableway", source: "manual" },
        { from: "索道候车厅", to: "玉龙雪山国家级风景名胜区冰川公园", mode: "cableway", source: "manual" },
      ],
      source: "creator-confirmed", confidence: 0.85,
    };
    const quality = scoreKnowledge(complete);
    expect(quality.transportCoverage).toBe(1);
    expect(quality.parts.sitePurity).toBe(1);
    expect(quality.grade).toBe("strong");
    expect(qualityGaps(quality)).toEqual([]);
  });

  it("证据可追溯率过低时单独报出来（数证据条数的旧算法看不见的维度）", () => {
    const weak = JSON.parse(JSON.stringify(realResearch));
    weak.trails[0].stops.forEach((s: any) => delete s.evidenceBound);
    const gaps = qualityGaps(scoreKnowledge(weak));
    expect(gaps.some(g => g.includes("外部证据"))).toBe(true);
  });
});
