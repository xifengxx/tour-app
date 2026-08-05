// 「纸上山河」路线国画五色 —— TourView 与 RouteBar 共用，避免两处常量漂移
export const ROUTE_COLORS = ['#c2402a', '#2f4f4a', '#9c6b3c', '#5b7a5e', '#c9973f']; // 朱砂/黛青/赭石/苍绿/藤黄

// 地点序号：壹贰叁…（地点条 chip 用），超过 20 回退阿拉伯数字
const CN_NUMS = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾',
  '拾壹', '拾贰', '拾叁', '拾肆', '拾伍', '拾陆', '拾柒', '拾捌', '拾玖', '贰拾'];
export const cnOrdinal = (i) => CN_NUMS[i] || String(i + 1);
