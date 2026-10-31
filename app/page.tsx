import Link from "next/link";
import { Logo, NotLegalAdvice } from "@/components/ui";
import { WaitlistForm } from "@/components/waitlist";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4">
      <header className="flex items-center justify-between py-5">
        <Logo />
        <Link href="/signin" className="btn-ghost">
          Open the app
        </Link>
      </header>
      <section className="flex flex-1 flex-col justify-center gap-6 py-16">
        <p className="eyebrow">Paperwork for every business</p>
        <h1 className="font-serif text-5xl leading-[0.95] font-semibold tracking-tight sm:text-7xl">
          Every form. <em className="text-accent">One link.</em>
        </h1>
        <p className="max-w-xl text-lg text-ink-2">
          Keep your W-9, insurance certificate, licenses and agreements in one place. Fill new forms from facts you confirmed
          once, and share an always-current packet with anyone who asks.
        </p>
        <WaitlistForm />
        <NotLegalAdvice className="max-w-xl" />
      </section>
    </main>
  );
}
