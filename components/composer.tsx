"use client";

import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Spinner } from "@/components/ui/spinner";
import { startRecording } from "@/lib/voice";
import type { ChatStatus } from "ai";
import { MicIcon, SquareIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type Props = {
  onSend: (text: string, viaVoice: boolean) => void;
  status?: ChatStatus;
  onStop?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(" ");

/** Text box + push-to-talk mic. Voice text streams into the box live, then sends on stop. */
export function Composer({ onSend, status, onStop, placeholder, autoFocus, className }: Props) {
  const [text, setText] = useState("");
  const [stopRec, setStopRec] = useState<null | (() => Promise<string>)>(null);
  const [finishing, setFinishing] = useState(false);
  const typedBefore = useRef("");
  const busy = status === "submitted" || status === "streaming";

  const toggleMic = async () => {
    if (finishing) return;
    if (stopRec) {
      setStopRec(null);
      setFinishing(true);
      try {
        const final = join(typedBefore.current, await stopRec());
        setText("");
        if (final) onSend(final, true);
        else toast("Didn't catch that — try again");
      } catch (e) {
        toast.error("Voice transcription failed", { description: (e as Error).message });
      } finally {
        setFinishing(false);
      }
      return;
    }
    try {
      typedBefore.current = text;
      const stop = await startRecording((partial) => setText(join(typedBefore.current, partial)));
      setStopRec(() => stop);
    } catch (e) {
      toast.error("Microphone unavailable", { description: (e as Error).message });
    }
  };

  return (
    <PromptInput
      className={className}
      onSubmit={({ text: value }) => {
        if (stopRec) return void toggleMic(); // Enter while recording = stop & send
        if (!value.trim()) return;
        onSend(value.trim(), false);
        setText("");
      }}
    >
      <PromptInputBody>
        <PromptInputTextarea
          aria-label={placeholder ?? "Ask a follow-up…"}
          autoFocus={autoFocus}
          className="min-h-12"
          onChange={(e) => setText(e.target.value)}
          placeholder={stopRec ? "Listening…" : (placeholder ?? "Ask a follow-up…")}
          value={text}
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputButton
            aria-label={stopRec ? "Stop recording and send" : "Ask by voice"}
            className={stopRec ? "text-red-500" : undefined}
            onClick={toggleMic}
            tooltip={stopRec ? "Stop & send (Enter)" : "Ask by voice"}
          >
            {finishing ? <Spinner /> : stopRec ? <SquareIcon className="fill-current" /> : <MicIcon />}
          </PromptInputButton>
          {stopRec && (
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <span className="size-2 animate-pulse rounded-full bg-red-500" /> Listening
            </span>
          )}
        </PromptInputTools>
        <PromptInputSubmit disabled={!busy && !text.trim() && !stopRec} onStop={onStop} status={status} />
      </PromptInputFooter>
    </PromptInput>
  );
}
