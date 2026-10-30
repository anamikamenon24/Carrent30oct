import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/logo";
import { MenuDisclosure } from "@/components/menu-disclosure";
import { getCurrentUser, type CurrentUser } from "@/server/session";

const NAV = [
  { href: "/search", label: "Find a car" },
  { href: "/branches", label: "Branches" },
  { href: "/rentals", label: "My rentals" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/" aria-label="DriveEasy home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-canvas hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <Suspense fallback={<div className="h-9 w-28 animate-pulse rounded-lg bg-canvas" aria-hidden />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}

async function UserMenu() {
  // The header is in the root layout, where an error would take down every page (global-error).
  // If the session can't be read, show the signed-out menu; protected pages still check on their own.
  let user: CurrentUser | null = null;
  try {
    user = await getCurrentUser();
  } catch (err) {
    unstable_rethrow(err);
    console.error(JSON.stringify({ level: "error", msg: "header session read failed", err: String(err) }));
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <MobileNavLinks user={null} />
        <Link href="/login" className="btn-ghost" data-testid="nav-login">
          Sign in
        </Link>
        <Link href="/register" className="btn-primary hidden sm:inline-flex" data-testid="nav-register">
          Create account
        </Link>
      </div>
    );
  }

  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <MobileNavLinks user={user} />
      {user.role === "ADMIN" && (
        <Link href="/admin" className="btn-secondary hidden sm:inline-flex" data-testid="nav-admin">
          Admin
        </Link>
      )}
      <div className="hidden md:block">
      <MenuDisclosure
        label={
          <span className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
              {initials || "?"}
            </span>
            <span className="hidden max-w-32 truncate text-sm font-medium lg:inline">{user.name}</span>
          </span>
        }
        buttonLabel="Account menu"
        testId="user-menu"
      >
        <div className="border-b border-line px-4 py-3">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
        <div className="py-1">
          <MenuLink href="/rentals">My rentals</MenuLink>
          <MenuLink href="/profile">Profile &amp; licence</MenuLink>
          {user.role === "ADMIN" && <MenuLink href="/admin">Admin console</MenuLink>}
        </div>
        <form action={signOutAction} className="border-t border-line py-1">
          <button
            type="submit"
            className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
            data-testid="sign-out"
          >
            Sign out
          </button>
        </form>
      </MenuDisclosure>
      </div>
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block px-4 py-2 text-sm hover:bg-canvas">
      {children}
    </Link>
  );
}

function MobileNavLinks({ user }: { user: CurrentUser | null }) {
  return (
    <div className="md:hidden">
      <MenuDisclosure
        label={
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        }
        buttonLabel="Open menu"
        testId="nav-menu-button"
      >
        {user && (
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
        )}
        <nav aria-label="Mobile" className="py-1">
          {NAV.map((item) => (
            <MenuLink key={item.href} href={item.href}>
              {item.label}
            </MenuLink>
          ))}
          {user && <MenuLink href="/profile">Profile &amp; licence</MenuLink>}
          {user?.role === "ADMIN" && <MenuLink href="/admin">Admin console</MenuLink>}
          {!user && <MenuLink href="/register">Create account</MenuLink>}
        </nav>
        {user && (
          <form action={signOutAction} className="border-t border-line py-1">
            <button
              type="submit"
              className="block w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
              data-testid="sign-out"
            >
              Sign out
            </button>
          </form>
        )}
      </MenuDisclosure>
    </div>
  );
}
