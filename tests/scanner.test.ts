import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { privacyPolicy } from "@/lib/docs";
import { buildResult } from "@/lib/scanner";
import { parseGitHubUrl, scanDirectory } from "@/lib/scanner/repo";

async function fixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "shipshape-test-"));
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await fs.writeFile(path.join(dir, name), body);
  }
  return dir;
}

// Built at runtime so no secret-looking string is ever committed.
const FAKE_AWS_KEY = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");

describe("repo scan", () => {
  it("finds the problems in a typical first app", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ dependencies: { "react-native": "0.80.0", "react-native-fbsdk-next": "13.0.0", "@stripe/stripe-react-native": "0.50.0", openai: "5.0.0" } }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/gpl-thing": { license: "GPL-3.0" }, "node_modules/fine": { license: "MIT" } } }),
      "src/auth.ts": "export const join = (e: string, p: string) => auth().createUserWithEmailAndPassword(e, p);",
      "src/chat.ts": 'import OpenAI from "openai";\nconst r = await client.chat.completions.create({ messages: [{ role: "user", content: q }] });',
      "src/config.ts": `export const AWS = "${FAKE_AWS_KEY}";`,
      "PRIVACY.md": "# Privacy\nWe use Google Analytics to understand usage.",
    });
    const scan = buildResult(dir, "repo", await scanDirectory(dir));
    const ids = scan.findings.map((f) => f.ruleId);

    expect(ids).toEqual(
      expect.arrayContaining([
        "apple-account-deletion",
        "play-account-deletion",
        "policy-missing-vendor",
        "committed-secret",
        "ca-companion-chatbot",
        "copyleft-dependency",
        "apple-iap",
        "terms-missing",
      ]),
    );
    expect(ids).not.toContain("privacy-policy-missing");

    const secret = scan.findings.find((f) => f.ruleId === "committed-secret")!;
    expect(secret.evidence[0]).toMatchObject({ file: "src/config.ts", line: 1 });
    expect(secret.evidence[0].snippet).not.toContain(FAKE_AWS_KEY);

    const gap = scan.findings.find((f) => f.ruleId === "policy-missing-vendor")!;
    expect(gap.evidence[0].snippet).toContain("Meta (Facebook)");
    expect(scan.score).toBeLessThan(50);
    await fs.rm(dir, { recursive: true });
  });

  it("stays quiet on a clean site", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ dependencies: { next: "16.0.0", "react-dom": "19.0.0" } }),
      "app/privacy/page.tsx": "export default () => <p>We collect nothing.</p>;",
      ".env.example": "API_KEY=",
    });
    const scan = buildResult(dir, "repo", await scanDirectory(dir));
    expect(scan.findings).toEqual([]);
    expect(scan.score).toBe(100);
    await fs.rm(dir, { recursive: true });
  });

  it("writes a policy that only claims what the code does", async () => {
    const dir = await fixture({
      "package.json": JSON.stringify({ dependencies: { "react-native": "0.80.0" } }),
      "src/auth.ts": "auth().createUserWithEmailAndPassword(e, p);",
    });
    const policy = privacyPolicy(buildResult(dir, "repo", await scanDirectory(dir)));
    expect(policy).toContain("no account deletion");
    expect(policy).not.toContain("You can delete your account at any time");
    await fs.rm(dir, { recursive: true });
  });
});

describe("GitHub URL guard", () => {
  it("accepts only plain public repo URLs", () => {
    expect(parseGitHubUrl("https://github.com/ShadowEsu/ShipShape")).toBe("https://github.com/ShadowEsu/ShipShape.git");
    expect(parseGitHubUrl("https://github.com/a/b.git")).toBe("https://github.com/a/b.git");
    expect(parseGitHubUrl("https://evil.com/a/b")).toBeNull();
    expect(parseGitHubUrl("https://github.com/a/b --upload-pack=x")).toBeNull();
    expect(parseGitHubUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("live site check", () => {
  it("flags a pixel with no consent banner and basic accessibility gaps", async () => {
    const { analyzeHtml } = await import("@/lib/scanner/live");
    const { checkPolicyMentions } = await import("@/lib/scanner/signals");
    const signals = new Map();
    const html = `<html><head><script src="https://connect.facebook.net/en_US/fbevents.js"></script></head>
<body><img src="a.png"><img src="b.png" alt="Shoes"><a href="/privacy">Privacy</a></body></html>`;
    const { policyUrl } = analyzeHtml(signals, "https://shop.example/", html);
    expect(policyUrl).toBe("https://shop.example/privacy");
    checkPolicyMentions(signals, "We use cookies to run the store.", policyUrl!);

    const ids = buildResult("https://shop.example/", "live", signals).findings.map((f) => f.ruleId);
    expect(ids).toEqual(expect.arrayContaining(["trackers-before-consent", "web-accessibility", "policy-missing-vendor", "ccpa-opt-out"]));
    expect(ids).not.toContain("privacy-policy-missing");
  });

  it("refuses private addresses", async () => {
    const { scanLiveSite } = await import("@/lib/scanner/live");
    await expect(scanLiveSite("http://127.0.0.1:3000")).rejects.toThrow("not a public website");
    await expect(scanLiveSite("http://169.254.169.254/latest/meta-data")).rejects.toThrow("not a public website");
    await expect(scanLiveSite("file:///etc/passwd")).rejects.toThrow();
  });
});
