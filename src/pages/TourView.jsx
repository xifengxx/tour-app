import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTourData } from '../hooks/useTourData';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import NavBar from '../components/NavBar';
import { Button } from '@/components/ui/button';
import RouteBar from '../components/RouteBar';
import ContentCard from '../components/ContentCard';
import DetailModal from '../components/DetailModal';
import ShareModal from '../components/ShareModal';
import CommentsModal from '../components/CommentsModal';
import { Share2, Check, Heart, MessageCircle } from 'lucide-react';
import { extractMarkerLoc, findNearestLocation, buildPinIcon } from '../lib/mapUtils';

const ROUTE_COLORS = ['#e74c3c','#f39c12','#3498db','#2ecc71','#9b59b6'];
const DEFAULT_PIN_COLOR = '#b3ae9e'; // 未选中标记：暖灰
const SELECTED_COLOR = '#c96442'; // 选中标记：陶土（亮底高对比）

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

export default function TourView() {
  const { tourId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const routePolylinesRef = useRef({});
  const locByIdRef = useRef({});
  const clustererRef = useRef(null);
  const currentLocRef = useRef(null);
  const firstLayerIdRef = useRef('novel'); // 导览第一个内容层 id（泰山等自定义层导览没有 novel）

  const [currentLoc, setCurrentLoc] = useState(null);
  const [currentLayer, setCurrentLayer] = useState('novel');
  const [currentRouteId, setCurrentRouteId] = useState(null);
  const [showCard, setShowCard] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [toast, setToast] = useState(null);

  const { tour, loading } = useTourData(tourId);

  currentLocRef.current = currentLoc; // 供 renderMarker 闭包读取最新选中态

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
      .then(({ data }) => setIsFav(!!data));
  }, [user, tourId]);

  const toggleFav = async () => {
    if (!user) { navigate('/login'); return; }
    if (isFav) {
      await supabase.from('favorites').delete().eq('user_id', user.id).eq('tour_id', tourId);
      setIsFav(false);
    } else {
      await supabase.from('favorites').insert({ user_id: user.id, tour_id: tourId });
      setIsFav(true);
    }
  };

  // Init map
  useEffect(() => {
    if (!tour || mapInstance.current) return;
    const init = () => {
      if (typeof window.AMap === 'undefined') { setTimeout(init, 200); return; }
      const bounds = tour.destination?.bounds;
      const center = bounds
        ? [(bounds[0][1] + bounds[1][1]) / 2, (bounds[0][0] + bounds[1][0]) / 2]
        : [104.0, 35.0]; // no coords yet (e.g. draft tour): default to China overview
      const map = new window.AMap.Map(mapRef.current, {
        center,
        zoom: 12, resizeEnable: true,
        mapStyle: 'amap://styles/normal'
      });
      mapInstance.current = map;

      // 地点标记 + 聚合：AMap 2.0 用 AMap.MarkerCluster（注意不是旧版 MarkerClusterer）。
      // 缩小地图时邻近点聚合成带数字气泡，放大才拆分为单个标记。
      locByIdRef.current = {};
      tour.locations.forEach(l => { locByIdRef.current[l.id] = l; });
      window.AMap.plugin('AMap.MarkerCluster', () => {
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
            m.setContent(`<div style="width:${d}px;height:${d}px;border-radius:50%;background:rgba(201,100,66,.9);border:2px solid rgba(255,255,255,.9);color:#fff;font-weight:700;font-size:${d >= 44 ? 15 : 13}px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.2);cursor:pointer">${n}</div>`);
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
        const path = route.stops.map(id => {
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
            color: ROUTE_COLORS[ri % ROUTE_COLORS.length]
          };
        }
      });

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
    init();
  }, [tour]);

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

  const selectLoc = useCallback((loc) => {
    setCurrentLoc(loc);
    setCurrentLayer(firstLayerIdRef.current); // 用导览第一个内容层，而非硬编码 novel
    setShowCard(true);
    if (mapInstance.current) {
      mapInstance.current.setCenter([loc.lng, loc.lat]);
      mapInstance.current.setZoom(16);
    }
  }, []);

  const selectRoute = useCallback((route) => {
    if (!route || !route.stops || route.stops.length === 0) {
      setCurrentRouteId(null);
      setCurrentLoc(null);
      markersRef.current.forEach(m => m.setOptions({ opacity: 1 }));
      Object.values(routePolylinesRef.current).forEach(rp => {
        rp.polyline.setOptions({ strokeOpacity: 0.6, strokeWeight: 4 });
        rp.polyline.show();
      });
      if (mapInstance.current) mapInstance.current.setFitView();
      return;
    }

    const newId = currentRouteId === route.id ? null : route.id;
    setCurrentRouteId(newId);
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
      const map = mapInstance.current;
      if (!map) return;
      const firstLoc = locByIdRef.current[route.stops[0]];
      if (firstLoc) {
        map.setZoomAndCenter(14, [firstLoc.lng, firstLoc.lat]);
      }
    } else {
      markersRef.current.forEach(m => m.setOptions({ opacity: 1 }));
      if (mapInstance.current) mapInstance.current.setFitView();
    }
  }, [currentRouteId]);

  // ── Computed ──
  const filteredLocations = currentRouteId
    ? (tour?.routes.find(r => r.id === currentRouteId)?.stops || [])
        .map(id => locByIdRef.current[id]).filter(Boolean)
    : (tour?.locations || []);
  const activeRoute = currentRouteId ? (tour?.routes || []).find(r => r.id === currentRouteId) : null;

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
      <div ref={mapRef} className="flex-1" />

      {/* Bottom card zone — 置于正常文档流而非覆盖地图：地图容器止于卡片上缘，
          高德版权条不再压在卡片底部内容上；卡片折叠时地图随之扩展 */}
      <div className="z-20 bg-card rounded-t-3xl max-h-[50vh] flex flex-col shadow-2xl">
        <div className="flex justify-center py-2 cursor-pointer" onClick={() => setShowCard(s => !s)}>
          <div className="w-8 h-1 rounded-full bg-black/10" />
        </div>

        {showCard && (
          <>
            {/* Route narrative: 完整行程描述（入口/交通方式/出口） */}
            {activeRoute?.narrative && (
              <div className="px-4 pb-2">
                <p className="text-xs text-muted-foreground leading-relaxed bg-background rounded-xl p-3 border border-border max-h-24 overflow-y-auto">{activeRoute.narrative}</p>
              </div>
            )}
            {/* Location strip — 右缘渐变提示可横向滚动查看更多 */}
            <div className="flex gap-2 px-4 pb-2 overflow-x-auto"
                 style={{ WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)', maskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)' }}>
              {filteredLocations.map(loc => (
                <button
                  key={loc.id}
                  onClick={() => selectLoc(loc)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors
                    ${currentLoc?.id === loc.id ? 'bg-primary/20 text-primary border border-primary/30' : 'bg-black/5 text-muted-foreground border border-transparent'}`}
                >
                  {'⭐'.repeat(loc.importance || 1)} {loc.name}
                </button>
              ))}
            </div>

            {currentLoc ? (
              <ContentCard
                loc={currentLoc}
                layer={currentLayer}
                layers={tour.contentLayers}
                onLayerChange={setCurrentLayer}
                onShowDetail={setShowDetail}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-center px-4 pb-6">
                <div>
                  <div className="text-4xl mb-3">🗺️</div>
                  <p className="text-muted-foreground text-sm">点击地图标记或上方地点<br/>查看此地的小说场景与人文故事</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showDetail && (
        <DetailModal
          loc={currentLoc}
          layers={tour.contentLayers}
          onClose={() => setShowDetail(false)}
        />
      )}

      {showShare && <ShareModal tour={tour} tourId={tourId} onClose={() => setShowShare(false)} />}

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
