import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export default function UserMenu({ user, signOut }) {
  const navigate = useNavigate();
  const avatarLetter = user?.email ? user.email[0].toUpperCase() : '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="outline-none" aria-label="打开账户菜单">
          <Avatar className="h-8 w-8 ring-2 ring-primary/20 hover:ring-primary/50 transition-all">
            <AvatarFallback>{avatarLetter}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/?tab=my')}>我的导览</DropdownMenuItem>
        <DropdownMenuItem onClick={signOut}>退出登录</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
