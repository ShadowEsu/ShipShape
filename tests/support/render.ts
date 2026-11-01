import { createElement } from "react";
import type { ComponentType } from "react";
import { prerender } from "react-dom/static";

/**
 * Renders a server page (an async component) to its static HTML, the way the app would serve it.
 * The test file must mock `next/headers`, `next/navigation` and `next/cache` first (see
 * tests/form-actions.test.ts), and sign a session into the cookie jar for pages behind
 * requireWorkspace.
 */
export async function renderPage<P extends object>(Page: ComponentType<P>, props: P): Promise<string> {
  const { prelude } = await prerender(createElement(Page, props));
  return new Response(prelude).text();
}

/** The visible text of rendered HTML: tags removed, entities decoded, whitespace collapsed. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Links and buttons in rendered HTML, in document order: what a person can do next. */
export function actionsOf(html: string): { tag: "a" | "button"; label: string; href?: string }[] {
  const out: { tag: "a" | "button"; label: string; href?: string }[] = [];
  for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const tag = m[1] === "a" ? "a" : "button";
    const href = /\bhref="([^"]*)"/.exec(m[2])?.[1];
    out.push({ tag, label: textOf(m[3]), href });
  }
  return out;
}
