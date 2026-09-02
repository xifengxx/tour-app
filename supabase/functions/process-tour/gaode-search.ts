import { GAODE_KEY } from "./config.ts";
import { cleanName } from "./gaode-scan.ts";
import { JUNK_RE } from "./gaode-scan.ts";

const PROV_PREFIX = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)/;
const PROV_EXACT = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)$/;
const AMUSE_RE = /动物王国|游乐园|欢乐谷|主题乐园|海洋馆|海洋公园|海昌|电影小镇|戏剧幻城|水上乐园|欢乐世界|方特|万达城|融创|游乐场|马戏|欢乐田园|迪士尼|欢乐海岸|梦幻王国|魔幻|乐园/;
const FACILITY_RE = /停车场|售票处|售票点|售票大厅|检票口|检票|门票站|乘车处|候车(?:处|亭|室)|索道(?:上站|下站|中站|入口|出口|站)?$|缆车$|观光车(?:站|场|停靠点)|游客中心|游客服务(?:点|中心)?|服务区|服务站|服务中心|管理处|管委会|委员会|居委会|村委会|派出所|加油站|银行|超市|商店|小卖部|商业街|饭店|餐厅|宾馆|酒店|客栈|民宿|山庄|农家乐|厕所|卫生间|洗手间|公厕|入口$|出口$|北门|南门|东门|西门|中门|大门|广场$|车站$|码头$|步道$|栈道$|观景台$|平台$|通道|门店|店\)|店$|综合服务|街道|步行街|(?<!故)居$|邮政|快递|营业厅|窗口|咨询|摄影|团队|散客|办事处|招商中心|营销中心|售楼处|工会|党员|人社|村委会/;

function splitRegion(t: string) {
  const sheng = t.indexOf("省");
  if (sheng > -1) return { prov: t.slice(0, sheng + 1), city: t.slice(sheng + 1) };
  const zzq = t.indexOf("自治区");
  if (zzq > -1) return { prov: t.slice(0, zzq + 3), city: t.slice(zzq + 3) };
  const m = t.match(PROV_PREFIX);
  if (m && m[0].length < t.length) return { prov: m[0], city: t.slice(m[0].length) };
  return { prov: "", city: t };
}

export async function gaode(name: string, destCity: string, bias?: { lng: number; lat: number }) {
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

export async function gaodeRegionScenics(city: string, bias?: { lng: number; lat: number }): Promise<{ lng: number; lat: number; name: string }[]> {
  const rawCity = (splitRegion(city).city || city).replace(/[市]$/g, "");
  const cityIsProvince = !!rawCity && PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  const cityPart = cityIsProvince ? "" : `city=${encodeURIComponent(rawCity)}&citylimit=true&`;
  const biasParam = bias ? `&location=${bias.lng},${bias.lat}` : "";
  const r = await fetch(`https://restapi.amap.com/v3/place/text?${cityPart}key=${GAODE_KEY}&types=风景名胜|旅游景点&offset=30${biasParam}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.pois || [])
    .filter((p: any) => p.location && !/省.*市/.test(p.name || ""))
    .filter((p: any) => !AMUSE_RE.test(p.name || "") && !JUNK_RE.test(p.name || "") && !FACILITY_RE.test(p.name || ""))
    .map((p: any) => { const [lng, lat] = p.location.split(",").map(Number); return { lng, lat, name: p.name }; });
}

export { AMUSE_RE, FACILITY_RE };
