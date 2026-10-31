import { EmptyState, PageHeader } from "@/components/app-ui";

/** Inside the app: the sidebar stays, and the message doesn't say whether the item exists elsewhere. */
export default function AppNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Not found" title="This isn't in your workspace" />
      <EmptyState
        title="Nothing here"
        body="It may have been deleted, or the link belongs to another workspace. Your documents are all on the Documents page."
        action={{ href: "/app/documents", label: "Go to documents" }}
      />
    </div>
  );
}
