"use client";
import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { LogOut, User, Key } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useProfile } from "@/contexts/profile-context";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AppHeader: React.FC = () => {
  const { isMobileOpen, toggleSidebar, toggleMobileSidebar } = useSidebar();
  const profile = useProfile();
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  const displayName = profile?.fullName || userEmail?.split("@")[0] || "";
  const displayEmail = profile?.email || userEmail || "";

  const handleToggle = () => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      toggleSidebar();
    } else {
      toggleMobileSidebar();
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-99999 flex w-full border-gray-200 bg-white lg:border-b">
      <div className="relative flex grow items-center justify-between px-3 py-3 lg:px-6 lg:py-4">
        {/* Toggle-Button */}
        <div className="flex items-center gap-2">
          <button
            className="flex h-12 w-12 items-center justify-center rounded-lg text-gray-500 lg:h-11 lg:w-11 lg:border lg:border-gray-200"
            onClick={handleToggle}
            aria-label="Sidebar umschalten"
          >
            {isMobileOpen ? (
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg
                width="20"
                height="14"
                viewBox="0 0 16 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile-Logo – absolute zentriert */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 lg:hidden">
          <Image
            src="/Ameise.png"
            alt="AMEISE"
            width={28}
            height={28}
            className="h-7 w-7 rounded-md"
          />
          <span className="text-lg font-bold tracking-wide text-gray-800">
            AMEISE
          </span>
        </div>

        {/* User-Dropdown */}
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-2 rounded-lg p-1 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                aria-label="Profil öffnen"
                suppressHydrationWarning
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-600">
                  {displayName
                    ? displayName.charAt(0).toUpperCase()
                    : displayEmail.charAt(0).toUpperCase()}
                </div>
                <span className="hidden text-gray-700 lg:block">
                  {displayName || displayEmail}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100000] w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  {displayName && (
                    <p className="text-sm font-medium leading-none">
                      {displayName}
                    </p>
                  )}
                  <p className="text-xs leading-none text-gray-500">
                    {displayEmail}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => router.push("/profil")}
              >
                <User className="mr-2 h-4 w-4" />
                Mein Profil
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => router.push("/profil#passwort")}
              >
                <Key className="mr-2 h-4 w-4" />
                Passwort ändern
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-error-500 focus:text-error-500"
                onClick={handleSignOut}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Abmelden
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
