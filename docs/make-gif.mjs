// 프레임 PNG 폴더 → 애니메이션 GIF
// usage: node make-gif.mjs <framesDir> <out.gif> <maxWidth> <delaysCsv>
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const [, , framesDir, outFile, maxWidthArg, delaysArg] = process.argv;
const maxWidth = Number(maxWidthArg || 880);
const delays = (delaysArg || "").split(",").filter(Boolean).map(Number);

const files = fs.readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();
if (files.length === 0) {
  console.error("no frames");
  process.exit(1);
}

const gif = GIFEncoder();

// 첫 프레임 기준으로 크기 고정 (모든 프레임 동일 크기여야 함)
const first = await sharp(path.join(framesDir, files[0])).metadata();
const scale = Math.min(1, maxWidth / first.width);
const W = Math.round(first.width * scale);
const H = Math.round(first.height * scale);

for (let i = 0; i < files.length; i++) {
  const buf = await sharp(path.join(framesDir, files[i]))
    .resize(W, H, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const data = new Uint8ClampedArray(buf);
  const palette = quantize(data, 256, { format: "rgba4444" });
  const index = applyPalette(data, palette, "rgba4444");
  const delay = delays[i] ?? delays[delays.length - 1] ?? 800;
  gif.writeFrame(index, W, H, { palette, delay, transparent: false });
}

gif.finish();
fs.writeFileSync(outFile, Buffer.from(gif.bytes()));
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`${path.basename(outFile)}  ${W}x${H}  ${files.length}frames  ${kb}KB`);
