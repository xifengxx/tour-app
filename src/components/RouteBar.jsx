const ROUTE_COLORS = ['#e74c3c', '#f39c12', '#3498db', '#2ecc71', '#9b59b6'];

export default function RouteBar({ routes, currentRouteId, onSelectRoute }) {
  if (!routes || routes.length === 0) return null;

  // 右缘渐变提示可滚动；有选中路线时含「清除筛选」按钮，不遮渐变以免按钮被淡出
  return (
    <div
      className="absolute top-28 left-0 right-0 z-10 px-4 flex gap-2 overflow-x-auto pointer-events-none"
      style={currentRouteId ? {} : { WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)', maskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)' }}
    >
      {routes.filter(r => r.id !== 'extra').map((route, i) => {
        const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
        const active = currentRouteId === route.id;
        return (
          <button
            key={route.id}
            onClick={() => onSelectRoute(route)}
            className={`pointer-events-auto px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap backdrop-blur border transition-all flex items-center gap-1.5
              ${active ? 'text-white border-transparent' : 'bg-card/90 text-muted-foreground border-border'}`}
            style={active ? { background: color } : {}}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: color }} />
            {route.day} {route.title}
          </button>
        );
      })}
      {currentRouteId && (
        <button
          onClick={() => onSelectRoute(null)}
          className="pointer-events-auto px-3 py-2 rounded-full text-xs bg-black/10 text-muted-foreground whitespace-nowrap"
        >
          ✕ 清除筛选
        </button>
      )}
    </div>
  );
}
