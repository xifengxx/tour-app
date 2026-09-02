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

  it("11 个核心点时保留完整核心动线，不再按 10 个截断", () => {
    const locs = Array.from({ length: 11 }, (_, i) => point(`核心${i}`, "核心", [], i + 1));
    const [plan] = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "目的地", isNovelBased: false, novelName: "", hasRegionTour: false });
    expect(plan.allow).toHaveLength(11);
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
