import { describe, expect, it } from "vitest";
import { buildRouteGraph, buildRouteLegs, estimateRouteDuration, planGraphStops, routeGraphSegments, routeGraphIssues, routeGraphNotes } from "./route-graph.ts";
import type { DestinationRouteKnowledge } from "./route-knowledge-types.ts";
import { CURATED_TRAILS, orderStopsByTrail } from "./trail-routes.ts";

const loc = (id: string, name: string, lng: number, lat: number) => ({ id, name, lng, lat });

const knowledge: DestinationRouteKnowledge = {
  destinationName: "示例山",
  aliases: ["示例山"],
  zones: [
    { id: "north", name: "北线" },
    { id: "south", name: "南线" },
  ],
  trails: [
    { id: "north-trail", zoneId: "north", aliases: ["示例山"], stops: [{ name: "入口" }, { name: "中亭" }, { name: "主峰" }] },
    { id: "south-trail", zoneId: "south", aliases: ["示例山"], stops: [{ name: "南门" }, { name: "石桥" }, { name: "南顶" }] },
  ],
  edges: [{ from: "主峰", to: "南门", mode: "shuttle", duration: "30分钟" }],
  source: "curated",
  confidence: 0.9,
};

const coords = {
  入口: [116.0, 39.0],
  中亭: [116.001, 39.001],
  主峰: [116.002, 39.002],
  南门: [116.2, 38.8],
  石桥: [116.201, 38.801],
  南顶: [116.202, 38.802],
};

const graphLocs = Object.entries(coords).map(([id, [lng, lat]]) => loc(id, id, lng, lat));

