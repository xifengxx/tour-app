import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTourData } from '../hooks/useTourData';
import { useAuth } from '../contexts/AuthContext';
import NavBar from '../components/NavBar';
import { Button } from '@/components/ui/button';
import RouteBar from '../components/RouteBar';
import ContentCard from '../components/ContentCard';
import DetailModal from '../components/DetailModal';
import { Share2, Check } from 'lucide-react';

const ROUTE_COLORS = ['#e74c3c','#f39c12','#3498db','#2ecc71','#9b59b6'];
const IMPORTANCE_COLORS = ['#95a5a6','#95a5a6','#3498db','#f39c12','#e74c3c','#e74c3c'];

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

  const [currentLoc, setCurrentLoc] = useState(null);
  const [currentLayer, setCurrentLayer] = useState('novel');
  const [currentRouteId, setCurrentRouteId] = useState(null);
  const [showCard, setShowCard] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [toast, setToast] = useState(null);

  const { tour, loading } = useTourData(tourId);

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
            const loc = ctx.data?.extData || ctx.data?.data || ctx.data || {};
            const m = ctx.marker;
            const color = IMPORTANCE_COLORS[Math.min(loc.importance || 0, 5)];
            const size = (loc.importance || 0) >= 4 ? 32 : 26;
            m.setIcon(new window.AMap.Icon({
              size: new window.AMap.Size(size, size + 10),
              imageSize: new window.AMap.Size(size, size + 10),
              image: 'data:image/svg+xml,' + encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 10}" viewBox="0 0 ${size} ${size + 10}">` +
                `<filter id="s"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.4"/></filter>` +
                `<path d="M${size / 2} 0 C${size * 0.23} 0 0 ${size * 0.23} 0 ${size / 2} C0 ${size * 0.77} ${size / 2} ${size + 6} ${size / 2} ${size + 6}z" fill="${color}" filter="url(#s)"/>` +
                `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.22}" fill="#fff" opacity="0.9"/>` +
                `</svg>`
              )
            }));
            m.setOffset(new window.AMap.Pixel(-size / 2, -(size + 10)));
            m.setzIndex(100 + (loc.importance || 0));
            m._locData = loc;
            m.on('click', () => selectLoc(loc));
            markersRef.current.push(m);
          },
          renderClusterMarker: (ctx) => {
            const m = ctx.marker;
            const n = ctx.count;
            const d = n >= 100 ? 52 : n >= 10 ? 44 : 36;
            m.setContent(`<div style="width:${d}px;height:${d}px;border-radius:50%;background:rgba(220,38,38,.88);border:2px solid rgba(255,255,255,.9);color:#fff;font-weight:700;font-size:${d >= 44 ? 15 : 13}px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.35);cursor:pointer">${n}</div>`);
            m.setSize(new window.AMap.Size(d, d));
            m.on('click', () => {
              // 点击聚合气泡 → 选中簇内最近的地点：内容栏立即更新并放大到该点，
              // 与点击单个标记行为一致（否则默认视图下点气泡只缩放不选中，用户会以为点不动）
              const pos = m.getPosition();
              const nearest = tour.locations.reduce((best, l) => {
                const d = (l.lng - pos.getLng()) ** 2 + (l.lat - pos.getLat()) ** 2;
                return !best || d < best.d ? { l, d } : best;
              }, null)?.l;
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

  // ── Actions ──
  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setToast('已复制链接');
      setTimeout(() => setToast(null), 2000);
    }).catch(() => {
      setToast('复制失败，请手动复制');
      setTimeout(() => setToast(null), 2000);
    });
  };

  const selectLoc = useCallback((loc) => {
    setCurrentLoc(loc);
    setCurrentLayer('novel');
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
    if (firstStop) { setCurrentLayer('novel'); setShowCard(true); }

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
  if (loading) return <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center text-gray-400">加载中...</div>;
  if (!tour) return <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center text-gray-400">未找到导览</div>;

  return (
    <div className="h-screen flex flex-col bg-[#0f0f1a] relative">
      {/* NavBar + subtitle */}
      <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
        <NavBar
          title={tour.meta.title}
          rightContent={
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={handleShare} title="分享链接">
                <Share2 className="h-4 w-4" />
              </Button>
              {user && tour.userId === user.id && (
                <Button variant="secondary" size="sm" onClick={() => navigate(`/tour/${tourId}/edit`)}>
                  编辑
                </Button>
              )}
            </div>
          }
        />
        <div className="px-4 pb-2 bg-gradient-to-b from-[#0f0f1a] to-transparent pointer-events-none">
          <p className="text-gray-400 text-xs">{tour.meta.subtitle}</p>
        </div>
      </div>

      <RouteBar routes={tour.routes} currentRouteId={currentRouteId} onSelectRoute={selectRoute} />

      {/* Map */}
      <div ref={mapRef} className="flex-1" />

      {/* Bottom card zone — 置于正常文档流而非覆盖地图：地图容器止于卡片上缘，
          高德版权条不再压在卡片底部内容上；卡片折叠时地图随之扩展 */}
      <div className="z-20 bg-[#1c1c32] rounded-t-3xl max-h-[50vh] flex flex-col shadow-2xl">
        <div className="flex justify-center py-2 cursor-pointer" onClick={() => setShowCard(s => !s)}>
          <div className="w-8 h-1 rounded-full bg-white/20" />
        </div>

        {showCard && (
          <>
            {/* Route narrative: 完整行程描述（入口/交通方式/出口） */}
            {activeRoute?.narrative && (
              <div className="px-4 pb-2">
                <p className="text-xs text-gray-300 leading-relaxed bg-[#0f0f1a] rounded-xl p-3 border border-white/5 max-h-24 overflow-y-auto">{activeRoute.narrative}</p>
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
                    ${currentLoc?.id === loc.id ? 'bg-red-600/20 text-red-400 border border-red-600/30' : 'bg-white/5 text-gray-400 border border-transparent'}`}
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
                  <p className="text-gray-400 text-sm">点击地图标记或上方地点<br/>查看此地的小说场景与人文故事</p>
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

      {/* Toast */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-card border border-border rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Check className="h-4 w-4 text-green-400" />
          <span className="text-sm text-white">{toast}</span>
        </div>
      )}
    </div>
  );
}
