import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser, safeNext } from "@/server/session";
import { AuthFormSkeleton, AuthShell } from "../auth-shell";
import { RegisterForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <AuthShell title="Create your account" subtitle="Book in minutes and keep all your rentals in one place.">
      <Suspense fallback={<AuthFormSkeleton />}>
        <RegisterContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function RegisterContent({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const sp = await searchParams;
  const next = safeNext(sp.next, "/");
  if (await getCurrentUser()) redirect(next);
  return <RegisterForm next={next} />;
}
