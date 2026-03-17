"use client";

import { createContext, useContext, type ReactNode } from "react";

type ProfileContextValue = {
  fullName: string | null;
  email: string | null;
  userId: string;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({
  fullName,
  email,
  userId,
  children,
}: ProfileContextValue & { children: ReactNode }) {
  return (
    <ProfileContext.Provider value={{ fullName, email, userId }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return ctx;
}
