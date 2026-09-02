import { GAODE_KEY } from "./config.ts";

// 名称多轮清洗：剥前缀和后缀，直至稳定。
export function cleanName(n: string): string {
  let c = n.replace(/^.*风景名胜区-|^.*国家森林公园-?/, "").trim();
  c = c.replace(/[（(]\s*[）)]/g, "").trim();
  c = c.replace(/[（(](公交站|地铁站|汽车站|火车站)[）)]/g, "").trim();
  c = c.replace(/[（(](暂停开放|暂停营业|临时关闭|装修中|升级改造|暂未开放)[）)]/g, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = c.replace(/社区|游客基地|游客中心|观光电车|小火车|乘车处|候车处|售票处|上站|下站|集邮点|入口|-?观景台$|风景区$|景区$/, "").trim();
    if (next === c) break;
    c = next;
  }
  return c || n;
}

export const SCAN_RADIUS = 12000;
export const JUNK_RE = /咖啡|餐厅|奶茶|小吃|甜品|麦当劳|瑞幸|肯德基|烧仙草|汉堡|客栈|民宿|山庄|农家乐|火锅|三下锅|菜馆|私房菜|家常菜|中餐馆|餐馆|乡厨|烧烤|快餐|美食|门店|服务社|宾馆|酒店|超市|银行|加油站|KTV|健身房|旅行社|蜜雪|面包|饮品|烘焙|酸奶|烤面包|速递|快递|饭庄/;

export async function gaodeAroundScenics(lng: number, lat: number, radius = SCAN_RADIUS): Promise<{ lng: number; lat: number; name: string; raw: string }[]> {
  const ATTRACTION = /景|峰|峡|桥|梯|画廊|溪|界|寨|洞|寺|观|湖|湾|山|岭|谷|岩|石|门|瀑|泉|亭|阁|殿|庙|祠|塔|墓|园|池|林|松|海|台|田|索道|温泉|漂流|故居|书院/;
  const fetchPage = async (page: number) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/around?location=${lng},${lat}&key=${GAODE_KEY}&radius=${radius}&offset=100&page=${page}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return [];
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise(r2 => setTimeout(r2, attempt === 0 ? 300 : 800)); continue; }
      return (d.pois || [])
        .filter((p: any) => p.location && !/省.*市/.test(p.name || "") && !JUNK_RE.test(p.name || "") && ATTRACTION.test(p.name || ""))
        .map((p: any) => { const [lng2, lat2] = p.location.split(",").map(Number); return { lng: lng2, lat: lat2, name: cleanName(p.name), raw: p.name }; });
    }
    return [];
  };
  const [p1, p2, p3] = await Promise.all([fetchPage(1), fetchPage(2), fetchPage(3)]);
  const seen = new Set<string>();
  return [...p1, ...p2, ...p3].filter(c => { const k = `${c.lng},${c.lat}|${c.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// 核心景点兜底扫描：AI 二次提议可能漏掉高评分殿宇（恒山实测漏三清殿）。
// 只扫寺庙道观类型，返回原始名和评分，由调用方继续做去重、坐标范围与业务过滤。
export async function gaodeNearbyCulturalPOIs(lng: number, lat: number, radius = 5000, poiTypes = "风景名胜;风景名胜;寺庙道观"): Promise<{ lng: number; lat: number; name: string; raw: string; rating: number }[]> {
  const fetchPage = async (page: number) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/around?location=${lng},${lat}&key=${GAODE_KEY}&radius=${radius}&offset=100&page=${page}&types=${encodeURIComponent(poiTypes)}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return [];
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise(r2 => setTimeout(r2, attempt === 0 ? 300 : 800)); continue; }
      return (d.pois || [])
        .filter((p: any) => p.location && !/省.*市/.test(p.name || "") && !JUNK_RE.test(p.name || ""))
        .map((p: any) => {
          const [poiLng, poiLat] = p.location.split(",").map(Number);
          const rating = Number(p.biz_ext?.rating);
          return { lng: poiLng, lat: poiLat, name: cleanName(p.name), raw: p.name, rating: Number.isFinite(rating) ? rating : 0 };
        });
    }
    return [];
  };
  const [p1, p2] = await Promise.all([fetchPage(1), fetchPage(2)]);
  const seen = new Set<string>();
  return [...p1, ...p2].filter(c => {
    const k = `${c.lng},${c.lat}|${c.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
