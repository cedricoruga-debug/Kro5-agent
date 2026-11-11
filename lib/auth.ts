import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "kro5_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const value = process.env.KRO5_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("KRO5_SESSION_SECRET must be set (32+ characters)");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function checkPasscode(passcode: string): boolean {
  const expected = process.env.KRO5_PASSCODE;
  return Boolean(expected) && safeEqual(passcode, expected!);
}

export function createSessionToken(): string {
  const expires = String(Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS);
  return `${expires}.${sign(expires)}`;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

export async function isAuthenticated(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !safeEqual(signature, sign(expires))) return false;
  return Number(expires) > Date.now() / 1000;
}

// The Siri Shortcut can't sign in with a cookie, so it sends KRO5_SHORTCUT_TOKEN as a bearer token.
export function checkShortcutToken(request: Request): boolean {
  const expected = process.env.KRO5_SHORTCUT_TOKEN;
  if (!expected || expected.length < 32) return false;
  // Typed on a phone, so accept "bearer" in any case and ignore stray spaces or line breaks.
  const key = (request.headers.get("authorization") ?? "").replace(/^\s*bearer\b/i, "").replace(/\s+/g, "");
  return safeEqual(key, expected.trim());
}
