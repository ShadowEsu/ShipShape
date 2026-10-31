/** A problem the person can fix; its message is shown to them as is. */
export class UserError extends Error {}

/** The workspace's plan doesn't include this (or it's at its limit). */
export class PlanLimit extends UserError {}
