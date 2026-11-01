import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-2xl px-5 pt-16 pb-24">
        <p className="eyebrow">Not found</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight">This page isn&apos;t here.</h1>
        <p className="mt-3 text-ink-2">The link may be mistyped, or the page was moved or deleted.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="btn-accent">
            Go to the home page
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
