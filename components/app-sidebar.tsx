"use client";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Paper } from "@/lib/store";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangleIcon,
  AtomIcon,
  ChevronRightIcon,
  FileTextIcon,
  LinkIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

type Props = { papers: Paper[]; activeId?: string; onOpen: (id: string) => void; onAdded: (p: Paper) => void };

export function AppSidebar({ papers, activeId, onOpen, onAdded }: Props) {
  const roots = papers.filter((p) => !p.parentId);
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="flex-row items-center gap-2 px-4 pt-4">
        <AtomIcon className="size-5 text-amber-400" />
        <span className="font-semibold tracking-tight">Science Buddy</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <AddPaperDialog onAdded={onAdded}>
            <SidebarGroupAction aria-label="Add paper" title="Add paper">
              <PlusIcon />
            </SidebarGroupAction>
          </AddPaperDialog>
          <SidebarGroupContent>
            <SidebarMenu>
              {roots.length === 0 && (
                <p className="px-2 py-6 text-center text-muted-foreground text-xs">
                  No papers yet. Add one with <PlusIcon className="inline size-3" />.
                </p>
              )}
              {roots.map((paper) => {
                const related = papers.filter((p) => p.parentId === paper.id);
                return (
                  <Collapsible className="group/collapsible" defaultOpen key={paper.id}>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        className="pr-14"
                        isActive={paper.id === activeId}
                        onClick={() => onOpen(paper.id)}
                        tooltip={paper.title}
                      >
                        <FileTextIcon />
                        <span className="truncate">{paper.title}</span>
                      </SidebarMenuButton>
                      <SidebarMenuBadge className="right-7">
                        <TranscriptStatus paper={paper} />
                      </SidebarMenuBadge>
                      {related.length > 0 && (
                        <CollapsibleTrigger asChild>
                          <button
                            aria-label="Toggle related papers"
                            className="absolute top-1.5 right-1 flex size-5 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent"
                            type="button"
                          >
                            <ChevronRightIcon className="size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                          </button>
                        </CollapsibleTrigger>
                      )}
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {related.map((r) => (
                            <SidebarMenuSubItem key={r.id}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <SidebarMenuSubButton
                                    className="cursor-pointer"
                                    isActive={r.id === activeId}
                                    onClick={() => onOpen(r.id)}
                                  >
                                    <span className="truncate">{r.title}</span>
                                    <span className="ml-auto">
                                      <TranscriptStatus paper={r} />
                                    </span>
                                  </SidebarMenuSubButton>
                                </TooltipTrigger>
                                {r.reason && (
                                  <TooltipContent className="max-w-xs" side="right">
                                    {r.reason}
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function TranscriptStatus({ paper }: { paper: Paper }) {
  const { done, total, running } = paper.transcript;
  if (done === total) return null;
  if (paper.error && !running)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertTriangleIcon className="size-3.5 text-destructive" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">Transcription failed: {paper.error} — reopen to retry</TooltipContent>
      </Tooltip>
    );
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
      <Spinner className="size-3" />
      {done}/{total}
    </span>
  );
}

// ---------- add paper ----------

const ARXIV_ID = /^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$/i;
const sourceSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1, "Paste an arXiv id or a link")
    .refine((v) => ARXIV_ID.test(v) || URL.canParse(v) && /^https?:/.test(v), {
      message: "Use an arXiv id like 2310.10315, an arXiv link, or a direct PDF URL",
    }),
});
const MAX_PDF_MB = 100;

function AddPaperDialog({ children, onAdded }: { children: React.ReactNode; onAdded: (p: Paper) => void }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const form = useForm<z.infer<typeof sourceSchema>>({
    resolver: zodResolver(sourceSchema),
    defaultValues: { source: "" },
  });

  const added = async (res: Response) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Couldn't add paper");
    toast.success("Paper added", { description: "Transcribing in the background — you can start reading now." });
    form.reset();
    setOpen(false);
    onAdded(body);
  };

  const submitLink = form.handleSubmit(async ({ source }) => {
    try {
      await added(
        await fetch("/api/papers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: source }),
        }),
      );
    } catch (e) {
      form.setError("source", { message: (e as Error).message });
    }
  });

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.type !== "application/pdf") return toast.error("Only PDF files are supported");
    if (file.size > MAX_PDF_MB * 1024 * 1024) return toast.error(`PDF is larger than ${MAX_PDF_MB} MB`);
    setUploading(true);
    try {
      const body = new FormData();
      body.set("file", file);
      await added(await fetch("/api/papers", { method: "POST", body }));
    } catch (e) {
      toast.error("Upload failed", { description: (e as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const busy = form.formState.isSubmitting || uploading;

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a paper</DialogTitle>
          <DialogDescription>
            It&apos;s transcribed once by Claude (math as LaTeX) and cached, so questions stay grounded and cheap.
          </DialogDescription>
        </DialogHeader>
        <form id="add-paper" onSubmit={submitLink}>
          <FieldGroup>
            <Controller
              control={form.control}
              name="source"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="paper-source">arXiv id or link</FieldLabel>
                  <div className="relative">
                    <LinkIcon className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
                    <Input
                      {...field}
                      aria-invalid={fieldState.invalid}
                      autoComplete="off"
                      autoFocus
                      className="pl-8"
                      disabled={busy}
                      id="paper-source"
                      placeholder="2310.10315 or https://arxiv.org/abs/…"
                    />
                  </div>
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>arXiv abstract links are converted to the PDF automatically.</FieldDescription>
                  )}
                </Field>
              )}
            />
            <FieldSeparator>or</FieldSeparator>
            <Field>
              <Button asChild disabled={busy} variant="outline">
                <label className="cursor-pointer">
                  {uploading ? <Spinner /> : <UploadIcon />} Upload a PDF
                  <input
                    accept="application/pdf"
                    className="sr-only"
                    disabled={busy}
                    onChange={(e) => upload(e.target.files?.[0])}
                    type="file"
                  />
                </label>
              </Button>
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button disabled={busy} form="add-paper" type="submit">
            {form.formState.isSubmitting && <Spinner />} Add paper
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
