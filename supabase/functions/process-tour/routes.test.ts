import { describe, expect, it } from "vitest";
import { buildThemeSections, filterRouteStops, mapSectionsToDbIds, isRouteStopEligible, orderStopsGeographic, planRoutes } from "./routes.ts";

const point = (id: string, scenic: string, tags: string[] = [], importance = 3, lng = 116, lat = 39) => ({ id, name: id, scenic, tags, importance, lng, lat });

describe("planRoutes", () => {
  it("始终生成核心一日路线，并按重要性截取", () => {
    const locs = Array.from({ length: 9 }, (_, i) => point(`核心${i}`, "核心", [], i + 1));
    const [plan] = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "目的地", isNovelBased: false, novelName: "", hasRegionTour: false });
    expect(plan.label).toBe("1日精华游");
    expect(plan.allow).toHaveLength(9);
  expect(plan.allow?.[0]).toBe("核心8");
  });

  it("9 个核心点且无主景区时不生成重复的两日路线", () => {
    const locs = Array.from({ length: 9 }, (_, i) => point(`核心${i}`, "核心", [], i + 1));
    const plans = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "目的地", isNovelBased: false, novelName: "", hasRegionTour: false });
    expect(plans.map(plan => plan.label)).toEqual(["1日精华游"]);
  });

  it("没有第二景区时，地区景点不能拼成两日山岳徒步线", () => {
    const locs = [
      ...Array.from({ length: 8 }, (_, i) => point(`核心${i}`, "核心", [], 8 - i, 114.16, 27.47)),
      point("纪念馆", "独立", ["地区景点"], 4, 113.87, 27.62),
      point("溶洞", "独立", ["地区景点"], 3, 113.95, 27.58),
    ];
    const plans = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "武功山", isNovelBased: false, novelName: "", hasRegionTour: true });
    expect(plans.map(plan => plan.label)).toEqual(["1日精华游", "主题游"]);
    expect(plans.find(plan => plan.label === "主题游")?.allow).toContain("纪念馆");
  });

  it("11 个核心点时按一日容量截到 10 站", () => {
    const locs = Array.from({ length: 11 }, (_, i) => point(`核心${i}`, "核心", [], i + 1));
    const [plan] = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "目的地", isNovelBased: false, novelName: "", hasRegionTour: false });
    expect(plan.allow).toHaveLength(10);
  });

  it("一日游核心点最多保留 10 站", () => {
    const locs = Array.from({ length: 25 }, (_, i) => point(`核心${i}`, "核心", [], i + 1));
    const plans = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "目的地", isNovelBased: false, novelName: "", hasRegionTour: false });
    const oneDay = plans.find(plan => plan.label === "1日精华游");
    expect(oneDay?.allow).toHaveLength(10);
    expect(oneDay?.allow?.[0]).toBe("核心24");
  });

  it("核心标签下的远处独立景点不进入一日线", () => {
    const locs = [
      ...Array.from({ length: 6 }, (_, i) => point(`核心${i}`, "核心", [], 5 - i, 100.18, 27.10)),
      point("丽江古城", "核心", [], 4, 100.233, 26.872),
      point("虎跳峡", "核心", [], 3, 100.10, 27.35),
    ];
    const plans = planRoutes(locs, {
      coreScenicName: "冰川公园", mainScenicName: "", destName: "玉龙雪山",
      destLoc: { lng: 100.18, lat: 27.10 }, isNovelBased: false, novelName: "", hasRegionTour: true,
    });
    const oneDay = plans.find(plan => plan.label === "1日精华游");
    expect(oneDay?.allow).toHaveLength(6);
    expect(oneDay?.allow).not.toContain("丽江古城");
    expect(oneDay?.allow).not.toContain("虎跳峡");
  });

  it("索道分区景区把一日容量压到核心区，并把两天拆成不同分区", () => {
    const yulongZones = [
      { id: "glacier_park", name: "冰川公园" },
      { id: "blue_moon_valley", name: "蓝月谷", aliases: ["白水河蓝月谷"] },
      { id: "spruce_meadow", name: "云杉坪" },
      { id: "yak_meadow", name: "牦牛坪" },
    ];
    const namedPoint = (id: string, name: string, importance: number, lng: number, lat: number) =>
      ({ id, name, scenic: "玉龙雪山", tags: [], importance, lng, lat });
    const locs = [
      namedPoint("glacier", "玉龙雪山冰川公园栈道", 5, 100.259, 27.098),
      namedPoint("blue-valley", "玉龙雪山国家级风景名胜区蓝月谷", 5, 100.245, 27.124),
      namedPoint("white-river", "白水河", 5, 100.242, 27.126),
      namedPoint("ganhaizi", "甘海子", 4, 100.258, 27.091),
      namedPoint("spruce", "云杉坪索道上部站", 4, 100.240, 27.135),
      namedPoint("yak", "牦牛坪", 4, 100.244, 27.166),
      namedPoint("jade-water", "丽江玉水寨", 4, 100.202, 27.000),
      namedPoint("temple", "玉峰寺", 4, 100.197, 26.991),
    ];
    const plans = planRoutes(locs, {
      coreScenicName: "玉龙雪山", mainScenicName: "", destName: "玉龙雪山",
      destLoc: { lng: 100.245, lat: 27.100 }, isNovelBased: false, novelName: "",
      hasRegionTour: true, zones: yulongZones,
    });
    const oneDay = plans.find(plan => plan.label === "1日精华游");
    const twoDay = plans.find(plan => plan.label === "2日全景游");
    expect(oneDay?.allow).toHaveLength(4);
    expect(oneDay?.allow).not.toContain("spruce");
    expect(oneDay?.allow).not.toContain("yak");
    expect(oneDay?.allow).not.toContain("jade-water");
    expect(twoDay?.dayPlan?.[0]?.label).toBe("第1天");
    expect(twoDay?.dayPlan?.[0]?.allow).not.toContain("spruce");
    expect(twoDay?.dayPlan?.[1]?.allow).toContain("spruce");
    expect(twoDay?.dayPlan?.[1]?.allow).toContain("yak");
    expect(twoDay?.dayPlan?.[1]?.allow).not.toContain("glacier");
  });

  it("文学导览追加文学巡礼线", () => {
    const locs = Array.from({ length: 8 }, (_, i) => point(`核心${i}`, "核心", [], 3));
    const plans = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "目的地", isNovelBased: true, novelName: "山行", hasRegionTour: false });
    expect(plans.at(-1)).toEqual({ label: "文学巡礼线", title: "《山行》文学巡礼", allow: null });
  });

  it("主题游覆盖 60km 内的地区景点，避免地点入库但无路线引用", () => {
    // 北岳恒山实测：应县木塔约 48km，华严寺约 60km；二者都应能进入主题游。
    const locs = [
      point("核心", "核心", [], 5, 113.72779, 39.66954),
      point("核心子点", "核心", [], 4, 113.73281, 39.67279),
      point("核心子点2", "核心", [], 3, 113.73212, 39.67032),
      point("核心子点3", "核心", [], 3, 113.73262, 39.66771),
      point("应县木塔", "独立", ["地区景点"], 3, 113.188831, 39.566465),
      point("华严寺", "独立", ["地区景点"], 3, 113.296824, 40.093211),
    ];
    const theme = planRoutes(locs, {
      coreScenicName: "核心", mainScenicName: "", destName: "北岳恒山",
      isNovelBased: false, novelName: "", hasRegionTour: true,
    }).find(plan => plan.label === "主题游");
    expect(theme?.allow).toContain("应县木塔");
    expect(theme?.allow).toContain("华严寺");
  });

  it("景区泛指和店铺、道路名不进入徒步路线", () => {
    const locs = [
      point("核心", "核心", [], 5, 113.95, 27.5),
      point("核心子点", "核心", [], 4, 113.96, 27.51),
      point("核心子点2", "核心", [], 3, 113.97, 27.49),
      point("核心子点3", "核心", [], 3, 113.98, 27.52),
      { ...point("萍乡武功山国家级风景名胜区", "核心", ["景区泛指"], 5) },
      { ...point("武功山", "核心", ["景区泛指"], 2) },
      { ...point("明月山大米", "独立", ["地区景点"], 3, 113.85, 27.65) },
      { ...point("白鹤峰路", "独立", ["地区景点"], 3, 114.05, 27.64) },
      point("应县木塔", "独立", ["地区景点"], 3, 114.0, 27.5),
    ];
    const plans = planRoutes(locs, {
      coreScenicName: "核心", mainScenicName: "", destName: "武功山",
      isNovelBased: false, novelName: "", hasRegionTour: true,
    });
    for (const plan of plans) {
      expect(plan.allow).not.toContain("萍乡武功山国家级风景名胜区");
      expect(plan.allow).not.toContain("武功山");
      expect(plan.allow).not.toContain("明月山大米");
      expect(plan.allow).not.toContain("白鹤峰路");
    }
    expect(plans.find(plan => plan.label === "主题游")?.allow).toContain("应县木塔");
  });

  it("景区锚点失败且 corePool 为空时，一日线回退到全部非地区景点", () => {
    // 嵩山线上实测：提取结果没有带“景区/风景名胜区”后缀的伞形锚点，导致 corePool=0，
    // 常规一日线因 stops 为空被丢掉，最终只剩文学巡礼线。
    const locs = [
      { ...point("神州第一圣地", "独立", [], 5) },
      { ...point("少林寺", "独立", [], 5) },
      { ...point("塔林", "独立", [], 4) },
      { ...point("中岳庙", "独立", [], 4) },
      { ...point("嵩阳书院", "独立", [], 4) },
    ];
    const [plan] = planRoutes(locs, {
      coreScenicName: "嵩山", mainScenicName: "", destName: "嵩山",
      isNovelBased: true, novelName: "嵩山少林寺", hasRegionTour: false,
    });
    expect(plan.label).toBe("1日精华游");
    expect(plan.allow).toHaveLength(5);
  });
});

