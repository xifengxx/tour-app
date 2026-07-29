import { useState, useEffect, useRef } from 'react';

/**
 * Full-screen map modal for searching and selecting locations.
 * Props: show, onClose, onAdd(location), initialRegion (optional city/area name)
 */
export default function MapSearchModal({ show, onClose, onAdd, initialRegion }) {
  const [query, setQuery] = useState('');
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const searchMarkersRef = useRef([]);
  const tempMarkerRef = useRef(null);

  useEffect(() => {
    if (!show) return;
    const init = () => {
      if (typeof window.AMap === 'undefined' || !mapRef.current) {
        setTimeout(init, 200);
        return;
      }
      const map = new window.AMap.Map(mapRef.current, {
        center: [113.0, 30.5],
        zoom: 5,
        resizeEnable: true,
      });
      mapInstance.current = map;

      // Click anywhere to drop a temporary pin
      map.on('click', (e) => {
        if (tempMarkerRef.current) map.remove(tempMarkerRef.current);
        const m = new window.AMap.Marker({
          position: [e.lnglat.lng, e.lnglat.lat],
          map,
          icon: new window.AMap.Icon({
            size: new window.AMap.Size(28, 36),
            imageSize: new window.AMap.Size(28, 36),
            image: 'data:image/svg+xml,' + encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">' +
              '<path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="#e74c3c"/>' +
              '<circle cx="14" cy="12" r="5" fill="#fff"/>' +
              '</svg>'
            ),
          }),
          offset: new window.AMap.Pixel(-14, -36),
        });
        tempMarkerRef.current = m;
      });
    };
    init();
    return () => {
      // Cleanup markers when modal closes
      searchMarkersRef.current.forEach(m => mapInstance.current?.remove(m));
      if (tempMarkerRef.current) mapInstance.current?.remove(tempMarkerRef.current);
      mapInstance.current?.destroy();
      mapInstance.current = null;
    };
  }, [show]);

  const doSearch = () => {
    if (!query.trim() || !mapInstance.current) return;

    // Clear old search markers
    searchMarkersRef.current.forEach(m => mapInstance.current.remove(m));
    searchMarkersRef.current = [];

    window.AMap.plugin('AMap.PlaceSearch', () => {
      const ps = new window.AMap.PlaceSearch({
        city: initialRegion || undefined,
        pageSize: 15,
      });
      ps.search(query, (status, result) => {
        if (status === 'complete' && result.poiList) {
          const pois = result.poiList.pois || [];
          const bounds = [];
          pois.forEach((poi) => {
            const pos = [poi.location.lng, poi.location.lat];
            bounds.push(pos);
            const m = new window.AMap.Marker({
              position: pos,
              map: mapInstance.current,
              title: poi.name,
              label: {
                content: `<div style="background:#c0392b;color:#fff;padding:2px 8px;border-radius:12px;font-size:11px;white-space:nowrap">${poi.name}</div>`,
                offset: new window.AMap.Pixel(0, -30),
              },
            });
            m._poi = poi;

            m.on('click', () => {
              // Show info window and ask to add
              const confirmed = window.confirm(`添加「${poi.name}」到导览？\n地址：${poi.address || '未知'}`);
              if (confirmed) {
                onAdd({
                  id: `loc_${Date.now()}`,
                  name: poi.name,
                  lng: poi.location.lng,
                  lat: poi.location.lat,
                  elevation: '',
                  importance: 3,
                  tags: [],
                  layers: {},
                  reflection: '',
                  practical: {},
                });
              }
            });

            searchMarkersRef.current.push(m);
          });
          if (bounds.length > 0) {
            mapInstance.current.setFitView(bounds);
          }
        }
      });
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') doSearch();
    if (e.key === 'Escape') onClose();
  };

  // Add current temp pin as location
  const addTempPin = () => {
    if (!tempMarkerRef.current) return;
    const pos = tempMarkerRef.current.getPosition();
    const name = window.prompt('地点名称：', query || '未命名地点');
    if (!name) return;
    onAdd({
      id: `loc_${Date.now()}`,
      name,
      lng: pos.lng,
      lat: pos.lat,
      elevation: '',
      importance: 3,
      tags: [],
      layers: {},
      reflection: '',
      practical: {},
    });
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0f0f1a] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 bg-[#1c1c32] border-b border-white/5">
        <button onClick={onClose} className="text-gray-400 px-3 py-2 rounded-xl bg-white/5 text-sm">✕ 关闭</button>
        <div className="flex-1 flex items-center gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-[#0f0f1a] text-white rounded-xl px-4 py-2.5 text-sm border border-white/10 outline-none focus:border-red-600"
            placeholder="搜索地点（如：祝融峰、华山北峰...）"
            autoFocus
          />
          <button
            onClick={doSearch}
            className="px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold"
          >
            🔍 搜索
          </button>
        </div>
        {tempMarkerRef.current && (
          <button onClick={addTempPin} className="px-3 py-2 bg-green-600 text-white rounded-xl text-xs">
            + 添加此点
          </button>
        )}
      </div>

      {/* Map */}
      <div ref={mapRef} className="flex-1" />

      {/* Hint */}
      <div className="absolute bottom-4 left-4 right-4 pointer-events-none">
        <div className="bg-[#1c1c32]/90 backdrop-blur rounded-xl px-4 py-2 text-gray-400 text-xs text-center max-w-xs mx-auto">
          💡 搜索地点点击标记添加，或直接点地图任意位置放置标记
        </div>
      </div>
    </div>
  );
}
