"""Prepare the v7 still images and record their dimensions and byte sizes."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs/v7-visuals"
MASTERS = DOCS / "masters"
records = []

for source in sorted(MASTERS.glob("v7_*.png")):
    if source.stem.endswith("_start") or source.stem == "v7_cast_fahd":
        continue
    group = source.stem.split("_")[1]
    target_size = (1024, 1280) if source.stem.endswith("_phone") else (1536, 1024)
    original = Image.open(source).convert("RGB")
    if original.size != target_size:
        raw = MASTERS / "raw" / source.name
        raw.parent.mkdir(exist_ok=True)
        if not raw.exists():
            raw.write_bytes(source.read_bytes())
        original = original.resize(target_size, Image.Resampling.LANCZOS)
        original.save(source)
    destination = ROOT / "public/illustrations/v7" / group
    destination.mkdir(parents=True, exist_ok=True)
    for width in (1200, 600):
        height = round(width * target_size[1] / target_size[0])
        image = original.resize((width, height), Image.Resampling.LANCZOS)
        suffix = "" if width == 1200 else "_600"
        output = destination / f"{source.stem}{suffix}.webp"
        for quality in range(90, 29, -2):
            image.save(output, "WEBP", quality=quality, method=6)
            if output.stat().st_size <= 80_000:
                break
        else:
            raise RuntimeError(f"Image exceeds size limit: {output.name}")
        records.append({
            "file": str(output.relative_to(ROOT)),
            "width": width,
            "height": height,
            "bytes": output.stat().st_size,
            "quality": quality,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        })

(DOCS / "asset-checks.json").write_text(json.dumps(records, indent=2) + "\n")
print(f"Prepared {len(records)} WebP files. Largest is {max(x['bytes'] for x in records)} bytes.")