describe("orderStopsGeographic", () => {
  // 北岳恒山线上实测坐标：AI 排序曾产出 山顶→山脚→山顶 锯齿动线
  const hengshanLocs = [
    { id: "gate", name: "北岳恒山", lng: 113.72779, lat: 39.66954 },
    { id: "summit", name: "天峰岭", lng: 113.73281, lat: 39.67279 },
    { id: "xuankongsi", name: "悬空寺", lng: 113.71578, lat: 39.66114 },
    { id: "huixianfu", name: "会仙府", lng: 113.73212, lat: 39.67032 },
    { id: "hufengkou", name: "虎风口", lng: 113.73380, lat: 39.66572 },
    { id: "guolaoling", name: "果老岭", lng: 113.73262, lat: 39.66771 },
    { id: "sanqingdian", name: "三清殿", lng: 113.72584, lat: 39.65185 },
    { id: "zhenwumiao", name: "真武庙", lng: 113.73490, lat: 39.66263 },
  ];
  const gate = { lng: 113.72779, lat: 39.66954 };

  it("从入口最近邻串联，形成上山顶再下山的连贯动线", () => {
    const ordered = orderStopsGeographic(hengshanLocs.map(l => l.id), hengshanLocs, gate);
    expect(ordered).toEqual([
      "gate",        // 入口
      "huixianfu",   // 上山
      "summit",      // 山顶
      "guolaoling",  // 下山
      "hufengkou",
      "zhenwumiao",
      "sanqingdian", // 山脚
      "xuankongsi",  // 外围峡谷景点收尾
    ]);
  });

  it("无坐标站点保持原顺序追加在末尾", () => {
    const locs = [...hengshanLocs, { id: "noCoord", name: "缺坐标点" }];
    const ordered = orderStopsGeographic(["noCoord", "gate", "summit"], locs, gate);
    expect(ordered.at(-1)).toBe("noCoord");
    expect(ordered).toContain("gate");
  });
});
describe("planRoutes 能力授权（v89 分层）", () => {
  const zoneA = { id: "zA", name: "A区" };
  const zoneB = { id: "zB", name: "B区" };
  const locs = [
    point("A区索道上站", "核心", [], 7, 114.10, 27.40),
    point("A区观景台", "核心", [], 6, 114.11, 27.41),
    point("B区草甸", "核心", [], 5, 114.13, 27.42),
    point("B区寺庙", "核心", [], 4, 114.14, 27.43),
    point("核心东", "核心", [], 3, 114.12, 27.41),
    point("核心西", "核心", [], 2, 114.115, 27.405),
    point("后山瀑布", "后山", [], 4, 114.16, 27.45),
    point("后山索道", "后山", [], 3, 114.17, 27.46),
    point("外围纪念馆", "独立", ["地区景点"], 5, 114.20, 27.50),
  ];
  const full = { multiDay: true, themeTour: true, zoneDriven: true, trailOrder: true, assertTransport: true };
  // v93：主题游不再受分层限制（分区结构只声明"这几个就近景区可连着玩"，
  // 不声明跨区连续动线），所以 researched 档只剩多日线被抑制
  const researched = { multiDay: false, themeTour: true, zoneDriven: false, trailOrder: true, assertTransport: false };
  const ctxOf = (over: Record<string, unknown> = {}) => ({
    coreScenicName: "核心", mainScenicName: "后山", destName: "示例山", isNovelBased: false,
    novelName: "", hasRegionTour: true, zones: [zoneA, zoneB], ...over,
  });

  it("已验证知识仍产出 1日/2日/主题游（不削弱现有能力）", () => {
    const suppressed: string[] = [];
    const plans = planRoutes(locs, ctxOf({
      capabilities: full, onSuppressed: (plan: string) => suppressed.push(plan),
    }));
    expect(plans.map(p => p.label)).toEqual(["1日精华游", "2日全景游", "主题游"]);
    expect(suppressed).toEqual([]);
  });

  it("未核实知识不再产出 2日全景游与主题游", () => {
    const suppressed: { plan: string; reason: string }[] = [];
    const plans = planRoutes(locs, ctxOf({
      capabilities: researched, onSuppressed: (plan, reason) => suppressed.push({ plan, reason }),
    }));
    expect(plans.map(p => p.label)).toEqual(["1日精华游", "主题游"]);
    expect(suppressed.map(p => p.plan)).toEqual(["2日全景游"]);
    expect(suppressed[0].reason).toContain("未经核实");
  });

  it("只有一个周边独立景区时主题游仍出，分区为核心+该景区（v96 必出项）", () => {
    // 用户要求：一条新导览至少两条路线——1日精华游 + 与周边地区组成的主题游。
    // 恒山/青城山实测：周边哪怕只并回 1 个独立景区（如都江堰），主题游也必须存在。
    const plans = planRoutes(locs, ctxOf({ capabilities: researched }));
    const theme = plans.find(p => p.label === "主题游");
    expect(theme).toBeTruthy();
    expect(theme!.sections).toHaveLength(2);
    expect(theme!.sections![0].kind).toBe("核心景区");
    expect(theme!.sections![1].name).toBe("外围纪念馆");
    expect(theme!.sections![1].allow).toContain("外围纪念馆");
  });

  it("未核实分区不再把 1 日线压到 5 站", () => {
    // 线上实况：auto-research 给玉龙雪山造的分区把 13 个点全归进"冰川公园"，
    // zoneDriven 选点只剩 4 站；关闭 zoneDriven 后按重要性取满一日容量。
    const researchedPlans = planRoutes(locs, ctxOf({ capabilities: researched }));
    const verifiedPlans = planRoutes(locs, ctxOf({ capabilities: full }));
    expect(researchedPlans[0].allow!.length).toBeGreaterThan(5);
    expect(verifiedPlans[0].allow!.length).toBeLessThanOrEqual(5);
  });

  it("没有第二景区也没有分区时不虚构多日线", () => {
    const plans = planRoutes(locs, ctxOf({ mainScenicName: "", zones: [], capabilities: full }));
    expect(plans.map(p => p.label)).toEqual(["1日精华游", "主题游"]);
  });

  it("小说源导览的文学巡礼线不受能力授权影响", () => {
    const withNovel = planRoutes(locs, ctxOf({ capabilities: researched, isNovelBased: true, novelName: "示例小说" }));
    const withoutNovel = planRoutes(locs, ctxOf({ capabilities: researched, isNovelBased: false, novelName: "" }));
    expect(withNovel.map(p => p.label)).toEqual(["1日精华游", "主题游", "文学巡礼线"]);
    expect(withNovel[2].allow).toBeNull(); // 文学线由 AI 自由选点，不锁站点
    expect(withoutNovel.map(p => p.label)).toEqual(["1日精华游", "主题游"]);
  });

  it("缺省不传 capabilities 时保持既有行为（向后兼容）", () => {
    const plans = planRoutes(locs, ctxOf());
    expect(plans.map(p => p.label)).toEqual(["1日精华游", "2日全景游", "主题游"]);
  });
});

