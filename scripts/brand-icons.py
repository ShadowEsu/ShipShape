"""Makes ShipShape's favicon and app icons from the mark in components/brand-mark.tsx (Design's rules, 4 Nov):
the mark at 62% of an ink tile with a radius 22.5% of its size, white on ink.

Writes app/icon.svg (any size), app/icon1.png (16), app/icon2.png (32) and app/apple-icon.png (180). Run it after
changing the mark: `python3 scripts/brand-icons.py` (needs Python Playwright with its Chromium)."""

import pathlib
import re

from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "components" / "brand-mark.tsx").read_text()


m = re.search(r"export const MARK_PATHS = \[([^\]]+)\];", src)
if not m:
    raise SystemExit("brand-icons: MARK_PATHS not found in components/brand-mark.tsx")
paths = re.findall(r'"([^"]+)"', m.group(1))
# The tile is 64 units with a 14.4-unit radius (22.5%); the 64-unit mark is scaled to 62% and centred on it.
s = 0.62
t = (64 - 64 * s) / 2
icon = f"""<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14.4" fill="#0a0a0a"/>
  <g transform="translate({t:.2f} {t:.2f}) scale({s})">
{chr(10).join(f'    <path d="{d}" fill="#ffffff"/>' for d in paths)}
  </g>
</svg>
"""
(root / "app" / "icon.svg").write_text(icon)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        for name, px in (("icon1.png", 16), ("icon2.png", 32), ("apple-icon.png", 180)):
            page = browser.new_page(viewport={"width": px, "height": px}, device_scale_factor=1)
            page.set_content(f'<html><body style="margin:0;background:transparent">{icon.replace(chr(10), "")}</body></html>')
            page.eval_on_selector("svg", f"(el) => {{ el.setAttribute('width', {px}); el.setAttribute('height', {px}); }}")
            page.screenshot(path=str(root / "app" / name), omit_background=True, clip={"x": 0, "y": 0, "width": px, "height": px})
            page.close()
    finally:
        browser.close()
print("brand-icons: app/icon.svg, app/icon1.png (16), app/icon2.png (32), app/apple-icon.png (180)")
