from io import BytesIO
from pathlib import Path
from struct import pack

from PIL import Image


# Package the same padded artwork rendered for macOS by build-app-icon.sh.
ROOT = Path(__file__).resolve().parent.parent
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def frame_data(frame):
    size = frame.width
    if size == 256:
        output = BytesIO()
        frame.save(output, format="PNG")
        return output.getvalue()

    # ICO's small bitmap frames use bottom-up BGRA plus a 32-bit-aligned AND mask.
    bottom_up = frame.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    pixels = bottom_up.tobytes("raw", "BGRA")
    mask = bottom_up.getchannel("A").point(lambda alpha: 255 if alpha == 0 else 0)
    mask_bytes = mask.convert("1", dither=Image.Dither.NONE).tobytes()
    row_bytes = (size + 7) // 8
    padding = b"\0" * (-row_bytes % 4)
    mask_rows = b"".join(mask_bytes[i:i + row_bytes] + padding for i in range(0, len(mask_bytes), row_bytes))
    header = pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0, len(pixels), 0, 0, 0, 0)
    return header + pixels + mask_rows


def write_icon(source, destination):
    with Image.open(source) as image:
        artwork = image.convert("RGBA")
    frames = [frame_data(artwork.resize((size, size), Image.Resampling.LANCZOS)) for size in SIZES]
    directory = bytearray(pack("<HHH", 0, 1, len(frames)))
    offset = len(directory) + 16 * len(frames)
    for size, frame in zip(SIZES, frames):
        side = size % 256
        directory.extend(pack("<BBBBHHII", side, side, 0, 0, 1, 32, len(frame), offset))
        offset += len(frame)
    destination.write_bytes(directory + b"".join(frames))


icons = ROOT / "desktop/windows/icons"
icons.mkdir(parents=True, exist_ok=True)
for theme, filename in (("Light", "personal-task-board-icon-1024.png"), ("Dark", "personal-task-board-icon-dark-1024.png")):
    write_icon(ROOT / "work" / filename, icons / f"AppIcon{theme}.ico")
