import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { searchTours, filterByCategory } from '../lib/filterTours';
import { useAuth } from '../contexts/AuthContext';
import NavBar from '../components/NavBar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, MoreHorizontal, Heart } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

const STATIC_TOURS = [
  {
    id: 'nanyue-hengshan',
    title: '剑出衡山 · 南岳巡礼',
    subtitle: '跟着赵荣的脚步，登五神峰寻剑神之路',
    theme: { primaryColor: '#c0392b' },
    destination: { name: '南岳衡山', region: '湖南省衡阳市' },
    stats: { locations: 21, routes: 5 },
  },
  {
    id: 'huashan-xiaoao',
    title: '笑傲江湖 · 华山巡礼',
    subtitle: '跟着令狐冲，上思过崖寻独孤九剑',
    theme: { primaryColor: '#c0392b' },
    destination: { name: '华山', region: '陕西省华阴市' },
    stats: { locations: 19, routes: 3 },
  },
];

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

  // Sync tab from URL params (for dropdown menu navigation)
  useEffect(() => {
    setTab(tabFromParams(searchParams));
  }, [searchParams]);

  // Fetch public tours
  useEffect(() => {
    supabase
      .from('tours')
      .select('id, title, subtitle, destination, theme, is_public, created_at, locations(count), routes(count)')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setPublicTours(data);
      });
  }, []);

  // Fetch user's own tours
  useEffect(() => {
    if (!user) { setMyTours([]); return; }
    setMyToursLoading(true);
    supabase
      .from('tours')
      .select('id, title, subtitle, destination, theme, is_public, created_at, locations(count), routes(count)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setMyTours(data);
        setMyToursLoading(false);
      });
  }, [user]);

  // 加载我的收藏（DB + 静态导览混合）
  useEffect(() => {
    if (!user) { setFavIds(new Set()); setFavTours([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('favorites').select('tour_id').eq('user_id', user.id);
      if (cancelled || !data) { if (!cancelled) { setFavIds(new Set()); setFavTours([]); } return; }
      const ids = data.map(f => f.tour_id);
      setFavIds(new Set(ids));
      const staticFavs = STATIC_TOURS.filter(s => ids.includes(s.id));
      const dbIds = ids.filter(id => !STATIC_TOURS.find(s => s.id === id));
      let dbFavs = [];
      if (dbIds.length > 0) {
        const { data: rows } = await supabase
          .from('tours')
          .select('id, title, subtitle, destination, theme, is_public, created_at, locations(count), routes(count)')
          .in('id', dbIds);
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
      await supabase.from('favorites').delete().eq('user_id', user.id).eq('tour_id', tour.id);
      setFavIds(prev => { const s = new Set(prev); s.delete(tour.id); return s; });
      setFavTours(prev => prev.filter(t => t.id !== tour.id));
    } else {
      await supabase.from('favorites').insert({ user_id: user.id, tour_id: tour.id });
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
    }
  };

  // 删除导览（子表有 ON DELETE CASCADE，会连带删除地点/路线/内容）
  const deleteTour = async (tour) => {
    if (!window.confirm(`确定删除「${tour.title}」？将同时删除其所有地点、路线和内容，且不可恢复。`)) return;
    const { error } = await supabase.from('tours').delete().eq('id', tour.id);
    if (!error) {
      setMyTours(prev => prev.filter(t => t.id !== tour.id));
    }
  };

  const renderTourCard = (tour, isMyTour) => (
    <div key={tour.id} className="relative group">
      <Link
        to={`/tour/${tour.id}`}
        className="block bg-card rounded-2xl p-5 hover:bg-secondary transition-colors border border-border"
      >
        {/* 标题留右侧空间给「已发布 + ⋮」徽标区，避免重叠 */}
        <h2 className={`text-base font-serif font-bold text-foreground mb-2 ${isMyTour ? 'pr-28' : ''}`}>{tour.title}</h2>
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{tour.subtitle}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>📍 {tour.destination?.name || '—'}{tour.destination?.region ? ` · ${tour.destination.region}` : ''}</span>
          {(tour.stats?.routes ?? tour.routes?.[0]?.count) != null && (
            <span>🗺 {tour.stats?.routes ?? tour.routes?.[0]?.count} 路线</span>
          )}
          {/* 地点数移至底部信息行，与右上角状态徽标分离 */}
          <span className="px-2 py-0.5 rounded-full bg-black/5">
            {tour.stats?.locations ?? tour.locations?.[0]?.count ?? '?'} 地点
          </span>
        </div>
      </Link>

      {/* 收藏 ♥（发现/收藏 tab 卡片） */}
      {!isMyTour && user && (
        <button
          onClick={() => toggleFav(tour)}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/5 flex items-center justify-center hover:bg-black/10 transition-colors"
          title={favIds.has(tour.id) ? '取消收藏' : '收藏'}
          aria-label={favIds.has(tour.id) ? '取消收藏' : '收藏'}
        >
          <Heart className={`h-3.5 w-3.5 ${favIds.has(tour.id) ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
        </button>
      )}

      {/* My tour: status badge + actions menu */}
      {isMyTour && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            tour.is_public
              ? 'bg-green-600/20 text-green-700'
              : 'bg-black/10 text-muted-foreground'
          }`}>
            {tour.is_public ? '已发布' : '私密'}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-6 h-6 rounded-full bg-black/10 text-muted-foreground flex items-center justify-center hover:bg-black/10 transition-colors"
                aria-label="导览操作"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => navigate(`/tour/${tour.id}/edit`)}>
                ✏️ 编辑导览
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => togglePublic(tour)}>
                {tour.is_public ? '🔒 设为私密' : '🌍 设为公开'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => deleteTour(tour)} className="text-primary focus:text-primary focus:bg-primary/10">
                🗑️ 删除导览
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      {/* Tabs + Create button */}
      <div className="flex items-end gap-2 px-4 pt-3 pb-1 max-w-4xl mx-auto">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="flex items-center justify-between">
            <TabsList className="bg-transparent p-0 h-auto gap-1">
              <TabsTrigger value="explore" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border data-[state=active]:border-primary/20 text-muted-foreground">
                🔍 发现
              </TabsTrigger>
              <TabsTrigger value="my" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border data-[state=active]:border-primary/20 text-muted-foreground">
                📋 我的导览
              </TabsTrigger>
              {user && (
                <TabsTrigger value="fav" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border data-[state=active]:border-primary/20 text-muted-foreground">
                  🔖 我的收藏
                </TabsTrigger>
              )}
            </TabsList>

            {user && (
              <button
                onClick={() => navigate('/create')}
                className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3 w-3" />
                创建
              </button>
            )}
          </div>

          {/* Subtitle */}
          <p className="text-muted-foreground text-xs mt-3 mb-2">
            {tab === 'explore' ? '带着小说去旅行，在每一处山崖找到书中的江湖'
              : tab === 'fav' ? '收藏想去的导览，随时出发'
              : '管理你创建的导览'}
          </p>

          {/* Tour Cards */}
          <TabsContent value="explore" className="mt-0">
            {/* 搜索 + 分类 */}
            <div className="mb-4 space-y-2">
              <div className="relative">
                <input
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  placeholder="搜索导览：目的地 / 作品 / 地区…"
                  className="w-full bg-card text-foreground rounded-xl px-4 py-2.5 text-sm border border-border outline-none focus:border-primary transition-colors"
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
                    className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs transition-colors ${
                      category === c
                        ? 'bg-primary text-white'
                        : 'bg-black/5 text-muted-foreground hover:bg-black/10'
                    }`}
                  >{c}</button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {filteredTours.length > 0 ? (
                filteredTours.map(tour => renderTourCard(tour, false))
              ) : (
                <div className="col-span-2 text-center py-16 text-muted-foreground">
                  <div className="text-4xl mb-3">🔍</div>
                  <p>没有匹配的导览</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="my" className="mt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              {!user ? (
                <div className="col-span-2 text-center py-16">
                  <div className="text-4xl mb-3">🔐</div>
                  <p className="text-muted-foreground mb-4">登录后查看你创建的导览</p>
                  <button
                    onClick={() => navigate('/login')}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
                  >
                    去登录
                  </button>
                </div>
              ) : myToursLoading ? (
                <div className="col-span-2 text-center py-16 text-muted-foreground">
                  <p>加载中...</p>
                </div>
              ) : myTours.length > 0 ? (
                myTours.map(tour => renderTourCard(tour, true))
              ) : (
                <div className="col-span-2 text-center py-16 text-muted-foreground">
                  <div className="text-4xl mb-3">📝</div>
                  <p className="mb-2">还没有创建导览</p>
                  <button
                    onClick={() => navigate('/create')}
                    className="text-primary text-sm hover:text-primary transition-colors"
                  >
                    + 创建第一条导览
                  </button>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="fav" className="mt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              {!user ? (
                <div className="col-span-2 text-center py-16">
                  <div className="text-4xl mb-3">🔐</div>
                  <p className="text-muted-foreground mb-4">登录后查看你的收藏</p>
                  <button
                    onClick={() => navigate('/login')}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors"
                  >
                    去登录
                  </button>
                </div>
              ) : favTours.length > 0 ? (
                favTours.map(tour => renderTourCard(tour, false))
              ) : (
                <div className="col-span-2 text-center py-16 text-muted-foreground">
                  <div className="text-4xl mb-3">🤍</div>
                  <p>还没有收藏的导览，去发现页点 ♥ 收藏吧</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
