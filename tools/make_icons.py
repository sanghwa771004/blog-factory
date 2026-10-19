"""글공장 앱 아이콘 만들기: 짙은 초록 바탕에 흰 '글', 아래쪽에 형광펜 줄."""
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
GREEN = (31, 93, 76)
MARK = (244, 218, 98)
WHITE = (255, 255, 255)
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
KR_INDEX = 1  # .ttc 안에서 KR 글꼴 위치를 찾아서 쓴다


def kr_font(size):
    for idx in range(0, 10):
        try:
            f = ImageFont.truetype(FONT, size, index=idx)
        except Exception:
            break
        if "KR" in " ".join(f.getname()):
            return f
    return ImageFont.truetype(FONT, size, index=KR_INDEX)


def draw_icon(size, safe=1.0):
    scale = 4  # 크게 그려서 줄이면 가장자리가 부드럽다
    S = size * scale
    img = Image.new("RGB", (S, S), GREEN)
    d = ImageDraw.Draw(img)
    inner = S * safe
    off = (S - inner) / 2
    # 형광펜 줄
    bar_h = inner * 0.20
    bar_y = off + inner * 0.60
    d.rounded_rectangle([off + inner * 0.16, bar_y, off + inner * 0.84, bar_y + bar_h], radius=bar_h * 0.35, fill=MARK)
    # 글자
    font = kr_font(int(inner * 0.62))
    text = "글"
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    w, h = r - l, b - t
    x = off + (inner - w) / 2 - l
    y = off + (inner - h) / 2 - t - inner * 0.02
    d.text((x, y), text, font=font, fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


draw_icon(180).save(f"{OUT}/icon-180.png")
draw_icon(192).save(f"{OUT}/icon-192.png")
draw_icon(512).save(f"{OUT}/icon-512.png")
draw_icon(512, safe=0.78).save(f"{OUT}/icon-maskable-512.png")
draw_icon(32).save(f"{OUT}/favicon-32.png")
print("ok")
