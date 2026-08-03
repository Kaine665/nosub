#!/usr/bin/env python3
"""生成 nosub 扩展图标 (16/48/128 px PNG)。"""

from pathlib import Path
import struct
import zlib

OUT = Path(__file__).parent.parent / "public"

def create_png(width: int, height: int, r: int, g: int, b: int) -> bytes:
    """创建纯色 PNG, 中心白色 'N' 字母。"""
    # 构建 RGBA 像素数组
    pixels = []
    for y in range(height):
        row = []
        for x in range(width):
            # 在中心画一个简单的 'N' 形状
            margin = max(2, width // 6)
            left = margin
            right = width - margin
            top = margin
            bottom = height - margin
            diag_x = left + (y - top) * (right - left) // (bottom - top)

            is_n = (
                (x >= left and x <= left + margin and y >= top and y <= bottom) or  # 左竖
                (x >= right - margin and x <= right and y >= top and y <= bottom) or  # 右竖
                (abs(x - diag_x) <= margin // 2 and y >= top and y <= bottom)  # 斜线
            )
            if is_n:
                row.append((255, 255, 255, 255))  # 白色 N
            else:
                row.append((r, g, b, 255))  # 背景色
        pixels.append(row)

    # PNG 编码
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))

    raw = b''
    for row in pixels:
        raw += b'\x00'  # filter none
        for px in row:
            raw += bytes(px)
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')

    return header + ihdr + idat + iend


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # 深蓝灰底色 + 白色 N
    bg = (40, 42, 54)

    for size in [16, 48, 128]:
        png = create_png(size, size, *bg)
        path = OUT / f"icon{size}.png"
        path.write_bytes(png)
        print(f"  ✓ {path} ({size}×{size})")

    print("图标已生成到 public/ 目录")


if __name__ == "__main__":
    main()
