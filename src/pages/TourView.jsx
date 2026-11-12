import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTourData } from '../hooks/useTourData';
import { supabase } from '../lib/supabase';
import { getErrorMessage } from '../lib/errorMessage';
import { loadAmap } from '../lib/amap';
import { useAuth } from '../contexts/AuthContext';
import NavBar from '../components/NavBar';
import { Button } from '@/components/ui/button';
import RouteBar from '../components/RouteBar';
import ContentCard from '../components/ContentCard';
import ElevationProfile from '../components/ElevationProfile';
import ThemeSectionDeck from '../components/ThemeSectionDeck';
import { ascentBetweenProf, detourCorrected, legDistanceM, walkMinutes } from '../lib/legEstimate';
import DetailModal from '../components/DetailModal';
import FavStampButton from '../components/FavStampButton';
import ShareModal from '../components/ShareModal';
import { LEGACY_SLUG_REDIRECTS } from '../lib/staticTours';
import CommentsModal from '../components/CommentsModal';
import TourPrologue from '../components/TourPrologue';
import { summarizeStory, applyStorySeed } from '../lib/story';
import { storySeedFor, hasSeedStory } from '../lib/storySeed';
import { fetchVisits, fetchFavorites, hydrateStampCache } from '../lib/visits';
import { Share2, Check, Heart, MessageCircle, MapPinned, CornerDownRight, ListTree, ChevronRight, ChevronLeft, Navigation, ScrollText } from 'lucide-react';
import { extractMarkerLoc, findNearestLocation, buildPinIcon } from '../lib/mapUtils';
import { ROUTE_COLORS, cnOrdinal } from '../lib/routeColors';
import { sectionPathPoints } from '../lib/routePath';
import { routeLegsSummary } from '../lib/routeLegs.js';

const DEFAULT_PIN_COLOR = '#a39d8c'; // 未选中标记：暖灰
const SELECTED_COLOR = '#c2402a'; // 选中标记：朱砂（亮底高对比）

// 游客藏印：未登录先存本机，登录后自动并入云端。
// 只记 tour 级收藏（与现有 favorites 表同口径），不记“到访”——到访必须另外主动盖行印。
const GUEST_FAV_KEY = 'tour-app:guest-favorites';
const readGuestFavs = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(GUEST_FAV_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch { return []; }
};
const writeGuestFavs = (ids) => {
  try { localStorage.setItem(GUEST_FAV_KEY, JSON.stringify(ids)); } catch { /* 隐私模式写不进，忽略 */ }
};

// 案头读完（或跳过）后记一笔：复访直接落地图，不再挡一屏。
const PROLOGUE_KEY = 'tour-app:prologue-seen';
const hasSeenPrologue = (tourId) => {
  try { return !!localStorage.getItem(`${PROLOGUE_KEY}:${tourId}`); } catch { return false; }
};
const markPrologueSeen = (tourId) => {
  try { localStorage.setItem(`${PROLOGUE_KEY}:${tourId}`, '1'); } catch { /* 忽略 */ }
};

// 统一给标记套上「普通 / 选中」样式。
// 未选中：统一灰色小图钉；选中：琥珀金 + 白色描边 + 放大 + 置顶。
// 之前按重要性配色（红/蓝/橙），其中橙色与选中琥珀金几乎同色，导致选中态分不清 —— 改为未选中全灰。
const applyPinStyle = (m, loc, isSel) => {
  const size = isSel ? 36 : 26;
  const color = isSel ? SELECTED_COLOR : DEFAULT_PIN_COLOR;
  m.setIcon(new window.AMap.Icon({
    size: new window.AMap.Size(size, size + 10),
    imageSize: new window.AMap.Size(size, size + 10),
    image: buildPinIcon(color, size, isSel),
  }));
  m.setOffset(new window.AMap.Pixel(-size / 2, -(size + 10)));
  m.setzIndex(isSel ? 500 : 100);
};

