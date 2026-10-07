// Local, open-source voice stack served by mlx-audio (`npm run voice`).
export const VOICE_URL = process.env.SB_VOICE_URL ?? "http://127.0.0.1:8765";
export const ASR_MODEL = process.env.SB_ASR_MODEL ?? "mlx-community/parakeet-tdt-0.6b-v3";
export const TTS_MODEL = process.env.SB_TTS_MODEL ?? "mlx-community/Kokoro-82M-bf16";
export const TTS_VOICE = process.env.SB_TTS_VOICE ?? "af_heart";
