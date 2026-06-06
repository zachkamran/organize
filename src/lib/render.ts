import { Jimp, JimpMime } from "jimp";
import { convertHeicForAnalysis } from "./downscale";

export type TerminalGraphics = "kitty" | "iterm" | "blocks" | "none";

/**
 * Detect the best image protocol the current terminal supports:
 * - kitty graphics protocol: Ghostty, Kitty, WezTerm
 * - iTerm inline images: iTerm2, WezTerm, Mintty
 * - blocks: 24-bit-color half-block fallback that works everywhere else
 */
export function detectGraphics(): TerminalGraphics {
  if (!process.stdout.isTTY) return "none";
  const program = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  const term = (process.env.TERM ?? "").toLowerCase();

  if (program === "ghostty" || term.includes("ghostty") || term.includes("kitty") || process.env.KITTY_WINDOW_ID) {
    return "kitty";
  }
  if (program === "iterm.app" || program === "wezterm" || program === "mintty") {
    return "iterm";
  }
  return "blocks";
}

const THUMB_WIDTH = 320; // px transmitted; terminals scale to the cell grid

async function thumbnailPng(path: string): Promise<Buffer> {
  const source = path.toLowerCase().endsWith(".heic")
    ? convertHeicForAnalysis(path).bytes
    : path;
  const image = await Jimp.read(source as never);
  if (image.width > THUMB_WIDTH) image.scaleToFit({ w: THUMB_WIDTH, h: THUMB_WIDTH });
  return Buffer.from(await image.getBuffer(JimpMime.png));
}

/** Render an image inline. `columns` is the display width in terminal cells. */
export async function renderImage(
  path: string,
  graphics: TerminalGraphics,
  columns = 36,
): Promise<string> {
  switch (graphics) {
    case "kitty":
      return kittyRender(await thumbnailPng(path), columns);
    case "iterm":
      return itermRender(await thumbnailPng(path), columns);
    case "blocks":
      return blocksRender(path, columns);
    case "none":
      return "";
  }
}

/** Kitty graphics protocol: chunked base64 PNG (f=100), display over `columns` cells. */
function kittyRender(png: Buffer, columns: number): string {
  const encoded = png.toString("base64");
  const CHUNK = 4096;
  const parts: string[] = [];
  for (let i = 0; i < encoded.length; i += CHUNK) {
    const chunk = encoded.slice(i, i + CHUNK);
    const isFirst = i === 0;
    const hasMore = i + CHUNK < encoded.length ? 1 : 0;
    const controls = isFirst ? `a=T,f=100,c=${columns},m=${hasMore}` : `m=${hasMore}`;
    parts.push(`\x1b_G${controls};${chunk}\x1b\\`);
  }
  return parts.join("") + "\n";
}

/** iTerm2 OSC 1337 inline image. */
function itermRender(png: Buffer, columns: number): string {
  const encoded = png.toString("base64");
  return `\x1b]1337;File=inline=1;width=${columns};preserveAspectRatio=1;size=${png.length}:${encoded}\x07\n`;
}

/** Universal fallback: 24-bit-color half-block (▀) mosaic, two pixels per cell. */
async function blocksRender(path: string, columns: number): Promise<string> {
  const source = path.toLowerCase().endsWith(".heic")
    ? convertHeicForAnalysis(path).bytes
    : path;
  const image = await Jimp.read(source as never);
  const width = Math.min(columns, 100);
  const height = Math.max(2, Math.round((image.height / image.width) * width));
  image.resize({ w: width, h: height % 2 === 0 ? height : height + 1 });

  let out = "";
  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x++) {
      const top = rgb(image.getPixelColor(x, y));
      const bottom = rgb(image.getPixelColor(x, y + 1));
      out += `\x1b[38;2;${top}m\x1b[48;2;${bottom}m▀`;
    }
    out += "\x1b[0m\n";
  }
  return out;
}

function rgb(pixel: number): string {
  return `${(pixel >>> 24) & 0xff};${(pixel >>> 16) & 0xff};${(pixel >>> 8) & 0xff}`;
}