// 路线渐绘：选中路线时像运笔一样画出。animToken 防止切换路线时旧动画残留半截线
const animateDraw = (rp, fullPath, duration = 900) => {
  rp.animToken = (rp.animToken || 0) + 1;
  const token = rp.animToken;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    rp.polyline.setPath(fullPath);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    if (rp.animToken !== token) return; // 被新的选择打断
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - (1 - t) ** 2;
    const n = Math.max(2, Math.round(2 + (fullPath.length - 2) * eased));
    rp.polyline.setPath(fullPath.slice(0, n));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const havKm = (a, b) => {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

// 剖面和地图共用同一套“站点折线累计里程”，避免两个时间轴错位。
const routePathAtKm = (path, km) => {
  if (!path?.length) return null;
  if (path.length === 1) return path[0];
  const havKmPath = (a, b) => {
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  let total = 0;
  const distances = [0];
  for (let i = 1; i < path.length; i++) {
    total += havKmPath(path[i - 1], path[i]);
    distances.push(total);
  }
  const target = Math.max(0, Math.min(km, total));
  if (target >= total) return path[path.length - 1];
  let index = 0;
  while (index < distances.length - 2 && distances[index + 1] < target) index++;
  const segment = Math.max(distances[index + 1] - distances[index], 0.0001);
  const t = (target - distances[index]) / segment;
  return [
    path[index][0] + (path[index + 1][0] - path[index][0]) * t,
    path[index][1] + (path[index + 1][1] - path[index][1]) * t,
  ];
};

const routeTotalKm = route => Number(route?.prof?.at(-1)?.[0]) || 0;

// ── 当前站条用的少量推导 ──
// 交通方式文案与 routeLegs 同一套口径，避免两处说法不一致
const MODE_TEXT = {
  walk: '徒步',
  cableway: '索道',
  shuttle: '观光车',
  car: '专车',
  other: '接驳',
};
const MODE_SPEED_KMH = { walk: 4.2, cableway: 6, shuttle: 22, car: 30, other: 20 };

const fmtDistance = (meters) => {
  if (!Number.isFinite(meters) || meters <= 0) return '';
  if (meters < 1000) return `${Math.round(meters / 10) * 10}米`;
  return `${(meters / 1000).toFixed(1)}公里`;
};

// 到下一站的距离与预计用时。距离优先取管线算好的 leg.distanceM；
// 老数据没有 legs 时用沿线里程差，再退化为站点直连距离。时长优先用 leg.duration 文本。
const nextLegInfo = (route, stopIdx, locById) => {
  const stops = route?.stops || [];
  const fromId = stops[stopIdx];
  const toId = stops[stopIdx + 1];
  if (!fromId || !toId) return null;
  const nextLoc = locById[toId];
  if (!nextLoc) return null;

  const legs = route.legs || [];
  const leg = legs.find(l => l.fromId === fromId && l.toId === toId) || legs[stopIdx] || null;
  let mode = leg?.mode || 'walk';

  // 距离：真实路径里程差优先（与剖面同一坐标系）。leg.distanceM 是两点直线距离，
  // 山地场景会严重偏小——恒山会仙府→天峰岭直线 280m，实际步道 560m。
  const a = locById[fromId];
  const b = locById[toId];
  const straightM = a && b ? havKm(a, b) * 1000 : null;
  const rawMeters = legDistanceM(route, stopIdx, straightM);
  const meters = detourCorrected(rawMeters, straightM);
  // 里程被按直线估过，说明这两点之间没有可用的公路连接（否则驾车路径不会绕那么多），
  // 那就不该配车：庐山五老峰→三叠泉直线 3.6km，却是徒步下行（可乘小火车），不是专车。
  const noRoadLink = Number.isFinite(rawMeters) && Number.isFinite(meters) && meters !== rawMeters;

  // 存量导览的 legs.mode 是管线按"直线距离"判的：天峰岭→悬空寺直线 1.95km < 3km
  // 被判成徒步，实际 7.2km 山路。真实里程一旦超过直线 2 倍且本身超过 3km，
  // 说明这个徒步判定站不住，就地改判（其余导览重跑前也能显示正确）。
  if (mode === 'walk' && meters > 3000 && straightM > 0 && meters > straightM * 2) {
    mode = meters > 12000 ? 'car' : 'shuttle';
  }
  // 里程本身也决定交通方式：景区摆渡跑不了 12 公里以上（庐山五老峰→三叠泉
  // 真实 49.6km 仍标"观光车 135 分钟"，实际是山路专车）。只升不降。
  if (meters > 12000 && (mode === 'shuttle' || mode === 'walk')) mode = 'car';
  // 没有合理公路连接的山路段按徒步处理，覆盖上面按里程做的升格。
  if (noRoadLink) mode = 'walk';

  // 时间：徒步段按剖面里的真实爬升折算（Naismith），机动车段仍按均速。
  // 里程经绕行修正的段，剖面本身就是那条绕山公路的剖面，爬升/下降不可信
  // （庐山五老峰→三叠泉会算出"爬升 695m"，实际是下行），故不参与计时，
  // 改按山地栈道配速 3.5km/h 计。
  const kmA = stopKmInRoute(route, fromId, locById);
  const kmB = stopKmInRoute(route, toId, locById);
  const { ascent, descent } = noRoadLink
    ? { ascent: 0, descent: 0 }
    : ascentBetweenProf(route?.prof, kmA, kmB);
  let minutes = null;
  if (Number.isFinite(meters) && meters > 0) {
    if (mode === 'walk') {
      minutes = walkMinutes(meters, ascent, descent, noRoadLink ? 3.5 : 4.5);
    } else {
      const speed = MODE_SPEED_KMH[mode] || MODE_SPEED_KMH.walk;
      minutes = Math.max(1, Math.round((meters / 1000) / speed * 60));
    }
  }

  return {
    nextLoc,
    meters: Number.isFinite(meters) && meters > 0 ? meters : null,
    minutes,
    ascent: mode === 'walk' ? ascent : 0,
    mode,
    // 徒步段一律用剖面算出的时间：AI 写的"约 X 分钟"同样是平地口径，会把爬坡写成 4 分钟。
    durationText: mode === 'walk' ? '' : (leg?.duration || ''),
    note: leg?.note || '',
  };
};

// 当前站条：站在哪、下一站多远、怎么去。地图给的是“全局”，这一条给的是“下一步”。
function StopBar({ route, loc, locById, tourId, overviewStage = 0, onToggleOverview, onGoto }) {
  const total = route?.stops?.length || 0;
  const idx = loc ? route.stops.indexOf(loc.id) : -1;
  const info = idx >= 0 ? nextLegInfo(route, idx, locById) : null;
  const isLast = idx >= 0 && idx === total - 1;
  // 主题游不是线性行程，"第 N 站 / 共 14 站"会把它读成一条线；改报"哪个片区、片区内第几点"。
  const sections = (route?.sections || []).filter(s => (s.stops || []).length);
  const section = loc ? sections.find(s => (s.stops || []).includes(loc.id)) : null;
  const withinSec = section && loc ? section.stops.indexOf(loc.id) : -1;
  const nextSection = section && info?.nextLoc
    ? sections.find(s => (s.stops || []).includes(info.nextLoc.id))
    : null;
  const crossingSection = !!section && !!nextSection && nextSection !== section;

  return (
    <div className="mx-4 mb-2 rounded-lg bg-background border border-border/60 border-l-2 border-l-primary px-3 py-2">
      <div className="flex items-center gap-1.5 min-w-0">
        {section ? (
          <>
            <span className="font-serif text-[11px] font-semibold text-primary shrink-0">{section.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              · 片区内第 {withinSec + 1}/{section.stops.length} 点
            </span>
          </>
        ) : idx >= 0 ? (
          <span className="font-serif text-[11px] font-semibold text-primary shrink-0">
            第{cnOrdinal(idx)}站
          </span>
        ) : (
          <span className="font-serif text-[11px] font-semibold text-primary shrink-0">路线</span>
        )}
        {!section && <span className="text-[10px] text-muted-foreground shrink-0">/ 共 {total} 站</span>}
        <span className="text-xs font-semibold text-foreground truncate flex-1 min-w-0">
          {loc?.name || route?.title || ''}
        </span>
        {/* 藏印贴在地点名右边：收藏是地点级的小动作，看到名字时最顺手 */}
        <FavStampButton loc={loc} tourId={tourId} />
        <button
          type="button"
          onClick={onToggleOverview}
          aria-expanded={overviewStage > 0}
          aria-label={`行程概览：${['已收起', '半开', '全开'][overviewStage]}`}
          title={`行程概览（${['已收起', '半开', '全开'][overviewStage]}）`}
          className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors
            ${overviewStage > 0 ? 'text-primary bg-primary/[0.08]' : 'text-muted-foreground/70 hover:text-foreground hover:bg-black/[0.04]'}`}
        >
          <ListTree className="h-3.5 w-3.5" />
        </button>
      </div>
      {(info || isLast) && (
        <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground min-w-0">
          {isLast ? (
            <span className="text-foreground/70">
              {section ? '本片区到此结束 · 可继续看其他片区' : '已到终点站 · 本路线到此结束'}
            </span>
          ) : (
            <>
              {/* 点这一行＝跳到下一站（现场最常用的动作），右侧另给一个直接导航的入口 */}
              <button
                type="button"
                onClick={() => onGoto?.(info.nextLoc)}
                className="flex items-baseline gap-1 min-w-0 flex-1 text-left hover:text-foreground"
              >
                <CornerDownRight className="h-3 w-3 text-dai/80 shrink-0 self-center" />
                <span className="truncate text-foreground/80">
                  {crossingSection ? `下一片区 ${nextSection.name} · ${info.nextLoc.name}` : `下一站 ${info.nextLoc.name}`}
                </span>
                {info.meters && <span className="shrink-0">· {fmtDistance(info.meters)}</span>}
                <span className="shrink-0">
                  · {MODE_TEXT[info.mode] || MODE_TEXT.other} {info.durationText || (info.minutes ? `约${info.minutes}分钟${info.ascent >= 30 ? `（爬升${Math.round(info.ascent)}m）` : ''}` : '')}
                </span>
                <ChevronRight className="h-3 w-3 shrink-0 self-center" />
              </button>
              <a
                href={`https://uri.amap.com/marker?position=${info.nextLoc.lng},${info.nextLoc.lat}&name=${encodeURIComponent(info.nextLoc.name)}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`导航到${info.nextLoc.name}`}
                className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-foreground/70 hover:text-foreground"
              >
                <Navigation className="h-3 w-3" />导航
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}


const stopKmInRoute = (route, stopId, locById) => {
  if (!route || !stopId) return 0;
  const idx = route.stops.indexOf(stopId);
  if (idx <= 0) return 0;
  // 真实路径的沿线里程优先（与剖面同一坐标系）；旧数据回退站点直连累计。
  if (Array.isArray(route.path?.stopKm) && Number.isFinite(route.path.stopKm[idx])) {
    return route.path.stopKm[idx];
  }
  const stopLocs = route.stops.map(id => locById[id]).filter(Boolean);
  if (stopLocs.length < 2) return 0;
  let km = 0;
  for (let i = 1; i <= idx && i < stopLocs.length; i++) km += havKm(stopLocs[i - 1], stopLocs[i]);
  return Math.round(km * 100) / 100;
};

export default function TourView() {
  const { tourId } = useParams();
  const navigate = useNavigate();
  // v99.9：旧静态演示导览的 slug 链接 → 301 到迁入后的数据库导览
  useEffect(() => {
    const target = LEGACY_SLUG_REDIRECTS[tourId];
    if (target) navigate(`/tour/${target}`, { replace: true });
  }, [tourId, navigate]);
  const { user } = useAuth();
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const routePolylinesRef = useRef({});
  // 主题游的分段线（一条路线 → 每个片区一条线）。它不是连续动线，所以不进 routePolylinesRef，
  // 只在选中该路线时显示，避免和其他路线的连线在同一张地图上糊成一片。
  const themePolylinesRef = useRef({});
  const locByIdRef = useRef({});
  const clustererRef = useRef(null);
  const currentLocRef = useRef(null);
  const firstLayerIdRef = useRef('novel'); // 导览第一个内容层 id（泰山等自定义层导览没有 novel）
  const currentRouteIdRef = useRef(null);
  const routeProgressMarkerRef = useRef(null);
  const routeProgressTokenRef = useRef(0);
  const autoRouteAppliedRef = useRef(false); // 首屏默认锁路线的“只做一次”开关

  const [currentLoc, setCurrentLoc] = useState(null);
  const [currentLayer, setCurrentLayer] = useState('novel');
  const [currentRouteId, setCurrentRouteId] = useState(null);
  currentRouteIdRef.current = currentRouteId;
  const [showCard, setShowCard] = useState(true);
  // 主题游的一级视图是"片区卡"：展开哪个片区、是否已从片区点进单点详情。
  const [themeSectionKey, setThemeSectionKey] = useState(null);
  const [themeSpotOpen, setThemeSpotOpen] = useState(false);
  // P2-1 概览三档：0 收起 / 1 半开 / 2 全开。点「行程」逐档循环，卡片高度跟着走
  const [overviewStage, setOverviewStage] = useState(0);
  const cycleOverview = () => setOverviewStage(v => (v + 1) % 3);
  // 首访案头：初值同步判定（不等异步数据），否则会先渲染地图再切成案头，闪一下。
  const prologueRequested = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('prologue') === '1'; } catch { return false; }
  }, []);
  const prologueDismissedRef = useRef(false);
  const [showPrologue, setShowPrologue] = useState(() => {
    if (!tourId) return false;
    if (prologueRequested) return true;
    if (window.location.hash || hasSeenPrologue(tourId)) return false;
    return hasSeedStory(storySeedFor(tourId));
  });
  const [showDetail, setShowDetail] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [toast, setToast] = useState(null);
  const [mapError, setMapError] = useState('');
  const [routeConfirmations, setRouteConfirmations] = useState([]);
  const [confirmingRouteId, setConfirmingRouteId] = useState(null);
  const [routeProgressKm, setRouteProgressKm] = useState(0);

  const { tour, loading } = useTourData(tourId);

  currentLocRef.current = currentLoc; // 供 renderMarker 闭包读取最新选中态

  const cancelRouteProgressAnimation = useCallback(() => {
    routeProgressTokenRef.current += 1;
  }, []);

  const handleRouteProgressChange = useCallback((km) => {
    cancelRouteProgressAnimation();
    setRouteProgressKm(km);
  }, [cancelRouteProgressAnimation]);

  // 路线选中时从起点播放到终点；拖动剖面会打断动画并接管进度。
  const animateRouteProgress = useCallback((route, fromKm, toKm, duration = 1200) => {
    if (!route?.prof?.length) return;
    cancelRouteProgressAnimation();
    const token = routeProgressTokenRef.current;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setRouteProgressKm(toKm);
      return;
    }
    const start = performance.now();
    const tick = now => {
      if (routeProgressTokenRef.current !== token) return;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setRouteProgressKm(fromKm + (toKm - fromKm) * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [cancelRouteProgressAnimation]);

  // ── 首屏默认锁定一条路线 ──
  // 以前进来看的是一张“全域景点图”：地点条一屏列出二十多个点，游客站在山脚不知道该从哪个开始。
  // 现在：有 #r= 深链就直达那条线；没有就默认选中第一条有站点的路线，并把第壹站作为当前站。
  // 折线注册在地图异步初始化完成后才可用，用轻量轮询等待就绪（5s 超时放弃）。
  const selectRouteRef = useRef(null);

  // 同页内改 hash（粘贴分享链接到已打开的标签页）也要生效：
  // #r= 由 selectRoute 用 replaceState 写入，不会触发 hashchange，因此这里不会自激。
  useEffect(() => {
    const onHashChange = () => {
      const m = /^#r=([^&]+)$/.exec(window.location.hash || '');
      const id = m ? decodeURIComponent(m[1]) : null;
      const target = id && tour?.routes?.find(r => r.id === id);
      if (target && currentRouteIdRef.current !== target.id) selectRouteRef.current?.(target);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [tour]);

  // 换一条导览时重置“只做一次”的开关（组件实例在 /tour/a → /tour/b 之间是复用的）
  useEffect(() => {
    autoRouteAppliedRef.current = false;
  }, [tourId]);

  useEffect(() => {
    if (!tour || tour.id !== tourId || !tour.routes?.length) return;
    if (autoRouteAppliedRef.current) return;
    const hashMatch = /^#r=([^&]+)$/.exec(window.location.hash || '');
    const hashId = hashMatch ? decodeURIComponent(hashMatch[1]) : null;
    const target = hashId
      ? tour.routes.find(r => r.id === hashId)
      : (tour.routes.find(r => r.id !== 'extra' && r.stops?.length) || null);
    if (!target || target.stops.length === 0) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      if (routePolylinesRef.current[target.id]) {
        clearInterval(iv);
        autoRouteAppliedRef.current = true;
        if (currentRouteIdRef.current !== target.id) {
          // 深链是按链接来的，保持原行为（贴近起点）；首屏默认选线时不动镜头，
          // 让用户先看到整片山与这条线，再自己决定走向。
          selectRouteRef.current?.(target, { keepView: !hashMatch });
        }
      } else if (tries > 25) {
        // 折线没注册成功（路线只有一站或缺路径）也要把路线锁上，不能干等超时
        clearInterval(iv);
        if (!autoRouteAppliedRef.current) {
          autoRouteAppliedRef.current = true;
          if (currentRouteIdRef.current !== target.id) {
            selectRouteRef.current?.(target, { keepView: !hashMatch });
          }
        }
      }
    }, 200);
    return () => clearInterval(iv);
  }, [tour, tourId]);

  // 记录导览第一个内容层 id：泰山等自定义层(无 novel)时选中地点默认落到第一个层
  useEffect(() => {
    firstLayerIdRef.current = tour?.contentLayers?.[0]?.id || 'novel';
  }, [tour]);

  // 收藏状态：登录读云端；未登录读本机藏印（山上不该被登录墙拦住）
  useEffect(() => {
    if (!user) { setIsFav(readGuestFavs().includes(tourId)); return; }
    supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('tour_id', tourId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setToast(getErrorMessage(error, '收藏状态加载失败'));
        else setIsFav(!!data);
      });
  }, [user, tourId]);

  // 地点级印记（藏印/行印）：进页时用云端数据回填本地缓存，详情弹层据此显示已盖的印
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const [v, f] = await Promise.all([fetchVisits(), fetchFavorites()]);
        if (alive) hydrateStampCache({ visits: v, favs: f });
      } catch {
        // 读不到就沿用本地缓存，不打扰用户
      }
    })();
    return () => { alive = false; };
  }, [user]);

  // 登录后把本机藏印并进云端，成功才清本机（失败留着下次再试，不打扰用户）
  useEffect(() => {
    if (!user) return;
    const pending = readGuestFavs().filter(Boolean);
    if (!pending.length) return;
    (async () => {
      const rows = pending.map(id => ({ user_id: user.id, tour_id: id }));
      const { error } = await supabase.from('favorites').insert(rows);
      if (error && error.code !== '23505') return; // 非"已存在"的错误：保留本机数据待重试
      writeGuestFavs([]);
      if (pending.includes(tourId)) setIsFav(true);
    })();
  }, [user, tourId]);

  const selectLoc = useCallback((loc) => {
    if (currentRouteIdRef.current) {
      const activeRoute = tour?.routes?.find(route => route.id === currentRouteIdRef.current);
      cancelRouteProgressAnimation();
      setRouteProgressKm(stopKmInRoute(activeRoute, loc.id, locByIdRef.current));
      // 主题游：点进某个点＝进入该片区的单点详情（二级），并记住属于哪个片区
      const secs = (activeRoute?.sections || []).filter(s => (s.stops || []).length);
      if (secs.length >= 2) {
        const sec = secs.find(s => (s.stops || []).includes(loc.id));
        if (sec) {
          setThemeSectionKey(sec.key);
          setThemeSpotOpen(true);
        }
      }
    }
    setCurrentLoc(loc);
    setCurrentLayer(firstLayerIdRef.current);
    setShowCard(true);
    const map = mapInstance.current;
    if (map) {
      if (map.panTo) map.panTo([loc.lng, loc.lat]);
      else map.setCenter([loc.lng, loc.lat]);
      map.setZoom(16);
    }
  }, [tour, cancelRouteProgressAnimation]);

  // 主题游：展开一个片区时把地图缩到该片区。全区域视图下每个片区只有几个像素，
  // 看图等于没看；片区才是主题游里"一次要玩的地方"。
  const focusSection = useCallback((section) => {
    const map = mapInstance.current;
    if (!map || !section?.stops?.length) return;
    const pts = section.stops
      .map(id => locByIdRef.current[id])
      .filter(l => l && Number.isFinite(l.lng) && Number.isFinite(l.lat))
      .map(l => [l.lng, l.lat]);
    if (!pts.length) return;
    if (pts.length === 1) { map.setZoomAndCenter(15, pts[0]); return; }
    const lngs = pts.map(p => p[0]); const lats = pts.map(p => p[1]);
    const sw = [Math.min(...lngs), Math.min(...lats)];
    const ne = [Math.max(...lngs), Math.max(...lats)];
    if (window.AMap?.Bounds) {
      map.setBounds(new window.AMap.Bounds(sw, ne), false, [60, 60, 160, 60]);
    } else {
      map.setFitView();
    }
  }, []);

  const toggleFav = async () => {
    if (!user) {
      const cur = readGuestFavs();
      const next = cur.includes(tourId) ? cur.filter(id => id !== tourId) : [...cur, tourId];
      writeGuestFavs(next);
      const on = next.includes(tourId);
      setIsFav(on);
      setToast(on ? '已盖藏印 · 存本机，登录后自动同步' : '已取消本机藏印');
      return;
    }
    if (isFav) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', user.id).eq('tour_id', tourId);
      if (error) { setToast(getErrorMessage(error, '取消收藏失败')); return; }
      setIsFav(false);
    } else {
      const { error } = await supabase.from('favorites').insert({ user_id: user.id, tour_id: tourId });
      if (error) { setToast(getErrorMessage(error, '收藏失败')); return; }
      setIsFav(true);
    }
  };

  const routeFingerprint = (route) => (route?.stops || []).join('|');

  // 创作者路线确认：不阻断发布，只把“看过并认可”的路线沉淀成同目的地可复用知识。
  useEffect(() => {
    if (!user || !tourId || !tour?.userId || tour.userId !== user.id) {
      setRouteConfirmations([]);
      return;
    }
    let cancelled = false;
    supabase
      .from('route_confirmations')
      .select('id, route_id, stops, route_fingerprint, created_at')
      .eq('tour_id', tourId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setToast(getErrorMessage(error, '路线确认状态加载失败'));
        else setRouteConfirmations(data || []);
      });
    return () => { cancelled = true; };
  }, [user, tourId, tour?.userId]);

  const confirmRoute = async (route) => {
    if (!user) { navigate('/login'); return; }
    if (!route?.stops?.length || !tour?.destination?.name) return;
    setConfirmingRouteId(route.id);
    const destinationName = String(tour.destination.name || '').trim();
    const aliases = [...new Set([
      destinationName,
      String(tour.destination.region || '').trim(),
      destinationName.replace(/之旅[。.]?$/, ''),
    ])].filter(Boolean);
    const stops = route.stops
      .map(id => locByIdRef.current[id])
      .filter(loc => loc?.name)
      .map(loc => ({
        name: loc.name,
        aliases: [loc.name],
        ...(loc.lat && loc.lng ? { lat: loc.lat, lng: loc.lng } : {}),
      }));
    if (stops.length < 2) {
      setConfirmingRouteId(null);
      setToast('路线至少需要两个有效地点才能确认');
      return;
    }
    const { data, error } = await supabase.from('route_confirmations').insert({
      // v99.9 根修：此前载荷缺 user_id——RLS 的 WITH CHECK 是
      // user_id = auth.uid()，NULL 永远不等于任何 uuid，插入必被拒。
      // 也就是说"创作者确认"自 v83 上线起从未成功写入过一条（0 行的真因）。
      user_id: user.id,
      tour_id: tourId,
      route_id: route.id,
      route_label: [route.day, route.title].filter(Boolean).join(' · '),
      destination_name: destinationName,
      destination_aliases: aliases,
      stops: stops.map(loc => loc.name),
      legs: route.legs || [],
      route_model: {
        zones: [],
        trails: [{
          id: `confirmed-${route.id}`,
          aliases,
          stops,
          notes: route.narrative || '',
        }],
        edges: (route.legs || []).map(leg => ({
          from: leg.fromName,
          to: leg.toName,
          mode: leg.mode || 'walk',
          duration: leg.duration || '',
          note: leg.note || '',
        })),
      },
      warnings: [],
      route_fingerprint: routeFingerprint(route),
      source: 'creator-confirmed',
      confidence: 0.85,
    }).select('id, route_id, stops, route_fingerprint, created_at').single();
    setConfirmingRouteId(null);
    if (error) {
      // RLS 拒绝几乎都是登录态过期（前端缓存的 user 还在，JWT 已不被接受）
      setToast(String(error?.message || '').includes('row-level security')
        ? '登录状态已过期，请退出后重新登录，再点一次确认'
        : getErrorMessage(error, '路线确认失败'));
      return;
    }
    setRouteConfirmations(prev => [data, ...prev]);
    setToast('路线确认已沉淀，后续同目的地导览可复用');
  };

  // Init map
  useEffect(() => {
    if (!tour || mapInstance.current) return;
    let cancelled = false;
    const init = () => {
      if (cancelled) return;
      const bounds = tour.destination?.bounds;
      const center = bounds
        ? [(bounds[0][1] + bounds[1][1]) / 2, (bounds[0][0] + bounds[1][0]) / 2]
        : [104.0, 35.0]; // no coords yet (e.g. draft tour): default to China overview
      const map = new window.AMap.Map(mapRef.current, {
        center,
        zoom: 12, resizeEnable: true,
        mapStyle: 'amap://styles/whitesmoke' // 白烟底图：与宣纸色系同源，标记更突出
      });
      mapInstance.current = map;
      setMapError('');
      requestAnimationFrame(() => map.resize());

      // 地点标记 + 聚合：AMap 2.0 用 AMap.MarkerCluster（注意不是旧版 MarkerClusterer）。
      // 缩小地图时邻近点聚合成带数字气泡，放大才拆分为单个标记。
      locByIdRef.current = {};
      tour.locations.forEach(l => { locByIdRef.current[l.id] = l; });
      window.AMap.plugin('AMap.MarkerCluster', () => {
        if (cancelled) return;
        const points = tour.locations.map(l => ({ lnglat: [l.lng, l.lat], extData: l }));
        const clusterer = new window.AMap.MarkerCluster(map, points, {
          gridSize: 60,
          maxZoom: 15,
          renderMarker: (ctx) => {
            // ctx.data 提取逻辑见 mapUtils.extractMarkerLoc（回归测试覆盖）
            const loc = extractMarkerLoc(ctx.data, tour.locations, () => ctx.marker.getPosition());
            const m = ctx.marker;
            const isSel = currentLocRef.current && loc.id === currentLocRef.current.id;
            applyPinStyle(m, loc, isSel);
            m._locData = loc;
            m.on('click', () => selectLoc(loc));
            markersRef.current.push(m);
          },
          renderClusterMarker: (ctx) => {
            const m = ctx.marker;
            const n = ctx.count;
            const d = n >= 100 ? 52 : n >= 10 ? 44 : 36;
            m.setContent(`<div style="width:${d}px;height:${d}px;border-radius:50%;background:rgba(194,64,42,.9);border:2px solid rgba(253,249,240,.9);color:#fdf9f0;font-weight:700;font-size:${d >= 44 ? 15 : 13}px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.2);cursor:pointer">${n}</div>`);
            m.setSize(new window.AMap.Size(d, d));
            m.on('click', () => {
              // 点击聚合气泡 → 选中簇内最近的地点：内容栏立即更新并放大到该点，
              // 与点击单个标记行为一致（否则默认视图下点气泡只缩放不选中，用户会以为点不动）
              const pos = m.getPosition();
              const nearest = findNearestLocation(tour.locations, pos);
              if (nearest) selectLoc(nearest);
            });
          },
        });
        clustererRef.current = clusterer;
      });

      // Draw routes
      (tour.routes || []).forEach((route, ri) => {
        if (route.id === 'extra') return;
        // 主题游不是一条线性动线：把一个片区内的点连起来、片区之间不连。
        // 原来所有站点共用一条 60km 的连续路径，"一日游的点 + 周边景区"在地图上被画成
        // 一条线，读起来就是"一趟走完"，与它的语义（几个景区可以连着玩）相反。
        const themeSecs = (route.sections || []).filter(sec => (sec.stops || []).length >= 2);
        if (themeSecs.length >= 2) {
          themePolylinesRef.current[route.id] = [];
          themeSecs.forEach((sec, si) => {
            // 优先切真实路径（path.geom），切开后才是山路/道路上的线，
            // 而不是穿过山体的三角形；没有路径数据才回退站点直连。
            const realPath = sectionPathPoints(route, sec, locByIdRef.current);
            const secPath = realPath && realPath.length > 1
              ? realPath
              : sec.stops.map(id => {
                  const l = locByIdRef.current[id];
                  return l ? [l.lng, l.lat] : null;
                }).filter(Boolean);
            if (secPath.length > 1) {
              const poly = new window.AMap.Polyline({
                path: secPath, map,
                strokeColor: ROUTE_COLORS[(ri + si) % ROUTE_COLORS.length],
                strokeWeight: 4, strokeOpacity: 0.75, // 片区线要在全区域缩放下仍看得出是"一段"
                lineJoin: 'round',
              });
              poly.hide(); // 只在选中这条主题游时显示
              if (currentRouteIdRef.current === route.id) poly.show(); // 深链首屏已选这条，先画出来
              themePolylinesRef.current[route.id].push(poly);
            }
          });
          // 片区之间不画线：那是车程/接驳，不是步行动线。
          return;
        }
        // v99：优先用服务端规划的高德真实路径（routes.path.geom），
        // 旧数据/回退时才用站点直连。
        const path = (Array.isArray(route.path?.geom) && route.path.geom.length > 1)
          ? route.path.geom
          : route.stops.map(id => {
              const l = locByIdRef.current[id];
              return l ? [l.lng, l.lat] : null;
            }).filter(Boolean);
        if (path.length > 1) {
          const poly = new window.AMap.Polyline({
            path, map,
            strokeColor: ROUTE_COLORS[ri % ROUTE_COLORS.length],
            strokeWeight: 3, strokeOpacity: 0.35, // 默认降透明度：多路线共享站点时避免交织成网，选中才高亮
          });
          routePolylinesRef.current[route.id] = {
            polyline: poly, route,
            color: ROUTE_COLORS[ri % ROUTE_COLORS.length],
            path, // 完整路径，渐绘动画/打断恢复用
          };
        }
      });

      routeProgressMarkerRef.current = new window.AMap.Marker({
        position: tour.locations[0] ? [tour.locations[0].lng, tour.locations[0].lat] : [104, 35],
        map,
        offset: new window.AMap.Pixel(-7, -7),
        content: '<div style="width:14px;height:14px;border-radius:50%;background:#c2402a;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25)"></div>',
        zIndex: 600,
      });
      routeProgressMarkerRef.current.hide();

      // 标记由 MarkerCluster 托管，setFitView 未必生效——直接从地点坐标算边界
      const lngs = tour.locations.map(l => l.lng);
      const lats = tour.locations.map(l => l.lat);
      if (lngs.length > 0) {
        map.setBounds(new window.AMap.Bounds(
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)]
        ));
      }
      setTimeout(() => setShowCard(true), 500);
    };
    loadAmap().then(init).catch(error => {
      if (!cancelled) setMapError(getErrorMessage(error, '地图加载失败，请检查网络或稍后重试。'));
    });
    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.destroy();
        mapInstance.current = null;
      }
      markersRef.current = [];
      routePolylinesRef.current = {};
      themePolylinesRef.current = {};
      routeProgressMarkerRef.current = null;
      routeProgressTokenRef.current += 1;
    };
  }, [tour, selectLoc]);

  // 选中态变化 → 刷新所有标记的「选中 / 普通」样式（选中地点琥珀金高亮）
  useEffect(() => {
    markersRef.current.forEach(m => {
      const ld = m._locData;
      if (!ld || !ld.id) return;
      const isSel = currentLoc && ld.id === currentLoc.id;
      applyPinStyle(m, ld, isSel);
    });
  }, [currentLoc]);

  // ── Actions ──

  const selectRoute = useCallback((route, opts = {}) => {
    if (!route || !route.stops || route.stops.length === 0) {
      setCurrentRouteId(null);
      setCurrentLoc(null);
      markersRef.current.forEach(m => m.setOptions({ opacity: 1 }));
      Object.values(routePolylinesRef.current).forEach(rp => {
        rp.animToken = (rp.animToken || 0) + 1; // 打断进行中的渐绘
        if (rp.path) rp.polyline.setPath(rp.path); // 恢复完整路径
        rp.polyline.setOptions({ strokeOpacity: 0.6, strokeWeight: 4 });
        rp.polyline.show();
      });
      if (mapInstance.current) mapInstance.current.setFitView();
      return;
    }

    const newId = currentRouteId === route.id ? null : route.id;
    setCurrentRouteId(newId);
    // 深链同步：选中路线写入 #r=，取消选中还原干净地址（分享/刷新都落在同一路线）。
    // 首屏默认选线（keepView）不写 hash：否则刷新会从“全览”跳成“贴到起点”，两版体验不一致。
    try {
      const keepHash = opts.keepView && window.location.hash;
      window.history.replaceState(
        null,
        '',
        newId && !opts.keepView ? `${window.location.pathname}#r=${encodeURIComponent(newId)}` : (keepHash || window.location.pathname)
      );
    } catch { /* 忽略沙箱环境下的 history 异常 */ }
    const firstStop = newId ? locByIdRef.current[route.stops[0]] : null;
    // 主题游首屏不预选任何单点：一级视图是片区卡，单点详情是点进去之后的二级。
    const themeRoute = (route?.sections || []).filter(s => (s.stops || []).length).length >= 2;
    if (themeRoute) {
      setThemeSectionKey(null);
      setThemeSpotOpen(false);
    }
    setCurrentLoc(themeRoute ? null : firstStop);
    if (!themeRoute && firstStop) { setCurrentLayer(firstLayerIdRef.current); setShowCard(true); }
    if (themeRoute) setShowCard(true);

    Object.entries(routePolylinesRef.current).forEach(([rid, rp]) => {
      if (!newId || rid === newId) {
        rp.polyline.setOptions({ strokeOpacity: 0.8, strokeWeight: 5 });
        rp.polyline.show();
      } else {
        rp.polyline.setOptions({ strokeOpacity: 0.15, strokeWeight: 2 });
      }
    });
    // 主题游的分段线只显示当前选中那条
    Object.entries(themePolylinesRef.current).forEach(([rid, list]) => {
      list.forEach(poly => { if (!newId || rid === newId) poly.show(); else poly.hide(); });
    });

    if (newId) {
      const stopIds = route.stops;
      markersRef.current.forEach(m => {
        m.setOptions({ opacity: stopIds.includes(m._locData?.id) ? 1 : 0.2 });
      });
      // 运笔渐绘：选中的路线从第一站画出
      const rp = routePolylinesRef.current[newId];
      if (rp?.path) animateDraw(rp, rp.path);
      // 海拔剖面联动：路线选中后红色圆点从起点播到终点
      routeProgressMarkerRef.current?.show();
      animateRouteProgress(route, 0, routeTotalKm(route));
      const map = mapInstance.current;
      if (!map) return;
      const firstLoc = locByIdRef.current[route.stops[0]];
      if (firstLoc && !opts.keepView) {
        map.setZoomAndCenter(14, [firstLoc.lng, firstLoc.lat]);
      }
    } else {
      markersRef.current.forEach(m => m.setOptions({ opacity: 1 }));
      routeProgressMarkerRef.current?.hide();
      setRouteProgressKm(0);
      Object.values(routePolylinesRef.current).forEach(rp => {
        rp.animToken = (rp.animToken || 0) + 1;
        if (rp.path) rp.polyline.setPath(rp.path);
      });
      if (mapInstance.current) mapInstance.current.setFitView();
    }
  }, [currentRouteId, animateRouteProgress]);

  selectRouteRef.current = selectRoute;

  // ── Computed ──
  const filteredLocations = currentRouteId
    ? (tour?.routes.find(r => r.id === currentRouteId)?.stops || [])
        .map(id => locByIdRef.current[id]).filter(Boolean)
    : (tour?.locations || []);
  const activeRoute = currentRouteId ? (tour?.routes || []).find(r => r.id === currentRouteId) : null;
  // 主题游有 ≥2 个片区 = 它不是一条线性行程，UI 要按片区呈现，且不再显示 1..N 站条。
  const isThemeRoute = (activeRoute?.sections || []).filter(s => (s.stops || []).length).length >= 2;

  // 案头摘要从 tour.locations 派生（不能用 locByIdRef：可变 ref 不会触发重渲染）。
  // 库里的 timeline/figures 还没建列时，用仓库 JSON 兜底，保证本地就能看到完整案头。
  const prologueLocById = useMemo(() => {
    const base = Object.fromEntries((tour?.locations || []).map(l => [l.id, l]));
    return applyStorySeed(base, storySeedFor(tourId));
  }, [tour, tourId]);
  // 案头聚合不能只看路线站点：行前案头讲的是「这座山怎么变成今天这样」，
  // 东林寺、白鹿洞、美庐这类不在当日路线上的地点同样该进案头。
  // 站点序列 = 路线站点（优先） + 其余带案头内容的地点。
  const prologueRoute = useMemo(() => {
    const base = activeRoute || tour?.routes?.[0];
    if (!base) return base;
    const stops = [...(base.stops || [])];
    const seen = new Set(stops);
    for (const l of tour?.locations || []) {
      if (seen.has(l.id)) continue;
      const has = (l.timeline?.length || 0) + (l.figures?.length || 0) > 0;
      if (!has) continue;
      stops.push(l.id);
      seen.add(l.id);
    }
    return stops.length === (base.stops || []).length ? base : { ...base, stops };
  }, [activeRoute, tour]);

  const storySummary = useMemo(
    () => summarizeStory(prologueRoute, prologueLocById),
    [prologueRoute, prologueLocById],
  );

  // 首访先读案头再进地图；读过一次（或带路线 hash 的分享链接）就直接给地图。
  // 不要用「检查一次就永久置位」的 ref：进页时路线还没锁定，has 一开始是 false，
  // 会被误判成「这条线没有案头」而永远不弹。改为等数据到位再补弹，用户关闭后才彻底不再弹。
  useEffect(() => {
    if (!tour || !tourId) return;
    if (prologueDismissedRef.current) return;
    if (hasSeenPrologue(tourId) || window.location.hash) return;
    if (!storySummary.has) return;
    setShowPrologue(true);
  }, [tour, tourId, storySummary.has]);

  // 从「开始导览 / 跳过」两个出口离开案头：记住已读，并把 ?prologue=1 清掉
  const closePrologue = useCallback(() => {
    prologueDismissedRef.current = true;
    markPrologueSeen(tourId);
    setShowPrologue(false);
    if (window.location.search) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  }, [tourId]);

  // 剖面按交通方式分段：里程与剖面共用同一套沿线累计（path.stopKm），避免图和字对不上。
  const routeSegments = (() => {
    const stops = activeRoute?.stops || [];
    if (stops.length < 2) return null;
    const total = routeTotalKm(activeRoute);
    const legs = activeRoute.legs || [];
    const out = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const fromKm = stopKmInRoute(activeRoute, stops[i], locByIdRef.current);
      let toKm = stopKmInRoute(activeRoute, stops[i + 1], locByIdRef.current);
      if (!Number.isFinite(toKm) || toKm <= fromKm) {
        toKm = i + 1 === stops.length - 1 ? total : fromKm;
      }
      if (toKm <= fromKm) continue;
      const leg = legs.find(l => l.fromId === stops[i] && l.toId === stops[i + 1]) || legs[i] || null;
      out.push({ fromKm, toKm: total ? Math.min(toKm, total) : toKm, mode: leg?.mode || 'walk' });
    }
    return out;
  })();

  // 红色进度圆点位置随 routeProgressKm 同步到地图路线
  useEffect(() => {
    if (!activeRoute) return;
    const path = routePolylinesRef.current[activeRoute.id]?.path;
    if (!path) return;
    const pos = routePathAtKm(path, routeProgressKm);
    if (!pos || Number.isNaN(pos[0]) || Number.isNaN(pos[1])) return;
    routeProgressMarkerRef.current?.setPosition(pos);
  }, [routeProgressKm, activeRoute]);

  const activeRouteConfirmed = activeRoute
    && routeConfirmations.some(row => (
      row.route_id === activeRoute.id
      && (row.route_fingerprint || (row.stops || []).join('|')) === routeFingerprint(activeRoute)
    ));

  // ── Render ──
  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">加载中...</div>;
  if (!tour) return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">未找到导览</div>;

  return (
    <div className="h-screen flex flex-col bg-background relative">
      {/* NavBar + subtitle */}
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
        <NavBar
          title={tour.meta.title}
          rightContent={
            <div className="flex items-center gap-0.5">
              {/* 案头常驻入口：和收藏/评论/分享同一排，属于「这条线的内容」，不占站条工具区 */}
              {storySummary.has && (
                <Button variant="ghost" size="icon" onClick={() => setShowPrologue(true)} title="行前案头 · 时代演变与人物">
                  <ScrollText className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={toggleFav} title={isFav ? '取消收藏' : '收藏'}>
                <Heart className={`h-4 w-4 ${isFav ? 'fill-primary text-primary' : ''}`} />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setShowComments(true)} title="评论">
                <MessageCircle className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setShowShare(true)} title="分享导览">
                <Share2 className="h-4 w-4" />
              </Button>
              {user && tour.userId === user.id && (
                <Button variant="secondary" size="sm" className="ml-1" onClick={() => navigate(`/tour/${tourId}/edit`)}>
                  编辑
                </Button>
              )}
            </div>
          }
        />
        <div className="px-4 pb-2 bg-gradient-to-b from-background to-transparent pointer-events-none">
          <p className="text-muted-foreground text-xs">{tour.meta.subtitle}</p>
        </div>
      </div>

      <RouteBar routes={tour.routes} currentRouteId={currentRouteId} onSelectRoute={selectRoute} />

      {/* Map */}
      <div className="relative flex-1 min-h-0">
        <div ref={mapRef} className="absolute inset-0 h-full w-full" />
        {/* 主题游不画海拔剖面：它不是一个连续行程（恒山主题游把 6 个片区串成 392km），
            画出来会读成"一天走了 392 公里、爬升 2.7km"，与事实相反。 */}
        {activeRoute?.prof?.length > 1 && !isThemeRoute && (
          <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-auto">
            <ElevationProfile
              prof={activeRoute.prof}
              activeKm={routeProgressKm}
              onProgressChange={handleRouteProgressChange}
              segments={routeSegments}
              stops={(activeRoute.stops || []).map(id => locByIdRef.current[id]).filter(Boolean).map(l => [l.lng, l.lat])}
            />
          </div>
        )}
        {mapError && (
          <div role="alert" className="absolute inset-0 flex items-center justify-center bg-background/85 px-6 text-center text-sm text-primary">
            {mapError}
          </div>
        )}
      </div>

      {/* Bottom card zone — 手卷式卡片：置于正常文档流而非覆盖地图，地图容器止于卡片上缘，
          高德版权条不再压在卡片底部内容上；卡片折叠时地图随之扩展 */}
      <div
        className="z-20 bg-card rounded-t-2xl flex flex-col border-t border-x border-border shadow-[0_-10px_32px_-14px_rgba(28,26,22,0.3)] safe-bottom transition-[max-height] duration-300 ease-out"
        style={{ maxHeight: ['50vh', '64vh', '88vh'][overviewStage] }}
      >
        {/* 卷轴杆拉手：两端轴头 + 杆身 */}
        <div className="flex justify-center items-center gap-1.5 py-2.5 cursor-pointer" onClick={() => setShowCard(s => !s)}>
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
          <div className="w-10 h-1 rounded-full bg-black/15" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
        </div>

        {showCard && (
          <div className="anim-content flex flex-col flex-1 min-h-0">
            {/* 当前站条：第几站 / 下一站多远、怎么去。主题游不适用——它没有"当前站" */}
            {!isThemeRoute && activeRoute && (
              <StopBar
                route={activeRoute}
                loc={currentLoc}
                locById={locByIdRef.current}
                tourId={tourId}
                overviewStage={overviewStage}
                onToggleOverview={cycleOverview}
                onGoto={selectLoc}
              />
            )}

            {/* 主题游一级视图：片区卡。点进单点后收起，让详情独占卡片，返回时再展开。 */}
            {isThemeRoute && !themeSpotOpen && (
              <ThemeSectionDeck
                sections={activeRoute?.sections}
                locationsById={locByIdRef.current}
                legs={activeRoute?.legs || []}
                activeKey={themeSectionKey}
                spotId={themeSpotOpen ? currentLoc?.id : null}
                onSelectSection={(key, group) => {
                  setThemeSectionKey(key);
                  setThemeSpotOpen(false);
                  if (key) focusSection(group);
                }}
                onSelectSpot={(id) => { const loc = locByIdRef.current[id]; if (loc) selectLoc(loc); }}
              />
            )}

            {/* 行程概览（卷首语 / 交通分段）：默认收起，把高度让给正文 */}
            {overviewStage > 0 && (
            <div className={`pb-2 shrink-0 overflow-y-auto overscroll-contain ${overviewStage === 2 ? 'max-h-[62vh]' : 'max-h-[30vh]'}`}>
            {/* Route narrative · 卷首语：完整行程描述（入口/交通方式/出口） */}
            {activeRoute?.narrative && (
              <div className="px-4 pb-2">
                <p className="font-kai text-xs text-muted-foreground leading-relaxed bg-background rounded-lg p-3 border-l-2 border-dai">{activeRoute.narrative}</p>
              </div>
            )}
            {activeRoute?.legs?.length > 0 && (
              <div className="px-4 pb-2">
                <p className="text-[11px] leading-relaxed text-muted-foreground bg-background rounded-lg p-2 border border-border/60">
                  <span className="font-semibold text-foreground/70">交通概况：</span>{routeLegsSummary(activeRoute.legs)}
                </p>
              </div>
            )}
            </div>
            )}
            {/* 创作者路线确认：留在概览之外，不影响普通游客的阅读区 */}
            {user && tour.userId === user.id && activeRoute && (
              <div className="px-4 pb-2">
                {activeRouteConfirmed ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background rounded-lg p-2 border border-border/60">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    当前路线已确认为可复用知识；修改站点后需重新确认
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 bg-background rounded-lg p-2 border border-border/60">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">这条路线正确吗？</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        确认只沉淀路线知识，不影响本导览发布
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={confirmingRouteId === activeRoute.id || activeRoute.stops.length < 2}
                      onClick={() => confirmRoute(activeRoute)}
                    >
                      {confirmingRouteId === activeRoute.id ? '确认中…' : '确认正确'}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {/* Location strip · 壹贰叁编号 — 右缘渐变提示可横向滚动查看更多。
                主题游不渲染：它不是一个 1..N 的线性序列，编号会把人误读成"一条线路"，
                片区内的点由上面的分区视图承载。 */}
            {!isThemeRoute && (
            <div className="flex gap-2 px-4 pb-2 overflow-x-auto"
                 style={{ WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)', maskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)' }}>
              {filteredLocations.map((loc, i) => (
                <button
                  key={loc.id}
                  onClick={() => selectLoc(loc)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all hover:-translate-y-px
                    ${currentLoc?.id === loc.id ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-black/[0.04] text-muted-foreground border border-transparent'}`}
                >
                  <span className={`font-serif font-semibold mr-1 ${currentLoc?.id === loc.id ? 'text-primary' : 'text-gamboge'}`}>{cnOrdinal(i)}</span>
                  {loc.name}
                </button>
              ))}
            </div>
            )}

            {/* 主题游：单点详情是二级视图，顶部给一条明确的"返回片区"导航。
                原来只有一行 10px 灰字，和下面的四层 Tab 一比几乎没有存在感，
                用户找不到回去的路，所以做成整行可点的按钮条。 */}
            {isThemeRoute && themeSpotOpen && currentLoc && (() => {
              const secs = activeRoute?.sections || [];
              const idx = secs.findIndex(s => s.key === themeSectionKey);
              const sec = idx >= 0 ? secs[idx] : null;
              // 片区内的邻点：按片区自己的顺序走，不跨片区。
              const rawIds = sec?.stopIds || sec?.stops || [];
              const ids = rawIds.filter(id => locByIdRef.current[id]);
              const pos = ids.indexOf(currentLoc.id);
              const prev = pos > 0 ? locByIdRef.current[ids[pos - 1]] : null;
              const next = pos >= 0 && pos < ids.length - 1 ? locByIdRef.current[ids[pos + 1]] : null;
              const navBtn = 'flex h-full w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-foreground active:bg-black/[0.04] disabled:opacity-30 disabled:active:bg-background';
              // 宽度收到 26rem：桌面宽屏下不再横贯整行，移动端仍自动收缩占满。
              return (
                <div className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] max-w-[26rem] items-stretch gap-1.5">
                  <button
                    type="button"
                    onClick={() => setThemeSpotOpen(false)}
                    className="flex flex-1 min-w-0 items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.05] px-3 py-2.5 active:bg-primary/10 transition-colors"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15">
                      <ChevronLeft className="h-4 w-4 text-primary" />
                    </span>
                    <span className="flex-1 min-w-0 text-left leading-tight">
                      <span className="block text-[10px] text-muted-foreground">返回片区</span>
                      <span className="block text-xs font-serif font-semibold text-foreground truncate">
                        {sec ? `${cnOrdinal(idx)} ${sec.name}` : '全部片区'}
                      </span>
                    </span>
                    {sec && pos >= 0 && (
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {pos + 1}/{ids.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => prev && selectLoc(prev)}
                    disabled={!prev}
                    aria-label="上一个地点"
                    className={navBtn}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => next && selectLoc(next)}
                    disabled={!next}
                    aria-label="下一个地点"
                    className={navBtn}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              );
            })()}

            {currentLoc && (isThemeRoute ? themeSpotOpen : true) ? (
              <ContentCard
                key={currentLoc.id}
                loc={currentLoc}
                layer={currentLayer}
                layers={tour.contentLayers}
                onLayerChange={setCurrentLayer}
                onShowDetail={setShowDetail}
                tourId={tourId}
              />
            ) : isThemeRoute ? null : (
              <div className="flex-1 flex items-center justify-center text-center px-4 pb-6">
                <div>
                  <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-border bg-background flex items-center justify-center">
                    <MapPinned className="h-6 w-6 text-primary/70" />
                  </div>
                  <p className="text-muted-foreground text-sm">点击地图标记或上方地点<br/>查看此地的小说场景与人文故事</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showDetail && (
        <DetailModal
          loc={currentLoc}
          layers={tour.contentLayers}
          tourId={tourId}
          onClose={() => setShowDetail(false)}
        />
      )}

      {showPrologue && (
        <TourPrologue
          tour={tour}
          route={prologueRoute || tour?.routes?.[0]}
          locById={prologueLocById}
          loading={!tour}
          onStart={closePrologue}
          onLookMap={closePrologue}
        />
      )}

      {showShare && <ShareModal tour={tour} tourId={tourId} onClose={() => setShowShare(false)} routeId={currentRouteId} />}

      {showComments && <CommentsModal tourId={tourId} onClose={() => setShowComments(false)} />}

      {/* Toast */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-card border border-border rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Check className="h-4 w-4 text-green-700" />
          <span className="text-sm text-foreground">{toast}</span>
        </div>
      )}
    </div>
  );
}
