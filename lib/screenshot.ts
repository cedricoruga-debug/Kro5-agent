import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

export type Device = "phone" | "desktop";

// An iPhone-sized screen at the iPhone's own sharpness, and a laptop screen at retina sharpness, so the
// pictures are good enough for a portfolio or a pitch deck.
const SIZES: Record<Device, { width: number; height: number; scale: number; mobile: boolean }> = {
  phone: { width: 390, height: 844, scale: 3, mobile: true },
  desktop: { width: 1440, height: 900, scale: 2, mobile: false },
};

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export type Shot = {
  device: Device;
  // Full sharpness, for Ced to save.
  full: string;
  // Screen-sized, for Claude to look at without filling the conversation.
  preview: string;
};

// Only public web pages: no local or private network addresses, so a page can't point KRO5's server at itself.
export function publicUrl(raw: string): URL {
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only web pages can be screenshotted.");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) ||
    host.startsWith("[")
  ) {
    throw new Error("That address isn't a public web page.");
  }
  return url;
}

// Locally (next dev) there's no bundled Chromium; point CHROMIUM_PATH at any Chrome or Chromium.
async function launch(): Promise<Browser> {
  const local = process.env.CHROMIUM_PATH;
  return puppeteer.launch({
    args: local ? ["--no-sandbox"] : await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: local || (await chromium.executablePath()),
    headless: "shell",
  });
}

export async function screenshot(raw: string, devices: Device[], fullPage: boolean): Promise<{ url: string; title: string; shots: Shot[] }> {
  const url = publicUrl(raw);
  const browser = await launch();
  try {
    let title = "";
    const shots: Shot[] = [];
    for (const device of devices) {
      const size = SIZES[device];
      const page = await browser.newPage();
      if (size.mobile) await page.setUserAgent({ userAgent: IPHONE_UA });
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: size.scale, isMobile: size.mobile, hasTouch: size.mobile });
      // Wait for the network to go quiet so fonts and images are in, but don't hang on a page that never stops.
      await page.goto(url.href, { waitUntil: "networkidle2", timeout: 20000 }).catch(async (err) => {
        if (!(await page.title().catch(() => ""))) throw err;
      });
      await new Promise((r) => setTimeout(r, 800));
      title ||= await page.title();
      const full = await page.screenshot({ type: "jpeg", quality: 85, fullPage, encoding: "base64" });
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile });
      const preview = await page.screenshot({ type: "jpeg", quality: 60, encoding: "base64" });
      shots.push({ device, full, preview });
      await page.close();
    }
    return { url: url.href, title, shots };
  } finally {
    await browser.close();
  }
}
