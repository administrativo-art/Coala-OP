#!/usr/bin/env python3
import argparse
from pathlib import Path

import pypdfium2 as pdfium


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("output_dir")
    parser.add_argument("--scale", type=float, default=2.0)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf = pdfium.PdfDocument(args.pdf)
    for index, page in enumerate(pdf):
        image = page.render(scale=args.scale).to_pil()
        image.save(output_dir / f"page-{index + 1:02d}.png")


if __name__ == "__main__":
    main()
