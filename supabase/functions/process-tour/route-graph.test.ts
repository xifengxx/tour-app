import { describe, expect, it } from "vitest";
import { buildRouteGraph, routeGraphIssues, routeGraphNotes } from "./route-graph.ts";
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
