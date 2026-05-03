"""
Generate images/icon.png — minimal, dark, violet magnifying-glass + log-lines logo.
Requires only Python stdlib (struct, zlib, math).
"""
import struct, zlib, math, os

W = H = 128

# ── colour palette ──────────────────────────────────────────────────────────
BG          = (13,  17,  41)
ACCENT      = (139, 92, 246)   # violet-500
ACCENT_L    = (167, 139, 250)  # violet-400
LINE_COL    = (210, 220, 255)

# ── helpers ─────────────────────────────────────────────────────────────────
def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))

def blend(base, col, a):
    return (int(base[0]*(1-a) + col[0]*a),
            int(base[1]*(1-a) + col[1]*a),
            int(base[2]*(1-a) + col[2]*a))

def aa_rounded_rect(x, y, x0, y0, x1, y1, r, soft=1.5):
    cx = clamp(x, x0+r, x1-r)
    cy = clamp(y, y0+r, y1-r)
    d  = math.hypot(x-cx, y-cy)
    return clamp((r - d) / soft)

def aa_ring(x, y, cx, cy, r, t, soft=1.2):
    d = math.hypot(x-cx, y-cy)
    return clamp((t/2 - abs(d-r)) / soft)

def aa_fill(x, y, cx, cy, r, soft=0.8):
    d = math.hypot(x-cx, y-cy)
    return clamp((r - d) / soft)

def aa_segment(x, y, ax, ay, bx, by, hw, soft=1.2):
    dx, dy = bx-ax, by-ay
    L = math.hypot(dx, dy)
    if L < 1e-9: return 0.0
    tx, ty = dx/L, dy/L
    t   = clamp((x-ax)*tx + (y-ay)*ty, 0.0, L)
    npx, npy = ax+t*tx, ay+t*ty
    d = math.hypot(x-npx, y-npy)
    return clamp((hw - d) / soft)

# ── raster ───────────────────────────────────────────────────────────────────
pixels = []

# geometry
LCX, LCY = 52.0, 50.0   # lens centre
LR        = 30.0          # lens radius
RING_T    = 5.5           # ring thickness
HW        = 5.5           # handle half-width
ANG       = math.radians(45)
H1X = LCX + (LR + RING_T*0.5 + 1) * math.cos(ANG)
H1Y = LCY + (LR + RING_T*0.5 + 1) * math.sin(ANG)
H2X = LCX + (LR + RING_T*0.5 + 30) * math.cos(ANG)
H2Y = LCY + (LR + RING_T*0.5 + 30) * math.sin(ANG)

# log-lines: (start_x relative to LCX, centre_y, length, half-height)
LOG_LINES = [
    (LCX - 12, LCY - 12, 22, 2.5),
    (LCX - 12, LCY,       28, 2.5),
    (LCX - 12, LCY + 12,  16, 2.5),
]

for y in range(H):
    row = []
    for x in range(W):
        fx, fy = x + 0.5, y + 0.5

        bg_a = aa_rounded_rect(fx, fy, 0, 0, W, H, 20, soft=1.5)
        if bg_a <= 0:
            row.append((0, 0, 0, 0))
            continue

        r, g, b = BG

        # — subtle vignette (darken corners very slightly) —
        vx = (fx - W/2) / (W/2)
        vy = (fy - H/2) / (H/2)
        vign = clamp(1.0 - 0.18 * (vx*vx + vy*vy))
        r = int(r * vign); g = int(g * vign); b = int(b * vign)

        # — handle (drawn before ring so ring sits on top) —
        h_a = aa_segment(fx, fy, H1X, H1Y, H2X, H2Y, HW)
        if h_a > 0:
            r, g, b = blend((r,g,b), ACCENT_L, h_a)

        # — ring —
        ring_a = aa_ring(fx, fy, LCX, LCY, LR, RING_T)
        if ring_a > 0:
            r, g, b = blend((r,g,b), ACCENT_L, ring_a)

        # — lens interior —
        fill_a = aa_fill(fx, fy, LCX, LCY, LR - RING_T*0.5)
        if fill_a > 0:
            # very subtle tint
            r, g, b = blend((r,g,b), ACCENT, 0.10 * fill_a)

            # log lines
            for (lsx, lsy, llen, lhh) in LOG_LINES:
                tx2 = clamp(fx, lsx, lsx + llen)
                d   = math.hypot(fx - tx2, fy - lsy)
                la  = clamp((lhh - d) / 0.8) * fill_a
                if la > 0:
                    # leftmost ~4 px act as a coloured "level" dot
                    dot_a = clamp((lsx + 5 - fx) / 1.5) * la
                    r, g, b = blend((r,g,b), LINE_COL, la * 0.80)
                    if dot_a > 0:
                        r, g, b = blend((r,g,b), ACCENT_L, dot_a * 0.60)

        row.append((r, g, b, int(bg_a * 255)))
    pixels.append(row)

# ── PNG writer ───────────────────────────────────────────────────────────────
def write_png(path, w, h, pix):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    raw = b''
    for row in pix:
        raw += b'\x00'
        for (r,g,b,a) in row:
            raw += bytes([r,g,b,a])

    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(raw, 9))
    iend = chunk(b'IEND', b'')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(sig + ihdr + idat + iend)
    print(f'Written {path}')

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'images', 'icon.png')
write_png(out, W, H, pixels)
