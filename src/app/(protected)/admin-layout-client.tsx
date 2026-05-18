"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RolesProvider } from "@/contexts/permissions-context";
import { ProfileProvider } from "@/contexts/profile-context";
import { useSidebar } from "@/contexts/SidebarContext";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import { useState } from "react";

type SessionForLayout = {
  roles: string[];
  isAdmin: boolean;
  isApprover: boolean;
  isHrManager: boolean;
  profile: {
    fullName: string | null;
    email: string | null;
  } | null;
  userId: string;
};

function LayoutInner({
  session,
  children,
}: {
  session: SessionForLayout;
  children: React.ReactNode;
}) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();

  const mainMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
      ? "lg:ml-[290px]"
      : "lg:ml-[90px]";

  return (
    <RolesProvider
      roles={session.roles}
      isAdmin={session.isAdmin}
      isApprover={session.isApprover}
      isHrManager={session.isHrManager}
    >
      <ProfileProvider
        fullName={session.profile?.fullName ?? null}
        email={session.profile?.email ?? null}
        userId={session.userId}
      >
        <div className="min-h-screen overflow-x-hidden">
          <AppSidebar />
          <Backdrop />
          <div
            className={`transition-all duration-300 ease-in-out ${mainMargin}`}
          >
            <AppHeader />
            <main className="mx-auto max-w-(--breakpoint-2xl) p-4 lg:p-8">
              {children}
            </main>
          </div>
        </div>
      </ProfileProvider>
    </RolesProvider>
  );
}

export default function AdminLayoutClient({
  session,
  children,
}: {
  session: SessionForLayout;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <LayoutInner session={session}>{children}</LayoutInner>
    </QueryClientProvider>
  );
}
