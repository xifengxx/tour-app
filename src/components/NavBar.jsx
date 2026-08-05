import { ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SealLogo from './SealLogo';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export default function NavBar({ title, showBack, rightContent }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();

  const isHome = location.pathname === '/';
  const showBackArrow = showBack !== false && !isHome;
  const avatarLetter = user?.email ? user.email[0].toUpperCase() : '?';

  return (
    <nav className="sticky top-0 z-30 bg-card/90 backdrop-blur border-b border-border pointer-events-auto">
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="outline-none">
                    <Avatar className="h-8 w-8 ring-2 ring-primary/20 hover:ring-primary/50 transition-all">
                      <AvatarFallback>{avatarLetter}</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/?tab=my')}>
                    我的导览
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => signOut()}>
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
