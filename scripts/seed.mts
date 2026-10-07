// Usage: npm run seed  ·  scans examples/demo-app into the local store so the app has a full report to show.
import { privacyPolicy, storeAnswers, termsOfService } from "../lib/docs";
import { buildResult } from "../lib/scanner";
import { scanDirectory } from "../lib/scanner/repo";
import { store } from "../lib/store";

const scan = buildResult("examples/demo-app (SnapStudy)", "repo", await scanDirectory("examples/demo-app"));
await store.saveScan(scan);
await store.saveDocument("Privacy policy · SnapStudy", "privacy-policy", privacyPolicy(scan, "SnapStudy Inc."), scan.id);
await store.saveDocument("Terms of service · SnapStudy", "terms", termsOfService(scan, "SnapStudy Inc."), scan.id);
await store.saveDocument("Store privacy answers · SnapStudy", "store-answers", storeAnswers(scan), scan.id);
console.log(`Seeded scan ${scan.id}: score ${scan.score}, ${scan.findings.length} findings. Open http://localhost:3000/app/scans/${scan.id}`);
