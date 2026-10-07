import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { claudeCode, createAiSdkMcpServer } from "ai-sdk-provider-claude-code";
import { z } from "zod";
import { addPaperFromUrl, getPaper, listPapers, PAPERS_DIR, saveThread, type Anchor, type Paper } from "@/lib/store";

const CHAT_MODEL = process.env.SB_CHAT_MODEL ?? "sonnet";

type Body = { id: string; messages: UIMessage[]; paperId: string; anchor: Anchor; createdAt: number };

export async function POST(req: Request) {
  const { id, messages, paperId, anchor, createdAt }: Body = await req.json();
  const thread = { id, anchor, createdAt, messages };
  await saveThread(paperId, thread); // persist the question right away so the underline survives a reload

  const paper = await getPaper(paperId);
  const rootId = paper.parentId ?? paper.id;
  const library = (await listPapers()).filter((p) => p.id === rootId || p.parentId === rootId);

  const tools = {
    add_related_paper: tool({
      description:
        "Download a related paper (e.g. the cited work a concept builds on) into the user's library, listed under the current paper. Its transcript appears at ./<id>/transcript.md a minute or two later.",
      inputSchema: z.object({
        url: z.string().describe("Direct PDF URL, arXiv URL, or arXiv id like 1706.03762"),
        title: z.string(),
        reason: z.string().describe("One line: why this paper matters for the user's question"),
      }),
      execute: async ({ url, title, reason }) => {
        const p = await addPaperFromUrl(url, { title, reason, parentId: rootId });
        return `Added "${p.title}" as ./${p.id}/ (${p.pages} pages). Transcript will be at ./${p.id}/transcript.md shortly; read ./${p.id}/chunks/*.md meanwhile.`;
      },
    }),
  };

  const result = streamText({
    model: claudeCode(CHAT_MODEL, {
      cwd: PAPERS_DIR,
      systemPrompt: systemPrompt(paper, anchor, library),
      // Read-only file tools are confined to cwd (prompts outside it are denied); web tools are pre-approved.
      tools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],
      allowedTools: ["WebSearch", "WebFetch", "mcp__sb__add_related_paper"],
      mcpServers: { sb: createAiSdkMcpServer("sb", tools) },
      permissionPrompts: "none",
      persistSession: false,
    }),
    messages: await convertToModelMessages(messages),
  });
  result.consumeStream(); // finish + save even if the browser disconnects

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: ({ messages }) => saveThread(paperId, { ...thread, messages }),
    }),
  });
}

function systemPrompt(paper: Paper, anchor: Anchor, library: Paper[]) {
  const pages = [...new Set(anchor.rects.map((r) => r.page))].join(", ");
  const partial = paper.transcript.done < paper.transcript.total;
  return `You are Science Buddy, a research tutor helping the user deeply understand the scientific paper they are reading.

Your working directory is the user's paper library. Each paper lives in ./<id>/ with paper.pdf and, once transcribed, transcript.md (faithful Markdown + LaTeX; pages marked <!-- page N -->).
Current paper: "${paper.title}" → ./${paper.id}/transcript.md${partial ? ` (transcription in progress — partial pages in ./${paper.id}/chunks/*.md)` : ""}
Library (current paper and its related papers):
${library.map((p) => `- ./${p.id}/ — ${p.title}`).join("\n")}

The user highlighted this passage on page ${pages}:
"""
${anchor.text}
"""

How to work:
- Ground answers in the paper. Grep/Read the transcript for definitions, notation, equations and surrounding context before answering. Cite pages like (p. 4).
- Math in LaTeX: $...$ inline, $$...$$ display.
- Diagrams (flows, architectures, dependencies): use a \`\`\`mermaid block.
- Visualizations (plots, geometric intuition, step-by-step animations): include ONE \`\`\`html block holding a complete self-contained HTML document (inline SVG/Canvas/JS; load libraries only from https://cdn.jsdelivr.net). It renders in a sandboxed iframe 440 px tall whose width varies (360–900 px), so make the layout responsive (width: 100%, no fixed pixel widths). Make it interactive (sliders, hover) when that builds intuition. Use a white background.
- Related work: if the concept builds on another paper (e.g. a cited method), find it (WebSearch, prefer arXiv) and call add_related_paper so it lands in the user's library; WebFetch it when you need its details.
- Teach: intuition first, then precise detail. Be concise unless asked for depth.`;
}
