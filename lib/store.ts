import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateText, type UIMessage } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { PDFDocument } from "pdf-lib";

// SB_DATA_DIR lets e2e run against its own library instead of yours.
export const PAPERS_DIR = path.resolve(process.env.SB_DATA_DIR ?? "data", "papers");
const TRANSCRIBE_MODEL = process.env.SB_TRANSCRIBE_MODEL ?? "sonnet";
const PAGES_PER_CHUNK = 3;
const CONCURRENCY = 2; // gentle on subscription rate limits; chat questions stay responsive

export type Rect = { page: number; x: number; y: number; w: number; h: number };
export type Anchor = { text: string; rects: Rect[] };
export type Thread = { id: string; anchor: Anchor; createdAt: number; messages: UIMessage[] };
type Meta = {
  id: string;
  title: string;
  pages: number;
  addedAt: number;
  parentId?: string;
  source?: string;
  reason?: string;
  error?: string;
};
export type Paper = Meta & { transcript: { done: number; total: number; running: boolean } };

const dir = (id: string) => {
  if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("Invalid paper id");
  return path.join(PAPERS_DIR, id);
};
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, "utf8"));
const writeJson = (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2));
const patchMeta = async (id: string, patch: Partial<Meta>) => {
  const file = path.join(dir(id), "meta.json");
  await writeJson(file, { ...(await readJson<Meta>(file)), ...patch });
};

export const pdfPath = (id: string) => path.join(dir(id), "paper.pdf");
export const readTranscript = (id: string) =>
  readFile(path.join(dir(id), "transcript.md"), "utf8").catch(() => null);

// ---------- papers ----------

/** Same bytes → same id, so re-adding a paper never re-transcribes it. */
export async function addPaper(
  bytes: Uint8Array,
  init: { title: string; parentId?: string; source?: string; reason?: string },
): Promise<Paper> {
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") throw new Error("That file is not a PDF");
  const id = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const d = dir(id);
  if (!existsSync(path.join(d, "meta.json"))) {
    const pages = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
    await mkdir(path.join(d, "threads"), { recursive: true });
    await writeFile(path.join(d, "paper.pdf"), bytes);
    const parentId = init.parentId === id ? undefined : init.parentId;
    await writeJson(path.join(d, "meta.json"), { ...init, parentId, id, pages, addedAt: Date.now() } satisfies Meta);
  }
  ensureTranscript(id);
  return getPaper(id);
}

export async function addPaperFromUrl(
  input: string,
  init: { title?: string; parentId?: string; reason?: string } = {},
): Promise<Paper> {
  let s = input.trim();
  if (/^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$/i.test(s)) s = `https://arxiv.org/pdf/${s.replace(/^arxiv:/i, "")}`;
  const url = new URL(s);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) links are supported");
  if (url.hostname.endsWith("arxiv.org")) url.pathname = url.pathname.replace(/^\/abs\//, "/pdf/");
  const res = await fetch(url, { headers: { "user-agent": "science-buddy/0.1" } });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const title = init.title || decodeURIComponent(url.pathname.split("/").pop() || url.hostname);
  return addPaper(new Uint8Array(await res.arrayBuffer()), { ...init, title, source: url.toString() });
}

export async function getPaper(id: string): Promise<Paper> {
  const d = dir(id);
  const meta = await readJson<Meta>(path.join(d, "meta.json"));
  const total = Math.ceil(meta.pages / PAGES_PER_CHUNK);
  const done = existsSync(path.join(d, "transcript.md"))
    ? total
    : (await readdir(path.join(d, "chunks")).catch(() => [])).filter((f) => f.endsWith(".md")).length;
  return { ...meta, transcript: { done, total, running: jobs().has(id) } };
}

export async function listPapers(): Promise<Paper[]> {
  const ids = (await readdir(PAPERS_DIR).catch(() => [])).filter((f) => /^[a-f0-9]{12}$/.test(f));
  return (await Promise.all(ids.map(getPaper))).sort((a, b) => a.addedAt - b.addedAt);
}

// ---------- threads ----------

