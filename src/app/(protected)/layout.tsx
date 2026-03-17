import { redirect } from "next/navigation";
import { getSessionWithRoles } from "@/lib/auth-server";
import AdminLayoutClient from "./admin-layout-client";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionWithRoles();

  if (!session) {
    redirect("/login");
  }

  const sessionForClient = JSON.parse(
    JSON.stringify({
      roles: session.roles,
      isAdmin: session.isAdmin,
      isApprover: session.isApprover,
      isHrManager: session.isHrManager,
      profile: session.profile
        ? {
            fullName: session.profile.full_name,
            email: session.profile.email,
          }
        : null,
      userId: session.user.id,
    })
  );

  return (
    <AdminLayoutClient session={sessionForClient}>{children}</AdminLayoutClient>
  );
}
