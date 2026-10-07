import { VOICE_URL, TTS_MODEL, TTS_VOICE } from "@/lib/voice-config";

/** `{ text }` in → WAV out, via the local mlx-audio server (Kokoro). */
export async function POST(req: Request) {
  const { text } = await req.json();
  const res = await fetch(`${VOICE_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, response_format: "wav" }),
  }).catch(() => null);
  if (!res?.ok) return Response.json({ error: `Local voice server unavailable at ${VOICE_URL} — run \`npm run voice\`` }, { status: 502 });
  return new Response(res.body, { headers: { "content-type": "audio/wav" } });
}
