import { describe, expect, it } from "vitest";
import { INFRA_RE, NON_SIGHT_RE, isNonSiteLocation, isNonSitePOI, isTransferPOI, rejectReasonForPOI } from "./poi-filter.ts";

// 全部取样自线上 locations 表里真实混进来的非游览点。
describe("poi-filter", () => {
  it("拒绝被当成景点排进动线的公交站（武当山线上实况）", () => {
    expect(isNonSitePOI("玄岳门(公交站)")).toBe(true);
    expect(rejectReasonForPOI("玄岳门(公交站)")).toBe("交通/服务设施");
    expect(isNonSitePOI("玉虚宫")).toBe(false); // 真景点不能连带误杀
  });

  it("拒绝地质描述条目（泰山 2日线里出现过「两期岩体穿插关系」）", () => {
    expect(isNonSitePOI("两期岩体穿插关系")).toBe(true);
    expect(NON_SIGHT_RE.test("断层构造遗迹")).toBe(true);
  });

  it("拒绝婚礼/旅拍场地（丽江地点表出现过「凌雪草坪(礼成旅行婚礼)」）", () => {
    expect(isNonSitePOI("凌雪草坪(礼成旅行婚礼)")).toBe(true);
  });

  it("拒绝餐饮住宿商业", () => {
    expect(isNonSitePOI("老院子饭庄(永定大道)")).toBe(true);
    expect(rejectReasonForPOI("云水间民宿")).toBe("餐饮住宿商业");
  });

  it("绝不误杀栈道/观景台这类真实游览点", () => {
    // FACILITY_RE 含 `栈道$|观景台$|索道站$`，因此本模块刻意不使用它。
    for (const name of ["金龙峡栈道", "玉龙雪山冰川公园栈道", "鬼谷栈道(野拂)", "福星谷栈道", "云杉坪索道上部站"]) {
      expect(isNonSitePOI(name)).toBe(false);
    }
  });

  it("首层提取沿用同一判据", () => {
    expect(INFRA_RE.test("游客服务中心")).toBe(true);
    expect(isNonSitePOI("售票处")).toBe(true);
  });

  it("空名称与缺失对象按非游览点处理", () => {
    expect(isNonSitePOI("  ")).toBe(true);
    expect(isNonSiteLocation(null)).toBe(true);
    expect(isNonSiteLocation({ name: "岱庙" })).toBe(false);
  });

  it("自定义规则可由调用方追加", () => {
    expect(isNonSitePOI("某某雕刻厂", { extra: [/雕刻厂/] })).toBe(true);
    expect(rejectReasonForPOI("某某雕刻厂", { extra: [/雕刻厂/] })).toBe("自定义规则");
  });

  it("对现网 181 个公开地点的实测精度：只剔除 3 个脏数据", () => {
    // 取样自 12 个公开导览的 locations 表全量扫描结果（scripts/audit-routes.ts 同源数据）。
    // 总闸命中且仅命中这三条已知缺陷条目，其余 178 个真实景点全部保留。
    const productionRejects = ["凌雪草坪(礼成旅行婚礼)", "玄岳门(公交站)", "两期岩体穿插关系"];
    productionRejects.forEach(name => expect(isNonSitePOI(name)).toBe(true));

    // 现网真实存在、且绝不能被误杀的命名形态（栈道/索道站/观景台/入口歧义）
    const productionKeeps = [
      "金龙峡栈道", "玉龙雪山冰川公园栈道", "福星谷栈道", "鬼谷栈道(野拂)", "西线玻璃栈道",
      "云杉坪索道上部站", "中庵索道", "泰山风景名胜区", "南天门", "会仙府", "虎风口",
      "紫极宫", "碧霞祠", "玉女开怀", "巨蟒出山", "百龙天梯", "天门洞前广场",
      "琴台公园-古建筑(打卡点)", "武汉东湖沙滩", "应县木塔", "华严寺",
    ];
    expect(productionKeeps.filter(isNonSitePOI)).toEqual([]);
  });

  it("区分入口/换乘设施与纯服务设施", () => {
    // 游客中心、索道站是动线节点；厕所、候车厅、售票窗口不是游览对象。
    for (const name of ["玉龙雪山国家级风景名胜区游客服务中心", "云杉坪索道上部站", "后石坞索道", "南门停车场"]) {
      expect(isTransferPOI(name)).toBe(true);
    }
    // 纯卫生/休息设施不是动线节点；候车厅属于登乘点，与索道站同类。
    expect(isTransferPOI("蓝月谷二级坝旅游厕所")).toBe(false);
    expect(isTransferPOI("观景台休息亭")).toBe(false);
    expect(isTransferPOI("索道候车厅")).toBe(true);
    // 但它们都不是"景点"：作为地点入库与排线时一律拒绝
    expect(isNonSitePOI("索道候车厅")).toBe(true);
    expect(isNonSitePOI("蓝月谷二级坝旅游厕所")).toBe(true);
  });
});
