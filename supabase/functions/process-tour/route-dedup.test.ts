import { describe, expect, it } from "vitest";
import { dedupeRoutes, findDuplicateRoutes, jaccardSimilarity } from "./route-dedup.ts";

const core = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
// 2日全景游按构造完全包含 1日线，再加第二景区站点
const twoDay = [...core, "m1", "m2"];

describe("jaccardSimilarity", () => {
  it("相同集合为 1，不相交为 0，空集合为 0", () => {
    expect(jaccardSimilarity(["a", "b"], ["b", "a"])).toBe(1);
    expect(jaccardSimilarity(["a"], ["b"])).toBe(0);
    expect(jaccardSimilarity([], [])).toBe(0);
  });

  it("完全包含关系只有 8/10，不会被误判为重复", () => {
    // 这是整个判据的核心：用包含率的话这条会是 1.0，多日线会被当成重复删掉
    expect(jaccardSimilarity(core, twoDay)).toBeCloseTo(0.8, 5);
  });
});

describe("findDuplicateRoutes", () => {
  it("抓住站点集合完全相同的重复路线（三清山线上实况）", () => {
    const routes = [
      { day_label: "1日游·徒步环线", stops: ["a", "b", "c", "d", "e"] },
      { day_label: "1日游·车行索道线", stops: ["e", "d", "c", "b", "a"] },
    ];
    const pairs = findDuplicateRoutes(routes);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      keepIndex: 0, dropIndex: 1, identical: true, keepLabel: "1日游·徒步环线", exempted: false,
    });
  });

  it("保留先出现的路线（plans 顺序即优先级）", () => {
    const dup = { day_label: "主题游", stops: ["a", "b", "c", "d"] };
    const pairs = findDuplicateRoutes([
      { day_label: "1日精华游", stops: ["a", "b", "c", "d"] },
      { day_label: "2日全景游", stops: twoDay },
      dup,
    ]);
    expect(pairs.map(p => p.keepLabel)).toEqual(["1日精华游"]);
  });

  it("1日与 2日这种合法包含关系不算重复", () => {
    const pairs = findDuplicateRoutes([
      { day_label: "1日精华游", stops: core },
      { day_label: "2日全景游", stops: twoDay },
      { day_label: "主题游", stops: [...core.slice(0, 4), "r1", "r2", "r3"] },
    ]);
    expect(pairs).toEqual([]);
  });

  it("两站以下的小路线不参与判定，避免半日游互相误伤", () => {
    expect(findDuplicateRoutes([
      { day_label: "半日游", stops: ["x", "y"] },
      { day_label: "半日游", stops: ["y", "x"] },
    ])).toEqual([]);
  });
});

describe("dedupeRoutes", () => {
  it("删除重复的普通路线，保留第一条", () => {
    const { routes, dropped, suspicious } = dedupeRoutes([
      { day_label: "1日游·徒步环线", stops: ["a", "b", "c", "d"] },
      { day_label: "1日游·车行索道线", stops: ["a", "b", "c", "d"] },
      { day_label: "主题游", stops: ["a", "b", "c", "d", "e", "f"] },
    ]);
    expect(routes.map(r => r.day_label)).toEqual(["1日游·徒步环线", "主题游"]);
    expect(dropped).toHaveLength(1);
    expect(suspicious).toEqual([]);
  });

  it("文学巡礼线撞站时不删除，但上报为需核实（v70.4 语义 + 黄山线上实况）", () => {
    const { routes, dropped, suspicious } = dedupeRoutes([
      { day_label: "1日精华游", stops: core },
      { day_label: "文学巡礼线", stops: [...core], _free: true },
    ]);
    expect(routes).toHaveLength(2);   // 没有被删
    expect(dropped).toEqual([]);
    expect(suspicious).toHaveLength(1);
    expect(suspicious[0]).toMatchObject({ dropLabel: "文学巡礼线", exempted: true, identical: true });
  });

  it("被删过的路线不再作为 keep 目标重复计数", () => {
    const { routes, dropped } = dedupeRoutes([
      { day_label: "1日精华游", stops: ["a", "b", "c", "d"] },
      { day_label: "2日全景游", stops: ["a", "b", "c", "d"] },
      { day_label: "主题游", stops: ["a", "b", "c", "d"] },
    ]);
    expect(routes.map(r => r.day_label)).toEqual(["1日精华游"]);
    expect(dropped).toHaveLength(2);
  });
});
