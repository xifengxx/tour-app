import { X, Mountain, Feather } from 'lucide-react';
import { ImportanceStars } from './ContentCard';

export default function DetailModal({ loc, layers, onClose }) {
  if (!loc) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg border border-border max-w-lg max-h-[80vh] overflow-y-auto p-6 w-full anim-rise" onClick={e => e.stopPropagation()}>
        <button
          className="float-right w-8 h-8 rounded-full bg-black/[0.05] text-muted-foreground hover:bg-black/10 transition-colors flex items-center justify-center"
          onClick={onClose}
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="text-foreground font-serif font-bold text-xl mb-1 flex items-center gap-2">
          <ImportanceStars importance={loc.importance} className="h-3.5 w-3.5" />
          {loc.name}
        </div>
        {loc.elevation && (
          <div className="text-muted-foreground text-sm mb-4 flex items-center gap-1">
            <Mountain className="h-3.5 w-3.5 text-dai/80" /> {loc.elevation}
          </div>
        )}

        {(layers || []).map(layer => {
          const raw = (loc.layers || {})[layer.id];
          // 兼容两种存储格式：嵌套 {text}/{scenes} 或 扁平字符串
          const ld = typeof raw === 'string' ? { text: raw } : raw;
          if (!ld) return null;
          return (
            <div key={layer.id} className="mb-4">
              <h3 className="font-serif text-sm font-bold mb-2 flex items-center gap-1.5" style={{ color: layer.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: layer.color }} />
                {layer.icon} {layer.name}
              </h3>
              {ld.scenes ? ld.scenes.map((s, i) => (
                <div key={i} className="bg-secondary/50 rounded-lg p-3 pl-4 mb-2 border-l-2 border-gamboge">
                  <div className="font-serif text-primary text-xs font-semibold tracking-wide mb-1.5">
                    {s.chapter}{s.title ? ' · ' + s.title : ''}
                  </div>
                  {s.quote && (
                    <div className="font-kai text-[15px] leading-relaxed text-[#5d5142] mb-1.5">
                      <span className="text-gamboge font-serif">「</span>{s.quote}<span className="text-gamboge font-serif">」</span>
                    </div>
                  )}
                  {s.context && <div className="text-muted-foreground text-xs leading-relaxed">{s.context}</div>}
                </div>
              )) : ld.text ? <p className="text-foreground/85 text-sm leading-relaxed">{ld.text}</p> : null}
            </div>
          );
        })}

        {loc.reflection && (
          <div className="border border-primary/25 bg-primary/[0.04] rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-primary font-serif text-xs font-semibold mb-1">
              <Feather className="h-3 w-3" /> 驻足一想
            </div>
            <div className="text-[#6b5a44] text-sm leading-relaxed">{loc.reflection}</div>
          </div>
        )}
      </div>
    </div>
  );
}
