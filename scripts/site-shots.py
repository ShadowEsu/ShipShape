"""The home page's product screenshots (app/home-quiet.tsx): crops of the app's own stills, saved as WebP in public/site/.

Each crop is sized to where the page shows it, at 2x. The boxes are pixel boxes in the stills (Chrome, device scale 2):
the papers from the 4 Nov set, the tour and Deadlines from the 5 Nov film's sample stills (the Quiet app, a fresh
sample). After the app's look changes, take new stills and measure the boxes again.

    /home/preston/shipshape-work.noindex/py/bin/python scripts/site-shots.py [folder holding both still sets]
"""

import sys
from pathlib import Path

from PIL import Image, features

STILLS = Path(sys.argv[1] if len(sys.argv) > 1 else "/home/preston/boss-handoff/agents/shipshape")
OUT = Path(__file__).resolve().parent.parent / "public" / "site"
FRAMES = "film-2026-11-05/frames"
WINDOW = (0, 0, 2880, 1800)

# name: (still, (left, top, right, bottom), output width or None to keep the crop's own width)
SHOTS = {
    # The tour (components/site-tour.tsx). Desktop: the whole 1440 window, shown at 960 CSS px. Each scene's own
    # content starts at the top: the answer is check-result-top (film_take.py), its title just under the top bar.
    "tour-ask": (f"{FRAMES}/check-answered-1440.png", WINDOW, 1920),
    "tour-answer": ("site-a-58/frames/check-result-top-1440.png", WINDOW, 1920),
    "tour-link": (f"{FRAMES}/passport-1440.png", WINDOW, 1920),
    # Phone: the one pane that matters, 366 CSS px wide, so it shows at about 1:1 in a 390 screen (Design MUST 2: the
    # app's text at 12px or more). The request and its box; the answer's heading and rows; the link.
    "tour-ask-sm": (f"{FRAMES}/check-answered-390.png", (24, 629, 756, 1469), None),
    "tour-answer-sm": (f"{FRAMES}/check-result-390.png", (24, 215, 756, 1146), None),
    "tour-link-sm": (f"{FRAMES}/passport-390.png", (24, 285, 756, 866), None),
    # Deadlines: the whole window on desktop; on a phone, Lapsed and Next 30 days.
    "deadlines": (f"{FRAMES}/deadlines-1440.png", WINDOW, 1920),
    "deadlines-sm": (f"{FRAMES}/deadlines-390.png", (24, 823, 756, 1335), None),
    # The whole first page in the document sheet (390 wide, where the sheet shows all of it), inside its border: 325 CSS px.
    "paper-nda": ("stills-2026-11-04/papers-papers-8e3aff3/47-sheet-nda-390.png", (40, 738, 740, 1648), 650),
    "paper-w9": ("stills-2026-11-04/papers-papers-8e3aff3/47-sheet-w9-390.png", (40, 738, 740, 1648), 650),
    "paper-coi": ("stills-2026-11-04/papers-papers-8e3aff3/47-sheet-coi-390.png", (40, 738, 740, 1648), 650),
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
