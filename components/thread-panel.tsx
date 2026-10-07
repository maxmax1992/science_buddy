"use client";

import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Composer } from "@/components/composer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import type { Thread } from "@/lib/store";
import { speak, stopSpeaking, toSpeech } from "@/lib/voice";
import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type DynamicToolUIPart, type UIMessage } from "ai";
import {
  ArrowLeftIcon,
  BookPlusIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  FileTextIcon,
  FolderSearchIcon,
  GlobeIcon,
  HighlighterIcon,
  LinkIcon,
  MaximizeIcon,
  MessageSquareTextIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
  SquareIcon,
  Volume2Icon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

// ---------- chat registry: one Chat per thread, kept alive across panel switches so streams keep running ----------

const chats = new Map<string, Chat<UIMessage>>();
const voiceThreads = new Set<string>(); // questions asked by voice get their answer read aloud

export function getChat(paperId: string, thread: Thread) {
  let chat = chats.get(thread.id);
  if (!chat) {
    chat = new Chat<UIMessage>({
      id: thread.id,
      messages: thread.messages,
      transport: new DefaultChatTransport({
        api: "/api/chat",
        body: { paperId, anchor: thread.anchor, createdAt: thread.createdAt },
      }),
      onFinish: ({ message, isError, isAbort }) => {
        if (voiceThreads.delete(thread.id) && !isError && !isAbort) void speakMessage(message);
      },
      onError: (e) => toast.error("Claude request failed", { description: e.message }),
    });
    chats.set(thread.id, chat);
  }
  return chat;
}

export function ask(paperId: string, thread: Thread, text: string, viaVoice: boolean) {
  if (viaVoice) voiceThreads.add(thread.id);
  void getChat(paperId, thread).sendMessage({ text });
}

const textOf = (m: UIMessage) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");

// ---------- read-aloud state (one voice at a time) ----------

let speakingId: string | null = null;
const listeners = new Set<() => void>();
const setSpeaking = (id: string | null) => {
  speakingId = id;
  listeners.forEach((l) => l());
};
const useSpeakingId = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => speakingId,
    () => null,
  );

async function speakMessage(m: UIMessage) {
  setSpeaking(m.id);
  try {
    await speak(toSpeech(textOf(m)));
  } catch (e) {
    toast.error("Couldn't read the answer aloud", { description: (e as Error).message });
  } finally {
    if (speakingId === m.id) setSpeaking(null);
  }
}

// ---------- thread view ----------

const pagesOf = (t: Thread) => [...new Set(t.anchor.rects.map((r) => r.page))].join(", ");

export function ThreadPanel({
  paperId,
  thread,
  onBack,
  onLocate,
}: {
  paperId: string;
  thread: Thread;
  onBack: () => void;
  onLocate: () => void;
}) {
  const { messages, status, stop, error, regenerate } = useChat({ chat: getChat(paperId, thread), throttle: 40 });
  const busy = status === "submitted" || status === "streaming";

  return (
    <section aria-label="Conversation" className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-2 border-b p-3">
        <Button aria-label="All questions" onClick={onBack} size="icon-sm" variant="ghost">
          <ArrowLeftIcon />
        </Button>
        <button className="group min-w-0 flex-1 text-left" onClick={onLocate} type="button">
          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground text-xs">
            <HighlighterIcon className="size-3.5 text-amber-400" />
            Page {pagesOf(thread)}
            <span className="opacity-0 transition-opacity group-hover:opacity-100">· show in paper</span>
          </div>
          <p className="line-clamp-3 border-amber-400/60 border-l-2 pl-2 text-muted-foreground text-sm italic">
            {thread.anchor.text}
          </p>
        </button>
      </header>

      <Conversation className="min-h-0">
        <ConversationContent className="gap-6">
          {messages.map((m, i) => (
            <ChatMessage key={m.id} message={m} streaming={busy && i === messages.length - 1} />
          ))}
          {status === "submitted" && <Shimmer className="text-sm">Reading the paper…</Shimmer>}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-2">
                <span className="line-clamp-4">{error.message}</span>
                <Button onClick={() => regenerate()} size="sm" variant="outline">
                  <RotateCcwIcon /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-3">
        <Composer onSend={(text, voice) => ask(paperId, thread, text, voice)} onStop={stop} status={status} />
      </div>
    </section>
  );
}

