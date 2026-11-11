import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchVisits, fetchFavorites } from '../lib/visits';
import { storySeedFor } from '../lib/storySeed';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

// 首页「我的回忆」页签：只给摘要与入口，完整列表在 /recollections
export default function RecollectSummary() {
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
        if (alive) setErr(e?.message || '读取回忆失败');
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [user, loading]);

  if (!user) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center">
        <p className="text-muted-foreground text-sm mb-4 font-kai">行印与藏印存在你的账户里，登录后才能留住。</p>
        <button onClick={() => navigate('/login')} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm">去登录</button>
      </div>
    );
  }

  if (busy) return <div className="text-muted-foreground text-sm py-6">正在取印…</div>;
  if (err) return <div className="text-primary text-xs py-4">{err}</div>;

  if (!visits.length && !favs.length) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <div className="text-foreground font-serif mb-2">还没有留下印</div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          进一条导览，在地点详情里盖「藏印」或「行印」。盖过的印会一件件攒在这里。
        </p>
        <button onClick={() => navigate('/')} className="mt-4 px-4 py-2 rounded-md border border-border text-sm text-muted-foreground hover:border-primary/50">
          去找一条导览
        </button>
      </div>
    );
  }

  const recent = visits.slice(0, 3);

  return (
    <div>
      <div className="flex items-center gap-4 mb-4 text-sm">
        <span className="flex items-center gap-1.5 text-foreground">
          <span className="w-5 h-5 rounded-sm border border-primary text-primary font-serif font-bold text-[11px] flex items-center justify-center">行</span>
          行印 {visits.length} 处
        </span>
        <span className="flex items-center gap-1.5 text-foreground">
          <span className="w-5 h-5 rounded-sm border border-primary text-primary font-serif font-bold text-[11px] flex items-center justify-center">藏</span>
          藏印 {favs.length} 处
        </span>
      </div>

      <div className="space-y-2">
        {recent.map(v => (
          <button
            key={v.id}
            onClick={() => navigate(`/tour/${v.tour_id}`)}
            className="w-full text-left bg-card border border-border rounded-lg p-3 flex items-center gap-3 hover:border-primary/40 transition-colors"
          >
            {v.photos?.[0]?.url ? (
              <img src={v.photos[0].url} alt="" className="w-12 h-12 rounded-md object-cover border border-border shrink-0" />
            ) : (
              <span className="w-12 h-12 rounded-md bg-secondary/60 flex items-center justify-center shrink-0">
                <MapPin className="h-4 w-4 text-primary/70" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-serif font-semibold text-foreground truncate">{v.loc_name || '未命名地点'}</span>
              <span className="block text-xs text-muted-foreground truncate">
                {storySeedFor(v.tour_id)?.tourName || ''} · {fmtDate(v.visited_at)}
              </span>
            </span>
          </button>
        ))}
      </div>

      <button
        onClick={() => navigate('/recollections')}
        className="mt-3 flex items-center gap-1 text-sm text-primary hover:underline"
      >
        查看全部回忆 <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
