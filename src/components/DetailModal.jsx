export default function DetailModal({ loc, layers, onClose }) {
  if (!loc) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl max-w-lg max-h-[80vh] overflow-y-auto p-6 w-full" onClick={e => e.stopPropagation()}>
        <button className="float-right w-8 h-8 rounded-full bg-black/10 text-foreground text-lg" onClick={onClose}>✕</button>
        <div className="text-foreground font-serif font-bold text-xl mb-1">
          {'⭐'.repeat(loc.importance || 1)} {loc.name}
        </div>
        {loc.elevation && <div className="text-muted-foreground text-sm mb-4">🏔 {loc.elevation}</div>}

        {(layers || []).map(layer => {
          const ld = (loc.layers || {})[layer.id];
          if (!ld) return null;
          return (
            <div key={layer.id} className="mb-4">
              <h3 className="text-sm font-bold mb-2" style={{ color: layer.color }}>{layer.icon} {layer.name}</h3>
              {ld.scenes ? ld.scenes.map((s, i) => (
                <div key={i} className="bg-secondary rounded-xl p-3 mb-2 border-l-2 border-yellow-600">
                  <div className="text-yellow-600 text-xs font-semibold mb-1">📖 {s.chapter}{s.title ? ' · ' + s.title : ''}</div>
                  {s.quote && <div className="text-[#7a6a4f] text-sm italic leading-relaxed mb-1">「{s.quote}」</div>}
                  {s.context && <div className="text-muted-foreground text-xs">{s.context}</div>}
                </div>
              )) : ld.text ? <p className="text-muted-foreground text-sm leading-relaxed">{ld.text}</p> : null}
            </div>
          );
        })}

        {loc.reflection && (
          <div className="bg-yellow-600/5 border border-yellow-600/15 rounded-xl p-3">
            <div className="text-yellow-600 text-xs font-semibold mb-1">💭 停下来想一想</div>
            <div className="text-[#7a6a4f] text-sm leading-relaxed">{loc.reflection}</div>
          </div>
        )}
      </div>
    </div>
  );
}
