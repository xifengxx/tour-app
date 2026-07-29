import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import NavBar from '../components/NavBar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';

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
  const [tab, setTab] = useState(searchParams.get('tab') === 'my' ? 'my' : 'explore');
  const [publicTours, setPublicTours] = useState([]);
  const [myTours, setMyTours] = useState([]);
  const [myToursLoading, setMyToursLoading] = useState(false);

  // Sync tab from URL params (for dropdown menu navigation)
  useEffect(() => {
    setTab(searchParams.get('tab') === 'my' ? 'my' : 'explore');
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

  const allTours = [
    ...STATIC_TOURS,
    ...publicTours.filter(st => !STATIC_TOURS.find(s => s.id === st.id)),
  ];

  const renderTourCard = (tour, isMyTour) => (
    <div key={tour.id} className="relative group">
      <Link
        to={`/tour/${tour.id}`}
        className="block bg-card rounded-2xl p-5 hover:bg-secondary transition-colors border border-border"
      >
        <div className="flex items-start justify-between mb-2">
          <h2 className="text-base font-bold text-white pr-2">{tour.title}</h2>
          <span className="text-xs px-2 py-1 rounded-full bg-white/5 text-muted-foreground flex-shrink-0">
            {tour.stats?.locations ?? tour.locations?.[0]?.count ?? '?'} 地点
          </span>
        </div>
        <p className="text-sm text-gray-400 mb-3 line-clamp-2">{tour.subtitle}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>📍 {tour.destination?.name || '—'}</span>
          <span>{tour.destination?.region || ''}</span>
          {(tour.stats?.routes ?? tour.routes?.[0]?.count) != null && (
            <span>🗺 {tour.stats?.routes ?? tour.routes?.[0]?.count} 路线</span>
          )}
        </div>
      </Link>

      {/* My tour: status badge */}
      {isMyTour && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            tour.is_public
              ? 'bg-green-600/20 text-green-400'
              : 'bg-white/10 text-gray-400'
          }`}>
            {tour.is_public ? '已发布' : '私密'}
          </span>
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
              <TabsTrigger value="explore" className="data-[state=active]:bg-red-600/10 data-[state=active]:text-red-400 data-[state=active]:border data-[state=active]:border-red-600/20 text-gray-400">
                🔍 发现
              </TabsTrigger>
              <TabsTrigger value="my" className="data-[state=active]:bg-red-600/10 data-[state=active]:text-red-400 data-[state=active]:border data-[state=active]:border-red-600/20 text-gray-400">
                📋 我的导览
              </TabsTrigger>
            </TabsList>

            {user && (
              <button
                onClick={() => navigate('/create')}
                className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold hover:bg-red-700 transition-colors"
              >
                <Plus className="h-3 w-3" />
                创建
              </button>
            )}
          </div>

          {/* Subtitle */}
          <p className="text-muted-foreground text-xs mt-3 mb-2">
            {tab === 'explore' ? '带着小说去旅行，在每一处山崖找到书中的江湖' : '管理你创建的导览'}
          </p>

          {/* Tour Cards */}
          <TabsContent value="explore" className="mt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              {allTours.length > 0 ? (
                allTours.map(tour => renderTourCard(tour, false))
              ) : (
                <div className="col-span-2 text-center py-16 text-muted-foreground">
                  <div className="text-4xl mb-3">🗺️</div>
                  <p>暂无公开导览</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="my" className="mt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              {!user ? (
                <div className="col-span-2 text-center py-16">
                  <div className="text-4xl mb-3">🔐</div>
                  <p className="text-gray-400 mb-4">登录后查看你创建的导览</p>
                  <button
                    onClick={() => navigate('/login')}
                    className="px-6 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors"
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
                    className="text-red-400 text-sm hover:text-red-300 transition-colors"
                  >
                    + 创建第一条导览
                  </button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
