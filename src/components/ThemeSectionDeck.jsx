/**
 * 主题游的一级视图：片区卡（v94）。
 *
 * 主题游不是一条线性行程——它是"这一带能连着玩几个景区、每个景区里怎么玩"。
 * 所以主视图应是片区卡，而不是"第 N 站 / 共 14 站"的路线卡；点详情退成二级。
 *
 * 片区之间的接驳用 route.legs 的真实分段数据（跨片区的相邻站点），不另算直线距离。
 */
const CN_NUM = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'];
const MODE_TEXT = { walk: '徒步', car: '车行', bus: '摆渡', cable: '索道', other: '接驳' };

function fmtKm(m) {
  if (!m) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} 公里` : `${Math.round(m)} 米`;
}

/** 两个片区之间的接驳：把跨片区的相邻段汇总成一条。 */
function interSectionLeg(legs = [], stopsA = [], stopsB = []) {
  const a = new Set(stopsA);
  const b = new Set(stopsB);
  const segs = legs.filter(l => a.has(l.fromId) && b.has(l.toId));
  if (!segs.length) return null;
  const distanceM = segs.reduce((s, l) => s + (l.distanceM || 0), 0);
  const mode = segs.find(l => l.mode && l.mode !== 'walk')?.mode || segs[0].mode || 'car';
  return { distanceM, mode };
}

export default function ThemeSectionDeck({
  sections = [],
  locationsById = {},
  legs = [],
  activeKey = null,
  spotId = null,
  onSelectSection,
  onSelectSpot,
}) {
  const groups = sections.filter(g => (g.stops || []).length);
  if (!groups.length) return null;

  return (
    <section className="px-4 pb-2 shrink-0 overflow-y-auto overscroll-contain max-h-[46vh]" aria-label="主题游片区">
      <p className="text-[11px] text-muted-foreground pb-1.5">
        本主题含 {groups.length} 个片区 · 点片区看怎么玩，点地点看它的故事
      </p>
      <ol className="flex flex-col gap-1.5">
        {groups.map((group, i) => {
          const open = activeKey === group.key;
          const next = groups[i + 1];
          const link = next ? interSectionLeg(legs, group.stops, next.stops) : null;
          return (
            <li key={group.key || group.name}>
              <div className={`rounded-lg border transition-colors ${open ? 'border-primary/40 bg-primary/[0.04]' : 'border-border/60 bg-background'}`}>
                <button
                  type="button"
                  onClick={() => onSelectSection?.(open ? null : group.key, group)}
                  aria-expanded={open}
                  className="w-full text-left px-3 py-2 flex items-center gap-2"
                >
                  <span className="seal-outline text-[10px] px-1 py-0.5 shrink-0">{CN_NUM[i] || i + 1}</span>
                  <span className="text-xs font-serif font-semibold text-foreground truncate flex-1 min-w-0">{group.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                    group.kind === '核心景区' ? 'bg-primary/10 text-primary' : 'bg-black/[0.05] text-muted-foreground'
                  }`}>{group.kind === '核心景区' ? '核心' : '周边'}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{group.stops.length} 个点</span>
                  <span className={`text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                </button>

                {open && (
                  <div className="px-3 pb-2.5">
                    {group.text && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground font-kai bg-card rounded-md p-2 border border-border/50">
                        {group.text}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(group.stops || []).map(id => {
                        const loc = locationsById[id];
                        if (!loc) return null;
                        const on = spotId === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onSelectSpot?.(id, group)}
                            className={`px-2 py-1 rounded-full text-[11px] border transition-colors ${
                              on ? 'bg-primary/15 text-primary border-primary/30' : 'bg-black/[0.03] text-foreground/80 border-transparent hover:border-border'
                            }`}
                          >
                            {loc.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {link && (
                  <div className="px-3 pb-1.5 text-[10px] text-muted-foreground flex items-center gap-1">
                    <span className="text-dai/80">↓</span>
                    <span>去「{next.name}」{MODE_TEXT[link.mode] || '接驳'} 约 {fmtKm(link.distanceM)}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
