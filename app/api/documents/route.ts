import { privacyPolicy, storeAnswers, termsOfService } from "@/lib/docs";
import { body, fail, json } from "@/lib/http";
import { store } from "@/lib/store";

export async function POST(req: Request) {
  const { scanId } = await body<{ scanId: string }>(req);
  const scan = (await store.read()).scans.find((s) => s.id === scanId);
  if (!scan) return fail("Scan not found", 404);
  const name = scan.target.replace(/^https?:\/\/(www\.)?(github\.com\/)?/, "").replace(/\/$/, "");
  await store.saveDocument(`Privacy policy · ${name}`, "privacy-policy", privacyPolicy(scan), scan.id);
  await store.saveDocument(`Terms of service · ${name}`, "terms", termsOfService(scan), scan.id);
  await store.saveDocument(`Store privacy answers · ${name}`, "store-answers", storeAnswers(scan), scan.id);
  return json({ ok: true });
}
