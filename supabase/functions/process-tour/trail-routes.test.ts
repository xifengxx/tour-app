import { describe, expect, it } from "vitest";
import { landmarkKey } from "./gaode-scan.ts";
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

  it("已存在同名地标时不再注入语义重复的路线补全点", () => {
    const locs = [
      loc("jinding", "武功山风景名胜区金顶", 114.178404, 27.452146),
      loc("gate", "游客服务中心", 114.15618, 27.46568),
    ];
    const trails = [{
      id: "wugong", aliases: ["武功山"], scenicName: "武功山",
      stops: [
        { name: "游客服务中心", required: true },
        { name: "金顶", aliases: ["武功山金顶"], lat: 27.47809, lng: 114.1356, required: true },
      ],
    }];
    expect(injectTrailSeeds(locs, "武功山", "武功山", trails as any)).toEqual([]);
    expect(locs.filter(l => landmarkKey(l.name, "武功山") === "金顶")).toHaveLength(1);
  });

  it("匹配到多条真实站点时提供真实动线提示；未知目的地回退空结果", () => {
    const locs = [
      loc("gate", "北岳恒山", 113.727792, 39.66954),
      loc("tianfengling", "天峰岭", 113.732809, 39.672792),
    ];
    expect(getTrailNotes("北岳恒山", locs)).toContain("三清殿");
    expect(orderStopsByTrail(["gate", "tianfengling"], locs, null, "无名小山")).toEqual([]);
  });

  it("单条已知路线也能提供核心景区名，避免伞形锚点抢占核心池", () => {
    const trails = [{
      id: "wugong", aliases: ["武功山"], scenicName: "武功山",
      stops: [{ name: "石鼓寺" }, { name: "中庵索道" }, { name: "金顶" }],
    }];
    expect(getPrimaryTrailScenicName("武功山", trails as any)).toBe("武功山");
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

describe("步道种子补全只接受游览点（v90）", () => {
  // 取自本地 research-knowledge.ts 对玉龙雪山的真实 auto-research 产出：
  // 6 个步道点里 4 个是设施（游客服务中心/索道候车厅/二级坝旅游厕所/游览车候车厅），
  // 且都带坐标、都被标 required。修复前它们会被当作景点注入导览并排进路线。
  const blueMoonTrail = {
    id: "trail_blue_moon_valley",
    aliases: ["玉龙雪山", "蓝月谷"],
    scenicName: "蓝月谷",
    zoneId: "zone_blue_moon_valley",
    stops: [
      { name: "蓝月谷导览驿站", lat: 27.12624, lng: 100.24754, required: true },
      { name: "蓝月谷二级坝旅游厕所", lat: 27.12561, lng: 100.24812, required: true },
      { name: "蓝月谷游览车-候车厅", lat: 27.1259, lng: 100.2479, required: true },
      { name: "蓝月谷湖心观景处", lat: 27.1245, lng: 100.246, required: true },
    ],
  };
  const entranceTrail = {
    id: "trail_glacier_park",
    aliases: ["玉龙雪山", "冰川公园"],
    scenicName: "冰川公园",
    zoneId: "zone_glacier_park",
    // selectTrail 要求至少 2 个站点能命中已有地点才信任这条步道，因此
    // 冰川公园与观景台都要有对应 loc；游客服务中心与厕所故意没有。
    stops: [
      { name: "玉龙雪山国家级风景名胜区游客服务中心", lat: 27.09752, lng: 100.25875, required: true },
      { name: "索道候车厅", lat: 27.12717, lng: 100.23471, required: true },
      { name: "冰川公园售票处", lat: 27.1299, lng: 100.2311, required: true },
      { name: "玉龙雪山国家级风景名胜区冰川公园", lat: 27.13, lng: 100.23, required: true },
      { name: "冰川公园观景台", lat: 27.1305, lng: 100.2295, required: true },
    ],
  };

  it("中段设施点不再被注入为景点", () => {
    const locs = [loc("valley", "玉龙雪山国家级风景名胜区蓝月谷", 100.247, 27.126)];
    const added = injectTrailSeeds(locs, "蓝月谷", "蓝月谷", [blueMoonTrail]);
    expect(added).not.toContain("蓝月谷二级坝旅游厕所");
    expect(added).not.toContain("蓝月谷游览车-候车厅");
    expect(locs.some((l: any) => /厕所|候车厅/.test(l.name))).toBe(false);
  });

  it("步道首站的入口/换乘设施可以补全，中段设施点不注入", () => {
    const locs = [
      loc("park", "玉龙雪山国家级风景名胜区冰川公园", 100.23, 27.13),
      loc("view", "冰川公园观景台", 100.2295, 27.1305),
    ];
    const added = injectTrailSeeds(locs, "冰川公园", "冰川公园", [entranceTrail]);
    expect(added).toContain("玉龙雪山国家级风景名胜区游客服务中心"); // 首站：动线起点
    expect(added).not.toContain("索道候车厅");   // 中段登乘点由交通边表达
    expect(added).not.toContain("冰川公园售票处"); // 售票设施不注入
    expect(locs.filter((l: any) => /候车厅|售票处/.test(l.name))).toEqual([]);
  });
});
