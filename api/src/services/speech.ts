import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "../config.ts";

// Oyu speech services (Mongolian TTS and STT). The adapters speak plain HTTP
// so the request/response shape can be adjusted to Oyu's API in one place:
//   TTS: POST OYU_TTS_URL  JSON {text, voice}      -> audio bytes, or JSON {audio: base64 | url}
//   STT: POST OYU_STT_URL  multipart file=<audio>  -> JSON {text | transcript | result}
// With no URL configured the phone page uses the browser's Web Speech API.

export const DATA_DIR = fileURLToPath(new URL("../../../data/", import.meta.url));
const AUDIO_DIR = `${DATA_DIR}audio/`;
const RECORDINGS_DIR = `${DATA_DIR}recordings/`;

export const speechStatus = () => ({
  tts: env.OYU_TTS_URL ? "oyu" : "browser",
  stt: env.OYU_STT_URL ? "oyu" : "browser",
});

const authHeaders = (): Record<string, string> =>
  env.OYU_API_KEY ? { [env.OYU_AUTH_HEADER]: `${env.OYU_AUTH_PREFIX}${env.OYU_API_KEY}` } : {};

const extensionFor = (contentType: string) => {
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("webm")) return "webm";
  return "wav";
};

type TtsJson = { audio?: string; audio_url?: string; url?: string; data?: { audio?: string; url?: string } };

/**
 * Synthesizes Mongolian speech and returns a URL under /media, or null when
 * TTS is not configured or fails (the phone then speaks in the browser).
 */
export const synthesize = async (text: string): Promise<string | null> => {
  if (!env.OYU_TTS_URL) return null;

  const key = createHash("sha1").update(`${env.OYU_VOICE ?? ""}|${text}`).digest("hex").slice(0, 20);
  for (const ext of ["mp3", "wav", "ogg", "webm"]) {
    if (existsSync(`${AUDIO_DIR}${key}.${ext}`)) return `/media/audio/${key}.${ext}`;
  }

  try {
    const response = await fetch(env.OYU_TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ text, ...(env.OYU_VOICE ? { voice: env.OYU_VOICE } : {}) }),
    });
    if (!response.ok) throw new Error(`TTS ${response.status}`);

    const contentType = response.headers.get("content-type") ?? "";
    let bytes: Buffer;
    let ext = extensionFor(contentType);

    if (contentType.startsWith("audio/") || contentType === "application/octet-stream") {
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      const json = (await response.json()) as TtsJson;
      const base64 = json.audio ?? json.data?.audio;
      const url = json.audio_url ?? json.url ?? json.data?.url;
      if (base64) {
        bytes = Buffer.from(base64.replace(/^data:audio\/\w+;base64,/, ""), "base64");
      } else if (url) {
        const audio = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        ext = extensionFor(audio.headers.get("content-type") ?? "");
        bytes = Buffer.from(await audio.arrayBuffer());
      } else {
        throw new Error("TTS response has no audio");
      }
    }

    mkdirSync(AUDIO_DIR, { recursive: true });
    writeFileSync(`${AUDIO_DIR}${key}.${ext}`, bytes);
    return `/media/audio/${key}.${ext}`;
  } catch (error) {
    console.warn("[tts] falling back to browser speech:", (error as Error).message);
    return null;
  }
};

/** Stores a guardian's recorded reply and returns its /media URL. */
export const saveRecording = (audio: Buffer, contentType: string) => {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const name = `${randomUUID()}.${extensionFor(contentType)}`;
  writeFileSync(`${RECORDINGS_DIR}${name}`, audio);
  return `/media/recordings/${name}`;
};

type SttJson = { text?: string; transcript?: string; result?: string | { text?: string } };

/** Transcribes Mongolian audio with Oyu STT; null when unavailable. */
export const transcribe = async (audio: Buffer, contentType: string): Promise<string | null> => {
  if (!env.OYU_STT_URL) return null;

  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: contentType }), `reply.${extensionFor(contentType)}`);
    form.append("language", "mn");

    const response = await fetch(env.OYU_STT_URL, {
      method: "POST",
      headers: authHeaders(),
      signal: AbortSignal.timeout(30_000),
      body: form,
    });
    if (!response.ok) throw new Error(`STT ${response.status}`);

    const json = (await response.json()) as SttJson;
    const result = typeof json.result === "string" ? json.result : json.result?.text;
    const text = (json.text ?? json.transcript ?? result ?? "").trim();
    return text || null;
  } catch (error) {
    console.warn("[stt] failed:", (error as Error).message);
    return null;
  }
};
