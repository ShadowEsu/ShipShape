"""The home page's product screenshots (app/home-quiet.tsx): crops of the app's own stills, saved as WebP in public/site/.

Each crop is sized to where the page shows it, at 2x. The boxes are pixel boxes in the stills (Chrome, device scale 2),
measured on the 4 Nov set; after the app's look changes, take new stills and measure the boxes again.

    /home/preston/shipshape-work.noindex/py/bin/python scripts/site-shots.py [stills folder]
"""

import sys
from pathlib import Path

from PIL import Image, features

STILLS = Path(sys.argv[1] if len(sys.argv) > 1 else "/home/preston/boss-handoff/agents/shipshape/stills-2026-11-04")
OUT = Path(__file__).resolve().parent.parent / "public" / "site"

# name: (still, (left, top, right, bottom), output width or None to keep the crop's own width)
SHOTS = {
    # Check a request's answer for Northwind's sample request: the heading and the first 3 of its 6 rows.
    # Hero, 472 CSS px wide on desktop and 318 on a 390 phone.
    "check-answer": ("stack-stack-6e5eff3/43-check-answer-1440.png", (908, 1429, 2444, 2219), 944),
    "check-answer-sm": ("stack-stack-6e5eff3/43-check-answer-390.png", (16, 1703, 764, 2765), 636),
    # Passport's "Your links" card after the link is made: 976 CSS px on desktop, 318 on a phone.
    "passport-links": ("stack-stack-6e5eff3/44-passport-made-1440.png", (700, 576, 2652, 846), None),
    "passport-links-sm": ("stack-stack-6e5eff3/44-passport-made-390.png", (16, 708, 764, 1106), 636),
    # The whole first page in the document sheet (390 wide, where the sheet shows all of it), inside its border: 325 CSS px.
    "paper-nda": ("papers-papers-8e3aff3/47-sheet-nda-390.png", (40, 738, 740, 1648), 650),
    "paper-w9": ("papers-papers-8e3aff3/47-sheet-w9-390.png", (40, 738, 740, 1648), 650),
    "paper-coi": ("papers-papers-8e3aff3/47-sheet-coi-390.png", (40, 738, 740, 1648), 650),
}


def main() -> None:
    if not features.check("webp"):
        sys.exit("This Pillow can't write WebP.")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (still, box, width) in SHOTS.items():
        shot = Image.open(STILLS / still).convert("RGB").crop(box)
        if width and width != shot.width:
            shot = shot.resize((width, round(shot.height * width / shot.width)), Image.Resampling.LANCZOS)
        path = OUT / f"{name}.webp"
        shot.save(path, "WEBP", quality=86, method=6)
        check = Image.open(path)
        if check.format != "WEBP":
            sys.exit(f"{path} isn't WebP.")
        print(f"{path.relative_to(OUT.parent.parent)} {check.width}x{check.height} {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
