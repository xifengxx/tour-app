import { GAODE_KEY } from "./config.ts";
import { cleanName } from "./gaode-scan.ts";
import { JUNK_RE } from "./gaode-scan.ts";

const PROV_PREFIX = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)/;
const PROV_EXACT = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)$/;
// v86a: 地理编码结果落在这级行政区划时直接使用坐标（先信编码，不先搜 POI）。
// 具体景点/POI 名编码返回"兴趣点"级或查无结果时仍走原有关键字搜索。
const ADMIN_LEVELS = new Set(["省", "市", "区县", "乡镇", "街道"]);
const AMUSE_RE = /动物王国|游乐园|欢乐谷|主题乐园|海洋馆|海洋公园|海昌|电影小镇|戏剧幻城|水上乐园|欢乐世界|方特|万达城|融创|游乐场|马戏|欢乐田园|迪士尼|欢乐海岸|梦幻王国|魔幻|乐园/;
const FACILITY_RE = /停车场|售票处|售票点|售票大厅|检票口|检票|门票站|乘车处|候车(?:处|亭|室)|索道(?:上站|下站|中站|入口|出口|站)?$|缆车$|观光车(?:站|场|停靠点)|游客中心|游客服务(?:点|中心)?|服务区|服务站|服务中心|管理处|管委会|委员会|居委会|村委会|派出所|加油站|银行|超市|商店|小卖部|商业街|饭店|餐厅|宾馆|酒店|客栈|民宿|山庄|农家乐|厕所|卫生间|洗手间|公厕|入口$|出口$|北门|南门|东门|西门|中门|大门|广场$|车站$|码头$|步道$|栈道$|观景台$|平台$|通道|门店|店\)|店$|综合服务|街道|步行街|(?<!故)居$|邮政|快递|营业厅|窗口|咨询|摄影|团队|散客|办事处|招商中心|营销中心|售楼处|工会|党员|人社|村委会|公路$|大道$|路$|街$|巷$/;

function splitRegion(t: string) {
  const sheng = t.indexOf("省");
  if (sheng > -1) return { prov: t.slice(0, sheng + 1), city: t.slice(sheng + 1) };
  const zzq = t.indexOf("自治区");
  if (zzq > -1) return { prov: t.slice(0, zzq + 3), city: t.slice(zzq + 3) };
  const m = t.match(PROV_PREFIX);
  if (m && m[0].length < t.length) return { prov: m[0], city: t.slice(m[0].length) };
  return { prov: "", city: t };
}

async function geocodeAddress(name: string, destCity: string): Promise<{ lng: number; lat: number; name: string; level: string } | null> {
  const rawCity = (splitRegion(destCity).city || destCity).replace(/[市]$/g, "");
  const cityIsProvince = !!rawCity && PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  const cityPart = cityIsProvince ? "" : `&city=${encodeURIComponent(rawCity)}`;
  try {
    const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(name)}${cityPart}&key=${GAODE_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const d = await res.json();
    const g = (d.geocodes || [])[0];
    if (!g?.location || !g?.level) return null;
    if (!ADMIN_LEVELS.has(g.level)) return null;
    const [lng, lat] = g.location.split(",").map(Number);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat, name: String(g.formatted_address || name), level: g.level };
  } catch {
    return null;
  }
}

export async function gaode(name: string, destCity: string, bias?: { lng: number; lat: number }) {
  // v86a: 行政区名（省/市/区县/乡镇）先走地理编码；编码命中高层级直接返回。
  // 景区名和 POI 名编码会落"兴趣点"级 → 不在 ADMIN_LEVELS → 继续走原有 POI 搜索。
  const geo = await geocodeAddress(name, destCity);
  if (geo) return { lng: geo.lng, lat: geo.lat, name: cleanName(geo.name) };
  const kw = encodeURIComponent(name);
  const biasParam = bias ? `&location=${bias.lng},${bias.lat}` : "";
  const rawCity = (splitRegion(destCity).city || destCity).replace(/[市]$/g, "");
  const cityIsProvince = !!rawCity && PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  const cityPart = cityIsProvince ? "" : `&city=${encodeURIComponent(rawCity)}&citylimit=true`;
  const overlaps = (pois: any[]) => pois.filter((p: any) => p.name?.includes(name) || name.includes(p.name || ""));
  const preferScenic = (pois: any[]) => {
    const s = pois.filter((p: any) => /风景名胜|旅游景点|名胜|景区|公园/.test(p.type || ""));
    return s.length ? s : pois;
  };
  const query = async (types: string | null, useCity = true) => {
    const typesParam = types ? `&types=${encodeURIComponent(types)}` : "";
    const cityParam = useCity ? cityPart : "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}${cityParam}&key=${GAODE_KEY}${typesParam}${biasParam}`, { signal: AbortSignal.timeout(30000) });
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise(r2 => setTimeout(r2, [300, 800, 1500, 2500][attempt] || 2500)); continue; }
      return (d.pois || []).filter((p: any) => !/省.*市/.test(p.name || ""));
    }
    return [];
  };
  let matched = overlaps(await query("风景名胜|旅游景点"));
  if (!matched.length) matched = overlaps(await query(null));
  if (!matched.length && cityPart) {
    matched = overlaps(await query("风景名胜|旅游景点", false));
    if (!matched.length) matched = overlaps(await query(null, false));
  }
  if (!matched.length) return null;
  const top = preferScenic(matched)[0];
  const [lng, lat] = top.location.split(",").map(Number);
  return { lng, lat, name: cleanName(top.name) };
}