function ChatMessage({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  if (message.role === "user")
    return (
      <Message from="user">
        <MessageContent>{textOf(message)}</MessageContent>
      </Message>
    );

  return (
    <Message from="assistant">
      <MessageContent className="w-full">
        {groupParts(message.parts).map((block, i) => {
          if (Array.isArray(block)) return <ToolGroup key={i} parts={block} />;
          if (block.type === "text") return <AnswerText key={i} streaming={streaming} text={block.text} />;
          if (block.type === "reasoning")
            return (
              <Reasoning isStreaming={streaming && block.state === "streaming"} key={i}>
                <ReasoningTrigger />
                <ReasoningContent>{block.text}</ReasoningContent>
              </Reasoning>
            );
          return null;
        })}
      </MessageContent>
      {!streaming && textOf(message) && <AnswerActions message={message} />}
    </Message>
  );
}

function AnswerActions({ message }: { message: UIMessage }) {
  const speaking = useSpeakingId() === message.id;
  const [copied, setCopied] = useState(false);
  return (
    <MessageActions>
      <MessageAction
        onClick={async () => {
          await navigator.clipboard.writeText(textOf(message));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        tooltip="Copy"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </MessageAction>
      <MessageAction
        onClick={() => (speaking ? (stopSpeaking(), setSpeaking(null)) : void speakMessage(message))}
        tooltip={speaking ? "Stop reading" : "Read aloud"}
      >
        {speaking ? <SquareIcon className="fill-current" /> : <Volume2Icon />}
      </MessageAction>
    </MessageActions>
  );
}

// ```html blocks become live sandboxed visualizations; everything else is streamed markdown (math, mermaid, code).
const HTML_BLOCK = /```html[^\n]*\n([\s\S]*?)```/g;

function AnswerText({ text, streaming }: { text: string; streaming: boolean }) {
  const segments: ({ md: string } | { html: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(HTML_BLOCK)) {
    segments.push({ md: text.slice(last, m.index) }, { html: m[1] });
    last = m.index + m[0].length;
  }
  let tail = text.slice(last);
  const open = tail.indexOf("```html");
  if (open >= 0) tail = tail.slice(0, open); // a visualization is still being written
  segments.push({ md: tail });

  return (
    <>
      {segments.map((s, i) =>
        "html" in s ? (
          <Visualization html={s.html} key={i} />
        ) : (
          s.md.trim() && (
            <MessageResponse
              className="[&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm"
              isAnimating={streaming}
              key={i}
            >
              {s.md}
            </MessageResponse>
          )
        ),
      )}
      {open >= 0 && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed">
          <Shimmer className="text-sm">Drawing visualization…</Shimmer>
        </div>
      )}
    </>
  );
}

function Visualization({ html }: { html: string }) {
  const [showCode, setShowCode] = useState(false);
  const frame = (className: string) => (
    // Model-written code: sandboxed without same-origin, so it can't touch the app or its APIs.
    <iframe className={className} sandbox="allow-scripts" srcDoc={html} title="Visualization" />
  );
  return (
    <div className="not-prose overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1 text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">
          <SparklesIcon className="size-3.5" /> Visualization
        </span>
        <div className="flex items-center gap-0.5">
          <Button aria-label="Toggle source" onClick={() => setShowCode((c) => !c)} size="icon-xs" variant="ghost">
            <CodeIcon />
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button aria-label="Expand" size="icon-xs" variant="ghost">
                <MaximizeIcon />
              </Button>
            </DialogTrigger>
            <DialogContent className="h-[85vh] max-w-[90vw] p-0 sm:max-w-[90vw]">
              <DialogTitle className="sr-only">Visualization</DialogTitle>
              {frame("size-full rounded-lg bg-white")}
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {showCode ? (
        <pre className="max-h-96 overflow-auto p-3 text-xs">{html}</pre>
      ) : (
        frame("h-[440px] w-full bg-white")
      )}
    </div>
  );
}

// ---------- tool activity: one quiet summary line per run of tool calls, details on demand ----------

type Part = UIMessage["parts"][number];

/** Consecutive tool calls collapse into one group; empty text/reasoning and step markers don't break a run. */
function groupParts(parts: Part[]): (Part | DynamicToolUIPart[])[] {
  const out: (Part | DynamicToolUIPart[])[] = [];
  for (const part of parts) {
    if (part.type === "dynamic-tool") {
      const last = out.at(-1);
      if (Array.isArray(last)) last.push(part);
      else out.push([part]);
    } else if ((part.type === "text" || part.type === "reasoning") && part.text.trim()) out.push(part);
  }
  return out;
}

const fileLabel = (p: unknown) => String(p ?? "").split("/").slice(-2).join("/");
const host = (u: unknown) => String(u ?? "").replace(/^https?:\/\//, "").slice(0, 60);
const TOOLS: Record<string, { icon: typeof WrenchIcon; title: (i: Record<string, unknown>) => string }> = {
  Read: { icon: FileTextIcon, title: (i) => `Read ${fileLabel(i.file_path)}` },
  Grep: { icon: SearchIcon, title: (i) => `Searched for “${i.pattern}”` },
  Glob: { icon: FolderSearchIcon, title: (i) => `Listed ${i.pattern}` },
  WebSearch: { icon: GlobeIcon, title: (i) => `Searched the web for “${i.query}”` },
  WebFetch: { icon: LinkIcon, title: (i) => `Fetched ${host(i.url)}` },
  ToolSearch: { icon: WrenchIcon, title: () => "Loaded tools" },
  mcp__sb__add_related_paper: { icon: BookPlusIcon, title: (i) => `Added related paper “${i.title}”` },
};
const toolInfo = (p: DynamicToolUIPart) => {
  const t = TOOLS[p.toolName];
  return {
    icon: t?.icon ?? WrenchIcon,
    title: t?.title((p.input ?? {}) as Record<string, unknown>) ?? p.toolName.replace(/^mcp__\w+?__/, ""),
  };
};
const isRunning = (p: DynamicToolUIPart) => p.state === "input-streaming" || p.state === "input-available";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function summarize(parts: DynamicToolUIPart[]) {
  const count = (...names: string[]) => parts.filter((p) => names.some((n) => p.toolName.endsWith(n))).length;
  const reads = count("Read");
  const searches = count("Grep", "Glob");
  const web = count("WebSearch");
  const fetches = count("WebFetch");
  const papers = count("add_related_paper");
  const other = parts.length - reads - searches - web - fetches - papers;
  const text = [
    reads && `read ${plural(reads, "file")}`,
    searches && `searched the paper${searches > 1 ? ` ${searches} times` : ""}`,
    web && "browsed the web",
    fetches && `fetched ${plural(fetches, "page")}`,
    papers && `added ${plural(papers, "related paper")}`,
    other && `used ${plural(other, "tool")}`,
  ]
    .filter(Boolean)
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ToolGroup({ parts }: { parts: DynamicToolUIPart[] }) {
  const running = parts.find(isRunning);
  const failed = parts.filter((p) => p.state === "output-error").length;
  return (
    <Collapsible className="group/tools not-prose">
      <CollapsibleTrigger className="flex max-w-full items-center gap-1.5 text-left text-muted-foreground text-sm transition-colors hover:text-foreground">
        {running ? (
          <>
            <Spinner className="size-3.5 shrink-0" />
            <Shimmer as="span" className="truncate">{`${toolInfo(running).title}…`}</Shimmer>
          </>
        ) : (
          <span>
            {summarize(parts)}
            {failed > 0 && <span className="text-destructive/80"> · {failed} failed</span>}
          </span>
        )}
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/tools:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 ml-1.5 flex flex-col border-l pl-2">
        {parts.map((p) => (
          <ToolRow key={p.toolCallId} part={p} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolRow({ part }: { part: DynamicToolUIPart }) {
  const { icon: Icon, title } = toolInfo(part);
  const output =
    typeof part.output === "string" ? (
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs">{part.output}</pre>
    ) : (
      part.output
    );
  return (
    <Collapsible className="group/row">
      <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{title}</span>
        {isRunning(part) && <Spinner className="size-3 shrink-0" />}
        {part.state === "output-error" && <XCircleIcon className="size-3.5 shrink-0 text-destructive" />}
        <ChevronDownIcon className="ml-auto size-3.5 shrink-0 transition-transform group-data-[state=open]/row:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 py-2 pl-6">
        <ToolInput input={part.input} />
        <ToolOutput errorText={part.errorText} output={output as DynamicToolUIPart["output"]} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------- list of questions on this paper ----------

export function ThreadList({ threads, onOpen }: { threads: Thread[]; onOpen: (id: string) => void }) {
  if (!threads.length)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HighlighterIcon />
          </EmptyMedia>
          <EmptyTitle>Highlight to ask</EmptyTitle>
          <EmptyDescription>
            Select any passage in the paper, then type or speak a question. Answers stay pinned to the text as
            underlines.
          </EmptyDescription>
        </EmptyHeader>
        <p className="text-muted-foreground text-xs">
          <Kbd>Esc</Kbd> closes the ask box · <Kbd>Enter</Kbd> sends
        </p>
      </Empty>
    );

  return (
    <ScrollArea className="h-full">
      <nav aria-label="Questions on this paper" className="flex flex-col gap-1 p-2">
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Questions on this paper</div>
        {[...threads].reverse().map((t) => {
          const chat = chats.get(t.id);
          const msgs = chat?.messages ?? t.messages;
          const first = msgs.find((m) => m.role === "user");
          const running = chat?.status === "submitted" || chat?.status === "streaming";
          return (
            <button
              className="flex flex-col gap-1 rounded-lg p-2.5 text-left transition-colors hover:bg-accent"
              key={t.id}
              onClick={() => onOpen(t.id)}
              type="button"
            >
              <span className="flex items-start gap-2 text-sm">
                {running ? (
                  <Spinner className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <MessageSquareTextIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="line-clamp-2">{first ? textOf(first) : "…"}</span>
              </span>
              <span className="line-clamp-1 pl-5.5 text-muted-foreground text-xs italic">“{t.anchor.text}”</span>
              <span className="pl-5.5 text-[11px] text-muted-foreground">
                p. {pagesOf(t)} · {Math.ceil(msgs.length / 2)} {msgs.length > 2 ? "exchanges" : "exchange"}
              </span>
            </button>
          );
        })}
      </nav>
    </ScrollArea>
  );
}
