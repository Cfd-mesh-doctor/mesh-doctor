# Contact sheet of the renders, for a quick visual check: python3 make_contact.py OUTDIR PREFIX DEST.png
import glob
import os
import sys

from PIL import Image, ImageDraw

out_dir, prefix, dest = sys.argv[1], sys.argv[2], sys.argv[3]
files = sorted(glob.glob(os.path.join(out_dir, prefix + '*.png')))
tw, th, cols, cap = 480, 270, 4, 16
rows = max(1, (len(files) + cols - 1) // cols)
sheet = Image.new('RGB', (cols * tw, rows * (th + cap)), 'white')
draw = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB')
    im.thumbnail((tw, th))
    x, y = (i % cols) * tw, (i // cols) * (th + cap)
    sheet.paste(im, (x, y + cap))
    draw.text((x + 4, y + 2), os.path.basename(f)[:-4], fill=(0, 0, 0))
sheet.save(dest)
print(len(files), 'images ->', dest)