/** 用高德逆地理把目的地坐标反解为所在城市（裸省名时的市级检索兜底）。 */
async function cityAtPoint(lng: number, lat: number): Promise<string> {
  const r = await fetch(`https://restapi.amap.com/v3/geocode/regeo?key=${GAODE_KEY}&location=${lng},${lat}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) return "";
  const d = await r.json();
  const comp = d.regeocode?.addressComponent;
  if (!comp) return "";
  const city = String(comp.city || ""); // 直辖市的 city 可能是空数组
  if (city && city !== "[]") return city;
  return String(comp.district || comp.province || "");
}

async function regionScenicsOnce(params: string) {
  // 刻意不传 location= 偏置：实测带偏置时高德把结果聚到圆心周围，
  // "山西大同 + 恒山坐标"只返回恒山自己的子 POI（介石/财神庙/洗心亭…），
  // 华严寺、云冈石窟、都江堰、黄鹤楼这类真正该进主题游的独立景区一个都拿不到；
  // 去掉偏置后市级检索能正常覆盖全城（武汉拿到黄鹤楼/武汉大学/昙华林/晴川阁）。
  const r = await fetch(`https://restapi.amap.com/v3/place/text?${params}key=${GAODE_KEY}&types=风景名胜|旅游景点&offset=50`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.pois || [])
    .filter((p: any) => p.location && !/省.*市/.test(p.name || ""))
    .filter((p: any) => !AMUSE_RE.test(p.name || "") && !JUNK_RE.test(p.name || "") && !FACILITY_RE.test(p.name || ""))
    .map((p: any) => { const [lng, lat] = p.location.split(",").map(Number); return { lng, lat, name: cleanName(p.name) }; });
}

/**
 * 检索"目的地所在区域的其他独立景区"（v96）。
 *
 * 刻意只做市级检索、不带坐标偏置：
 * 实测带 location= 偏置时高德把结果聚到圆心周围，"山西大同 + 恒山坐标"
 * 只返回恒山自己的子 POI（介石/财神庙/洗心亭…），华严寺、都江堰、黄鹤楼
 * 这类真正该进主题游的独立景区一个都拿不到；去掉偏置后市级检索能覆盖全城
 * （武汉拿到黄鹤楼/武汉大学/昙华林/晴川阁）。省级补查方案实测无效，已撤销。
 * 超出市级范围的邻市景点（如属朔州的应县木塔）不在本函数职责内，
 * 主题游候选主要由核心点位与城市列表共同决定；远点由调用方的
 * REGION_RADIUS（60km）距离闸负责过滤。
 */
export async function gaodeRegionScenics(city: string, bias?: { lng: number; lat: number }): Promise<{ lng: number; lat: number; name: string }[]> {
  void bias; // 仅用于裸省名反解城市，不作为检索偏置；见 regionScenicsOnce 注释
  const { city: rawCityOnly } = splitRegion(city);
  const rawCity = (rawCityOnly || city).replace(/[市]$/g, "");
  const cityIsProvince = !rawCity || PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  // v96.4：裸省名（如青城山地区填"四川"）时市级参数为空，高德对
  // "types=风景名胜" 的全省查询直接返回空（要求先选城市），线上实测
  // 主题游候选为 0。改用目的地坐标逆解出所在城市（都江堰 12km 的漏检
  // 由此产生），再走正常的市级检索。
  let effectiveCity = cityIsProvince ? "" : rawCity;
  if (!effectiveCity && bias) effectiveCity = (await cityAtPoint(bias.lng, bias.lat)).replace(/[市]$/g, "");
  const query = effectiveCity ? `city=${encodeURIComponent(effectiveCity)}&citylimit=true&` : "";
  const seen = new Set<string>();
  const out: { lng: number; lat: number; name: string }[] = [];
  for (const p of await regionScenicsOnce(query).catch(() => [])) {
    const key = `${p.name}|${p.lat},${p.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export { AMUSE_RE, FACILITY_RE };
