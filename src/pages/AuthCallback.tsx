import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Clock } from 'lucide-react';

// Verarbeitet alle GoTrue Callbacks (Password-Recovery, E-Mail-Bestätigung, etc.)
// GoTrue leitet nach diesem Muster weiter:
//   ?token_hash=XXX&type=recovery  (PKCE/OTP flow)
//   #access_token=XXX&type=recovery (implicit flow)
// Supabase JS v2 mit detectSessionInUrl: true verarbeitet beides automatisch.

const AuthCallback = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Prüfe ob GoTrue einen Fehler zurückgegeben hat (z.B. Token abgelaufen)
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    const errorCode = searchParams.get('error') || hashParams.get('error');
    const errorDesc = searchParams.get('error_description') || hashParams.get('error_description');

    if (errorCode) {
      setError(errorDesc || errorCode);
      return;
    }

    // Supabase JS v2 verarbeitet token_hash/code/access_token automatisch via detectSessionInUrl.
    // Wir warten auf onAuthStateChange um das Ergebnis zu kennen und reagieren entsprechend.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/auth/new-password', { replace: true });
      } else if (event === 'SIGNED_IN') {
        navigate('/', { replace: true });
      } else if (event === 'USER_UPDATED') {
        navigate('/', { replace: true });
      }
    });

    // Timeout-Fallback: Falls kein Event kommt (ungültiger Token, bereits verbraucht, etc.)
    const timeout = setTimeout(() => {
      setError('Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.');
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-masitcon-darkblue via-masitcon-lightblue to-masitcon-turquoise p-4">
        <div className="text-center max-w-md">
          <div className="rounded-xl bg-white/10 border border-white/20 p-8">
            <p className="text-white text-lg font-semibold mb-2">Link ungültig</p>
            <p className="text-white/70 text-sm mb-6">{error}</p>
            <a
              href="/auth"
              className="inline-block rounded-lg bg-white/20 hover:bg-white/30 text-white px-6 py-2 transition-colors"
            >
              Zurück zur Anmeldung
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-masitcon-darkblue via-masitcon-lightblue to-masitcon-turquoise p-4">
      <div className="text-center">
        <Clock className="mx-auto h-12 w-12 animate-spin text-white" />
        <p className="mt-4 text-white">Einen Moment bitte...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
