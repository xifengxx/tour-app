import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Mountain, Feather, Bookmark } from 'lucide-react';
import { ImportanceStars } from './ContentCard';
import ShotGuide from './ShotGuide';
import VisitStampModal from './VisitStampModal';
import { layerIconOf } from '../lib/layerIcons';
import { useAuth } from '../contexts/AuthContext';
import {
  addFavorite, removeFavorite, markFavInCache, hasFavInCache, hasVisitInCache,
} from '../lib/visits';

export default function DetailModal({ loc, layers, onClose, tourId }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fav, setFav] = useState(() => (loc ? hasFavInCache(loc.id) : false));
  const [favBusy, setFavBusy] = useState(false);
  const [visited, setVisited] = useState(() => (loc ? hasVisitInCache(loc.id) : false));
  const [stampOpen, setStampOpen] = useState(false);

  // 弹层不销毁时切换到另一个地点，两印状态要跟着换
  useEffect(() => {
    if (!loc) return;
    setFav(hasFavInCache(loc.id));
    setVisited(hasVisitInCache(loc.id));
    setStampOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc?.id]);

  if (!loc) return null;

  const toggleFav = async () => {
    if (!user) { navigate('/login'); return; }
    setFavBusy(true);
    try {
      if (fav) {
        await removeFavorite(loc.id);
        markFavInCache(loc.id, false);
        setFav(false);
      } else {
        await addFavorite({ userId: user.id, tourId, locId: loc.id, locName: loc.name });
        markFavInCache(loc.id, true);
        setFav(true);
      }
    } catch (e) {
      // 失败时不改本地状态，保持与服务端一致
      console.error(e);
    } finally {
      setFavBusy(false);
    }
  };

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
                {(() => { const Icon = layerIconOf(layer); return <Icon className="h-3.5 w-3.5" style={{ color: layer.color }} />; })()}
                {layer.name}
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

        <ShotGuide shots={loc.shot} defaultOpen />

        {loc.reflection && (
          <div className="border border-primary/25 bg-primary/[0.04] rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-primary font-serif text-xs font-semibold mb-1">
              <Feather className="h-3 w-3" /> 驻足一想
            </div>
            <div className="text-[#6b5a44] text-sm leading-relaxed">{loc.reflection}</div>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-border flex items-center gap-3">
          <button
            onClick={toggleFav}
            disabled={favBusy}
            className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors disabled:opacity-60 ${
              fav ? 'border-primary/60 bg-primary/[0.06] text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
            }`}
          >
            <span className={`w-5 h-5 rounded-sm border font-serif font-bold text-[11px] flex items-center justify-center ${fav ? 'border-primary text-primary' : 'border-muted-foreground/50'}`}>
              藏
            </span>
            <span className="text-xs">{fav ? '已藏印' : '盖藏印'}</span>
            <Bookmark className={`h-3.5 w-3.5 ${fav ? 'text-primary' : 'text-muted-foreground/70'}`} />
          </button>

          <button
            onClick={() => { if (!user) { navigate('/login'); return; } setStampOpen(true); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${
              visited ? 'border-primary/60 bg-primary/[0.06] text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
            }`}
          >
            <span className={`w-5 h-5 rounded-sm border font-serif font-bold text-[11px] flex items-center justify-center ${visited ? 'border-primary text-primary' : 'border-muted-foreground/50'}`}>
              行
            </span>
            <span className="text-xs">{visited ? '已留行印' : '在此留印'}</span>
          </button>
        </div>
        <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
          藏印是收藏，行印是到访。行印只在你点「盖下行印」后记录，看页面不算到过。
        </div>
      </div>

      {stampOpen && (
        <VisitStampModal
          tourId={tourId}
          loc={loc}
          onClose={() => setStampOpen(false)}
          onSaved={() => setVisited(true)}
        />
      )}
    </div>
  );
}
