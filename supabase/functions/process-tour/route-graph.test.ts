import { describe, expect, it } from "vitest";
import { blockingIssues, buildRouteGraph, buildRouteLegs, elevationDeltaM, estimateRouteDuration, inferTransferMode, matchLocsToGraph, minModeForTransfer, parseElevationM, planGraphStops, routeGraphSegments, routeGraphIssues, routeGraphNotes, repairPlanStops, routeLegsText, SCENIC_SHUTTLE_MAX_M, stripFacilitySuffix, crossAreaComponents } from "./route-graph.ts";
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

  it("设施节点不会用景区名派生别名冒充游览点（玉龙雪山真实知识回归）", () => {
    // auto-research 给蓝月谷造的步道里，节点"蓝月谷游览车-候车厅"含景区名"蓝月谷"，
    // 派生别名让地点"玉龙雪山国家级风景名胜区蓝月谷"绑到了一座候车厅上，
    // 整段顺序改由设施点决定。资料显式声明的 aliases 不受此限制。
    const facilityKnowledge: DestinationRouteKnowledge = {
      destinationName: "玉龙雪山",
      aliases: ["玉龙雪山"],
      zones: [{ id: "blue", name: "蓝月谷" }],
      trails: [{
        id: "t1", zoneId: "blue", scenicName: "蓝月谷", aliases: ["玉龙雪山"],
        stops: [{ name: "蓝月谷游览车-候车厅" }, { name: "蓝月谷导览驿站" }],
      }],
      edges: [],
      source: "auto-research",
      confidence: 0.75,
    };
    const graph = buildRouteGraph(facilityKnowledge);
    const hall = [...graph.nodes.values()].find(n => n.name === "蓝月谷游览车-候车厅");
    const station = [...graph.nodes.values()].find(n => n.name === "蓝月谷导览驿站");
    expect(hall?.aliases || []).not.toContain("蓝月谷");
    expect(station?.aliases || []).toContain("蓝月谷"); // 非设施节点仍可派生

    const valleyLoc = [{ id: "v", name: "玉龙雪山国家级风景名胜区蓝月谷", lat: 27.126, lng: 100.247 }];
    const matched = matchLocsToGraph(["v"], valleyLoc, graph);
    expect(matched.get("v")?.name).toBe("蓝月谷导览驿站");
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

  it("显式索道边也覆盖反向，不留下默认徒步边", () => {
    const graph = buildRouteGraph({
      ...knowledge,
      edges: [{ from: "入口", to: "中亭", mode: "cableway", duration: "8分钟" }],
    });
    expect(graph.edges.get("入口|中亭")).toMatchObject({ mode: "cableway" });
    expect(graph.edges.get("中亭|入口")).toMatchObject({ mode: "cableway" });
  });

  it("原路返回的索道终点转去其他分区时保持索道下撤", () => {
    const roundTripKnowledge: DestinationRouteKnowledge = {
      destinationName: "玉龙雪山",
      aliases: ["玉龙雪山"],
      zones: [{ id: "glacier_park", name: "冰川公园" }, { id: "yak_meadow", name: "牦牛坪" }],
      trails: [{
        id: "glacier-trail",
        zoneId: "glacier_park",
        scenicName: "冰川公园",
        aliases: ["玉龙雪山"],
        notes: "从游客中心乘索道至冰川公园，原路返回。",
        stops: [
          { name: "玉龙雪山国家级风景名胜区游客服务中心" },
          { name: "索道候车厅" },
          { name: "冰川公园", aliases: ["玉龙雪山冰川公园"] },
        ],
      }],
      edges: [
        { from: "玉龙雪山国家级风景名胜区游客服务中心", to: "索道候车厅", mode: "cableway", duration: "10分钟" },
        { from: "索道候车厅", to: "冰川公园", mode: "cableway", duration: "10分钟" },
      ],
      source: "auto-research",
      confidence: 0.75,
    };
    const locs = [
      loc("glacier", "玉龙雪山冰川公园栈道", 100.2596, 27.0985),
      loc("yak", "牦牛坪", 100.2445, 27.1660),
    ];
    const legs = buildRouteLegs(["glacier", "yak"], locs, roundTripKnowledge);
    expect(legs[0]).toMatchObject({
      fromId: "glacier",
      mode: "cableway",
      note: expect.stringContaining("先乘索道下至索道候车厅"),
    });
  });

  it("发现同一条步道中的顺序回退", () => {
    const issues = routeGraphIssues(["主峰", "入口", "中亭"], graphLocs, knowledge);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "trail-backtrack" }),
    ]));
  });

  it("闸门先尝试重排修好顺序问题，不改站点集合", () => {
    const result = repairPlanStops(["入口", "主峰", "中亭"], graphLocs, knowledge);
    expect(result.stopIds).toHaveLength(3);
    expect([...result.stopIds].sort()).toEqual(["中亭", "入口", "主峰"].sort()); // 集合不变
    expect(result.stopIds).toEqual(["入口", "中亭", "主峰"]);
    expect(result.repairs).toEqual([expect.objectContaining({ type: "reordered" })]);
    expect(result.issues).toEqual([]);
    expect(result.trimmedIds).toEqual([]);
  });

  it("超容量时砍掉低重要性尾部站点，保留入口与步道站点", () => {
    const noKnowledge: DestinationRouteKnowledge = {
      destinationName: "示例山", aliases: ["示例山"], zones: [], trails: [], edges: [], source: "none", confidence: 0,
    };
    // 6 个相距约 1km 的点，用 maxDailyHours=1 压低容量预算，稳定触发 long-day
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`, name: `站点${i}`, lat: 30 + i * 0.009, lng: 118,
      importance: i === 0 ? 5 : 1, // 首站是入口，重要性最高
    }));
    const ids = many.map(l => l.id);
    const result = repairPlanStops(ids, many, noKnowledge, { maxDailyHours: 1, dayLabel: "1日精华游" });
    expect(result.stopIds.length).toBeLessThan(ids.length);
    expect(result.stopIds[0]).toBe("s0");                      // 入口不被砍
    expect(result.trimmedIds.every(id => id !== "s0")).toBe(true);
    expect(result.repairs.some(r => r.type === "trimmed")).toBe(true);
    expect(result.repairs.find(r => r.type === "trimmed").message).toContain("请确认");
    // 砍到下限仍超容量时不假装修好，把剩余问题交给闸门
    expect(result.issues.map(i => i.type)).toContain("long-day");
  });

  it("无法确定性修复的问题原样返回，绝不静默放行", () => {
    const noKnowledge: DestinationRouteKnowledge = {
      destinationName: "示例山", aliases: ["示例山"], zones: [], trails: [], edges: [], source: "none", confidence: 0,
    };
    const far = [
      { id: "a", name: "甲", lat: 30.0, lng: 118.0, importance: 5 },
      { id: "b", name: "乙", lat: 30.08, lng: 118.0, importance: 4 }, // 约 8.9km，超步行也超摆渡上限
    ];
    const result = repairPlanStops(["a", "b"], far, noKnowledge, { dayLabel: "1日精华游" });
    expect(result.repairs).toEqual([]);
    expect(result.issues.map(i => i.type)).toContain("long-transfer");
    expect(result.stopIds).toEqual(["a", "b"]); // 站点太少不允许砍到 2 以下
  });

  it("空与单站计划直接返回，不产生修复动作", () => {
    expect(repairPlanStops([], graphLocs, knowledge).stopIds).toEqual([]);
    expect(repairPlanStops(["入口"], graphLocs, knowledge).repairs).toEqual([]);
  });

  it("文学巡礼线的叙事排序不触发发布阻断（v97）", () => {
    // 迎客松(7)→天都峰(3)→莲花峰(9)：对玉屏步道是回退，但对沿课本情节走的
    // 文学巡礼线这是产品设定。物理类检查仍应工作。
    const narrative = ["入口", "主峰", "中亭"];
    const plain = routeGraphIssues(narrative, graphLocs, knowledge);
    const free = routeGraphIssues(narrative, graphLocs, knowledge, { allowNarrativeOrder: true });
    expect(plain.some(i => i.type === "trail-backtrack" && i.level === "blocking")).toBe(true);
    expect(free.some(i => i.type === "trail-backtrack" && i.level === "advisory")).toBe(true);
    expect(free.some(i => i.level === "blocking")).toBe(false);
  });

  it("跨步道共享枢纽不参与单条步道的顺序断言（黄山光明顶回归）", () => {
    const hubKnowledge: DestinationRouteKnowledge = {
      destinationName: "示例二山", aliases: [],
      zones: [{ id: "zp", name: "玉屏线" }, { id: "bh", name: "北海线" }],
      trails: [
        { id: "t-yuping", zoneId: "zp", stops: [{ name: "索道站" }, { name: "迎客松" }, { name: "莲花峰" }, { name: "光明顶" }] },
        { id: "t-beihai", zoneId: "bh", stops: [{ name: "光明顶" }, { name: "始信峰" }, { name: "清凉台" }, { name: "飞来石" }] },
      ],
      edges: [], source: "auto-research", confidence: 0.5,
    };
    const hubLocs = [
      loc("ciguang", "索道站", 118.11, 30.11), loc("guest", "迎客松", 118.12, 30.11),
      loc("lotus", "莲花峰", 118.13, 30.12), loc("bright", "光明顶", 118.14, 30.13),
      loc("shixin", "始信峰", 118.16, 30.15), loc("qingliang", "清凉台", 118.17, 30.15),
      loc("feilai", "飞来石", 118.18, 30.16),
    ];
    // 前山上、北海下的合法换乘线：光明顶是两条步道的连接器，
    // 它在玉屏段末尾=北海段开头，不构成任何一条步道的"回退"。
    const lawful = ["ciguang", "guest", "lotus", "bright", "shixin", "qingliang", "feilai"];
    expect(routeGraphIssues(lawful, hubLocs, hubKnowledge).filter(i => i.type === "trail-backtrack")).toEqual([]);
    // 但真折返不豁免：非枢纽点（清凉台→始信峰）在北海段内部倒退仍然阻断。
    const zig = ["ciguang", "guest", "lotus", "bright", "qingliang", "shixin", "feilai"];
    expect(routeGraphIssues(zig, hubLocs, hubKnowledge)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "trail-backtrack" })]),
    );
  });

  it("整条步道反向串联是合法下撤，不报顺序回退", () => {
    // 恒山 1日线曾按下山方向串联，若把它误判为回退，P1-2 闸门会拦下正确路线。
    const reversed = routeGraphIssues(["主峰", "中亭", "入口"], graphLocs, knowledge);
    expect(reversed.some(i => i.type === "trail-backtrack")).toBe(false);
    // 但真正的折返仍要报出来：入口→主峰→中亭 是上山后再下山回半山。
    const zigzag = routeGraphIssues(["入口", "主峰", "中亭"], graphLocs, knowledge);
    expect(zigzag).toEqual(expect.arrayContaining([expect.objectContaining({ type: "trail-backtrack" })]));
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
    // P1-3: 不再输出笼统的"需接驳"，而是给出山路里程与车程，
    // 让 AI 无法把跨片区位移复述成"乘景区观光车"。
    expect(transferLegs.at(-1)).toMatchObject({
      mode: "car",
      note: expect.stringContaining("山路约"),
      roadMinutes: expect.any(Number),
      inferred: true,
    });
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
    // P1-3: 8km 直线摆渡按 1.6 绕行系数折 12.8km 山路、35km/h 均速 → 22 分钟，
    // 旧实现隐含"直线 55km/h"低估为 25→实为严重低估山地车程。
    expect(duration).toEqual({
      movementMinutes: 102,
      visitMinutes: 80,
      totalMinutes: 182,
      estimatedLegs: 1,
    });
  });

  it("交通方式按直线距离分层，car 只由距离决定", () => {
    expect(inferTransferMode(1200)).toBe("walk");
    expect(inferTransferMode(3000)).toBe("walk");
    expect(inferTransferMode(3001)).toBe("shuttle");
    expect(inferTransferMode(SCENIC_SHUTTLE_MAX_M)).toBe("shuttle");
    expect(inferTransferMode(SCENIC_SHUTTLE_MAX_M + 1)).toBe("car");
    expect(inferTransferMode(36710)).toBe("car");
    expect(inferTransferMode(null)).toBe("walk"); // 缺坐标时保守按徒步，不编造车程
  });

  it("海拔文本解析不被区间与说明文字带偏", () => {
    expect(parseElevationM("4506-4680米")).toBe(4506); // 曾被解析成 -4680
    expect(parseElevationM("约2900米")).toBe(2900);
    expect(parseElevationM("1918.3")).toBe(1918.3);
    expect(parseElevationM("海拔3100米（相对高差1000米）")).toBe(3100);
    expect(parseElevationM("")).toBeNull();
    expect(parseElevationM("1:50000")).toBeNull(); // 无单位且非纯数字比例，拒绝
    expect(parseElevationM("4506m")).toBe(4506);
    // 异常高差整段作废，不拿去做交通判定
    expect(elevationDeltaM("4506-4680米", "约2900米")).toBe(-1606);
    expect(elevationDeltaM("8000米", "10米")).toBeNull();
  });

  it("索道段不因海拔文本区间被误判成公路下撤", () => {
    const cableLocs = [
      { ...loc("boardwalk", "玉龙雪山冰川公园栈道", 100.2596, 27.0985), elevation: "4506-4680米" },
      { ...loc("blue", "玉龙雪山国家级风景名胜区蓝月谷", 100.1946, 27.0973), elevation: "约2900米" },
    ];
    const legs = buildRouteLegs(["boardwalk", "blue"], cableLocs, {
      ...knowledge,
      edges: [{ from: "玉龙雪山冰川公园栈道", to: "玉龙雪山国家级风景名胜区蓝月谷", mode: "cableway", duration: "10分钟", source: "manual" }],
      trails: [],
    });
    expect(legs[0]).toMatchObject({ mode: "cableway", edgeMode: "cableway" });
    // 索道段不追加"下撤"提示，避免和资料的 cableway 表述冲突。
    expect(legs[0].note || "").not.toContain("禁止写成连续徒步");
  });

  it("跨市位移不得标成景区观光车（丽江虎跳峡线上事故回归）", () => {
    // 线上实况：主题游 拉市海 → 香格里拉虎跳峡 直线 36.71km，
    // 旧逻辑 (>3km → shuttle) 产出 narrative「乘观光车/摆渡车，直线约37公里」。
    const farLocs = [
      loc("lashihai", "丽江拉市海湿地公园", 100.13, 26.87),
      loc("hutiaoxia", "香格里拉虎跳峡", 100.11, 27.19),
    ];
    const legs = buildRouteLegs(["lashihai", "hutiaoxia"], farLocs, { ...knowledge, edges: [] });
    expect(legs[0]).toMatchObject({ mode: "car", inferred: true });
    expect(legs[0].note).toContain("车程");
    expect(legs[0].roadMinutes).toBeGreaterThan(60);
    const text = routeLegsText(legs);
    expect(text).toContain("专车/出租车");
    expect(text).toContain("禁止描述为景区观光车短驳或索道直达");
    // 主题游允许长串联，但标注方式必须正确，不能再被静默放行
    const issues = routeGraphIssues(["lashihai", "hutiaoxia"], farLocs, { ...knowledge, edges: [] }, { allowLongTransfers: true });
    expect(issues.some(i => i.type === "long-transfer" && i.message.includes("无车程估算"))).toBe(false);
  });

  it("主题游片区边界的跨区段改用中性接驳表述（v96）", () => {
    // 线上实况：恒山主题游的景区之间真实走"景区直通车"（用户亲历大同古城→恒山→悬空寺→应县木塔），
    // 旧表述把它断言成"专车/出租车"；但反过来无资料断言"这里有直通车"同样是未核实声明（同 v88 P1-3）。
    // 因此边界段保留 car 距离下限，表述改为"班车优先、无班车包车"的择一条件。
    const areaLocs = [
      loc("gucheng", "大同古城", 113.295, 40.076),
      loc("hengshan", "北岳恒山", 113.716, 39.736),
    ];
    const plain = buildRouteLegs(["gucheng", "hengshan"], areaLocs, { ...knowledge, edges: [] });
    expect(plain[0]).toMatchObject({ mode: "car" });
    expect(plain[0].interArea).toBeUndefined();
    expect(routeLegsText(plain)).toContain("禁止描述为景区观光车短驳或索道直达");

    const themed = buildRouteLegs(["gucheng", "hengshan"], areaLocs, { ...knowledge, edges: [] },
      { sections: [["gucheng"], ["hengshan"]] });
    expect(themed[0]).toMatchObject({ mode: "car", interArea: true });
    expect(themed[0].note).toContain("景区直通车");
    expect(themed[0].note).not.toMatch(/\d/); // 边界段 note 不再带第二个数字，车程只有 ETA 一处
    const text = routeLegsText(themed);
    expect(text).toContain("跨区域接驳");
    expect(text).toContain("禁止写成连续徒步或景区观光车短驳");
    expect(text).toContain("逐字照抄");
    // 保守车程估算不丢：容量校验仍按 car 的绕行系数与山区均速计
    expect(themed[0].roadMinutes).toBeGreaterThan(60);

    // 同一分区内部不标边界
    const sameSection = buildRouteLegs(["gucheng", "hengshan"], areaLocs, { ...knowledge, edges: [] },
      { sections: [["gucheng", "hengshan"]] });
    expect(sameSection[0].interArea).toBeUndefined();
    // 边界段但距离在摆渡/徒步层（非 car）时也不标——interArea 只针对长距离断言
    const near = buildRouteLegs(["a", "b"], [loc("a", "东山门", 113.70, 39.70), loc("b", "西山门", 113.73, 39.70)],
      { ...knowledge, edges: [] }, { sections: [["a"], ["b"]] });
    expect(near[0]).toMatchObject({ mode: "walk" });
    expect(near[0].interArea).toBeUndefined();
  });

  it("大落差平面短距离不得判为连续徒步（泰山日观峰→岱庙回归）", () => {
    // 线上实况：日观峰 1536m → 岱庙 150m，直线 7.12km，旧 8km 阈值完全漏报。
    const steepLocs = [
      { ...loc("riguan", "日观峰", 117.19, 36.26), elevation: "1536m" },
      { ...loc("miao", "岱庙", 117.13, 36.2), elevation: "150m" },
    ];
    // 大落差 = "不可当作平面徒步段"，升级为 shuttle；car 只由平面距离决定
    // （山上未必有公路，把 1606m 落差判成"包车"会产出另一个错误叙述）。
    expect(minModeForTransfer(7120, 1386)).toBe("shuttle");
    expect(minModeForTransfer(7120, 400)).toBe("shuttle");
    expect(minModeForTransfer(2000, 1386)).toBe("walk"); // 短距离爬升仍是徒步段
    expect(minModeForTransfer(19000, 1000)).toBe("car");  // 距离本身已跨片区
    const legs = buildRouteLegs(["riguan", "miao"], steepLocs, { ...knowledge, edges: [] });
    expect(legs[0]).toMatchObject({ mode: "shuttle", elevationDeltaM: expect.any(Number) });
    expect(legs[0].elevationDeltaM).toBeLessThan(-1000);
    expect(legs[0].note).toContain("禁止写成连续徒步");
  });

  it("资料标注与物理量冲突时对所有路线类型上报", () => {
    // auto-research 把 19km 跨片区写成 walk 时，不能再因为"有资料边"就免检。
    const conflictKnowledge: DestinationRouteKnowledge = {
      ...knowledge,
      trails: [{ id: "t", zoneId: "north", aliases: ["示例山"], stops: [{ name: "甲" }, { name: "乙" }] }],
      edges: [{ from: "甲", to: "乙", mode: "walk" }],
    };
    const conflictLocs = [loc("甲", "甲", 116.0, 39.0), loc("乙", "乙", 116.2, 38.85)];
    const legs = buildRouteLegs(["甲", "乙"], conflictLocs, conflictKnowledge);
    expect(legs[0].mode).not.toBe("walk");
    expect(legs[0].edgeMode).toBe("walk");
    const issues = routeGraphIssues(["甲", "乙"], conflictLocs, conflictKnowledge, { allowLongTransfers: true });
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "long-transfer", message: expect.stringContaining("资料标注为「徒步」") }),
    ]));
  });

  it("目的地没有任何路线知识时仍然必须体检", () => {
    // 这是"每加一条新导览就出新问题"的关键机制缺口：新目的地必然没有知识，
    // 旧实现在 trails 为空时直接 return []，新导览从来没被校验过一次。
    const noKnowledge: DestinationRouteKnowledge = {
      destinationName: "新目的地", aliases: ["新目的地"],
      zones: [], trails: [], edges: [], source: "none", confidence: 0,
    };
    const far = [
      { id: "a", name: "山腰寺", lat: 30.0, lng: 118.0 },
      { id: "b", name: "邻县古镇", lat: 30.25, lng: 118.2 },
    ];
    // 34km 两点分属两个片区：阻断来自与顺序无关的连通性判定，
    // 同时那条缺资料的长跳仍作为待核实记录（两件事各自表达，不互相吞掉）
    const noKbIssues = routeGraphIssues(["a", "b"], far, noKnowledge);
    expect(blockingIssues(noKbIssues)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "zone-interleaved", message: expect.stringContaining("个片区") }),
        // 34km 还越过了 HARD_TRANSFER_M，所以"缺资料"这一条本身也升级为阻断
        expect.objectContaining({ type: "long-transfer" }),
      ]),
    );
    // 步行段资料缺失但物理上必须机动化时，措辞要说清是"默认按步行"而非"资料主张步行"
    const synthetic = [
      { id: "a", name: "山腰寺", lat: 30.0, lng: 118.0 },
      { id: "b", name: "山顶", lat: 30.002, lng: 118.002 },
    ];
    const syntheticKnowledge: DestinationRouteKnowledge = {
      ...noKnowledge,
      trails: [{ id: "t", aliases: ["新目的地"], stops: [{ name: "山腰寺" }, { name: "山顶" }] }],
    };
    expect(buildRouteLegs(["a", "b"], synthetic, syntheticKnowledge)[0]).toMatchObject({
      mode: "walk", edgeMode: "walk", edgeSynthetic: true, inferred: true,
    });
  });

  it("黄山两日线混入 28km 外徽州古村能被自动捕获（线上事故回归）", () => {
    const noKnowledge: DestinationRouteKnowledge = {
      destinationName: "黄山", aliases: ["黄山"], zones: [], trails: [], edges: [], source: "none", confidence: 0,
    };
    // 坐标取自线上黄山导览 locations 表真实值（27.71km 直线）
    const huangshan = [
      { id: "hou", name: "猴子观海", lat: 30.144546, lng: 118.170502 },
      { id: "chengkan", name: "呈坎", lat: 29.914335, lng: 118.280803 },
    ];
    const blocking = blockingIssues(routeGraphIssues(["hou", "chengkan"], huangshan, noKnowledge));
    expect(blocking).toHaveLength(1);
    expect(blocking[0].message).toContain("呈坎");
    expect(blocking[0].message).toContain("个片区");
    // 只有两个站点时不削站（削完就没路线了），但必须把阻断报出来
    const repaired = repairPlanStops(["hou", "chengkan"], huangshan, noKnowledge, { dayLabel: "2日全景游" });
    expect(repaired.stopIds).toEqual(["hou", "chengkan"]);
    expect(repaired.repairs).toEqual([]);
    expect(blockingIssues(repaired.issues)).toHaveLength(1);
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

describe("设施后缀剥离匹配（v92 绑定改善）", () => {
  it("剥离规则本身", () => {
    expect(stripFacilitySuffix("蓝月谷游览车-候车厅")).toBe("蓝月谷");
    expect(stripFacilitySuffix("牦牛坪下部站")).toBe("牦牛坪");
    expect(stripFacilitySuffix("玉龙雪山国家级风景名胜区游客服务中心")).toBe("玉龙雪山国家级风景名胜区");
    // 帐篷不在设施表里：不能被剥成"金顶"去冒充山顶点
    expect(stripFacilitySuffix("武功山金顶帐篷")).toBe("");
    // 剥离后过短会退化成无意义键，宁可不用
    expect(stripFacilitySuffix("谷驿站")).toBe("");
    expect(stripFacilitySuffix("蓝月谷")).toBe(""); // 本来就不是设施名
  });

  const valleyLoc = [{ id: "v", name: "玉龙雪山国家级风景名胜区蓝月谷", lat: 27.126, lng: 100.247 }];
  const facilityKnowledge: DestinationRouteKnowledge = {
    destinationName: "玉龙雪山",
    aliases: ["玉龙雪山"],
    zones: [],
    trails: [{
      id: "t1", aliases: ["玉龙雪山"], scenicName: "蓝月谷",
      stops: [
        { name: "蓝月谷游览车-候车厅", lat: 27.1259, lng: 100.2479 },
        { name: "蓝月谷导览驿站", lat: 27.12624, lng: 100.24754 },
      ],
    }],
    edges: [{ from: "蓝月谷导览驿站", to: "蓝月谷游览车-候车厅", mode: "shuttle", source: "manual" }],
    source: "auto-research",
    confidence: 0.6,
  };

  it("同一景区名同时有真实景点与设施节点时，绑定给景点", () => {
    const matched = matchLocsToGraph(["v"], valleyLoc, buildRouteGraph(facilityKnowledge));
    expect(matched.get("v")?.name).toBe("蓝月谷导览驿站");
  });

  it("设施节点由显式边创建出来时，也排在其后", () => {
    // 只保留候车厅作 trail 站点，但 edges 仍会额外造出"导览驿站"节点
    const onlyFacilityTrail: DestinationRouteKnowledge = {
      ...facilityKnowledge,
      trails: [{ ...facilityKnowledge.trails[0], stops: [{ name: "蓝月谷游览车-候车厅", lat: 27.1259, lng: 100.2479 }] }],
    };
    expect(matchLocsToGraph(["v"], valleyLoc, buildRouteGraph(onlyFacilityTrail)).get("v")?.name).toBe("蓝月谷导览驿站");
  });

  it("知识里只有设施节点时仍能绑定，不至于完全连不上", () => {
    const facilityOnly: DestinationRouteKnowledge = { ...facilityKnowledge, edges: [], trails: [{ ...facilityKnowledge.trails[0], stops: [{ name: "蓝月谷游览车-候车厅", lat: 27.1259, lng: 100.2479 }] }] };
    expect(matchLocsToGraph(["v"], valleyLoc, buildRouteGraph(facilityOnly)).get("v")?.name).toBe("蓝月谷游览车-候车厅");
  });

  it("相邻但语义不同的地标不会被剥成同一个键", () => {
    const graph = buildRouteGraph({
      destinationName: "武功山", aliases: [], zones: [],
      trails: [{ id: "t", aliases: ["武功山"], stops: [{ name: "武功山金顶帐篷", lat: 27.478, lng: 114.136 }] }],
      edges: [], source: "auto-research", confidence: 0.6,
    });
    const locs = [{ id: "j", name: "金顶", lat: 27.48, lng: 114.14 }];
    expect(matchLocsToGraph(["j"], locs, graph).has("j")).toBe(false);
  });

describe("跨片区判定必须与站点顺序无关（v94 线上实测修正）", () => {
  // 坐标与海拔取自线上 locations 表原值
  const yak = { id: "yak", name: "牦牛坪", lat: 27.166042, lng: 100.244457, elevation: "约3700米", importance: 4 };
  const yushui = { id: "ys", name: "丽江玉水寨", lat: 26.999757, lng: 100.201622, elevation: "约2700米", importance: 4 };
  const noKnowledge: DestinationRouteKnowledge = {
    destinationName: "玉龙雪山", aliases: [], zones: [], trails: [], edges: [], source: "none", confidence: 0,
  };

  it("长距离相邻段只算待核实，不再判阻断：它是排序产物而非路线性质", () => {
    // 线上实测：同一批 9 个站点，一种排序里最长跳 11.4km（无 car 段），
    // 另一种排序里出现 19km 的 car 段。拿序列当判据会让同一条路线既通过又被拦。
    // 只有这两个点时确实分属两个片区
    expect(blockingIssues(routeGraphIssues(["yak", "ys"], [yak, yushui], noKnowledge, { dayLabel: "1日精华游" }))).toHaveLength(1);
    const inPark = [
      { id: "a", name: "玉龙雪山冰川公园栈道", lat: 27.102002, lng: 100.199865, elevation: "4506-4680米", importance: 5 },
      { id: "b", name: "玉龙雪山国家级风景名胜区蓝月谷", lat: 27.124436, lng: 100.245886, elevation: "约2900米", importance: 5 },
      { id: "c", name: "甘海子", lat: 27.090724, lng: 100.257808, elevation: "约3100米", importance: 4 },
      yak, yushui,
    ];
    // 但甘海子↔玉水寨只有 11.4km，属摆渡可达一跳：整条路线是一个连通片区，不该阻断
    const whole = routeGraphIssues(["a", "b", "c", "yak", "ys"], inPark, noKnowledge, { dayLabel: "1日精华游" });
    expect(blockingIssues(whole)).toEqual([]);
    expect(whole.some(i => i.message.includes("19km") && i.level === "advisory")).toBe(true);
  });

  it("真跨片区的少数分量被削掉，文案按剩余站点生成", () => {
    const park = [
      { id: "p1", name: "会仙府", lat: 39.6703, lng: 113.7321, importance: 5 },
      { id: "p2", name: "天峰岭", lat: 39.6728, lng: 113.7328, importance: 4 },
      { id: "p3", name: "虎风口", lat: 39.6657, lng: 113.7338, importance: 4 },
      { id: "p4", name: "悬空寺", lat: 39.6611, lng: 113.7158, importance: 5 },
      { id: "mut", name: "应县木塔", lat: 39.7573, lng: 113.1896, importance: 3 },
    ];
    const ids = ["p1", "p2", "p3", "p4", "mut"];
    expect(crossAreaComponents(ids, park, noKnowledge)).toHaveLength(2);
    const repaired = repairPlanStops(ids, park, noKnowledge, { dayLabel: "2日全景游" });
    expect(repaired.stopIds).toEqual(["p1", "p2", "p3", "p4"]);
    expect(repaired.repairs[0].message).toContain("应县木塔");
    expect(blockingIssues(repaired.issues)).toEqual([]);
  });

  it("主题游允许跨片区串联，不触发这条阻断", () => {
    const issues = routeGraphIssues(["yak", "ys"], [yak, yushui], noKnowledge, {
      allowLongTransfers: true, dayLabel: "主题游",
    });
    expect(issues.filter(i => i.level === "blocking")).toEqual([]);
  });
});

});

describe("退化路线必须被拦下（v95 线上批量重跑实测）", () => {
  const noKnowledge: DestinationRouteKnowledge = {
    destinationName: "黄山", aliases: [], zones: [], trails: [], edges: [], source: "none", confidence: 0,
  };

  it("只有 1 个站点的路线报阻断，而不是跳过体检", () => {
    // 线上实况：批量重跑后黄山"1日精华游"只剩 1 站，旧实现在 length<2 时直接 return []，
    // 于是最短的路线恰好是唯一不被检查的那条。
    const issues = routeGraphIssues(["only"], [{ id: "only", name: "黄山", lat: 30.1, lng: 118.16 }], noKnowledge, { dayLabel: "1日精华游" });
    expect(issues).toEqual([expect.objectContaining({ level: "blocking", message: expect.stringContaining("不构成可游览行程") })]);
  });

  it("2 站是合法的最短路线（现网有 2 站半日游），不再被退化规则误伤", () => {
    const two = [{ id: "a", name: "龟山风景区", lat: 30.547, lng: 114.276 }, { id: "b", name: "晴川阁", lat: 30.556, lng: 114.277 }];
    expect(blockingIssues(routeGraphIssues(["a", "b"], two, noKnowledge, { dayLabel: "半日游" }))).toEqual([]);
  });

  it("退化路线不会被自动削站修成空，只能交回人工", () => {
    const r = repairPlanStops(["only"], [{ id: "only", name: "黄山", lat: 30.1, lng: 118.16 }], noKnowledge, { dayLabel: "1日精华游" });
    expect(r.stopIds).toEqual(["only"]);
    expect(r.repairs).toEqual([]);
    expect(blockingIssues(r.issues)).toHaveLength(1);
  });
});
