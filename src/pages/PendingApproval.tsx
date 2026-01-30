import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Calculator, Clock, LogOut } from 'lucide-react';

const PendingApproval = () => {
  const { user, isLoading, isApproved, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth');
    }
    if (!isLoading && isApproved) {
      navigate('/');
    }
  }, [user, isLoading, isApproved, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-elevated border border-border p-8 animate-fade-in text-center">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="p-3 rounded-xl gradient-primary">
              <Calculator className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="text-center">
              <h1 className="font-serif font-bold text-2xl text-foreground">Дафи</h1>
              <p className="text-xs text-muted-foreground">Счетоводни решения</p>
            </div>
          </div>

          {/* Pending Icon */}
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-6">
            <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>

          {/* Message */}
          <h2 className="font-serif text-xl font-semibold text-foreground mb-3">
            Очаква одобрение
          </h2>
          <p className="text-muted-foreground mb-6">
            Вашият акаунт е създаден успешно, но все още не е одобрен. 
            Моля, изчакайте администратор да прегледа и одобри достъпа ви.
          </p>

          <p className="text-sm text-muted-foreground mb-6">
            Ще получите достъп веднага след одобрението.
          </p>

          <Button
            variant="outline"
            onClick={handleSignOut}
            className="w-full"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Изход
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PendingApproval;
