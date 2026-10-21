import type Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { isAuthenticated } from "@/lib/auth";

export const maxDuration = 120;

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { messages } = (await request.json()) as { messages: Anthropic.Beta.BetaMessageParam[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await runAgent(messages));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "KRO5 hit an error talking to Claude. Try again." }, { status: 502 });
  }
}
