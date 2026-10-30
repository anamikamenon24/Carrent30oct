import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-muted">
            Car rental across the UAE with clear AED pricing. VAT, deposit and one-way fees are always shown
            before you pay.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Rent</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <Link href="/search" className="hover:text-ink">
                Find a car
              </Link>
            </li>
            <li>
              <Link href="/branches" className="hover:text-ink">
                Branches
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Your account</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>
              <Link href="/rentals" className="hover:text-ink">
                My rentals
              </Link>
            </li>
            <li>
              <Link href="/profile" className="hover:text-ink">
                Profile &amp; licence
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t border-line py-4 text-center text-xs text-muted">
        Prices in UAE dirham (AED). Times shown in each branch&rsquo;s local time.
      </p>
    </footer>
  );
}
