import { openLinkHandler } from "@/lib/server/links";
import { PASSPORT_COOKIE } from "@/lib/server/passport";

export const dynamic = "force-dynamic";

export const POST = openLinkHandler("p", PASSPORT_COOKIE);
