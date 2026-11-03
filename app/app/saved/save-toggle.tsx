import { Icon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import type { SavedKind } from "@/lib/server/saved";
import { toggleSaved } from "./actions";

/**
 * Save / Saved on a document's or a passport link's page (redesigned look): a small secondary button with the
 * bookmark, filled once saved. Its words say the state; once saved, its name also says what a press does
 * (and starts with the visible word). The form asks for the other state, so a double click can't flip it back.
 */
export function SaveToggle({ kind, id, saved }: { kind: SavedKind; id: string; saved: boolean }) {
  return (
    <form action={toggleSaved}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="saved" value={saved ? "0" : "1"} />
      <SubmitButton className="btn-ghost press px-4" pendingLabel={saved ? "Removing…" : "Saving…"} label={saved ? "Saved. Remove from Saved" : undefined}>
        <Icon name="bookmark" size={16} className={saved ? "fill-current" : undefined} />
        {saved ? "Saved" : "Save"}
      </SubmitButton>
    </form>
  );
}
