import { ChevronLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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
    <nav className="sticky top-0 z-30 bg-[#0f0f1a]/95 backdrop-blur border-b border-white/5 pointer-events-auto">
      <div className="flex items-center justify-between h-12 px-4 max-w-4xl mx-auto">
        {/* Left */}
        <div className="w-16">
          {showBackArrow && (
            <button
              onClick={() => navigate(-1)}
              className="text-gray-400 hover:text-white transition-colors text-sm flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">返回</span>
            </button>
          )}
        </div>

        {/* Center */}
        <button
          onClick={() => navigate('/')}
          className="text-white font-bold text-base hover:text-red-400 transition-colors"
        >
          {title || '文学巡礼'}
        </button>

        {/* Right */}
        <div className="w-16 flex justify-end">
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
                className="text-xs text-gray-400 hover:text-white transition-colors"
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
