import { PageHeader } from "@/components/app-ui";
import type { ProfileKey } from "@/lib/profile-fields";
import { EinPanel, FactsFormV2 } from "./forms";

/**
 * Business facts in the redesigned app (PR 7 plan): the 720 column; the facts as grouped-list rows with Save and
 * confirm docked, then the EIN as its own titled group. Same words, notices and forms as the current page.
 */
export function FactsV2({
  intro,
  notices,
  values,
  readOnly,
  masked,
  demo,
}: {
  intro: React.ReactNode;
  notices: React.ReactNode;
  values: Record<ProfileKey, string>;
  readOnly: boolean;
  masked: string | null;
  demo: boolean;
}) {
  return (
    <div className="mx-auto max-w-[720px] space-y-8">
      <div className="space-y-4">
        <PageHeader eyebrow="Business facts" title="Business facts" />
        <p className="text-ink-2">{intro}</p>
        {notices}
      </div>
      <FactsFormV2 values={values} readOnly={readOnly} />
      <section aria-labelledby="ein-title" className="space-y-3">
        <h2 id="ein-title" className="section-title">
          Employer identification number (EIN)
        </h2>
        <EinPanel masked={masked} readOnly={readOnly} sample={demo} v2 />
      </section>
      {/* A sample takes no SSN (W14-2), so this applies to real workspaces only. */}
      {!demo && (
        <p className="text-xs text-ink-3">
          We don&apos;t keep social security numbers in your business facts. If a form needs one, you type it for that form, and it
          is saved only inside that document&apos;s PDF.
        </p>
      )}
    </div>
  );
}
