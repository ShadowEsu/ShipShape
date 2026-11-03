import "server-only";
import { megabytes, PLANS } from "@/lib/plans";

/**
 * The limits on costly actions (review wave 15) and the words each refusal says (Design, wave 15). Each
 * sentence is defined once here; a number in a sentence comes from the limit itself, so they can't drift.
 */

/** A sample workspace holds this many documents in all, archived ones included (W15-2). */
export const SAMPLE_DOCUMENTS = 30;

/** Signature requests one person may try in an hour (`esign-send`); `esign-net` allows twice that per network. */
export const ESIGN_TRIES_PER_HOUR = 20;

export const FILL_BUSY = "That's the hourly limit for new documents. Nothing was made; try again in an hour.";

export const SAMPLE_FULL = `This sample is full: it holds up to ${SAMPLE_DOCUMENTS} documents, archived ones included. To try more, start a new sample from the sign-in page.`;

export const LINKS_BUSY = "That's the hourly limit for new links. Nothing was made; try again in an hour.";

export const VENDORS_BUSY = "That's the hourly limit for adding vendors. Nothing was added; try again in an hour.";

export const UPLOAD_BUSY = "That's the hourly limit for uploads. Nothing was added; try again in an hour.";

export const FILES_FULL = `The Free plan holds ${megabytes(PLANS.free.files)} of files, and this would go past it. Archived files still count.`;

/** Added to FILES_FULL only for someone who can move the workspace to Pro (see planLimit). */
export const FILES_FULL_PRO = " Pro has no total file limit.";

export const ESIGN_BUSY = `That's ${ESIGN_TRIES_PER_HOUR} signature requests tried in the last hour, the most ShipShape allows. Nothing was sent; try again in an hour.`;

export const SAMPLE_SIGNIN_BUSY = "Too many samples started from this network. Wait up to an hour, then try again, or sign in with your account.";

/** People (0046): a workspace keeps at most this many contacts; 0046's before-insert trigger holds the same number (Security P4). */
export const PEOPLE_MAX = 500;

export const PEOPLE_FULL = `People holds up to ${PEOPLE_MAX} people in a workspace, and this one is full. Nothing was added; delete someone you no longer need to make room.`;

/** People one person may add in an hour (typed or kept from a signer). */
export const PEOPLE_PER_HOUR = 60;

export const PEOPLE_BUSY = "That's the hourly limit for adding people. Nothing was added; try again in an hour.";
