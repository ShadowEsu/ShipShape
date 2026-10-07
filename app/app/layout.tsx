import Link from "next/link";
import { Disclaimer, Logo } from "@/components/ui";

const NAV = [
  ["/app", "Home"],
  ["/app/scans/new", "New scan"],
  ["/app/scans", "Scan history"],
  ["/app/vault", "Document vault"],
  ["/app/signatures", "Signatures"],
  ["/app/audit", "Audit log"],
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-foam md:flex">
      <aside className="border-b border-line bg-white p-4 md:min-h-screen md:w-56 md:border-r md:border-b-0">
        <Logo href="/app" />
        <nav className="mt-6 flex flex-wrap gap-1 md:flex-col">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-sea-light">
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {children}
          <Disclaimer />
        </div>
      </main>
    </div>
  );
}
