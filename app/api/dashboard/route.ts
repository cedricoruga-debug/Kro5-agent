import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { BUILD, BUILD_HEADER } from "@/lib/build";
import { getDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json(await getDashboard(), { headers: { "Cache-Control": "no-store", [BUILD_HEADER]: BUILD } });
}
