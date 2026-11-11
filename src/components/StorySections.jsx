import { Clock3, Users, Share2 } from 'lucide-react';

/**
 * 案头内容三段（时间轴 / 人物 / 关系图）。
 * 纯展示组件；聚合与摘要逻辑在 lib/story.js，避免组件文件同时导出函数（fast-refresh 告警）。
 *
 * 数据来自 locations.timeline / locations.figures：
 *   timeline[i] = { era, label, function, change, evidence, order? }
 *   figures[i]  = { name, role, relation, works[], evidence }
 * 字段缺省时显示「待补」，不编造。
 */

const Empty = ({ text }) => (
  <p className="text-[11px] leading-relaxed text-muted-foreground bg-black/[0.02] border border-dashed border-border/70 rounded-lg px-3 py-2">
    {text}
  </p>
);

export default function StorySections({ timeline = [], figures = [] }) {
  return (
    <div className="space-y-6">
      {/* 一、时代演变 */}
      <section aria-label="时代演变">
        <div className="flex items-center gap-1.5 mb-2">
          <Clock3 className="h-3.5 w-3.5 text-primary" />
          <h3 className="font-serif text-sm font-bold text-foreground">时代演变</h3>
          <span className="text-[10px] text-muted-foreground">何时、是什么、为什么变</span>
        </div>
        {timeline.length === 0 ? (
          <Empty text="这条线的时代资料还没生成 · 需要管线补 timeline 字段" />
        ) : (
          <div className="relative pl-4">
            <span className="absolute left-[5px] top-1 bottom-1 w-px bg-border" aria-hidden="true" />
            {timeline.map(group => (
              <div key={group.era} className="relative mb-3 last:mb-0">
                <span className="absolute -left-[15px] top-1.5 w-2 h-2 rounded-full bg-primary ring-2 ring-card" aria-hidden="true" />
                <div className="font-serif text-xs font-semibold text-primary mb-1">{group.era}</div>
                {group.items.map((it, i) => (
                  <div key={`${it.locationId}-${i}`} className="bg-secondary/40 rounded-md px-2.5 py-1.5 mb-1 last:mb-0 border-l-2 border-gamboge/60">
                    <div className="text-[12px] font-semibold text-foreground leading-snug">{it.label}</div>
                    {(it.function || it.change) && (
                      <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                        {it.function && <span>当时：{it.function}</span>}
                        {it.function && it.change && <span className="text-muted-foreground/50"> · </span>}
                        {it.change && <span>为何变：{it.change}</span>}
                      </div>
                    )}
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mt-1 text-[10px] text-muted-foreground/80">
                      <span className="shrink-0 px-1 rounded bg-black/[0.04]">{it.locationName}</span>
                      {it.evidence
                        ? <span className="leading-snug"><span className="text-muted-foreground/55">来源 · </span>{it.evidence}</span>
                        : <span className="text-gamboge">依据待考</span>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 二、关联人物 */}
      <section aria-label="关联人物">
        <div className="flex items-center gap-1.5 mb-2">
          <Users className="h-3.5 w-3.5 text-primary" />
          <h3 className="font-serif text-sm font-bold text-foreground">关联人物</h3>
          <span className="text-[10px] text-muted-foreground">只收可核查的真人与此地的关系</span>
        </div>
        {figures.length === 0 ? (
          <Empty text="这条线的人物资料还没生成 · 需要管线补 figures 字段" />
        ) : (
          <div className="space-y-2">
            {figures.map(f => (
              <div key={f.name} className="rounded-lg border border-border/60 bg-background p-2.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="seal-outline text-[11px] px-1.5 py-0.5 shrink-0">{f.name}</span>
                  {f.role && <span className="text-[11px] text-muted-foreground">{f.role}</span>}
                </div>
                {f.relation && <p className="text-[12px] text-foreground/85 leading-relaxed mt-1">{f.relation}</p>}
                {(f.works.length > 0 || f.places.length > 0) && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {f.places.map(p => (
                      <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{p}</span>
                    ))}
                    {f.works.map(w => (
                      <span key={w} className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/[0.05] text-muted-foreground border border-border/60">{w}</span>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground/80 mt-1 leading-relaxed">
                  {f.evidence
                    ? <><span className="text-muted-foreground/55">来源 · </span>{f.evidence}</>
                    : <span className="text-gamboge">依据待考</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 三、人物—地点—作品 */}
      <section aria-label="人物地点作品关系">
        <div className="flex items-center gap-1.5 mb-2">
          <Share2 className="h-3.5 w-3.5 text-primary" />
          <h3 className="font-serif text-sm font-bold text-foreground">人物 · 地点 · 作品</h3>
        </div>
        {figures.length === 0 ? (
          <Empty text="有了一位人物和他的作品，这张关系图才画得出来" />
        ) : (
          <div className="rounded-lg border border-border/60 bg-background p-3 space-y-2.5">
            <div className="grid grid-cols-3 text-[10px] text-muted-foreground/80">
              <span>人物</span><span className="text-center">作品</span><span className="text-right">地点</span>
            </div>
            {figures.map(f => (
              <div key={`rel-${f.name}`} className="grid grid-cols-3 items-center gap-1">
                <div className="justify-self-start">
                  <span className="seal-outline text-[10px] px-1.5 py-0.5">{f.name}</span>
                </div>
                <div className="min-w-0 px-1">
                  <div className="relative">
                    <span className="absolute left-0 right-0 top-1/2 border-t border-dashed border-border" aria-hidden="true" />
                    <div className="relative flex flex-col items-center gap-0.5">
                      {(f.works.length ? f.works : ['—']).slice(0, 3).map(w => (
                        <span key={w} className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-border/70 text-foreground/75 max-w-full truncate">{w}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="justify-self-end flex flex-col items-end gap-0.5">
                  {(f.places.length ? f.places : ['—']).slice(0, 3).map(p => (
                    <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary max-w-full truncate">{p}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
