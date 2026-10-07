import { VOICE_URL, ASR_MODEL } from "@/lib/voice-config";

/** WAV body in → `{ text }` out, via the local mlx-audio server (Parakeet). */
export async function POST(req: Request) {
  const form = new FormData();
  form.set("file", new Blob([await req.arrayBuffer()], { type: "audio/wav" }), "speech.wav");
  form.set("model", ASR_MODEL);
  form.set("response_format", "json");
  const res = await fetch(`${VOICE_URL}/v1/audio/transcriptions`, { method: "POST", body: form }).catch(() => null);
  if (!res?.ok) return Response.json({ error: `Local voice server unavailable at ${VOICE_URL} — run \`npm run voice\`` }, { status: 502 });
  const { text } = await res.json();
  return Response.json({ text: String(text ?? "").trim() });
}
