import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

// What happened in a voice turn on Ced's phone (mic and audio state, timings; never audio or words),
// written to the server log so problems can be diagnosed from Vercel's logs.
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const data = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const fields = Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
      .slice(0, 12)
      .map(([k, v]) => [k.slice(0, 32), typeof v === "string" ? v.slice(0, 80) : v]),
  );
  console.info("voice", JSON.stringify(fields));
  return new NextResponse(null, { status: 204 });
}
