import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, MapPin, Quote, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchVisits, fetchFavorites, deleteVisit, markVisitInCache } from '../lib/visits';
import { storySeedFor } from '../lib/storySeed';

function tourNameOf(tourId, fallback) {
  const seed = storySeedFor(tourId);
  return seed?.tourName || fallback || '未命名导览';
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function Recollections() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [visits, setVisits] = useState([]);
  const [favs, setFavs] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) { setBusy(false); return; }
    let alive = true;
    (async () => {
      try {
        const [v, f] = await Promise.all([fetchVisits(), fetchFavorites()]);
        if (!alive) return;
        setVisits(v);
        setFavs(f);
      } catch (e) {
        if (alive) setErr(e?.message || '读取失败');
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [user, loading]);

  const remove = async (id, locId) => {
    try {
      await deleteVisit(id);
      setVisits(prev => prev.filter(x => x.id !== id));
      const still = visits.some(x => x.id !== id && x.loc_id === locId);
      if (!still) markVisitInCache(locId, false);
    } catch (e) {
      setErr(e?.message || '删除失败');
    }
  };

  const groups = visits.reduce((acc, v) => {
    (acc[v.tour_id] = acc[v.tour_id] || []).push(v);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-5 py-8">
        <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" /> 返回首页
        </button>

        <div className="flex items-center gap-3 mb-2">
          <span className="w-9 h-9 rounded-sm border-2 border-primary text-primary font-serif font-bold flex items-center justify-center">印</span>
          <h1 className="font-serif text-2xl font-bold text-foreground">我的回忆</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
          行印是到过的地方，藏印是想去或记下的地方。两样都只在你亲手按下时出现。
        </p>

        {!user && !loading && (
          <div className="bg-card border border-border rounded-lg p-6 text-center">
            <div className="text-foreground font-serif mb-2">登录后才能留住印</div>
            <p className="text-muted-foreground text-sm mb-4">行印与藏印存在你的账户里，换设备也还在。</p>
            <button onClick={() => navigate('/login')} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm">去登录</button>
          </div>
        )}

        {user && busy && <div className="text-muted-foreground text-sm">正在取印…</div>}
        {err && <div className="text-primary text-xs mb-4">{err}</div>}

        {user && !busy && visits.length === 0 && favs.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <div className="text-foreground font-serif mb-2">还没有留下印</div>
            <p className="text-muted-foreground text-sm leading-relaxed">进一条导览，在地点详情里盖「藏印」或「行印」。盖过的印会一件件攒在这里。</p>
          </div>
        )}

        {user && Object.keys(groups).length > 0 && (
          <section className="mb-10">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-5 h-5 rounded-sm border border-primary text-primary font-serif font-bold text-[11px] flex items-center justify-center">行</span>
              <h2 className="font-serif font-bold text-foreground">行印 · 到过的 {visits.length} 处</h2>
            </div>
            {Object.entries(groups).map(([tourId, list]) => (
              <div key={tourId} className="mb-6">
                <button onClick={() => navigate(`/tour/${tourId}`)} className="text-sm font-serif font-semibold text-foreground hover:text-primary mb-2">
                  {tourNameOf(tourId, list[0]?.tour_name)}
                </button>
                <div className="space-y-3">
                  {list.map(v => (
                    <div key={v.id} className="bg-card border border-border rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5 text-foreground font-serif font-semibold">
                            <MapPin className="h-3.5 w-3.5 text-primary/80" /> {v.loc_name || '未命名地点'}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">{fmtDate(v.visited_at)}</div>
                        </div>
                        <button onClick={() => remove(v.id, v.loc_id)} className="text-muted-foreground hover:text-primary p-1" aria-label="删除这条行印">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {v.photos?.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          {v.photos.map((p, i) => (
                            <img key={i} src={p.url} alt={p.caption || ''} className="aspect-square w-full object-cover rounded-md border border-border" />
                          ))}
                        </div>
                      )}

                      {v.favorite_figure && (
                        <div className="flex items-center gap-1.5 mt-3 text-xs text-primary">
                          <User className="h-3 w-3" /> 此行最记住：{v.favorite_figure}
                        </div>
                      )}

                      {v.quote && (
                        <div className="mt-2 font-kai text-[15px] leading-relaxed text-[#5d5142] flex gap-1.5">
                          <Quote className="h-3.5 w-3.5 text-gamboge shrink-0 mt-0.5" />
                          <span>{v.quote}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {user && !busy && favs.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="w-5 h-5 rounded-sm border border-primary text-primary font-serif font-bold text-[11px] flex items-center justify-center">藏</span>
              <h2 className="font-serif font-bold text-foreground">藏印 · 记下的 {favs.length} 处</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {favs.map(f => (
                <button key={f.id} onClick={() => navigate(`/tour/${f.tour_id}`)}
                  className="px-3 py-1.5 rounded-full border border-border text-sm text-foreground hover:border-primary/50">
                  {f.loc_name || '未命名地点'}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
