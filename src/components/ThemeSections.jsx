/**
 * 主题游的分区视图（v93）。
 *
 * 主题游过去和 1日/2日 长成一样：一长串景点连成一条线。
 * 但它的语义其实是"这一片有几个值得连着玩的景区"，不是"一条步行动线"，
 * 所以改成两层：主题 → 景区 → 景区内具体怎么玩。
 * 线性行程（1日/2日/文学巡礼线）不传 sections，仍走原来的叙事 + 交通分段。
 */
const CN_NUM = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'];

export default function ThemeSections({ sections, locationsById = {}, onSelectSpot }) {
  const groups = (sections || []).filter(g => (g.stops || []).length);
  if (groups.length < 2) return null;

  return (
    <section className="px-4 pb-2" aria-label="主题游分区">
      <div className="bg-background rounded-lg border border-border/60 overflow-hidden">
        <p className="text-[11px] text-muted-foreground px-3 pt-2 pb-1.5">
          本主题含 {groups.length} 个片区，每个片区内按实际动线排列
        </p>
        <ol className="divide-y divide-border/50 max-h-56 overflow-y-auto overscroll-contain">
          {groups.map((group, i) => (
            <li key={group.key || group.name} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="seal-outline text-[10px] px-1 py-0.5 shrink-0">{CN_NUM[i] || i + 1}</span>
                <span className="text-xs font-serif font-semibold text-foreground truncate">{group.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                  group.kind === '核心景区' ? 'bg-primary/10 text-primary' : 'bg-black/[0.05] text-muted-foreground'
                }`}>{group.kind === '核心景区' ? '核心' : '周边'}</span>
              </div>
              {group.text && (
                <p className="text-[11px] leading-relaxed text-muted-foreground mt-1 font-kai">{group.text}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-1.5">
                {(group.stops || []).map((id, j) => {
                  const loc = locationsById[id];
                  const name = loc?.name || id;
                  return (
                    <span key={id} className="inline-flex items-center gap-1 text-[11px] text-foreground/80">
                      {j > 0 && <span aria-hidden="true" className="text-muted-foreground/60">→</span>}
                      {onSelectSpot && loc ? (
                        <button type="button" onClick={() => onSelectSpot(id, group)} className="underline decoration-border/70 underline-offset-2 hover:text-primary">
                          {name}
                        </button>
                      ) : (
                        <span>{name}</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
