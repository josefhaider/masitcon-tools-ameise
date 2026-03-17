"use client";

import { createContext, useContext, type ReactNode } from "react";

type RolesContextValue = {
  roles: string[];
  isAdmin: boolean;
  isApprover: boolean;
  isHrManager: boolean;
};

const RolesContext = createContext<RolesContextValue | null>(null);

export function RolesProvider({
  roles,
  isAdmin,
  isApprover,
  isHrManager,
  children,
}: RolesContextValue & { children: ReactNode }) {
  const value: RolesContextValue = { roles, isAdmin, isApprover, isHrManager };

  return (
    <RolesContext.Provider value={value}>{children}</RolesContext.Provider>
  );
}

export function useRoles(): RolesContextValue {
  const ctx = useContext(RolesContext);
  if (!ctx) {
    throw new Error("useRoles must be used within RolesProvider");
  }
  return ctx;
}
