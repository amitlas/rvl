"""Draws rvl's icons (16/32/48/128 px) into icons/. Run: python3 scripts/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BG = (79, 70, 229)      # indigo
FG = (255, 255, 255)
FONT = "/System/Library/Fonts/HelveticaNeue.ttc"


def draw(size):
    scale = 8  # draw large, then downsample for smooth edges
    big = size * scale
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=BG)
    font = ImageFont.truetype(FONT, int(big * 0.72), index=1)  # bold face
    box = d.textbbox((0, 0), "A", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((big - w) / 2 - box[0], (big - h) / 2 - box[1]), "A", font=font, fill=FG)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    for size in (16, 32, 48, 128):
        draw(size).save(ROOT / "icons" / f"icon{size}.png")
    print("icons written")
