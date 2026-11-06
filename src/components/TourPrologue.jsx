import { ArrowRight, MapPinned, X } from 'lucide-react';
import StorySections from './StorySections';
import { summarizeStory } from '../lib/story';

/**
 * 行前案头（整页）。
 *
 * 产品里「行前」和「行中」是两件事：案头是"进山之前读的"，地图页是"进山之后用的"。
 * 所以这里不做弹层、也不做 tab——首访整页读，读完点「开始导览」进地图，
 * 复访直接落地图页，想回看从概览顶部的入口再进来。
 */
export default function TourPrologue({ tour, route, locById = {}, loading = false, onStart, onLookMap }) {
  const { timeline, figures } = summarizeStory(route, locById);

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-lg px-5 pt-8 pb-28">
        {/* 卷首 */}
        <div className="text-center mb-6">
          <div className="text-[10px] tracking-[0.3em] text-muted-foreground mb-2">行前 · 案头</div>
          <h1 className="font-serif text-2xl font-bold text-foreground leading-tight">
            {tour?.meta?.title || '山 水'}
          </h1>
          {route?.title && (
            <div className="text-[11px] text-muted-foreground mt-1.5">{route.title}</div>
          )}
          <div className="mt-3 inline-flex items-center gap-1 text-[11px] text-foreground/70 bg-secondary/50 border border-border/60 rounded-full px-3 py-1">
               {loading ? (
              <span>正在铺开案头</span>
            ) : (
              <>
                <span>{timeline.length ? `${timeline.length} 个时期` : '时期待补'}</span>
                <span className="text-muted-foreground/50">·</span>
                <span>{figures.length ? `${figures.length} 位人物` : '人物待补'}</span>
              </>
            )}
          </div>
          <p className="font-kai text-[13px] text-foreground/70 leading-relaxed mt-4">
            先弄清它怎么变成今天这样、谁在这里留下过痕迹，再动身。
          </p>
        </div>

        <div className="h-px bg-border/60 mb-6" aria-hidden="true" />

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="案头资料载入中">
            <div className="h-24 rounded-lg bg-secondary/40 animate-pulse" />
            <div className="h-16 rounded-lg bg-secondary/30 animate-pulse" />
            <div className="h-20 rounded-lg bg-secondary/20 animate-pulse" />
          </div>
        ) : (
          <StorySections timeline={timeline} figures={figures} />
        )}

        <div className="text-center text-[10px] text-muted-foreground/70 mt-8 pt-4 border-t border-border/50">
          资料均标注出处 · 无出处者标「依据待考」
        </div>
      </div>

      {/* 底部固定 CTA：进山的那个动作只有一下 */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border/60 bg-card/95 backdrop-blur px-4 py-3">
        <div className="mx-auto max-w-lg flex items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground font-serif text-sm font-semibold py-2.5 hover:brightness-110 transition"
          >
            <MapPinned className="h-4 w-4" />开始导览
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onLookMap}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground py-2"
          >
            <X className="h-3 w-3" />跳过，直接看地图
          </button>
        </div>
      </div>
    </div>
  );
}
