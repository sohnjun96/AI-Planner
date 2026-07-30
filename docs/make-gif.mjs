// 프레임 PNG 폴더 → 애니메이션 GIF
// usage: node make-gif.mjs <framesDir> <out.gif> <maxWidth> <delaysCsv> [maxColors]
//
// 프레임 수가 많아도 용량이 커지지 않도록, 2번째 프레임부터는 이전 프레임과
// 달라진 픽셀만 칠하고 나머지는 투명으로 남긴다(dispose=1로 이전 화면 유지).
// 타이핑처럼 일부만 바뀌는 구간에서 용량이 크게 줄어든다.
import gifenc from "gifenc";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const [, , framesDir, outFile, maxWidthArg, delaysArg, colorsArg] = process.argv;
const maxWidth = Number(maxWidthArg || 880);
const delays = (delaysArg || "").split(",").filter(Boolean).map(Number);
const maxColors = Number(colorsArg || 200);

const files = fs.readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();
if (files.length === 0) {
  console.error("no frames");
  process.exit(1);
}

const first = await sharp(path.join(framesDir, files[0])).metadata();
const scale = Math.min(1, maxWidth / first.width);
const W = Math.round(first.width * scale);
const H = Math.round(first.height * scale);

async function readFrame(file) {
  const buf = await sharp(path.join(framesDir, file))
    .resize(W, H, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return new Uint8ClampedArray(buf);
}

// 모든 프레임이 같은 팔레트를 쓰도록 대표 프레임들에서 팔레트를 만든다.
// (프레임마다 팔레트를 새로 쓰면 용량이 프레임 수에 비례해 늘어난다)
const sampleIdx = [...new Set([0, Math.floor(files.length / 3), Math.floor((files.length * 2) / 3), files.length - 1])];
const samples = [];
for (const i of sampleIdx) {
  samples.push(await readFrame(files[i]));
}
const merged = new Uint8ClampedArray(samples.reduce((n, s) => n + s.length, 0));
let off = 0;
for (const s of samples) {
  merged.set(s, off);
  off += s.length;
}
// 인덱싱에는 basePalette만 쓰고, 출력 팔레트 끝에 투명용 자리를 덧붙인다.
// (applyPalette가 투명 인덱스를 골라 버리면 멀쩡한 픽셀이 사라진다)
const basePalette = quantize(merged, Math.max(2, maxColors - 1), { format: "rgba4444" });
const transparentIndex = basePalette.length;
const palette = [...basePalette, [255, 0, 255, 255]];

const gif = GIFEncoder();
let prev = null;

for (let i = 0; i < files.length; i++) {
  const data = await readFrame(files[i]);
  const index = applyPalette(data, basePalette, "rgba4444");
  const delay = delays[i] ?? delays[delays.length - 1] ?? 800;

  if (prev === null) {
    gif.writeFrame(index, W, H, { palette, delay, transparent: false });
  } else {
    // 이전 프레임과 동일한 픽셀은 투명으로 두어 그대로 남긴다
    for (let p = 0, q = 0; p < index.length; p++, q += 4) {
      if (
        data[q] === prev[q] &&
        data[q + 1] === prev[q + 1] &&
        data[q + 2] === prev[q + 2]
      ) {
        index[p] = transparentIndex;
      }
    }
    gif.writeFrame(index, W, H, { palette, delay, transparent: true, transparentIndex, dispose: 1 });
  }
  prev = data;
}

gif.finish();
fs.writeFileSync(outFile, Buffer.from(gif.bytes()));
const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`${path.basename(outFile)}  ${W}x${H}  ${files.length}frames  ${kb}KB`);
