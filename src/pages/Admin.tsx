import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Calculator, Check, X, ArrowLeft, Users, Loader2, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface UserProfile {
  id: string;
  user_id: string;
  approved: boolean;
  created_at: string;
  updated_at: string;
  email: string | null;
}

const Admin = () => {
  const { user, isLoading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate('/auth');
    }
    if (!isLoading && user && !isAdmin) {
      navigate('/');
    }
  }, [user, isLoading, isAdmin, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchProfiles();
    }
  }, [isAdmin]);

  const fetchProfiles = async () => {
    setLoadingProfiles(true);
    // Use the view that includes user emails (only works for admins)
    const { data, error } = await supabase
      .from('profiles_with_email')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast({
        title: 'Грешка',
        description: 'Неуспешно зареждане на потребителите',
        variant: 'destructive',
      });
    } else {
      // Map the view data to UserProfile, handling nullable fields from the view
      const mappedProfiles: UserProfile[] = (data || []).map(row => ({
        id: row.id ?? '',
        user_id: row.user_id ?? '',
        approved: row.approved ?? false,
        created_at: row.created_at ?? '',
        updated_at: row.updated_at ?? '',
        email: row.email,
      }));
      setProfiles(mappedProfiles);
    }
    setLoadingProfiles(false);
  };

  const updateApproval = async (profileId: string, approved: boolean) => {
    setUpdatingId(profileId);
    const { error } = await supabase
      .from('profiles')
      .update({ approved })
      .eq('id', profileId);
    
    if (error) {
      toast({
        title: 'Грешка',
        description: 'Неуспешна промяна на статуса',
        variant: 'destructive',
      });
    } else {
      toast({
        title: approved ? 'Одобрен' : 'Отхвърлен',
        description: `Потребителят е ${approved ? 'одобрен' : 'отхвърлен'} успешно`,
      });
      fetchProfiles();
    }
    setUpdatingId(null);
  };

  const deleteUser = async (profile: UserProfile) => {
    if (!confirm(`Сигурни ли сте, че искате да изтриете ${profile.email || profile.user_id}?`)) {
      return;
    }

    setDeletingId(profile.id);
    
    const { data: { session } } = await supabase.auth.getSession();
    
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { user_id: profile.user_id },
    });

    if (error || data?.error) {
      toast({
        title: 'Грешка',
        description: data?.error || 'Неуспешно изтриване на потребител',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Изтрит',
        description: 'Потребителят е изтрит успешно',
      });
      fetchProfiles();
    }
    setDeletingId(null);
  };

  if (isLoading || loadingProfiles) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const pendingProfiles = profiles.filter(p => !p.approved);
  const approvedProfiles = profiles.filter(p => p.approved);

  return (
    <div className="min-h-screen gradient-hero p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-card rounded-2xl shadow-elevated border border-border p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl gradient-primary">
                <Calculator className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-serif font-bold text-2xl text-foreground">Администрация</h1>
                <p className="text-sm text-muted-foreground">Управление на потребители</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Назад
            </Button>
          </div>
        </div>

        {/* Pending Approvals */}
        <div className="bg-card rounded-2xl shadow-elevated border border-border p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-amber-500" />
            <h2 className="font-serif text-lg font-semibold text-foreground">
              Очакващи одобрение ({pendingProfiles.length})
            </h2>
          </div>
          
          {pendingProfiles.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Няма потребители за одобрение</p>
          ) : (
            <div className="space-y-3">
              {pendingProfiles.map(profile => (
                <div key={profile.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium text-foreground">{profile.email || profile.user_id}</p>
                    <p className="text-sm text-muted-foreground">
                      Регистриран: {new Date(profile.created_at).toLocaleDateString('bg-BG')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-green-600 border-green-600 hover:bg-green-50"
                      onClick={() => updateApproval(profile.id, true)}
                      disabled={updatingId === profile.id || deletingId === profile.id}
                    >
                      {updatingId === profile.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Одобри
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-600 hover:bg-red-50"
                      onClick={() => deleteUser(profile)}
                      disabled={updatingId === profile.id || deletingId === profile.id}
                    >
                      {deletingId === profile.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-1" />
                          Изтрий
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Approved Users */}
        <div className="bg-card rounded-2xl shadow-elevated border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-green-500" />
            <h2 className="font-serif text-lg font-semibold text-foreground">
              Одобрени потребители ({approvedProfiles.length})
            </h2>
          </div>
          
          {approvedProfiles.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Няма одобрени потребители</p>
          ) : (
            <div className="space-y-3">
              {approvedProfiles.map(profile => (
                <div key={profile.id} className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="font-medium text-foreground">{profile.email || profile.user_id}</p>
                    <p className="text-sm text-muted-foreground">
                      Регистриран: {new Date(profile.created_at).toLocaleDateString('bg-BG')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-600 hover:bg-red-50"
                      onClick={() => updateApproval(profile.id, false)}
                      disabled={updatingId === profile.id || deletingId === profile.id}
                    >
                      {updatingId === profile.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <X className="h-4 w-4 mr-1" />
                          Отхвърли
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive/10"
                      onClick={() => deleteUser(profile)}
                      disabled={updatingId === profile.id || deletingId === profile.id || profile.user_id === user?.id}
                    >
                      {deletingId === profile.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-1" />
                          Изтрий
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
