"use client";

// Push-to-talk recording → local ASR, and local TTS playback. Both go through /api/voice/*.

async function transcribe(chunks: Float32Array[], rate: number): Promise<string> {
  const res = await fetch("/api/voice/asr", { method: "POST", body: encodeWav(chunks, rate) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Transcription failed");
  return body.text;
}

/**
 * Starts recording. While recording, the growing buffer is re-transcribed about once a second
 * (Parakeet runs in ~0.1 s locally) so the user sees live text. Call the returned `stop()` for the final text.
 */
export async function startRecording(onPartial: (text: string) => void): Promise<() => Promise<string>> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ponytail: ScriptProcessor is deprecated but universal and fine for short push-to-talk clips; AudioWorklet if it ever glitches.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(ctx.destination);

  let stopped = false;
  let inflight = false;
  const timer = setInterval(async () => {
    if (inflight || stopped || chunks.length < 4) return;
    inflight = true;
    try {
      const text = await transcribe([...chunks], ctx.sampleRate);
      if (!stopped) onPartial(text);
    } catch {
      // partials are best-effort; the final transcription reports errors
    }
    inflight = false;
  }, 1000);

  return async () => {
    stopped = true;
    clearInterval(timer);
    source.disconnect();
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    const rate = ctx.sampleRate;
    await ctx.close();
    return chunks.length ? transcribe(chunks, rate) : "";
  };
}

function encodeWav(chunks: Float32Array[], rate: number): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const view = new DataView(new ArrayBuffer(44 + length * 2));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  str(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks)
    for (const sample of chunk) {
      const s = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  return new Blob([view], { type: "audio/wav" });
}

/** Markdown/LaTeX answer → something worth saying out loud. */
export function toSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " (see the equation) ")
    .replace(/\$([^$\n]+)\$/g, (_, m: string) => m.replace(/\\([a-zA-Z]+)/g, "$1").replace(/[{}_^\\]/g, " "))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[#*`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  current?.pause();
  current = null;
}

/** Speaks text with local TTS; resolves when playback ends (or is interrupted). */
export async function speak(text: string): Promise<void> {
  stopSpeaking();
  const res = await fetch("/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Speech failed");
  const audio = new Audio(URL.createObjectURL(await res.blob()));
  current = audio;
  await audio.play();
  await new Promise<void>((resolve) => {
    audio.onended = audio.onpause = () => resolve();
  });
  URL.revokeObjectURL(audio.src);
}
