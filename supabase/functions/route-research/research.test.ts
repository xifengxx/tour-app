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

  it("提示词要求引用证据并限制最高置信度", () => {
    const prompt = buildResearchPrompt("北岳恒山", "山西省大同市", { lng: 113.73, lat: 39.67 }, [
      { provider: "wikipedia", title: "恒山", text: "恒山主峰天峰岭。", url: "https://example.com" },
    ]);
    expect(prompt[0].content).toContain("不要虚构景点");
    expect(prompt[1].content).toContain("confidence 最高 0.80");
    expect(prompt[1].content).toContain("【来源1·wikipedia】");
  });
});
