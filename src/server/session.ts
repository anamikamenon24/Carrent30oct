import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/server/auth";

export type Role = "CUSTOMER" | "ADMIN";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
}

/** Reads the session once per request. Returns null when signed out. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string | null; phone?: string | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "ADMIN" ? "ADMIN" : "CUSTOMER",
    phone: u.phone ?? null,
  };
});

/** Redirects to /login (returning to `next`) when signed out. */
export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

/** Signed-out users go to /login; signed-in non-admins get a 404 so admin routes aren't revealed. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser("/admin");
  if (user.role !== "ADMIN") {
    notFound();
  }
  return user;
}

/** Safe in-app redirect target (blocks open redirects). */
export function safeNext(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
