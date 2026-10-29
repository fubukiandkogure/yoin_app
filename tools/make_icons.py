"""ホーム画面用アイコン（PNG）を作る。外部ライブラリ不要。 python tools/make_icons.py
意匠：墨色の地に、朱の点と、右へ広がる2本の弧（余韻＝響きが残るさま）。
"""
import math, os, struct, zlib

INK = (22, 21, 19)
PAPER = (239, 233, 222)
ACCENT = (224, 70, 42)

# 0〜1 の座標系（中心をやや左に置き、弧が右へ広がる）
CX, CY = 0.40, 0.5
DOT_R = 0.085
RINGS = [(0.19, 0.034, 1.0), (0.305, 0.034, 0.42)]  # (半径, 太さ, 濃さ)


def color_at(x, y):
    dx, dy = x - CX, y - CY
    d = math.hypot(dx, dy)
    if d <= DOT_R:
        return ACCENT, 1.0
    if dx >= 0:
        for r, w, a in RINGS:
            if abs(d - r) <= w / 2:
                return PAPER, a
    # 弧の端を丸く
    for r, w, a in RINGS:
        for ey in (CY - r, CY + r):
            if math.hypot(x - CX, y - ey) <= w / 2:
                return PAPER, a
    return None, 0


def render(size, scale=1.0, ss=3):
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    x = ((px + (sx + .5) / ss) / size - .5) / scale + .5
                    y = ((py + (sy + .5) / ss) / size - .5) / scale + .5
                    c, a = color_at(x, y)
                    col = INK if c is None else tuple(INK[k] * (1 - a) + c[k] * a for k in range(3))
                    for k in range(3):
                        acc[k] += col[k]
            row += bytes(int(v / (ss * ss)) for v in acc)
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    h = len(rows); w = len(rows[0]) // 3
    raw = b''.join(b'\x00' + r for r in rows)

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)


out = os.path.join(os.path.dirname(__file__), '..', 'icons')
for name, size, scale in [('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0), ('icon-maskable-512.png', 512, 0.8), ('apple-touch-icon.png', 180, 0.95)]:
    write_png(os.path.join(out, name), render(size, scale, ss=2 if size > 300 else 3))
    print('wrote', name)
