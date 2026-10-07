import { addPaper, addPaperFromUrl, listPapers } from "@/lib/store";

export const GET = async () => Response.json(await listPapers());

/** multipart `file` upload, or JSON `{ url }` (PDF link, arXiv link or arXiv id). */
export async function POST(req: Request) {
  try {
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) throw new Error("No file uploaded");
      const title = file.name.replace(/\.pdf$/i, "");
      return Response.json(await addPaper(new Uint8Array(await file.arrayBuffer()), { title }));
    }
    const { url } = await req.json();
    if (typeof url !== "string" || !url.trim()) throw new Error("Missing url");
    return Response.json(await addPaperFromUrl(url));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
