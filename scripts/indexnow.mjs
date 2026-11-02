// Tells the IndexNow engines (Bing, Yandex, Seznam, Naver; https://www.indexnow.org) that the site's public pages changed:
// reads the live sitemap, checks the live key file matches INDEXNOW_KEY, then posts the URLs once to api.indexnow.org.
//   SHIPSHAPE_APP_URL=https://… INDEXNOW_KEY=… node scripts/indexnow.mjs           posts
//   … node scripts/indexnow.mjs --dry-run                                          prints what it would post
// Run after a production deploy that changes public pages. Exit codes: 0 accepted (200/202), 1 refused or unreachable.
const site = process.env.SHIPSHAPE_APP_URL ? new URL(new URL(process.env.SHIPSHAPE_APP_URL).origin) : null;
const key = process.env.INDEXNOW_KEY?.trim();
const dry = process.argv.includes("--dry-run");

if (!site || !key) {
  console.error("Set SHIPSHAPE_APP_URL (the live site) and INDEXNOW_KEY (the key production serves at /indexnow.txt).");
  process.exit(1);
}
const keyLocation = new URL("/indexnow.txt", site).href;
const served = await fetch(keyLocation).then((r) => (r.ok ? r.text() : null), () => null);
if (served?.trim() !== key) {
  console.error(`${keyLocation} doesn't serve this key yet: set INDEXNOW_KEY in production and redeploy first.`);
  process.exit(1);
}
const xml = await fetch(new URL("/sitemap.xml", site)).then((r) => (r.ok ? r.text() : ""), () => "");
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter((u) => new URL(u).host === site.host);
if (urlList.length === 0) {
  console.error(`${new URL("/sitemap.xml", site).href} lists no pages on ${site.host}.`);
  process.exit(1);
}
const body = { host: site.host, key, keyLocation, urlList };
if (dry) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}
const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urlList.length} URLs on ${site.host}`);
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
