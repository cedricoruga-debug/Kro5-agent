import type Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { isAuthenticated } from "@/lib/auth";
import { BUILD, BUILD_HEADER } from "@/lib/build";
import type { RecentChat } from "@/lib/memory";

export const maxDuration = 120;

// Streams newline-delimited JSON events: "text" as the reply comes in, "step" when KRO5 uses a tool,
// then one "done" with the full result, or "error".
export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { messages, recent } = (await request.json()) as { messages: Anthropic.Beta.BetaMessageParam[]; recent?: RecentChat[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const started = Date.now();
      let firstText = 0;
      let steps = 0;
      try {
        const result = await runAgent(messages, {
          // The phone's last few conversations, sent with the first message of a new one.
          recent: (Array.isArray(recent) ? recent : [])
            .slice(0, 5)
            .map((r) => ({ at: String(r?.at ?? ""), asked: String(r?.asked ?? ""), reply: String(r?.reply ?? "") }))
            .filter((r) => r.asked && !Number.isNaN(Date.parse(r.at))),
          onText: (text) => {
            firstText ||= Date.now() - started;
            send({ type: "text", text });
          },
          onStep: (step) => {
            steps++;
            send({ type: "step", step });
          },
        });
        console.info("chat", JSON.stringify({ firstTextMs: firstText, totalMs: Date.now() - started, steps }));
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
