import { describe, expect, it } from "vitest";
import { orderStopsGeographic, planRoutes } from "./routes.ts";

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