const threadFile = (paperId: string, threadId: string) => {
  if (!/^[\w-]{1,64}$/.test(threadId)) throw new Error("Invalid thread id");
  return path.join(dir(paperId), "threads", `${threadId}.json`);
};
export const saveThread = (paperId: string, thread: Thread) => writeJson(threadFile(paperId, thread.id), thread);
export async function listThreads(paperId: string): Promise<Thread[]> {
  const td = path.join(dir(paperId), "threads");
  const files = (await readdir(td).catch(() => [])).filter((f) => f.endsWith(".json"));
  const threads = await Promise.all(files.map((f) => readJson<Thread>(path.join(td, f))));
  return threads.sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- transcription (LLM, cached per 3-page chunk) ----------

// globalThis so every route bundle in dev shares one job table.
const jobs = (): Map<string, Promise<void>> =>
  ((globalThis as { __sbJobs?: Map<string, Promise<void>> }).__sbJobs ??= new Map());

/** Idempotent: no-op when transcribed or already running; resumes from cached chunks after a crash/error. */
export function ensureTranscript(id: string) {
  if (jobs().has(id) || existsSync(path.join(dir(id), "transcript.md"))) return;
  const job = transcribe(id)
    .catch((e) => patchMeta(id, { error: e instanceof Error ? e.message : String(e) }))
    .finally(() => jobs().delete(id));
  jobs().set(id, job);
}

const TRANSCRIBE_SYSTEM = `You transcribe pages of scientific papers into Markdown. Output ONLY the transcription: no preamble, no commentary, no surrounding code fence.
Rules:
- Start every page with <!-- page N --> using the ORIGINAL page numbers you are given.
- Keep all text verbatim and in reading order (merge two-column layouts correctly). Skip running headers/footers and bare page numbers.
- The paper title (first page only) is the single "# " heading. Section headings use "##", subsections "###".
- Math in LaTeX: inline $...$, display $$...$$; keep equation numbers with \\tag{n}.
- Tables as Markdown tables.
- Figures: "> **Figure N:** <caption>" followed by one sentence describing what the figure shows.
- Footnotes go at the end of the page they appear on.`;

async function transcribe(id: string) {
  const d = dir(id);
  const chunkDir = path.join(d, "chunks");
  await mkdir(chunkDir, { recursive: true });
  await patchMeta(id, { error: undefined });
  const src = await PDFDocument.load(await readFile(pdfPath(id)), { ignoreEncryption: true });
  const n = src.getPageCount();
  const starts = Array.from({ length: Math.ceil(n / PAGES_PER_CHUNK) }, (_, i) => i * PAGES_PER_CHUNK + 1);
  const queue = [...starts];
  const worker = async () => {
    for (let s = queue.shift(); s !== undefined; s = queue.shift())
      await transcribeChunk(src, chunkDir, s, Math.min(s + PAGES_PER_CHUNK - 1, n));
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const md = (await Promise.all(starts.map((s) => readFile(path.join(chunkDir, `${s}.md`), "utf8")))).join("\n\n");
  await writeFile(path.join(d, "transcript.md"), md);
  const title = md.match(/^# (.+)$/m)?.[1]?.trim();
  if (title) await patchMeta(id, { title });
}

async function transcribeChunk(src: PDFDocument, chunkDir: string, from: number, to: number) {
  const out = path.join(chunkDir, `${from}.md`);
  if (existsSync(out)) return;
  // Claude's Read tool needs poppler for page ranges, but reads small PDFs natively — so split first.
  const chunk = await PDFDocument.create();
  const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  for (const page of await chunk.copyPages(src, indices)) chunk.addPage(page);
  await writeFile(path.join(chunkDir, `${from}.pdf`), await chunk.save());
  const { text } = await generateText({
    model: claudeCode(TRANSCRIBE_MODEL, {
      cwd: chunkDir,
      systemPrompt: TRANSCRIBE_SYSTEM,
      tools: ["Read"],
      allowedTools: ["Read"],
      permissionPrompts: "none",
      persistSession: false,
    }),
    prompt: `Read ./${from}.pdf with the Read tool. It contains pages ${from}-${to} of the paper. Transcribe it.`,
  });
  // Never cache a refusal or error message as if it were the paper.
  if (!text.includes("<!-- page")) throw new Error(`Transcription of pages ${from}-${to} failed: ${text.slice(0, 200)}`);
  await writeFile(out, text.trim());
}
