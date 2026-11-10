import { useEffect, useState } from 'react';
import { Bookmark } from 'lucide-react';
import { useAuthOptional } from '../contexts/AuthContext';
import { addFavorite, removeFavorite, markFavInCache, hasFavInCache } from '../lib/visits';

// 藏印：地点级收藏，轻动作，随时可点。图标式，占用小。
export default function FavStampButton({ loc, tourId, className = '' }) {
  const { user } = useAuthOptional();
  const goLogin = () => { window.location.assign('/login'); };
  const [fav, setFav] = useState(() => (loc ? hasFavInCache(loc.id) : false));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loc) setFav(hasFavInCache(loc.id));
  }, [loc]);

  if (!loc) return null;

  const toggle = async (e) => {
    e.stopPropagation();
    if (!user) { goLogin(); return; }
    setBusy(true);
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
    } catch (err) {
      console.error(err); // 失败不改本地状态，保持与服务端一致
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-label={fav ? '取消藏印' : '盖藏印'}
      title={fav ? '已藏印，点击取消' : '藏印 · 收下这个地方'}
      className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors disabled:opacity-50
        ${fav ? 'text-primary bg-primary/[0.08]' : 'text-muted-foreground/70 hover:text-primary hover:bg-black/[0.04]'} ${className}`}
    >
      <Bookmark className={`h-3.5 w-3.5 ${fav ? 'fill-primary' : ''}`} />
    </button>
  );
}
