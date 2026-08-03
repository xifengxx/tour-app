export default function ContentCard({ loc, layer, layers, onLayerChange, onShowDetail }) {
  if (!loc) return null;

  return (
    <>
      {/* Layer tabs */}
      <div className="flex gap-1 px-4 pb-2 overflow-x-auto">
        {(layers || []).map(l => (
          <button
            key={l.id}
            onClick={() => onLayerChange(l.id)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors"
            style={{
              background: layer === l.id ? l.color : 'transparent',
              color: layer === l.id ? '#fff' : '#888',
              border: layer === l.id ? 'none' : '1px solid rgba(255,255,255,0.1)'
            }}
          >
            {l.icon} {l.name}
          </button>
        ))}
      </div>

      {/* Scrollable content — pb-12 给高德版权条留出空间，避免遮挡底部实用信息 */}
      <div className="flex-1 overflow-y-auto px-4 pb-12">
        <div className="text-white font-bold text-lg mb-1">
          {'⭐'.repeat(loc.importance || 1)} {loc.name}
        </div>
        {loc.elevation && <div className="text-gray-400 text-xs mb-3">🏔 {loc.elevation}</div>}

        {loc.tags && (
          <div className="flex gap-1 flex-wrap mb-3">
            {loc.tags.map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-white/5 text-gray-400 text-xs">{t}</span>
            ))}
          </div>
        )}

        {(() => {
          const ld = (loc.layers || {})[layer];
          if (!ld) return <p className="text-gray-500 text-sm">暂无此分类的内容</p>;
          if (ld.scenes && ld.scenes.length > 0) {
            return ld.scenes.map((s, i) => (
              <div key={i} className="bg-[#242444] rounded-xl p-3 mb-2 border-l-2 border-yellow-600">
                <div className="text-yellow-600 text-xs font-semibold mb-1">📖 {s.chapter}{s.title ? ' · ' + s.title : ''}</div>
                {s.quote && <div className="text-[#c8b898] text-sm italic leading-relaxed mb-1">「{s.quote}」</div>}
                {s.context && <div className="text-gray-500 text-xs">{s.context}</div>}
              </div>
            ));
          }
          return <p className="text-gray-400 text-sm leading-relaxed">{ld.text}</p>;
        })()}

        {/* Reflection */}
        {loc.reflection && (
          <div className="bg-yellow-600/5 border border-yellow-600/15 rounded-xl p-3 my-3">
            <div className="text-yellow-600 text-xs font-semibold mb-1">💭 停下来想一想</div>
            <div className="text-[#c8b898] text-xs leading-relaxed">{loc.reflection}</div>
          </div>
        )}

        {/* Practical info */}
        {loc.practical && (loc.practical.access || loc.practical.difficulty || loc.practical.tip) && (
          <div className="flex gap-1 flex-wrap my-2">
            {loc.practical.access && <span className="px-2 py-1 rounded-full bg-white/5 text-gray-400 text-xs">🚶 {loc.practical.access}</span>}
            {loc.practical.difficulty && <span className="px-2 py-1 rounded-full bg-white/5 text-gray-400 text-xs">⚡ {loc.practical.difficulty}</span>}
            {loc.practical.tip && <span className="px-2 py-1 rounded-full bg-white/5 text-gray-400 text-xs">💡 {loc.practical.tip}</span>}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => window.open(`https://uri.amap.com/marker?position=${loc.lng},${loc.lat}&name=${encodeURIComponent(loc.name)}`, '_blank')}
            className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-semibold"
          >
            🧭 导航到这里
          </button>
          <button
            onClick={() => onShowDetail(true)}
            className="flex-1 py-3 bg-white/5 text-gray-400 rounded-xl text-sm font-semibold"
          >
            📖 查看全文
          </button>
        </div>
      </div>
    </>
  );
}
