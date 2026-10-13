export function resolveCoreDestination(tour: any, fallback: string): string {
  const current = String(fallback || "").trim();
  if (/山|峰|岭|峡|谷|风景名胜区|景区|公园|森林公园|国家公园/.test(current)) return current;

  const title = String(tour?.title || "").trim().replace(/之旅[。.]?$/, "");
  if (!current || !title.includes(current)) return current;

  const specific = title.replace(current, "").trim();
  return specific.length >= 2 && /山|峰|岭|峡|谷|风景名胜区|景区|公园|森林公园|国家公园/.test(specific)
    ? specific
    : current;
}
