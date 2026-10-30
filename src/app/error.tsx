"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-16 text-center" role="alert">
      <div className="grid size-14 place-items-center rounded-full bg-red-50 text-2xl text-red-700">!</div>
      <h1 className="mt-4 text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        We couldn&rsquo;t load this page. Please try again. If it keeps happening, contact the branch.
      </p>
      {digest && <p className="mt-2 font-mono text-xs text-muted">Reference: {digest}</p>}
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={() => retry()} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Go home
        </Link>
      </div>
    </div>
  );
}
