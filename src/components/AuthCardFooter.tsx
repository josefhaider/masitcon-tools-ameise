"use client";

// Platzhalter für das Muzzitcon-Dug Logo.
// Sobald das finale Dug-Asset verfügbar ist, einfach den img-src austauschen.
export function AuthCardFooter() {
  return (
    <div className="border-t border-gray-200 py-6 px-8">
      <div className="flex flex-col items-center gap-2">
        <img
          src="/Logo_masitcon_breit_RGB.png"
          alt="masitcon"
          className="h-6 w-auto object-contain opacity-60"
        />
        <p className="text-[11px] text-gray-400 tracking-wide">Ein Tool von masitcon</p>
      </div>
    </div>
  );
}