describe("路线站点资格（景区伞形名）", () => {
  it("伞形景区名不能作为游览站", () => {
    // 现网实况：这三个都是景区名被高德定位到行政/质心点，却出现在路线站点序列里
    expect(isRouteStopEligible({ name: "泰山风景名胜区", tags: [] }, { destName: "泰山" })).toBe(false);
    expect(isRouteStopEligible({ name: "黄山", tags: [] }, { destName: "黄山" })).toBe(false);
    expect(isRouteStopEligible({ name: "天门山国家森林公园", tags: [] }, { destName: "天门山" })).toBe(false);
    expect(isRouteStopEligible({ name: "武功山", tags: ["景区泛指"] }, { destName: "武功山" })).toBe(false);
  });

  it("带景区前缀的真实地标不被误杀", () => {
    expect(isRouteStopEligible({ name: "泰山风景名胜区-碧霞祠", tags: [] }, { destName: "泰山" })).toBe(true);
    expect(isRouteStopEligible({ name: "日观峰", tags: [] }, { destName: "泰山" })).toBe(true);
    expect(isRouteStopEligible({ name: "岱庙", tags: [] }, { destName: "泰山" })).toBe(true);
    expect(isRouteStopEligible({ name: "玉龙雪山国家级风景名胜区蓝月谷", tags: [] }, { destName: "玉龙雪山" })).toBe(true);
    expect(isRouteStopEligible({ name: "嵩山国家重点风景名胜区峻极峰", tags: [] }, { destName: "嵩山" })).toBe(true);
  });

  it("策展步道声明的入口/换乘点获得豁免（恒山首站别名就是目的地名）", () => {
    const protectedNames = new Set(["北岳恒山", "恒山", "游客中心"]);
    expect(isRouteStopEligible({ name: "北岳恒山", tags: ["景区泛指"] }, { destName: "北岳恒山", protectedNames })).toBe(true);
    // 没有步道保护时仍然排除
    expect(isRouteStopEligible({ name: "北岳恒山", tags: ["景区泛指"] }, { destName: "北岳恒山" })).toBe(false);
  });

  it("filterRouteStops 剔除伞形点并报告点名，未知 id 原样保留", () => {
    const byId = new Map<string, any>([
      ["d1", { id: "d1", name: "红门宫", tags: [] }],
      ["d2", { id: "d2", name: "泰山风景名胜区", tags: [] }],
      ["d3", { id: "d3", name: "中天门", tags: [] }],
    ]);
    const { kept, dropped } = filterRouteStops(["d1", "d2", "d3", "d-unknown"], byId, { destName: "泰山" });
    expect(kept).toEqual(["d1", "d3", "d-unknown"]);
    expect(dropped).toEqual(["泰山风景名胜区"]);
  });

  it("文学巡礼线经资格闸后不再混入伞形点，且不会清空整条路线", () => {
    const byId = new Map<string, any>([
      ["h1", { id: "h1", name: "黄山", tags: ["景区泛指"] }],
      ["h2", { id: "h2", name: "黄山-迎客松", tags: [] }],
      ["h3", { id: "h3", name: "黄山风景区-光明顶", tags: [] }],
    ]);
    const { kept, dropped } = filterRouteStops(["h1", "h2", "h3"], byId, { destName: "黄山" });
    expect(kept).toEqual(["h2", "h3"]);
    expect(dropped).toEqual(["黄山"]);
  });

describe("主题游分区结构（v93）", () => {
  const corePool = [
    point("核心A", "核心", [], 5, 114.10, 27.40),
    point("核心B", "核心", [], 4, 114.11, 27.41),
  ];
  const clusters = [
    { rep: point("蓝月谷", "独立", ["地区景点"], 4, 114.20, 27.50), locs: [
      point("蓝月谷", "独立", ["地区景点"], 4, 114.20, 27.50),
      point("白水河", "独立", ["地区景点"], 3, 114.21, 27.51),
    ] },
    { rep: point("云杉坪", "独立", ["地区景点"], 3, 114.40, 27.60), locs: [
      point("云杉坪", "独立", ["地区景点"], 3, 114.40, 27.60),
    ] },
  ];

  it("一簇 = 一个片区，代表点在前，成员是片区内具体玩法点", () => {
    const sections = buildThemeSections([...corePool, ...clusters[0].locs, ...clusters[1].locs], { destName: "示例山", coreScenicName: "核心" }, corePool, clusters);
    expect(sections.map(s => s.name)).toEqual(["核心", "蓝月谷", "云杉坪"]);
    expect(sections[0].kind).toBe("核心景区");
    expect(sections[1]).toMatchObject({ kind: "周边景点", allow: ["蓝月谷", "白水河"] });
    // 片区总数受上限约束，不会把 60km 半径内所有散点全塞进主题游
    expect(sections.reduce((n, s) => n + s.allow.length, 0)).toBeLessThanOrEqual(20);
  });

  it("planRoutes 的主题游带分区，且 allow 是各分区拼接结果", () => {
    const plans = planRoutes([
      ...Array.from({ length: 6 }, (_, i) => point(`核心${i}`, "核心", [], 6 - i, 114.10 + i * 0.002, 27.40)),
      point("蓝月谷", "独立", ["地区景点"], 4, 114.20, 27.50),
      point("白水河", "独立", ["地区景点"], 3, 114.205, 27.505),
      point("云杉坪", "独立", ["地区景点"], 3, 114.30, 27.60),
      point("牦牛坪", "独立", ["地区景点"], 3, 114.305, 27.605),
    ], { coreScenicName: "核心", mainScenicName: "", destName: "示例山", isNovelBased: false, novelName: "", hasRegionTour: true, zones: [] });
    const theme = plans.find(p => p.label === "主题游");
    expect(theme?.sections?.length).toBeGreaterThan(1);
    expect(theme?.allow).toEqual(theme!.sections!.flatMap(s => s.allow));
    // 每个片区的站点都必须是路线站点的子集，前端才能只用一份 stops 做地图连线
    for (const sec of theme!.sections!) {
      expect(sec.allow.every(id => theme!.allow!.includes(id))).toBe(true);
    }
  });
});
});

