// Run with `node scripts/generate-brand-icons.mjs` after editing app/icon.svg.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

// Reuse Next.js's existing image dependency; no extra package is needed.
const requireFromNext = createRequire(import.meta.resolve("next"));
const sharp = requireFromNext("sharp");
const source = await readFile(new URL("../app/icon.svg", import.meta.url));
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()));

// ICO directory followed by one lossless PNG image per size.
const directory = Buffer.alloc(6 + images.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(images.length, 4);
let imageOffset = directory.length;
for (const [index, image] of images.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(imageOffset, entry + 12);
  imageOffset += image.length;
}
await writeFile(new URL("../app/favicon.ico", import.meta.url), Buffer.concat([directory, ...images]));
console.log(`Generated app/favicon.ico (${sizes.map((size) => `${size}×${size}`).join(", ")})`);
