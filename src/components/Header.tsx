import { Calculator, LogOut, User, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

export function Header() {
  const { user, signOut, isAdmin } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg gradient-primary">
            <Calculator className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-serif font-semibold text-lg text-foreground">
              Дафи
            </h1>
            <p className="text-xs text-muted-foreground -mt-0.5">
              Счетоводни решения
            </p>
          </div>
        </div>
        
        {user && (
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span className="truncate max-w-[150px]">{user.email}</span>
            </div>
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/admin')}
                className="gap-2"
              >
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline">Админ</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={signOut}
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Изход</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