describe("mapSectionsToDbIds（v94 线上 bug 回归）", () => {
  const slugToDbId = new Map([["h1", "77a1-h1"], ["h2", "77a1-h2"], ["h3", "77a1-h3"]]);
  const sections = [
    { key: "core", name: "玉龙雪山", kind: "核心景区" as const, allow: ["h1", "h2"], text: "" },
    { key: "area-h3", name: "蓝月谷", kind: "周边景点" as const, allow: ["h3"], text: "" },
  ];

  it("分区的 slug id 必须映射成写库用的 db id", () => {
    // 线上实测：之前直接拿 slug 与 db id 求交集，结果恒为空，
    // 每个分区都被"非空站点"过滤掉，routes.sections 落库永远是空数组。
    const mapped = mapSectionsToDbIds(sections, slugToDbId, ["77a1-h1", "77a1-h2", "77a1-h3"]);
    expect(mapped).toEqual([
      { key: "core", name: "玉龙雪山", kind: "核心景区", stopIds: ["77a1-h1", "77a1-h2"] },
      { key: "area-h3", name: "蓝月谷", kind: "周边景点", stopIds: ["77a1-h3"] },
    ]);
  });

  it("不在最终路线里的站点被剔除，空分区不写库", () => {
    const mapped = mapSectionsToDbIds(sections, slugToDbId, ["77a1-h1"]);
    expect(mapped).toEqual([
      { key: "core", name: "玉龙雪山", kind: "核心景区", stopIds: ["77a1-h1"] },
    ]);
  });

  it("没有分区（线性路线）时返回空数组", () => {
    expect(mapSectionsToDbIds(undefined, slugToDbId, [])).toEqual([]);
    expect(mapSectionsToDbIds([], slugToDbId, [])).toEqual([]);
  });
});
