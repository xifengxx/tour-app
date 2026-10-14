import { describe, expect, it } from "vitest";
import { capabilitiesFor, knowledgeTier, TIER_LABEL, tierCapabilities } from "./knowledge-tier.ts";
import type { DestinationRouteKnowledge } from "./route-knowledge-types.ts";

const base = (over: Partial<DestinationRouteKnowledge> = {}): DestinationRouteKnowledge => ({
  destinationName: "示例山",
  aliases: ["示例山"],
  zones: [],
  trails: [{ id: "t1", aliases: ["示例山"], stops: [{ name: "入口" }, { name: "主峰" }, { name: "下山口" }] }],
  edges: [],
  source: "curated",
  confidence: 0.9,
  ...over,
});

describe("knowledgeTier", () => {
  it("人工策展与创作者确认才是 L3", () => {
    for (const source of ["curated", "official", "manual", "creator-confirmed"]) {
      expect(knowledgeTier(base({ source }))).toBe("L3");
    }
  });

  it("自动研究算未核实，即使置信度看起来很高", () => {
    expect(knowledgeTier(base({ source: "auto-research", confidence: 0.75 }))).toBe("L2");
    // 丽江玉龙雪山线上实况：auto-research 置信度 0.75 却能驱动 2 日线分区装配
    expect(tierCapabilities("L2").multiDay).toBe(false);
  });

  it("内置策展快照按人工撰写计入 L3，但没有 zones/edges 时相应能力仍关闭", () => {
    expect(knowledgeTier(base({ source: "builtin", confidence: 0.5 }))).toBe("L3");
    const builtin = capabilitiesFor(base({ source: "builtin", confidence: 0.5 }));
    expect(builtin.capabilities.multiDay).toBe(true);   // 前山/后山这类划分是人工知识
    expect(builtin.capabilities.zoneDriven).toBe(false); // 没有 zones
    expect(builtin.capabilities.assertTransport).toBe(false); // 完全没有 edges（现网 5 个策展目的地全如此）
  });

  it("没有站点顺序知识就是 L1，未识别来源按未核实处理", () => {
    expect(knowledgeTier(base({ trails: [] }))).toBe("L1");
    expect(knowledgeTier(null)).toBe("L1");
    expect(knowledgeTier(base({ source: "database" }))).toBe("L2");
    expect(knowledgeTier(base({ source: "osm" }))).toBe("L2");
  });

  it("能力授权还要与数据实际形态取与，避免授权了但无数据可用", () => {
    const l3NoZones = capabilitiesFor(base({ source: "curated" }));
    expect(l3NoZones.tier).toBe("L3");
    expect(l3NoZones.capabilities.zoneDriven).toBe(false);   // 没有 zones
    expect(l3NoZones.capabilities.assertTransport).toBe(false); // 没有 edges（现网 5 个策展目的地全如此）
    expect(l3NoZones.capabilities.trailOrder).toBe(true);

    // 交通断言还要 edges 真的连得上相邻站点对：curated 那批 0 edges、
    // auto-research 那份 5 条边只盖住一半站点对，都不该拿到断言权。
    const fullyWired = capabilitiesFor(base({
      source: "creator-confirmed",
      zones: [{ id: "z1", name: "北线" }],
      trails: [{ id: "t", aliases: ["示例山"], stops: [{ name: "入口" }, { name: "中亭" }, { name: "主峰" }] }],
      edges: [
        { from: "入口", to: "中亭", mode: "cableway" },
        { from: "中亭", to: "主峰", mode: "shuttle" },
      ],
    }));
    expect(fullyWired.capabilities).toEqual({
      multiDay: true, themeTour: true, zoneDriven: true, trailOrder: true, assertTransport: true,
    });
    // 只有 1/2 站点对有边：不达阈值
    const halfWired = capabilitiesFor(base({
      source: "creator-confirmed",
      trails: [{ id: "t", aliases: ["示例山"], stops: [{ name: "入口" }, { name: "中亭" }, { name: "主峰" }] }],
      edges: [{ from: "入口", to: "中亭", mode: "cableway" }],
    }));
    expect(halfWired.capabilities.assertTransport).toBe(false);
  });

  it("分层说明可直接展示给创作者", () => {
    expect(TIER_LABEL.L3).toContain("已验证");
    expect(TIER_LABEL.L2).toContain("未经核实");
    expect(TIER_LABEL.L1).toBe("无路线知识");
  });
});
