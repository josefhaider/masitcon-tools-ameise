"use client";
import MonthlyTimeCalendar from "@/components/MonthlyTimeCalendar";
import { useProfile } from "@/contexts/profile-context";

export default function ZeiterfassungPage() {
  const { userId } = useProfile();
  return <MonthlyTimeCalendar userId={userId} />;
}
