import { Star, Mountain, Footprints, Zap, Lightbulb, Feather, Navigation, BookOpen } from 'lucide-react';

// 重要度：藤黄小星（最多 5 颗）
export function ImportanceStars({ importance, className = 'h-3 w-3' }) {
  const n = Math.min(Math.max(importance || 1, 1), 5);
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {Array.from({ length: n }).map((_, i) => (
        <Star key={i} className={`${className} fill-gamboge text-gamboge`} />
      ))}
    </span>
  );
}

export default function ContentCard({ loc, layer, layers, onLayerChange, onShowDetail }) {
  if (!loc) return null;

  return (
    <>
      {/* Layer tabs · 书签式：色点标识内容层，选中为朱砂 */}
      <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto">
        {(layers || []).map(l => {
          const active = layer === l.id;
          return (
            <button
              key={l.id}
              onClick={() => onLayerChange(l.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors
                ${active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'}`}
            >
              {!active && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: l.color }} />}
              {l.icon} {l.name}
            </button>
          );
        })}
      </div>

      {/* Scrollable content — pb-12 给高德版权条留出空间，避免遮挡底部实用信息 */}
      <div className="flex-1 overflow-y-auto px-4 pb-12">
        <div className="text-foreground font-serif font-bold text-lg mb-1 flex items-center gap-2">
          <ImportanceStars importance={loc.importance} />
          {loc.name}
        </div>
        {loc.elevation && (
          <div className="text-muted-foreground text-xs mb-3 flex items-center gap-1">
            <Mountain className="h-3 w-3 text-dai/80" /> {loc.elevation}
          </div>
        )}

        {loc.tags && (
          <div className="flex gap-1 flex-wrap mb-3">
            {loc.tags.map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-black/[0.04] border border-border/60 text-muted-foreground text-xs">{t}</span>
            ))}
          </div>
        )}

        {(() => {
          const raw = (loc.layers || {})[layer];
          // 兼容两种存储格式：嵌套 {text: "..."} 或 扁平字符串 "..."（历史数据/分批生成的差异）
          const ld = typeof raw === 'string' ? { text: raw } : raw;
          if (!ld) return <p className="text-muted-foreground text-sm">此处暂无该分类的内容 · 试试切换上方其他内容层</p>;
          if (ld.scenes && ld.scenes.length > 0) {
            // 页边批注样式：朱色章节小标 + 藤黄「」引文（楷体）+ 暖灰背景说明
            return ld.scenes.map((s, i) => (
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
            ));
          }
          return <p className="text-foreground/85 text-sm leading-relaxed">{ld.text}</p>;
        })()}

        {/* Reflection · 朱砂批注 */}
        {loc.reflection && (
          <div className="border border-primary/25 bg-primary/[0.04] rounded-lg p-3 my-3">
            <div className="flex items-center gap-1.5 text-primary font-serif text-xs font-semibold mb-1">
              <Feather className="h-3 w-3" /> 驻足一想
            </div>
            <div className="text-[#6b5a44] text-xs leading-relaxed">{loc.reflection}</div>
          </div>
        )}

        {/* Practical info */}
        {loc.practical && (loc.practical.access || loc.practical.difficulty || loc.practical.tip) && (
          <div className="flex gap-1.5 flex-wrap my-2">
            {loc.practical.access && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/[0.04] border border-border/60 text-muted-foreground text-xs">
                <Footprints className="h-3 w-3 text-dai/80" /> {loc.practical.access}
              </span>
            )}
            {loc.practical.difficulty && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/[0.04] border border-border/60 text-muted-foreground text-xs">
                <Zap className="h-3 w-3 text-ochre" /> {loc.practical.difficulty}
              </span>
            )}
            {loc.practical.tip && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/[0.04] border border-border/60 text-muted-foreground text-xs">
                <Lightbulb className="h-3 w-3 text-gamboge" /> {loc.practical.tip}
              </span>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => window.open(`https://uri.amap.com/marker?position=${loc.lng},${loc.lat}&name=${encodeURIComponent(loc.name)}`, '_blank')}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-primary/90 transition-colors"
          >
            <Navigation className="h-4 w-4" /> 导航到这里
          </button>
          <button
            onClick={() => onShowDetail(true)}
            className="flex-1 py-3 bg-black/[0.05] text-muted-foreground rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-black/[0.08] transition-colors"
          >
            <BookOpen className="h-4 w-4" /> 查看全文
          </button>
        </div>
      </div>
    </>
  );
}
