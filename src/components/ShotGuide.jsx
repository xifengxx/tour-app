import { useState } from 'react';
import { Aperture, ChevronDown, ChevronUp, Compass, MapPin, Sun, TriangleAlert, Camera } from 'lucide-react';

/**
 * 机位 · 构图（P1-7）。
 *
 * 写的不是"艺术构图理论"，而是现场能照着做的四件事：
 * 站哪、朝哪、怎么构、什么时候来。避开项单独标出来，比正面建议更容易用上。
 * 数据来自 locations.shot（仓库 JSON 兜底）：
 *   shot[i] = { title, position, direction, formula, time, avoid }
 */

const Line = ({ icon: Icon, label, text, warn = false }) => {
  if (!text) return null;
  return (
    <div className="flex gap-2 text-[12px] leading-relaxed">
      <span className="shrink-0 inline-flex items-center gap-1 w-12 text-muted-foreground/75">
        <Icon className="h-3 w-3" />{label}
      </span>
      <span className={warn ? 'text-gamboge' : 'text-foreground/85'}>{text}</span>
    </div>
  );
};

export default function ShotGuide({ shots = [], defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!shots.length) return null;

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-background my-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-black/[0.02] transition-colors"
      >
        <Aperture className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-serif text-xs font-semibold text-foreground">机位 · 构图</span>
        <span className="text-[10px] text-muted-foreground">{shots.length} 处</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          {shots.map((s, i) => (
            <div key={`${s.title || 'shot'}-${i}`} className="rounded-md bg-secondary/40 border-l-2 border-gamboge/60 px-2.5 py-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Camera className="h-3 w-3 text-primary/80 shrink-0" />
                <span className="text-[12px] font-semibold text-foreground leading-snug">{s.title || `机位 ${i + 1}`}</span>
              </div>
              <Line icon={MapPin} label="站哪" text={s.position} />
              <Line icon={Compass} label="朝哪" text={s.direction} />
              <Line icon={Aperture} label="怎么构" text={s.formula} />
              <Line icon={Sun} label="时段" text={s.time} />
              <Line icon={TriangleAlert} label="避开" text={s.avoid} warn />
            </div>
          ))}
          <div className="text-[10px] text-muted-foreground/70 pt-0.5">
            机位按实地可站位置写 · 只描述站位与取景，不涉及器材推荐
          </div>
        </div>
      )}
    </div>
  );
}
