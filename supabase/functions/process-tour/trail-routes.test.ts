import { describe, expect, it } from "vitest";
import { getTrailNotes, injectTrailSeeds, orderStopsByTrail } from "./trail-routes.ts";

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
});
