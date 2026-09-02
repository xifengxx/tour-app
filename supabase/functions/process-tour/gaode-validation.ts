import { GAODE_KEY } from "./config.ts";

// Regeo: verify a coordinate is actually in the expected city/province.
// 返回值三态：object=坐标可解析；undefined=API 不可达；null=坐标无法解析。
export async function regeo(lng: number, lat: number) {
  try {
    const r = await fetch(`https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${GAODE_KEY}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return undefined;
    const d = await r.json();
    if (d.status === "1" && d.regeocode?.addressComponent) {
      const ac = d.regeocode.addressComponent;
      return { province: ac.province, city: ac.city, district: ac.district, adcode: ac.adcode };
    }
    return null;
  } catch {
    // API failure — skip validation, don't crash
    return undefined;
  }
}
