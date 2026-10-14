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

  it("相似但语义不同的外部 POI 不能冒充路线点坐标", () => {
    const result = normalizeResearchResult("武功山", {
      trails: [{
        aliases: ["武功山"],
        stops: [{ name: "金顶" }, { name: "武功山金顶" }],
        evidence: ["1. 武功山金顶帐篷 @27.47809,114.13560"],
      }],
    }, 1);
    expect(result?.trails[0].stops[0].lat).toBeUndefined();
    expect(result?.trails[0].stops[0].lng).toBeUndefined();
    expect(result?.trails[0].stops[1].lat).toBeUndefined();
    expect(result?.trails[0].stops[1].lng).toBeUndefined();
  });

  it("坐标可追溯性单独标记，自评置信度不再向模型索取", () => {
    const result = normalizeResearchResult("武功山", {
      trails: [{
        aliases: ["武功山"],
        // 至少 3 站才会被接受（少于 3 站直接判为无效结果）
        stops: [{ name: "金顶" }, { name: "吊马桩", lat: 27.4, lng: 114.2 }, { name: "发云界" }],
        evidence: ["金顶 @27.47809,114.13560"],
      }],
    }, 1);
    // 来自外部 POI 证据 → 可追溯；模型自己填的数字不算证据
    expect(result?.trails[0].stops[0]).toMatchObject({ evidenceBound: true });
    expect(result?.trails[0].stops[1]).toMatchObject({ evidenceBound: false });
    // 可信度由证据事实计算：这份只有一半坐标可追溯、无显式交通边的结果不可能拿高分
    // 逐项：来源 0.55、坐标 2/3、可追溯 1/3、无设施噪声 1、结构 0.5
    // → 0.55*0.35 + 0.67*0.2 + 0.33*0.15 + 1*0.15 + 0.5*0.15 ≈ 0.60
    // 旧公式只看 evidenceCount=1 会给 0.6+0.05 = 0.65，与内容质量无关
    expect(result!.confidence).toBeCloseTo(0.6, 2);
  });

  it("提示词要求引用证据，并明确不采信模型自评置信度", () => {
    const prompt = buildResearchPrompt("北岳恒山", "山西省大同市", { lng: 113.73, lat: 39.67 }, [
      { provider: "wikipedia", title: "恒山", text: "恒山主峰天峰岭。", url: "https://example.com" },
    ]);
    expect(prompt[0].content).toContain("不要虚构景点");
    expect(prompt[1].content).toContain("模型自评不作数");
    expect(prompt[1].content).toContain("每个 zone 都要给出一条对应 trail");
    expect(prompt[1].content).not.toContain("\"confidence\"");
    expect(prompt[1].content).toContain("【来源1·wikipedia】");
  });
});
