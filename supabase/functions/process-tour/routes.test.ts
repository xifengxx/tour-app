import { describe, expect, it } from "vitest";
import { orderStopsGeographic, planRoutes } from "./routes.ts";

const point = (id: string, scenic: string, tags: string[] = [], importance = 3, lng = 116, lat = 39) => ({ id, name: id, scenic, tags, importance, lng, lat });

describe("planRoutes", () => {
  it("始终生成核心一日路线，并按重要性截取", () => {
    const locs = Array.from({ length: 9 }, (_, i) => point(`核心${i}`, "核心", [], i + 1));
    const [plan] = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "目的地", isNovelBased: false, novelName: "", hasRegionTour: false });
    expect(plan.label).toBe("1日精华游");
    expect(plan.allow).toHaveLength(8);
    expect(plan.allow?.[0]).toBe("核心8");
  });

  it("文学导览追加文学巡礼线", () => {
    const locs = Array.from({ length: 8 }, (_, i) => point(`核心${i}`, "核心", [], 3));
    const plans = planRoutes(locs, { coreScenicName: "核心", mainScenicName: "", destName: "目的地", isNovelBased: true, novelName: "山行", hasRegionTour: false });
    expect(plans.at(-1)).toEqual({ label: "文学巡礼线", title: "《山行》文学巡礼", allow: null });
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
