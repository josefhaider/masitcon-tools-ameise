import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { AuthLayout } from '@/components/AuthLayout';
import { AuthCardFooter } from '@/components/AuthCardFooter';

// Passwort-Formular nach erfolgreichem Recovery-Link-Klick.
// Nur erreichbar wenn eine aktive Session mit Recovery-Token vorliegt –
// andernfalls Weiterleitung zurück zu /auth.

const AuthNewPassword = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate('/auth', { replace: true });
      }
    });
  }, [navigate]);

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error('Passwörter stimmen nicht überein');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('Passwort muss mindestens 6 Zeichen haben');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      toast.error('Passwort konnte nicht geändert werden', { description: error.message });
    } else {
      toast.success('Passwort erfolgreich geändert');
      navigate('/', { replace: true });
    }
    setLoading(false);
  };

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Mascot + Titel */}
          <div className="flex flex-col items-center pt-8 pb-6 px-8">
            <img
              src="/Ameise.png"
              alt="Ameise"
              className="mb-2 h-56 w-auto object-contain drop-shadow-xl"
            />
            <h1 className="text-2xl font-bold tracking-widest text-gray-800 uppercase">
              Ameise
            </h1>
            <p className="mt-0.5 text-xs text-gray-500 tracking-wide">
              Masitcon Zeiterfassung
            </p>
          </div>

          {/* Formular */}
          <div className="px-8 pb-8">
            <p className="text-xs text-gray-500 text-center mb-4">
              Legen Sie ein neues Passwort für Ihr Konto fest.
            </p>
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Neues Passwort
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                    required
                    className="h-10 border-gray-200 bg-gray-50 focus:bg-white pr-10 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                    aria-label={showNew ? 'Passwort verbergen' : 'Passwort anzeigen'}
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Passwort bestätigen
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={6}
                    required
                    className="h-10 border-gray-200 bg-gray-50 focus:bg-white pr-10 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                    aria-label={showConfirm ? 'Passwort verbergen' : 'Passwort anzeigen'}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-10 text-sm font-semibold bg-masitcon-turquoise hover:bg-masitcon-turquoise/90 shadow-md transition-all duration-200"
                disabled={loading}
              >
                {loading ? 'Wird gespeichert...' : 'Passwort ändern'}
              </Button>
            </form>
          </div>

          <AuthCardFooter />
        </div>
      </div>
    </AuthLayout>
  );
};

export default AuthNewPassword;
