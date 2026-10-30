import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-16 text-center" data-testid="not-found">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-2xl font-bold">We couldn&rsquo;t find that page</h1>
      <p className="mt-2 text-sm text-muted">It may have moved, or you may not have access to it.</p>
      <div className="mt-6 flex gap-2">
        <Link href="/search" className="btn-primary">
          Find a car
        </Link>
        <Link href="/" className="btn-secondary">
          Go home
        </Link>
      </div>
    </div>
  );
}
