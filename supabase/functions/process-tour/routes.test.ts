import { describe, expect, it } from "vitest";
import { planRoutes } from "./routes.ts";

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