describe("route graph", () => {
  it("把 trails 连续关系转换为图边", () => {
    const graph = buildRouteGraph(knowledge);
    expect(graph.edges.get("入口|中亭")?.mode).toBe("walk");
    expect(graph.edges.get("主峰|南门")?.mode).toBe("shuttle");
    expect(graph.edges.get("南门|主峰")?.mode).toBe("shuttle");
  });

  it("显式交通边强制覆盖同向的默认徒步边", () => {
    const overrideKnowledge: DestinationRouteKnowledge = {
      ...knowledge,
      edges: [
        { from: "入口", to: "中亭", mode: "cableway", duration: "8分钟" },
        ...knowledge.edges,
      ],
    };
    const graph = buildRouteGraph(overrideKnowledge);
    expect(graph.edges.get("入口|中亭")).toMatchObject({ mode: "cableway", duration: "8分钟" });
  });

  it("发现同一条步道中的顺序回退", () => {
    const issues = routeGraphIssues(["主峰", "入口", "中亭"], graphLocs, knowledge);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "trail-backtrack" }),
    ]));
  });

  it("发现两个徒步区被交错访问", () => {
    const issues = routeGraphIssues(["入口", "南门", "中亭", "石桥"], graphLocs, knowledge);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "zone-interleaved" }),
    ]));
  });

  it("长距离相邻点缺少非徒步衔接时告警", () => {
    const issues = routeGraphIssues(["中亭", "南门"], graphLocs, knowledge);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "long-transfer" }),
    ]));
  });

  it("整段分区路线没有结构问题", () => {
    expect(routeGraphIssues(["入口", "中亭", "主峰", "南门", "石桥", "南顶"], graphLocs, knowledge)).toEqual([]);
  });

  it("为 AI 描述真实交通衔接，而不是默认徒步", () => {
    const notes = routeGraphNotes(["中亭", "主峰", "南门"], graphLocs, knowledge);
    expect(notes).toContain("中亭 → 主峰：徒步");
    expect(notes).toContain("主峰 → 南门：观光车/摆渡车，30分钟");
  });

  it("路线图规划按徒步区整段串联，段内保持步道顺序", () => {
    const ordered = planGraphStops(graphLocs.map(l => l.id), graphLocs, knowledge);
    expect(ordered).toEqual(["入口", "中亭", "主峰", "南门", "石桥", "南顶"]);
    const segments = routeGraphSegments(ordered, graphLocs, knowledge);
    expect(segments.map(s => s.zoneId)).toEqual(["north", "south"]);
    expect(segments.map(s => s.stopIds)).toEqual([
      ["入口", "中亭", "主峰"],
      ["南门", "石桥", "南顶"],
    ]);
  });

  it("把未匹配的近点归入最近区段，远点保留到最后接驳", () => {
    const locs = [
      ...graphLocs,
      loc("near-summit", "山顶服务点", 116.0025, 39.0025),
      loc("far-park", "外围游客中心", 117.0, 38.0),
    ];
    const ordered = planGraphStops(locs.map(l => l.id), locs, knowledge);
    expect(ordered.slice(0, 3)).toEqual(["入口", "中亭", "主峰"]);
    expect(ordered).toContain("near-summit");
    expect(ordered.indexOf("near-summit")).toBeLessThan(ordered.indexOf("南门"));
    expect(ordered.at(-1)).toBe("far-park");
  });

  it("把同区未匹配点插回步道骨架，避免按原顺序堆在路线末尾", () => {
    const locs = [
      ...graphLocs,
      loc("midway", "步道休憩点", 116.0015, 39.0015),
    ];
    const rawOrder = ["主峰", "midway", "入口", "中亭"];
    const ordered = planGraphStops(rawOrder, locs, knowledge);
    expect(ordered).toEqual(["入口", "中亭", "midway", "主峰"]);
  });

  it("未匹配点不倒插到已知步道入口之前", () => {
    const locs = [
      ...graphLocs,
      loc("near-entrance", "入口服务点", 116.0002, 39.0002),
    ];
    const ordered = planGraphStops(["near-entrance", "中亭", "主峰", "入口"], locs, knowledge);
    expect(ordered).toEqual(["入口", "near-entrance", "中亭", "主峰"]);
  });

  it("交通设施短别名能命中实际景点名，并保留索道衔接", () => {
    const mountainKnowledge: DestinationRouteKnowledge = {
      destinationName: "武功山",
      aliases: ["武功山"],
      zones: [{ id: "main", name: "武功山主景区" }],
      trails: [{
        id: "classic", zoneId: "main", aliases: ["武功山"],
        stops: [
          { name: "游客服务中心" },
          { name: "石鼓寺" },
          { name: "中庵索道" },
          { name: "金顶" },
        ],
      }],
      edges: [
        { from: "游客服务中心", to: "石鼓寺", mode: "shuttle", duration: "15分钟" },
        { from: "石鼓寺", to: "中庵索道", mode: "cableway", duration: "5分钟" },
        { from: "中庵索道", to: "金顶", mode: "walk", duration: "2小时" },
      ],
      source: "auto-research",
      confidence: 0.75,
    };
    const mountainLocs = [
      loc("shigu", "石鼓寺", 114.155081, 27.466864),
      loc("jinding", "武功山风景名胜区金顶", 114.178404, 27.452146),
      loc("ziyuan", "萍乡武功山景区紫极宫(中庵)", 114.172656, 27.458630),
    ];
    const ordered = planGraphStops(mountainLocs.map(l => l.id), mountainLocs, mountainKnowledge);
    expect(ordered).toEqual(["shigu", "ziyuan", "jinding"]);
    const legs = buildRouteLegs(ordered, mountainLocs, mountainKnowledge);
    expect(legs[0]).toMatchObject({ fromId: "shigu", toId: "ziyuan", mode: "cableway", duration: "5分钟" });
    expect(legs[1]).toMatchObject({ fromId: "ziyuan", toId: "jinding", mode: "walk", duration: "2小时" });
  });

  it("交通 leg 优先使用显式边，并按距离保守推断接驳方式", () => {
    const legs = buildRouteLegs(["中亭", "主峰", "南门"], graphLocs, knowledge);
    expect(legs[0]).toMatchObject({ fromId: "中亭", toId: "主峰", mode: "walk" });
    expect(legs[1]).toMatchObject({ fromId: "主峰", toId: "南门", mode: "shuttle", duration: "30分钟" });

    const transferKnowledge: DestinationRouteKnowledge = {
      ...knowledge,
      edges: [],
    };
    const transferLegs = buildRouteLegs(["入口", "中亭", "far-park"], [
      ...graphLocs,
      loc("far-park", "外围游客中心", 117.0, 38.0),
    ], transferKnowledge);
    expect(transferLegs.at(-1)).toMatchObject({ mode: "car", note: expect.stringContaining("需接驳") });
  });

  it("缺少坐标或匹配资料时不崩溃并回退到徒步", () => {
    expect(planGraphStops(["gate"], [{ id: "gate", name: "入口" }], knowledge)).toEqual(["gate"]);
    expect(planGraphStops(["gate"], [{ id: "gate", name: "入口" }], { ...knowledge, trails: [] })).toEqual([]);
    const legs = buildRouteLegs(["入口", "no-coord"], [loc("入口", "入口", 116, 39), loc("no-coord", "无名点")], knowledge);
    expect(legs[0]).toMatchObject({ fromId: "入口", toId: "no-coord", mode: "walk" });
  });

  it("耗时估算优先使用资料时长，并累计停留时间", () => {
    const duration = estimateRouteDuration([
      { fromId: "a", toId: "b", fromName: "A", toName: "B", mode: "walk", duration: "1小时20分钟" },
      { fromId: "b", toId: "c", fromName: "B", toName: "C", mode: "shuttle", distanceM: 8000 },
    ], 5);
    expect(duration).toEqual({
      movementMinutes: 105,
      visitMinutes: 80,
      totalMinutes: 185,
      estimatedLegs: 1,
    });
  });

  it("发现每日行程超过容量上限", () => {
    const locs = [
      loc("a", "入口", 116.0, 39.0),
      loc("b", "山腰", 116.1, 39.0),
      loc("c", "山顶", 116.2, 39.0),
    ];
    const issues = routeGraphIssues(locs.map(l => l.id), locs, {
      ...knowledge,
      edges: [],
    }, { dayLabel: "1日精华游", maxDailyHours: 1 });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "long-day" }),
    ]));
  });

  it("真实恒山策展动线不触发路线图误报", () => {
    const locs = [
      loc("gate", "北岳恒山", 113.727792, 39.66954),
      loc("sanqingdian", "三清殿", 113.725842, 39.651853),
      loc("sanyuangong", "三元宫", 113.72432, 39.651753),
      loc("zhenwumiao", "真武庙", 113.734905, 39.662628),
      loc("hufengkou", "虎风口", 113.733802, 39.665722),
      loc("guolaoling", "北岳恒山-果老岭", 113.73262, 39.667709),
      loc("huixianfu", "会仙府", 113.732116, 39.670322),
      loc("tianfengling", "天峰岭", 113.732809, 39.672792),
      loc("xuankongsi", "悬空寺", 113.715781, 39.661139),
      loc("jinlongxia", "金龙峡栈道", 113.713587, 39.664756),
      loc("cuiping", "翠屏山-三清殿", 113.707197, 39.665923),
    ];
    const ordered = orderStopsByTrail(locs.map(l => l.id), locs, { lng: 113.727792, lat: 39.66954 }, "北岳恒山");
    const issues = routeGraphIssues(ordered, locs, {
      destinationName: "北岳恒山", aliases: ["北岳恒山"], zones: [], trails: CURATED_TRAILS, edges: [], source: "curated", confidence: 0.9,
    });
    expect(issues).toEqual([]);
  });
});
