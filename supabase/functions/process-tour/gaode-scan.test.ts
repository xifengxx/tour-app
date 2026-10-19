import { describe, expect, it } from "vitest";
import { isDestinationUmbrella, landmarkKey, semanticDedupLocations } from "./gaode-scan.ts";

describe("地名语义清洗", () => {
  it("剥掉目的地和景区后缀后识别同一地标", () => {
    expect(landmarkKey("武功山风景名胜区金顶", "武功山")).toBe("金顶");
    expect(landmarkKey("金顶", "武功山")).toBe("金顶");
    expect(landmarkKey("武功山金顶帐篷", "武功山")).toBe("金顶帐篷");
  });

  it("目的地伞形名标记为景区泛指，具体地标不受影响", () => {
    expect(isDestinationUmbrella("武功山", "武功山")).toBe(true);
    expect(isDestinationUmbrella("萍乡武功山国家级风景名胜区", "武功山")).toBe(true);
    expect(isDestinationUmbrella("武功山风景名胜区金顶", "武功山")).toBe(false);
  });

  it("合并同名地标，并保留非路线补全的高重要性点", () => {
    const locs = [
      { id: "a", name: "金顶", lat: 27.47809, lng: 114.1356, importance: 4, tags: ["子景点", "路线补全"] },
      { id: "b", name: "武功山风景名胜区金顶", lat: 27.452146, lng: 114.178404, importance: 5, tags: ["山峰"] },
      { id: "c", name: "萍乡武功山国家级风景名胜区", lat: 27.473856, lng: 114.159907, importance: 5, tags: ["山岳"] },
    ];
    const merged = semanticDedupLocations(locs, "武功山");
    expect(merged).toHaveLength(2);
    expect(merged.find(l => l.id === "b")?.tags).toContain("路线补全");
    expect(merged.find(l => l.id === "c")?.tags).toContain("景区泛指");
  });
});

describe("别名前缀语义去重（v99.2 恒山天峰岭回归）", () => {
  it("『恒山天峰岭』与『天峰岭』合并为一条", () => {
    const a = { id: "tf", name: "天峰岭", importance: 5, tags: [] };
    const b = { id: "hstf", name: "恒山天峰岭", importance: 3, tags: ["子景点"] };
    const out = semanticDedupLocations([a, b], "北岳恒山", ["北岳恒山", "恒山"]);
    expect(out.length).toBe(1);
    expect(out[0].name).toBe("天峰岭"); // 高重要性保留
    expect(out[0].tags).toContain("子景点"); // 标签合并保留
  });
  it("无别名参数时行为不变", () => {
    const a = { id: "tf", name: "天峰岭", importance: 5, tags: [] };
    const b = { id: "hstf", name: "恒山天峰岭", importance: 3, tags: [] };
    expect(semanticDedupLocations([a, b], "北岳恒山").length).toBe(2);
  });
});
