import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import masitconLogo from '@/assets/masitcon-logo.png';

// Passwort-Formular nach erfolgreichem Recovery-Link-Klick.
// Nur erreichbar wenn eine aktive Session mit Recovery-Token vorliegt –
// andernfalls Weiterleitung zurück zu /auth.

const AuthNewPassword = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Schutz: Seite nur zugänglich wenn eine gültige Session vorhanden ist
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
      toast.error('Passwort konnte nicht geändert werden', {
        description: error.message,
      });
    } else {
      toast.success('Passwort erfolgreich geändert');
      navigate('/', { replace: true });
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-masitcon-darkblue via-masitcon-lightblue to-masitcon-turquoise p-4">
      <Card className="w-full max-w-md backdrop-blur-xl bg-white/95 border-white/20 shadow-2xl">
        <CardHeader className="space-y-1 text-center">
          <img
            src={masitconLogo}
            alt="masitcon"
            className="mx-auto h-12 w-auto object-contain mb-4"
          />
          <CardTitle className="text-2xl font-bold">Neues Passwort festlegen</CardTitle>
          <CardDescription>Geben Sie Ihr neues Passwort ein</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Neues Passwort</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Passwort bestätigen</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-masitcon-turquoise hover:bg-masitcon-turquoise/90"
              disabled={loading}
            >
              {loading ? 'Wird gespeichert...' : 'Passwort ändern'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthNewPassword;
