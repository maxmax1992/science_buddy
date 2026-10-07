"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { AppSidebar } from "@/components/app-sidebar";
import { ThreadList, ThreadPanel, ask } from "@/components/thread-panel";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Anchor, Paper, Thread } from "@/lib/store";
import { BookOpenTextIcon, FileTextIcon, HighlighterIcon, ScrollTextIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const PdfView = dynamic(() => import("@/components/pdf-view"), { ssr: false });

// Client-only app (PDF.js, mic, local files) — skipping SSR also lets state read the URL hash directly.
export default dynamic(() => Promise.resolve(Home), { ssr: false });

const fromHash = () => location.hash.slice(1).split("/") as [string?, string?];

function Home() {
  const [papers, setPapers] = useState<Paper[]>([]);
  // #paperId/threadId keeps the place across reloads.
  const [paperId, setPaperId] = useState(() => fromHash()[0] || undefined);
  const [threadId, setThreadId] = useState(() => fromHash()[1] || undefined);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [view, setView] = useState<"pdf" | "md">("pdf");

  // ponytail: polling keeps transcription progress and agent-added related papers fresh; SSE if this ever feels laggy.
  useEffect(() => {
    const load = () => fetch("/api/papers").then((r) => r.json()).then(setPapers).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (paperId) history.replaceState(null, "", `#${paperId}${threadId ? `/${threadId}` : ""}`);
  }, [paperId, threadId]);
  useEffect(() => {
    // back/forward and hand-edited links (replaceState above doesn't fire this, so no loop)
    const onHash = () => {
      const [p, t] = fromHash();
      setPaperId(p || undefined);
      setThreadId(t || undefined);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const paper = papers.find((p) => p.id === paperId);
  const transcribed = !!paper && paper.transcript.done === paper.transcript.total;

  useEffect(() => {
    if (!paperId) return;
    let live = true;
    fetch(`/api/papers/${paperId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live || !d.paper) return;
        setThreads(d.threads);
        setTranscript(d.transcript);
      });
    return () => {
      live = false;
    };
  }, [paperId]);

  useEffect(() => {
    if (paperId && transcribed && transcript === null)
      fetch(`/api/papers/${paperId}`)
        .then((r) => r.json())
        .then((d) => setTranscript(d.transcript ?? null));
  }, [paperId, transcribed, transcript]);

  const openPaper = (id: string) => {
    if (id === paperId) return;
    setPaperId(id);
    setThreadId(undefined);
    setThreads([]);
    setTranscript(null);
  };

  const onAsk = (anchor: Anchor, question: string, viaVoice: boolean) => {
    if (!paperId) return;
    const thread: Thread = { id: crypto.randomUUID(), anchor, createdAt: Date.now(), messages: [] };
    setThreads((ts) => [...ts, thread]);
    setThreadId(thread.id);
    ask(paperId, thread, question, viaVoice);
  };

  const activeThread = threads.find((t) => t.id === threadId);

  return (
    <SidebarProvider className="h-svh">
      <AppSidebar
        activeId={paperId}
        onAdded={(p) => {
          setPapers((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, p]));
          openPaper(p.id);
        }}
        onOpen={openPaper}
        papers={papers}
      />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Separator className="mr-1 data-[orientation=vertical]:h-4" orientation="vertical" />
          {paper ? (
            <>
              <h1 className="min-w-0 truncate font-medium text-sm">{paper.title}</h1>
              {!transcribed && (
                <Badge className="shrink-0 gap-1.5" variant="secondary">
                  <Spinner className="size-3" /> Transcribing {paper.transcript.done}/{paper.transcript.total}
                </Badge>
              )}
              <ToggleGroup
                className="ml-auto"
                onValueChange={(v) => v && setView(v as "pdf" | "md")}
                size="sm"
                type="single"
                value={view}
                variant="outline"
              >
                <ToggleGroupItem aria-label="PDF" value="pdf">
                  <FileTextIcon /> PDF
                </ToggleGroupItem>
                <ToggleGroupItem aria-label="Transcript" disabled={!transcript} value="md">
                  <ScrollTextIcon /> Transcript
                </ToggleGroupItem>
              </ToggleGroup>
            </>
          ) : (
            <h1 className="font-medium text-sm">Science Buddy</h1>
          )}
        </header>

        {paper ? (
          <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
            <ResizablePanel defaultSize="64" minSize="35">
              {view === "md" && transcript ? (
                <div className="h-full overflow-y-auto">
                  <article className="mx-auto max-w-3xl px-8 py-10 text-[15px] leading-relaxed">
                    <MessageResponse>{transcript.replace(/<!-- page (\d+) -->/g, "\n\n###### Page $1\n\n")}</MessageResponse>
                  </article>
                </div>
              ) : (
                <PdfView
                  activeId={threadId}
                  onAsk={onAsk}
                  onOpen={setThreadId}
                  threads={threads}
                  url={`/api/papers/${paper.id}/pdf`}
                />
              )}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="36" minSize="24">
              {activeThread ? (
                <ThreadPanel
                  key={activeThread.id}
                  onBack={() => setThreadId(undefined)}
                  onLocate={() => setView("pdf")}
                  paperId={paper.id}
                  thread={activeThread}
                />
              ) : (
                <ThreadList onOpen={setThreadId} threads={threads} />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <Welcome hasPapers={papers.length > 0} />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function Welcome({ hasPapers }: { hasPapers: boolean }) {
  const steps = useMemo(
    () => [
      { icon: BookOpenTextIcon, text: "Add a paper (arXiv id, link or PDF). Claude transcribes it once, math included." },
      { icon: HighlighterIcon, text: "Highlight a passage and ask — typed or by voice. Answers stream into a side chat." },
      { icon: FileTextIcon, text: "Asked passages stay underlined. Click one to reopen the full conversation." },
    ],
    [],
  );
  return (
    <Empty className="flex-1">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon">
          <BookOpenTextIcon />
        </EmptyMedia>
        <EmptyTitle>{hasPapers ? "Pick a paper from the library" : "Your research buddy"}</EmptyTitle>
        <EmptyDescription>Read with a tutor that has the whole paper — and its references — in context.</EmptyDescription>
      </EmptyHeader>
      <ol className="flex max-w-md flex-col gap-3 text-left text-muted-foreground text-sm">
        {steps.map(({ icon: Icon, text }) => (
          <li className="flex gap-3" key={text}>
            <Icon className="mt-0.5 size-4 shrink-0 text-amber-400" />
            {text}
          </li>
        ))}
      </ol>
    </Empty>
  );
}
