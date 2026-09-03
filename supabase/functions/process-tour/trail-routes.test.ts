import { describe, expect, it } from "vitest";
import { applyTrailGroups, getPrimaryTrailScenicName, getTrailNotes, injectTrailSeeds, orderStopsByTrail } from "./trail-routes.ts";

const loc = (id: string, name: string, lng: number, lat: number) => ({ id, name, lng, lat });

describe("curated trail routes", () => {
  const hengshanLocs = [
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
  const gate = { lng: 113.727792, lat: 39.66954 };

  it("用已知步道顺序取代地理最近邻，并把同名异景点放在正确位置", () => {
    const ids = hengshanLocs.map(l => l.id);
    const ordered = orderStopsByTrail(ids, hengshanLocs, gate, "北岳恒山");
    expect(ordered.slice(0, 4)).toEqual(["gate", "sanqingdian", "sanyuangong", "zhenwumiao"]);
    expect(ordered.slice(4, 9)).toEqual(["hufengkou", "guolaoling", "huixianfu", "tianfengling", "xuankongsi"]);
    expect(ordered.slice(-2)).toEqual(["jinlongxia", "cuiping"]);
  });

  it("为已知山岳补齐缺失的关键步道点", () => {
    const locs = [
      loc("gate", "北岳恒山", 113.727792, 39.66954),
      loc("tianfengling", "天峰岭", 113.732809, 39.672792),
      loc("xuankongsi", "悬空寺", 113.715781, 39.661139),
    ];
    const added = injectTrailSeeds(locs, "北岳恒山", "北岳恒山");
    expect(added).toEqual(expect.arrayContaining(["三清殿", "真武庙", "虎风口", "果老岭", "会仙府"]));
    expect(locs.find(l => l.name === "真武庙")).toMatchObject({ scenic: "北岳恒山", importance: 4 });
  });

  it("匹配到多条真实站点时提供真实动线提示；未知目的地回退空结果", () => {
    const locs = [
      loc("gate", "北岳恒山", 113.727792, 39.66954),
      loc("tianfengling", "天峰岭", 113.732809, 39.672792),
    ];
    expect(getTrailNotes("北岳恒山", locs)).toContain("三清殿");
    expect(orderStopsByTrail(["gate", "tianfengling"], locs, null, "无名小山")).toEqual([]);
  });

  it("嵩山双山线路将少室山景点分到独立景区池，而不是混入一日爬线", () => {
    const locs = [
      { ...loc("songshan", "神州第一圣地", 113.024861, 34.494863), scenic: "嵩山" },
      { ...loc("shaolin", "少林寺", 112.941373, 34.507029), scenic: "嵩山" },
      { ...loc("talin", "塔林", 112.937188, 34.503335), scenic: "嵩山" },
      { ...loc("sanhuangzhai", "三皇寨", 112.952063, 34.473496), scenic: "嵩山" },
      { ...loc("shaoshiStele", "少室山碑", 112.938088, 34.489904), scenic: "嵩山" },
      { ...loc("taishi", "太室山", 113.042706, 34.491078), scenic: "嵩山" },
    ];
    const changed = applyTrailGroups(locs, "嵩山");
    expect(changed).toHaveLength(6);
    expect(locs.filter(l => l.scenic === "少室山").map(l => l.name)).toEqual(["少林寺", "塔林", "三皇寨", "少室山碑"]);
  });

  it("嵩山一日线只用太室山池，两日线按太室山段+少室山段拼接", () => {
    const locs = [
      { ...loc("shenzhou", "神州第一圣地", 113.024861, 34.494863), scenic: "嵩山", tags: [] },
      { ...loc("zhongyue", "中岳庙", 113.074125, 34.457862), scenic: "嵩山", tags: [] },
      { ...loc("songyang", "嵩阳书院", 113.033552, 34.480289), scenic: "嵩山", tags: [] },
      { ...loc("taishi", "太室山", 113.042706, 34.491078), scenic: "嵩山", tags: [] },
      { ...loc("songyueta", "嵩岳寺塔", 113.022266, 34.500246), scenic: "嵩山", tags: [] },
      { ...loc("guanxing", "观星台", 113.146903, 34.400929), scenic: "嵩山", tags: [] },
      { ...loc("huishan", "会善寺", 113.005234, 34.491258), scenic: "嵩山", tags: [] },
      { ...loc("shaolin", "少林寺", 112.941373, 34.507029), scenic: "嵩山", tags: [] },
      { ...loc("talin", "塔林", 112.937188, 34.503335), scenic: "嵩山", tags: [] },
      { ...loc("shaoshiStele", "少室山碑", 112.938088, 34.489904), scenic: "嵩山", tags: [] },
      { ...loc("sanhuangzhai", "三皇寨", 112.952063, 34.473496), scenic: "嵩山", tags: [] },
    ];
    applyTrailGroups(locs, "嵩山");
    const coreScenicName = getPrimaryTrailScenicName("嵩山");
    expect(coreScenicName).toBe("太室山");
    const oneDay = locs.filter(l => l.scenic === coreScenicName).map(l => l.id);
    expect(oneDay).not.toContain("shaoshiStele");

    const twoDayIds = [...oneDay, "shaolin", "talin", "shaoshiStele", "sanhuangzhai"];
    const ordered = orderStopsByTrail(twoDayIds, locs, null, "嵩山");
    expect(ordered.slice(0, oneDay.length)).toEqual(expect.arrayContaining(oneDay));
    expect(ordered.slice(oneDay.length)).toEqual(["shaolin", "talin", "sanhuangzhai", "shaoshiStele"]);
  });
});
