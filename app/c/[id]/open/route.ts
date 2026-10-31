import { COLLECT_COOKIE } from "@/lib/server/collect";
import { openLinkHandler } from "@/lib/server/links";

export const dynamic = "force-dynamic";

export const POST = openLinkHandler("c", COLLECT_COOKIE);
