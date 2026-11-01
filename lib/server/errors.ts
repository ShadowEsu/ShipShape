/** A problem the person can fix; its message is shown to them as is. */
export class UserError extends Error {}

/** The workspace's plan doesn't include this (or it's at its limit); `fix` is the one page where room can be made, if any. */
export class PlanLimit extends UserError {
  readonly fix: { href: string; label: string } | null;
  constructor(message: string, fix: { href: string; label: string } | null = null) {
    super(message);
    this.fix = fix;
  }
}

/** Account deletion stopped because a subscription we know is running couldn't be cancelled by us (billing is off). */
export class SubscriptionStillRunning extends UserError {
  constructor() {
    super("Your subscription couldn't be cancelled automatically, so nothing was deleted.");
  }
}
