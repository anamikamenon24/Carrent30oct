import { Suspense } from "react";
import { AdminNav } from "@/components/admin-nav";
import { PageLoading } from "@/components/ui/states";
import { requireAdmin } from "@/server/session";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<PageLoading label="Checking access…" />}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

/** Only admins see the console; everyone else is sent to /login or gets a 404. Pages re-check too. */
async function AdminGate({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[13rem_1fr]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="mb-2 hidden text-xs font-semibold tracking-wide text-muted uppercase lg:block">Admin console</p>
        <AdminNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
