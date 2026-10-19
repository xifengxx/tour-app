import { useState, useEffect, useRef, useCallback } from 'react';
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
import ThemeSections from '../components/ThemeSections';
import DetailModal from '../components/DetailModal';
import ShareModal from '../components/ShareModal';
import { LEGACY_SLUG_REDIRECTS } from '../lib/staticTours';
import CommentsModal from '../components/CommentsModal';
import { Share2, Check, Heart, MessageCircle, MapPinned } from 'lucide-react';
import { extractMarkerLoc, findNearestLocation, buildPinIcon } from '../lib/mapUtils';
import { ROUTE_COLORS, cnOrdinal } from '../lib/routeColors';

const DEFAULT_PIN_COLOR = '#a39d8c'; // 未选中标记：暖灰
const SELECTED_COLOR = '#c2402a'; // 选中标记：朱砂（亮底高对比）

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
  const locByIdRef = useRef({});
  const clustererRef = useRef(null);
  const currentLocRef = useRef(null);
  const firstLayerIdRef = useRef('novel'); // 导览第一个内容层 id（泰山等自定义层导览没有 novel）
  const currentRouteIdRef = useRef(null);
  const routeProgressMarkerRef = useRef(null);
  const routeProgressTokenRef = useRef(0);

  const [currentLoc, setCurrentLoc] = useState(null);
  const [currentLayer, setCurrentLayer] = useState('novel');
  const [currentRouteId, setCurrentRouteId] = useState(null);
  currentRouteIdRef.current = currentRouteId;
  const [showCard, setShowCard] = useState(true);
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

  // v99：#r=<routeId> 深链——分享链接直达某条路线。
  // 折线注册在地图异步初始化完成后才可用，用轻量轮询等待就绪（5s 超时放弃）。
  useEffect(() => {
    const m = /^#r=([^&]+)$/.exec(window.location.hash || '');
    if (!m || !tour?.routes?.length) return;
    const target = tour.routes.find(r => r.id === decodeURIComponent(m[1]));
    if (!target) return;
    let tries = 0;
    const iv = setInterval(() => {
      tries += 1;
      if (routePolylinesRef.current[target.id]) {
        clearInterval(iv);
        if (currentRouteIdRef.current !== target.id) selectRouteRef.current?.(target);
      } else if (tries > 25) clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  }, [tour]);
  const selectRouteRef = useRef(null);

  // 记录导览第一个内容层 id：泰山等自定义层(无 novel)时选中地点默认落到第一个层
  useEffect(() => {
    firstLayerIdRef.current = tour?.contentLayers?.[0]?.id || 'novel';
  }, [tour]);

  // 收藏状态（登录后）
  useEffect(() => {
    if (!user) { setIsFav(false); return; }
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

  const selectLoc = useCallback((loc) => {
    if (currentRouteIdRef.current) {
      const activeRoute = tour?.routes?.find(route => route.id === currentRouteIdRef.current);
      cancelRouteProgressAnimation();
      setRouteProgressKm(stopKmInRoute(activeRoute, loc.id, locByIdRef.current));
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

  const toggleFav = async () => {
    if (!user) { navigate('/login'); return; }
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
    if (error) { setToast(getErrorMessage(error, '路线确认失败')); return; }
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

  const selectRoute = useCallback((route) => {
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
    // 深链同步：选中路线写入 #r=，取消选中还原干净地址（分享/刷新都落在同一路线）
    try {
      window.history.replaceState(null, '', newId ? `${window.location.pathname}#r=${encodeURIComponent(newId)}` : window.location.pathname);
    } catch { /* 忽略沙箱环境下的 history 异常 */ }
    const firstStop = newId ? locByIdRef.current[route.stops[0]] : null;
    setCurrentLoc(firstStop);
    if (firstStop) { setCurrentLayer(firstLayerIdRef.current); setShowCard(true); }

    Object.entries(routePolylinesRef.current).forEach(([rid, rp]) => {
      if (!newId || rid === newId) {
        rp.polyline.setOptions({ strokeOpacity: 0.8, strokeWeight: 5 });
        rp.polyline.show();
      } else {
        rp.polyline.setOptions({ strokeOpacity: 0.15, strokeWeight: 2 });
      }
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
      if (firstLoc) {
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
        {activeRoute?.prof?.length > 1 && (
          <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-auto">
            <ElevationProfile
              prof={activeRoute.prof}
              activeKm={routeProgressKm}
              onProgressChange={handleRouteProgressChange}
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
      <div className="z-20 bg-card rounded-t-2xl max-h-[50vh] flex flex-col border-t border-x border-border shadow-[0_-10px_32px_-14px_rgba(28,26,22,0.3)] safe-bottom">
        {/* 卷轴杆拉手：两端轴头 + 杆身 */}
        <div className="flex justify-center items-center gap-1.5 py-2.5 cursor-pointer" onClick={() => setShowCard(s => !s)}>
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
          <div className="w-10 h-1 rounded-full bg-black/15" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
        </div>

        {showCard && (
          <div className="anim-content flex flex-col flex-1 min-h-0">
            {/* Route narrative · 卷首语：完整行程描述（入口/交通方式/出口） */}
            {activeRoute?.narrative && (
              <div className="px-4 pb-2">
                <p className="font-kai text-xs text-muted-foreground leading-relaxed bg-background rounded-lg p-3 border-l-2 border-dai max-h-24 overflow-y-auto">{activeRoute.narrative}</p>
              </div>
            )}
            {/* v93：主题游按片区呈现（片区 → 片区内游览点），与线性行程区分开 */}
            <ThemeSections
              sections={activeRoute?.sections}
              locationsById={locByIdRef.current}
              onSelectSpot={(id) => { const loc = locByIdRef.current[id]; if (loc) selectLoc(loc); }}
            />
            {activeRoute?.legs?.length > 0 && (
              <div className="px-4 pb-2">
                <p className="text-[11px] leading-relaxed text-muted-foreground bg-background rounded-lg p-2 border border-border/60 max-h-16 overflow-y-auto">
                  <span className="font-semibold text-foreground/70">交通分段：</span>{routeLegsText(activeRoute.legs)}
                </p>
              </div>
            )}
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
            {/* Location strip · 壹贰叁编号 — 右缘渐变提示可横向滚动查看更多 */}
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

            {currentLoc ? (
              <ContentCard
                key={currentLoc.id}
                loc={currentLoc}
                layer={currentLayer}
                layers={tour.contentLayers}
                onLayerChange={setCurrentLayer}
                onShowDetail={setShowDetail}
              />
            ) : (
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
          onClose={() => setShowDetail(false)}
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
import { routeLegsText } from '../lib/routeLegs.js';
