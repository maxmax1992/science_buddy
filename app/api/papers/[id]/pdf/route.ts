import { readFile } from "node:fs/promises";
import { pdfPath } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/papers/[id]/pdf">) {
  const { id } = await ctx.params;
  const bytes = await readFile(pdfPath(id)).catch(() => null);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: { "content-type": "application/pdf", "cache-control": "private, max-age=31536000, immutable" },
  });
}
