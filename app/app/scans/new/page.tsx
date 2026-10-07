import { ScanForm } from "@/components/forms";

export default async function NewScan({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const { target } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold">New scan</h1>
      <div className="card space-y-4">
        <p className="text-sm text-slate-600">
          Paste a public GitHub repo to check the code, or a website URL to check what a first time visitor gets. We clone repos read
          only and delete the copy as soon as the scan ends.
        </p>
        <ScanForm initial={target ?? ""} />
      </div>
    </>
  );
}
