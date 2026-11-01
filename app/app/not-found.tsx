import { PageHeader } from "@/components/app-ui";
import { BackToSection } from "./nav";

/** Inside the app: the sidebar stays, and the message doesn't say whether the item exists elsewhere. */
export default function AppNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Not found" title="This isn't in your workspace" />
      <p className="max-w-prose text-ink-2">It may have been deleted, or the link belongs to another workspace.</p>
      <BackToSection />
    </div>
  );
}
