import { SIGN_COOKIE } from "@/lib/server/esign";
import { openLinkHandler } from "@/lib/server/links";

export const dynamic = "force-dynamic";

export const POST = openLinkHandler("s", SIGN_COOKIE);
