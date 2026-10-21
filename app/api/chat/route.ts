import type Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { isAuthenticated } from "@/lib/auth";
import { BUILD, BUILD_HEADER } from "@/lib/build";

export const maxDuration = 120;

// Streams newline-delimited JSON events: "text" as the reply comes in, "step" when KRO5 uses a tool,
// then one "done" with the full result, or "error".
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { messages } = (await request.json()) as { messages: Anthropic.Beta.BetaMessageParam[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const result = await runAgent(messages, {
          onText: (text) => send({ type: "text", text }),
          onStep: (step) => send({ type: "step", step }),
        });
        send({ type: "done", ...result });
      } catch (err) {
        console.error(err);
        send({ type: "error", error: "KRO5 hit an error talking to Claude. Try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", [BUILD_HEADER]: BUILD } });
}
