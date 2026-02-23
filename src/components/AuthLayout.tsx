interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* Video-Hintergrund */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src="/Wood_background.mp4"
        autoPlay
        muted
        loop
        playsInline
      />

      {/* Dunkles Overlay für Kontrast */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Zentrierter Inhalt */}
      <div className="relative z-10 flex min-h-screen items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
}
