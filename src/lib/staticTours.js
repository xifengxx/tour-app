// v99.9：静态演示导览已迁入数据库（scripts/import-static-tours.ts）。
// STATIC_TOURS 清空后，data.js/Home/useTourData 的静态分支自然失效，
// 旧 slug 链接通过 LEGACY_SLUG_REDIRECTS 跳到新的 UUID 导览。
export const STATIC_TOURS = [];

export const LEGACY_SLUG_REDIRECTS = {
  'nanyue-hengshan': '6c4c2ebe-6165-4776-b02a-ec140c6f1074', // 剑出衡山 · 南岳巡礼
  'huashan-xiaoao': 'e953e2bc-e8d7-460a-91c9-9be5998e9512', // 笑傲江湖 · 华山巡礼
};

export const STATIC_DATA = Object.fromEntries(
  STATIC_TOURS.map(tour => [tour.id, tour.file])
);
