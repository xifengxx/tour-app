import { describe, expect, it } from "vitest";
import { canonicalizeMechanicalName, isDestinationUmbrella, landmarkKey, semanticDedupLocations } from "./gaode-scan.ts";

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

  it("景区伞形名 + 片区 仍是泛指，不因为带「-」就算景点", () => {
    // 三清山线上实测："三清山国家级旅游" importance=5，直接进了 2 日线第 2 站
    expect(isDestinationUmbrella("三清山国家级旅游", "三清山")).toBe(true);
    // 形态上无法区分「风景名胜区-碧霞祠」和「风景区-南清园」，所以不按形态判定：
    // 片区由知识层 zones 标记（index.ts markKnowledgeZones），这里只守住真实景点不被误杀
    expect(isDestinationUmbrella("三清山-三清宫", "三清山")).toBe(false);
    expect(isDestinationUmbrella("三清宫", "三清山")).toBe(false);
    expect(isDestinationUmbrella("西海岸栈道", "三清山")).toBe(false);
  });

  it("剥掉 AI 的「目的地-地标」机械拼接名，优先用策展知识里的规范名", () => {
    const known = ["三清宫", "风雷塔", "禹皇顶", "西海岸栈道"];
    expect(canonicalizeMechanicalName("三清山-三清宫", "三清山", known)).toBe("三清宫");
    expect(canonicalizeMechanicalName("三清山国家级旅游风景区-风雷塔", "三清山", known)).toBe("风雷塔");
    // 知识里没有的，至少把目的地前缀剥掉
    expect(canonicalizeMechanicalName("三清山-冰玉洞", "三清山", known)).toBe("冰玉洞");
    // 伞形名保持原样，交给 isDestinationUmbrella 判
    expect(canonicalizeMechanicalName("三清山国家级旅游", "三清山", known)).toBe("三清山国家级旅游");
    // 不含目的地前缀的名称不动
    expect(canonicalizeMechanicalName("玉台-禹皇顶栈道", "三清山", known)).toBe("玉台-禹皇顶栈道");
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
