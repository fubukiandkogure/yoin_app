"""ホーム画面用アイコン（PNG）を作る。外部ライブラリ不要。 python tools/make_icons.py"""
import struct, zlib, os

PAPER = (245, 241, 232)
SHAPES = [  # 0〜1 の座標系での多角形と色（本棚に3冊、1冊は傾いている）
    ([(0.20, 0.24), (0.33, 0.24), (0.33, 0.74), (0.20, 0.74)], (70, 104, 90)),
    ([(0.36, 0.30), (0.49, 0.30), (0.49, 0.74), (0.36, 0.74)], (138, 109, 59)),
    ([(0.60, 0.74), (0.716, 0.709), (0.602, 0.284), (0.486, 0.315)], (42, 40, 36)),
    ([(0.14, 0.74), (0.86, 0.74), (0.86, 0.785), (0.14, 0.785)], (42, 40, 36)),
]

def inside(poly, x, y):
    c = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

def render(size, scale=1.0, ss=3):
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x = ((px + (sx + .5) / ss) / size - .5) / scale + .5
                    y = ((py + (sy + .5) / ss) / size - .5) / scale + .5
                    col = PAPER
                    for poly, c in SHAPES:
                        if inside(poly, x, y):
                            col = c
                    for k in range(3):
                        acc[k] += col[k]
            row += bytes(int(a / (ss * ss)) for a in acc)
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
for name, size, scale in [('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0), ('icon-maskable-512.png', 512, 0.78), ('apple-touch-icon.png', 180, 0.92)]:
    write_png(os.path.join(out, name), render(size, scale, ss=2 if size > 300 else 3))
    print('wrote', name)
