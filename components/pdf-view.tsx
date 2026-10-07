"use client";

import { Suggestion } from "@/components/ai-elements/suggestion";
import { Composer } from "@/components/composer";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { Anchor, Rect, Thread } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BookMarkedIcon, ChartSplineIcon, GraduationCapIcon, LightbulbIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const QUICK_ASKS = [
  { label: "Explain", icon: LightbulbIcon, q: "Explain this passage." },
  { label: "Visualize", icon: ChartSplineIcon, q: "Explain this concept and visualize it." },
  {
    label: "Help me understand",
    icon: GraduationCapIcon,
    q: "Help me understand this. Build the intuition step by step, assuming I'm new to it.",
  },
  {
    label: "Find the source",
    icon: BookMarkedIcon,
    q: "Which earlier paper does this build on? Find it, add it to my library, and explain the connection.",
  },
];

type Selection = Anchor & { range: Range };

type Props = {
  url: string;
  threads: Thread[];
  activeId?: string;
  onOpen: (threadId: string) => void;
  onAsk: (anchor: Anchor, question: string, viaVoice: boolean) => void;
};

export default function PdfView({ url, threads, activeId, onOpen, onAsk }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState<Selection | null>(null);

  // Fit pages to the column; debounced so dragging the panel divider doesn't re-render every frame.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(([e]) => {
      clearTimeout(t);
      t = setTimeout(() => setWidth(Math.min(Math.floor(e.contentRect.width) - 48, 1100)), 120);
    });
    ro.observe(box.current!);
    return () => (clearTimeout(t), ro.disconnect());
  }, []);

  useEffect(() => {
    if (activeId)
      box.current
        ?.querySelector(`[data-thread="${activeId}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId, numPages]);

  const pageEls = () => [...(box.current?.querySelectorAll<HTMLElement>(".react-pdf__Page") ?? [])];

  const hitTest = (cx: number, cy: number) => {
    for (const el of pageEls()) {
      const b = el.getBoundingClientRect();
      if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) continue;
      const x = (cx - b.left) / b.width;
      const y = (cy - b.top) / b.height;
      const page = Number(el.dataset.pageNumber);
      return threads.findLast((t) =>
        t.anchor.rects.some((r) => r.page === page && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
      )?.id;
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const s = window.getSelection();
    const text = s?.toString().replace(/\s+/g, " ").trim();
    if (!s || !text || s.rangeCount === 0) {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) onOpen(hit);
      return;
    }
    const range = s.getRangeAt(0);
    const rects = toRects(range, pageEls());
    if (rects.length) setSel({ text, rects, range: range.cloneRange() });
  };

  const submit = (question: string, viaVoice = false) => {
    if (!sel) return;
    onAsk({ text: sel.text, rects: sel.rects }, question, viaVoice);
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="relative h-full overflow-auto bg-muted/30" onMouseUp={onMouseUp} ref={box}>
      <Document
        className="flex flex-col items-center gap-4 py-6"
        error={<p className="p-8 text-destructive text-sm">Couldn&apos;t load this PDF.</p>}
        file={url}
        loading={<PageSkeleton />}
        onLoadSuccess={(d) => setNumPages(d.numPages)}
      >
        {width > 0 &&
          Array.from({ length: numPages }, (_, i) => (
            <Page
              className="overflow-hidden rounded-sm shadow-lg ring-1 ring-black/5"
              key={i}
              loading={<Skeleton style={{ width, height: width * 1.294 }} />}
              pageNumber={i + 1}
              width={width}
            >
              <Marks activeId={activeId} page={i + 1} pending={sel?.rects} threads={threads} />
            </Page>
          ))}
      </Document>

      <Popover onOpenChange={(open) => !open && setSel(null)} open={!!sel}>
        {sel && <PopoverAnchor virtualRef={{ current: sel.range }} />}
        <PopoverContent
          align="start"
          className="w-[420px] gap-2 p-2"
          collisionPadding={12}
          onMouseUp={(e) => e.stopPropagation()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          side="bottom"
        >
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ASKS.map(({ label, icon: Icon, q }) => (
              <Suggestion className="h-7 gap-1.5 px-3 text-xs" key={label} onClick={() => submit(q)} suggestion={q}>
                <Icon className="size-3.5" /> {label}
              </Suggestion>
            ))}
          </div>
          <Composer autoFocus onSend={submit} placeholder="Ask anything about this passage…" />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Marks({
  page,
  threads,
  activeId,
  pending,
}: {
  page: number;
  threads: Thread[];
  activeId?: string;
  pending?: Rect[];
}) {
  const style = (r: Rect) => ({
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  });
  return (
    <>
      {threads.flatMap((t) =>
        t.anchor.rects
          .filter((r) => r.page === page)
          .map((r, j) => (
            <div
              className={cn("sb-mark", t.id === activeId && "sb-mark-active")}
              data-thread={t.id}
              key={`${t.id}-${j}`}
              style={style(r)}
            />
          )),
      )}
      {pending
        ?.filter((r) => r.page === page)
        .map((r, j) => <div className="sb-mark sb-mark-pending" key={`p-${j}`} style={style(r)} />)}
    </>
  );
}

function PageSkeleton() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 px-6">
      <Skeleton className="aspect-[1/1.294] w-full" />
    </div>
  );
}

/** Selection → page-relative, normalized line boxes (survive zoom/resize). Fragments on one line are merged. */
function toRects(range: Range, pages: HTMLElement[]): Rect[] {
  const out: Rect[] = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const el = pages.find((p) => {
      const b = p.getBoundingClientRect();
      return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
    });
    if (!el) continue;
    const b = el.getBoundingClientRect();
    const rect = {
      page: Number(el.dataset.pageNumber),
      x: (r.left - b.left) / b.width,
      y: (r.top - b.top) / b.height,
      w: r.width / b.width,
      h: r.height / b.height,
    };
    if (rect.h > 0.06) continue; // pdf.js container boxes, not text
    const prev = out.at(-1);
    if (prev && prev.page === rect.page && Math.abs(prev.y + prev.h / 2 - (rect.y + rect.h / 2)) < prev.h / 2) {
      const right = Math.max(prev.x + prev.w, rect.x + rect.w);
      const bottom = Math.max(prev.y + prev.h, rect.y + rect.h);
      prev.x = Math.min(prev.x, rect.x);
      prev.y = Math.min(prev.y, rect.y);
      prev.w = right - prev.x;
      prev.h = bottom - prev.y;
    } else out.push(rect);
  }
  return out;
}
