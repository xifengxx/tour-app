import { describe, expect, it } from "vitest";
import { buildResearchPrompt, normalizeResearchResult } from "./research.ts";

describe("route research", () => {
  const raw = {
    destination_name: "北岳恒山",
    aliases: ["恒山"],
    zones: [{ name: "恒山主景区" }],
    trails: [
      {
        aliases: ["恒山"],
        scenicName: "恒山",
        stops: [{ name: "游客中心" }, "真武庙", { name: "虎风口" }, { name: "天峰岭" }],
        evidence: ["游客中心→真武庙→虎风口→天峰岭"],
      },
    ],
    edges: [{ from: "天峰岭", to: "悬空寺", mode: "shuttle" }],
  };

  it("归一化研究结果并限制置信度低于人工策展层", () => {
    const result = normalizeResearchResult("北岳恒山", raw, 3);
    expect(result).not.toBeNull();
    expect(result!.aliases).toContain("北岳恒山");
    expect(result!.trails[0].id).toBe("auto-北岳恒山-1");
    expect(result!.trails[0].stops.map(s => s.name)).toEqual(["游客中心", "真武庙", "虎风口", "天峰岭"]);
    expect(result!.edges[0].mode).toBe("shuttle");
    expect(result!.confidence).toBeLessThanOrEqual(0.8);
  });

  it("拒绝没有有效步道的低质量结果", () => {
    expect(normalizeResearchResult("未知山", { trails: [{ stops: ["入口", "山顶"] }] }, 1)).toBeNull();
  });

  it("根据备注纠偏索道/景区交通模式", () => {
    const result = normalizeResearchResult("北岳恒山", {
      trails: [{ stops: ["下站", "上站", "庙群", "主峰"] }],
      edges: [
        { from: "下站", to: "上站", mode: "walk", note: "乘坐恒山索道" },
        { from: "主峰", to: "停车场", mode: "walk", note: "乘坐景区交通" },
      ],
    }, 1);
    expect(result?.edges[0].mode).toBe("cableway");
    expect(result?.edges[1].mode).toBe("shuttle");
  });

  it("从外部 POI 证据中恢复步道坐标，并允许补全关键路线点", () => {
    const result = normalizeResearchResult("武功山", {
      trails: [{
        aliases: ["武功山"],
        stops: [{ name: "游客服务中心" }, { name: "石鼓寺" }, { name: "中庵索道" }, { name: "金顶" }],
        evidence: [
          "1. 武功山国家级风景名胜区游客服务中心 @27.48902,114.12944\n2. 石鼓寺 @27.46686,114.15508",
          "中庵索道 @27.46568,114.15618",
        ],
      }],
    }, 2);
    expect(result?.trails[0].stops[0]).toMatchObject({ lat: 27.48902, lng: 114.12944, required: true });
    expect(result?.trails[0].stops[1]).toMatchObject({ lat: 27.46686, lng: 114.15508, required: true });
    expect(result?.trails[0].stops[2]).toMatchObject({ lat: 27.46568, lng: 114.15618, required: true });
    expect(result?.trails[0].stops[3].required).toBe(false);
  });

  it("提示词要求引用证据并限制最高置信度", () => {
    const prompt = buildResearchPrompt("北岳恒山", "山西省大同市", { lng: 113.73, lat: 39.67 }, [
      { provider: "wikipedia", title: "恒山", text: "恒山主峰天峰岭。", url: "https://example.com" },
    ]);
    expect(prompt[0].content).toContain("不要虚构景点");
    expect(prompt[1].content).toContain("confidence 最高 0.80");
    expect(prompt[1].content).toContain("【来源1·wikipedia】");
  });
});
