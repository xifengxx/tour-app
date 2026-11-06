import { BookOpen, Landmark, Feather, Users, ScrollText, Bookmark } from 'lucide-react';

/**
 * 内容层图标映射：lucide only（DESIGN.md 规定不用 emoji）。
 * 库里 content_layers.icon 仍是 emoji 的历史数据，这里一律按 layer.id 覆盖，
 * 新建自定义层走 ScrollText / Bookmark 兜底，保证不同页面看到同一套图标。
 */
export const LAYER_ICON = { novel: BookOpen, history: Landmark, folklore: Feather, customs: Users };

export const layerIconOf = layer =>
  LAYER_ICON[layer?.id] || (String(layer?.id || '').startsWith('custom') ? ScrollText : Bookmark);
