import { lazy, Suspense } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SealLogo from './SealLogo';

const UserMenu = lazy(() => import('./UserMenu'));

export default function NavBar({ title, showBack, rightContent }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();

  const isHome = location.pathname === '/';
  const showBackArrow = showBack !== false && !isHome;

  return (
    <nav className="sticky top-0 z-30 bg-card/90 backdrop-blur border-b border-border gold-hairline pointer-events-auto safe-top">
      <div className="flex items-center justify-between h-12 px-4 max-w-4xl mx-auto">
        {/* Left */}
        <div className="flex-shrink-0 w-16">
          {isHome ? (
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 outline-none"
              aria-label="回到首页"
            >
              <SealLogo size={26} />
            </button>
          ) : (
            showBackArrow && (
              <button
                onClick={() => navigate(-1)}
                className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-1"
                aria-label="返回上一页"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">返回</span>
              </button>
            )
          )}
        </div>

        {/* Center：首页不重复站名（hero 已展示），子页显示导览标题 */}
        {!isHome && (
          <button
            onClick={() => navigate('/')}
            className="flex-1 min-w-0 text-center text-foreground font-serif font-bold text-base hover:text-primary transition-colors truncate px-2"
          >
            {title || '文学巡礼'}
          </button>
        )}
        {isHome && <div className="flex-1" />}

        {/* Right */}
        <div className="flex-shrink-0 flex items-center justify-end gap-0.5">
          {rightContent != null ? rightContent : (
            user ? (
              <Suspense fallback={<span className="h-8 w-8" aria-hidden="true" />}>
                <UserMenu user={user} signOut={signOut} />
              </Suspense>
            ) : (
              <button
                onClick={() => navigate('/login')}
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                登录
              </button>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
