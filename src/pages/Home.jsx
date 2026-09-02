import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getErrorMessage } from '../lib/errorMessage';
import { STATIC_TOURS } from '../lib/staticTours';
import { searchTours, filterByCategory } from '../lib/filterTours';
import { useAuth } from '../contexts/AuthContext';
import NavBar from '../components/NavBar';
import SealLogo from '../components/SealLogo';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Plus, MoreHorizontal, Heart, MapPin, Route as RouteIcon, Search,
  Compass, LibraryBig, Bookmark, Pencil, Lock, Globe, Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tabFromParams = p => (p.get('tab') === 'my' || p.get('tab') === 'fav') ? p.get('tab') : 'explore';
  const [tab, setTab] = useState(tabFromParams(searchParams));
  const [publicTours, setPublicTours] = useState([]);
  const [myTours, setMyTours] = useState([]);
  const [myToursLoading, setMyToursLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('全部');
  const [favIds, setFavIds] = useState(new Set());
  const [favTours, setFavTours] = useState([]);
  const [notice, setNotice] = useState('');

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };

  // Sync tab from URL params (for dropdown menu navigation)
  useEffect(() => {
    setTab(tabFromParams(searchParams));
  }, [searchParams]);

  // Fetch public tours
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('tours')
      .select('id, title, subtitle, destination, theme, is_public, created_at, locations(count), routes(count)')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) showNotice(getErrorMessage(error, '公开导览加载失败'));
        else if (data) setPublicTours(data);
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch user's own tours
  useEffect(() => {
    if (!user) { setMyTours([]); return; }
    setMyToursLoading(true);
    let cancelled = false;
    supabase
      .from('tours')
      .select('id, title, subtitle, destination, theme, is_public, created_at, locations(count), routes(count)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) showNotice(getErrorMessage(error, '我的导览加载失败'));
        else if (data) setMyTours(data);
        setMyToursLoading(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  // 加载我的收藏（DB + 静态导览混合）
  useEffect(() => {
    if (!user) { setFavIds(new Set()); setFavTours([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('favorites').select('tour_id').eq('user_id', user.id);
      if (cancelled) return;
      if (error || !data) {
        setFavIds(new Set());
        setFavTours([]);
        showNotice(getErrorMessage(error, '收藏加载失败'));
        return;
      }
      const ids = data.map(f => f.tour_id);
      setFavIds(new Set(ids));
      const staticFavs = STATIC_TOURS.filter(s => ids.includes(s.id));
      const dbIds = ids.filter(id => !STATIC_TOURS.find(s => s.id === id));
      let dbFavs = [];
      if (dbIds.length > 0) {
        const { data: rows, error: rowsError } = await supabase
          .from('tours')
          .select('id, title, subtitle, destination, theme, is_public, created_at, locations(count), routes(count)')
          .in('id', dbIds);
        if (rowsError) {
          showNotice(getErrorMessage(rowsError, '收藏的导览加载失败'));
          return;
        }
        dbFavs = rows || [];
      }
      if (!cancelled) setFavTours([...dbFavs, ...staticFavs]);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // 切换收藏
  const toggleFav = async (tour) => {
    if (!user) { navigate('/login'); return; }
    const isFav = favIds.has(tour.id);
    if (isFav) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', user.id).eq('tour_id', tour.id);
      if (error) { showNotice(getErrorMessage(error, '取消收藏失败')); return; }
      setFavIds(prev => { const s = new Set(prev); s.delete(tour.id); return s; });
      setFavTours(prev => prev.filter(t => t.id !== tour.id));
    } else {
      const { error } = await supabase.from('favorites').insert({ user_id: user.id, tour_id: tour.id });
      if (error) { showNotice(getErrorMessage(error, '收藏失败')); return; }
      setFavIds(prev => new Set(prev).add(tour.id));
      setFavTours(prev => [tour, ...prev]);
    }
  };

  const allTours = [
    ...STATIC_TOURS,
    ...publicTours.filter(st => !STATIC_TOURS.find(s => s.id === st.id)),
  ];

  // 搜索 + 分类过滤（客户端，数据量小）
  const filteredTours = filterByCategory(searchTours(allTours, keyword), category);
  const CATEGORIES = ['全部', '名山', '湖泊', '人文', '其他'];

  // 切换公开/私密
  const togglePublic = async (tour) => {
    const newVal = !tour.is_public;
    const { error } = await supabase.from('tours').update({ is_public: newVal }).eq('id', tour.id);
    if (!error) {
      setMyTours(prev => prev.map(t => t.id === tour.id ? { ...t, is_public: newVal } : t));
      // 同步「发现」页：设为公开 → 加入公开列表；设为私密 → 移除（无需刷新）
      setPublicTours(prev => newVal
        ? (prev.some(t => t.id === tour.id) ? prev : [{ ...tour, is_public: true }, ...prev])
        : prev.filter(t => t.id !== tour.id)
      );
    } else showNotice(getErrorMessage(error, '更新发布状态失败'));
  };

  // 删除导览（子表有 ON DELETE CASCADE，会连带删除地点/路线/内容）
  const deleteTour = async (tour) => {
    if (!window.confirm(`确定删除「${tour.title}」？将同时删除其所有地点、路线和内容，且不可恢复。`)) return;
    const { error } = await supabase.from('tours').delete().eq('id', tour.id);
    if (!error) {
      setMyTours(prev => prev.filter(t => t.id !== tour.id));
    } else showNotice(getErrorMessage(error, '删除导览失败'));
  };

  const renderTourCard = (tour, isMyTour, idx = 0) => (
    <div key={tour.id} className="relative group anim-rise" style={{ animationDelay: `${Math.min(idx, 8) * 60}ms` }}>
      <Link
        to={`/tour/${tour.id}`}
        className="book-card relative block bg-card rounded-lg border border-border overflow-hidden hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_12px_30px_-14px_rgba(28,26,22,0.35)]"
      >
        {/* 朱砂书脊：hover 时生长 */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary/85 transition-all duration-200 group-hover:w-[5px]" />
        <div className="p-5 pl-6">
          {/* 标题留右侧空间给「已发布 + ⋮」徽标区，避免重叠 */}
          <h2 className={`relative text-lg font-serif font-bold text-foreground leading-snug mb-1.5 group-hover:text-primary transition-colors
            after:absolute after:left-0 after:-bottom-0.5 after:h-[2px] after:w-0 after:bg-primary/70 after:transition-all after:duration-300 group-hover:after:w-10
            ${isMyTour ? 'pr-28' : 'pr-8'}`}>{tour.title}</h2>
          <p className="text-sm text-muted-foreground mb-4 line-clamp-2 leading-relaxed">{tour.subtitle}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3 text-primary/70" />
              {tour.destination?.name || '—'}{tour.destination?.region ? ` · ${tour.destination.region}` : ''}
            </span>
            {(tour.stats?.routes ?? tour.routes?.[0]?.count) != null && (
              <span className="inline-flex items-center gap-1">
                <RouteIcon className="h-3 w-3 text-dai/80" />
                {tour.stats?.routes ?? tour.routes?.[0]?.count} 路线
              </span>
            )}
            {/* 地点数移至底部信息行，与右上角状态徽标分离 */}
            <span className="px-2 py-0.5 rounded-full bg-black/[0.04] border border-border/60">
              {tour.stats?.locations ?? tour.locations?.[0]?.count ?? '?'} 地点
            </span>
          </div>
        </div>
      </Link>

      {/* 收藏 ♥（发现/收藏 tab 卡片） */}
      {!isMyTour && user && (
        <button
          onClick={() => toggleFav(tour)}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center hover:border-primary/40 transition-colors before:absolute before:-inset-2 before:content-['']"
          title={favIds.has(tour.id) ? '取消收藏' : '收藏'}
          aria-label={favIds.has(tour.id) ? '取消收藏' : '收藏'}
        >
          <Heart className={`h-3.5 w-3.5 ${favIds.has(tour.id) ? 'fill-primary text-primary anim-stamp' : 'text-muted-foreground'}`} />
        </button>
      )}

      {/* My tour: 状态印戳 + 操作菜单 */}
      {isMyTour && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className={`seal-outline text-[10px] px-1.5 py-1 ${
            tour.is_public ? 'text-primary bg-primary/5' : 'text-muted-foreground bg-black/[0.03]'
          }`}>
            {tour.is_public ? '已发布' : '私密'}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="relative w-6 h-6 rounded-full bg-black/[0.05] text-muted-foreground flex items-center justify-center hover:bg-black/10 transition-colors before:absolute before:-inset-2.5 before:content-['']"
                aria-label="导览操作"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => navigate(`/tour/${tour.id}/edit`)}>
                <Pencil className="h-3.5 w-3.5 mr-1" /> 编辑导览
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => togglePublic(tour)}>
                {tour.is_public
                  ? <><Lock className="h-3.5 w-3.5 mr-1" /> 设为私密</>
                  : <><Globe className="h-3.5 w-3.5 mr-1" /> 设为公开</>}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => deleteTour(tour)} className="text-primary focus:text-primary focus:bg-primary/10">
                <Trash2 className="h-3.5 w-3.5 mr-1" /> 删除导览
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  const renderEmpty = (icon, text, action) => (
    <div className="col-span-2 text-center py-16">
      <div className="w-14 h-14 mx-auto mb-4 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <p className="text-muted-foreground text-sm mb-4">{text}</p>
      {action}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      {notice && <div role="status" className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-card border border-border rounded-xl shadow-lg text-sm text-primary">{notice}</div>}

      {/* ── Hero · 门面：对联式双竖排 + 菱形饰线 ── */}
      <header className="max-w-4xl mx-auto px-4 pt-9 pb-2">
        <div className="flex items-start justify-between gap-4">
          {/* 上联（桌面端） */}
          <div className="vertical-rl font-kai text-sm text-muted-foreground/70 pt-2 select-none hidden sm:block anim-rise" style={{ animationDelay: '80ms' }}>
            于山水间读江湖
          </div>

          <div className="flex-1 text-center anim-rise">
            <div className="flex items-center justify-center gap-3.5 mb-2.5">
              <SealLogo size={44} animate />
              <h1 className="font-serif font-black text-4xl sm:text-[2.6rem] tracking-[0.12em] text-foreground">文学巡礼</h1>
            </div>
            <p className="text-[11px] tracking-[0.35em] text-muted-foreground uppercase">
              Literary&nbsp;Pilgrimage&nbsp;·&nbsp;纸上山河
            </p>
          </div>

          {/* 下联 */}
          <div className="vertical-rl font-kai text-sm text-muted-foreground/70 pt-2 select-none anim-rise" style={{ animationDelay: '160ms' }}>
            带着小说去旅行
          </div>
        </div>

        <div className="rule-ornament mt-6 max-w-md mx-auto anim-rise" style={{ animationDelay: '220ms' }}><span /></div>
      </header>

      {/* Tabs + Create button */}
      <div className="px-4 max-w-4xl mx-auto">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex items-center justify-between border-b border-border">
            <TabsList className="bg-transparent p-0 h-auto gap-5 rounded-none">
              {[
                { v: 'explore', label: '发现', icon: Compass },
                { v: 'my', label: '我的导览', icon: LibraryBig },
                ...(user ? [{ v: 'fav', label: '我的收藏', icon: Bookmark }] : []),
              ].map(({ v, label, icon: Icon }) => (
                <TabsTrigger
                  key={v}
                  value={v}
                  className="relative rounded-none px-1 pt-1 pb-2.5 text-sm font-serif font-semibold text-muted-foreground shadow-none
                    data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none
                    hover:text-foreground transition-colors
                    after:absolute after:left-0 after:right-0 after:-bottom-px after:h-[2px] after:bg-primary
                    after:origin-left after:scale-x-0 after:transition-transform after:duration-300
                    data-[state=active]:after:scale-x-100"
                >
                  <Icon className="h-3.5 w-3.5 mr-1.5 opacity-80" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {user && (
              <button
                onClick={() => navigate('/create')}
                className="btn-press flex items-center gap-1 px-3 py-2 mb-1 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90"
              >
                <Plus className="h-3 w-3" />
                创建
              </button>
            )}
          </div>

          {/* Subtitle */}
          <p className="font-kai text-muted-foreground text-xs mt-3 mb-3 tracking-wide">
            {tab === 'explore' ? '在每一处山崖，找到书中的江湖'
              : tab === 'fav' ? '收藏想去的导览，随时出发'
              : '管理你创建的导览'}
          </p>

          {/* Tour Cards */}
          <TabsContent value="explore" className="mt-0">
            {/* 搜索 + 分类 */}
            <div className="mb-4 space-y-2.5">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  placeholder="搜索导览：目的地 / 作品 / 地区…"
                  className="w-full bg-card text-foreground rounded-lg pl-9 pr-8 py-2.5 text-sm border border-border outline-none focus:border-primary transition-colors"
                />
                {keyword && (
                  <button
                    onClick={() => setKeyword('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm hover:text-foreground"
                    aria-label="清空搜索"
                  >✕</button>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {CATEGORIES.map(c => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs border transition-all hover:-translate-y-px ${
                      category === c
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-transparent text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                    }`}
                  >{c}</button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pb-10">
              {filteredTours.length > 0 ? (
                filteredTours.map((tour, i) => renderTourCard(tour, false, i))
              ) : (
                renderEmpty(<Search className="h-5 w-5" />, '没有匹配的导览')
              )}
            </div>
          </TabsContent>

          <TabsContent value="my" className="mt-0">
            <div className="grid gap-4 sm:grid-cols-2 pb-10">
              {!user ? (
                renderEmpty(
                  <Lock className="h-5 w-5" />,
                  '登录后查看你创建的导览',
                  <button
                    onClick={() => navigate('/login')}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
                  >
                    去登录
                  </button>
                )
              ) : myToursLoading ? (
                <div className="col-span-2 text-center py-16 text-muted-foreground">
                  <p>加载中...</p>
                </div>
              ) : myTours.length > 0 ? (
                myTours.map((tour, i) => renderTourCard(tour, true, i))
              ) : (
                renderEmpty(
                  <Pencil className="h-5 w-5" />,
                  '还没有创建导览',
                  <button
                    onClick={() => navigate('/create')}
                    className="text-primary text-sm hover:text-primary/80 transition-colors font-serif font-semibold"
                  >
                    + 创建第一条导览
                  </button>
                )
              )}
            </div>
          </TabsContent>

          <TabsContent value="fav" className="mt-0">
            <div className="grid gap-4 sm:grid-cols-2 pb-10">
              {!user ? (
                renderEmpty(
                  <Lock className="h-5 w-5" />,
                  '登录后查看你的收藏',
                  <button
                    onClick={() => navigate('/login')}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
                  >
                    去登录
                  </button>
                )
              ) : favTours.length > 0 ? (
                favTours.map((tour, i) => renderTourCard(tour, false, i))
              ) : (
                renderEmpty(<Bookmark className="h-5 w-5" />, '还没有收藏的导览，去发现页点 ♥ 收藏吧')
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
