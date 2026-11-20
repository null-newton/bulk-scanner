# Generates the page-processing test scans in tests/fixtures (run: python tests/make_fixtures.py). Needs Pillow and Windows fonts.
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT, DPI = Path(__file__).parent / 'fixtures', 120
TEXT = ("Thank you for your order. This invoice lists the delivered goods, the agreed prices and the payment terms. "
        "Please transfer the total amount within thirty days to the bank account shown below, quoting the invoice number. "
        "Questions about this delivery can be sent to our customer service desk, which is open on weekdays from eight until five. "
        "Bedankt voor uw bestelling. Gelieve het totaalbedrag binnen dertig dagen over te schrijven met vermelding van het factuurnummer.").split()
random.seed(7)

def page(w_in=8.27, h_in=11.69, font='times.ttf', size=13, lines=None):
  W, H = int(w_in * DPI), int(h_in * DPI)
  im, f = Image.new('L', (W, H), 250), ImageFont.truetype(f'C:/Windows/Fonts/{font}', int(size * DPI / 72))
  d, m, y = ImageDraw.Draw(im), int(0.9 * DPI), int(0.9 * DPI)
  d.text((m, y), 'INVOICE 2026-0142', font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(20 * DPI / 72)), fill=20); y += int(0.6 * DPI)
  for _ in range(lines or 999):
    words, line = TEXT[:], ''
    random.shuffle(words)
    for wd in words:
      if d.textlength(line + ' ' + wd, font=f) > W - 2 * m: break
      line = (line + ' ' + wd).strip()
    d.text((m, y), line, font=f, fill=30); y += int(size * 1.5 * DPI / 72)
    if y > H - m: break
  return im

def scan(im, rot=0, skew=0.0, bg=None, at=(0, 0), size=None):
  im = im.rotate(rot, expand=True, fillcolor=250)
  if skew: im = im.rotate(skew, expand=True, resample=Image.BICUBIC, fillcolor=bg or 250)
  if bg is not None:
    W, H = size; out = Image.new('L', (W, H), bg)
    shadow = Image.new('L', im.size, 0); out.paste(225, (at[0] + 3, at[1] + 3, at[0] + im.width + 3, at[1] + im.height + 3)); out.paste(im, at, Image.new('L', im.size, 255).rotate(0)) if not skew else out.paste(im, at)
    im = out
  return im.filter(ImageFilter.GaussianBlur(0.6)).convert('RGB')

OUT.mkdir(exist_ok=True)
A4, glass = page(), (int(8.5 * DPI), int(11.69 * DPI))
cases = {
  'upright': scan(A4), 'upside_down': scan(A4, 180), 'sideways_cw': scan(A4, -90), 'sideways_ccw': scan(A4, 90),
  'skew_plus4': scan(A4, 0, 4), 'skew_minus3': scan(A4, 0, -3), 'upside_down_skew2': scan(A4, 180, 2),
  'flatbed_receipt': scan(page(3.2, 5.5, 'arial.ttf', 10), 0, 5, bg=242, at=(int(0.4 * DPI), int(0.5 * DPI)), size=glass),
  'mostly_blank': scan(page(lines=2)),
}
for name, im in cases.items(): im.save(OUT / f'{name}.jpg', quality=72)
print('wrote', len(cases), 'fixtures to', OUT)
