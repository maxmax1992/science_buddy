import { ensureTranscript, getPaper, listThreads, readTranscript } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/papers/[id]">) {
  const { id } = await ctx.params;
  try {
    ensureTranscript(id); // retries a failed/interrupted transcription whenever the paper is opened
    const [paper, threads, transcript] = await Promise.all([getPaper(id), listThreads(id), readTranscript(id)]);
    return Response.json({ paper, threads, transcript });
  } catch {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }
}
