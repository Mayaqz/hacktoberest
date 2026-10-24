import { CALL_LABELS, PURPOSE_LABELS, api, formatDateTime, html, listen, modelLabel, raw, toast } from "./common.js";

// Guardian-side phone simulator: receives calls and SMS over SSE, plays the
// school's spoken message (Oyu TTS audio, or the browser's voice), records the
// spoken reply (Oyu STT on the server, or browser speech recognition), and
// sends SMS replies.

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
let status = null;
let guardianId = params.get("g");
let source = null;
let currentCall = null;

const QUICK = {
  late_pickup: ["10 минутын дараа очно", "Эмээ нь авна", "Би замдаа явж байна", "Өнөөдөр очиж чадахгүй"],
  absence: ["Өвчтэй байгаа", "Эмнэлэгт үзүүлж байна", "Хоцорч ирнэ", "Хөдөө явсан"],
  meeting: ["Ирнэ", "Ирж чадахгүй"],
};

// ---- Audio -------------------------------------------------------------
let audioCtx = null;
let ringTimer = null;

const unlock = () => {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  } catch {}
  $("#unlock").classList.add("hidden");
};
$("#unlock").addEventListener("click", unlock);

const beep = () => {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  for (const [offset, freq] of [[0, 880], [0.25, 660], [0.5, 880], [0.75, 660]]) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, t + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.22);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.24);
  }
};

const startRinging = () => {
  stopRinging();
  beep();
  navigator.vibrate?.([400, 200, 400]);
  ringTimer = setInterval(() => {
    beep();
    navigator.vibrate?.([400, 200, 400]);
  }, 2000);
};

const stopRinging = () => {
  clearInterval(ringTimer);
  navigator.vibrate?.(0);
};

const mongolianVoice = () => speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("mn"));

/** Plays server TTS audio, or speaks with a Mongolian browser voice if one exists. */
const speak = (text, audioUrl) =>
  new Promise((resolve) => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
      $("#voice-note").textContent = "🔊 Oyu TTS";
      return;
    }
    const voice = mongolianVoice();
    if (!voice || !("speechSynthesis" in window)) {
      $("#voice-note").textContent = "Монгол дуу хоолой суугаагүй тул текстээр харуулж байна (OYU_API_KEY тохируулна уу).";
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    $("#voice-note").textContent = `🔊 Browser: ${voice.name}`;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });

// ---- Guardian selection ------------------------------------------------
const loadGuardians = async () => {
  // Grouped by child, in call order (the first guardian is called first).
  const today = await api("/today");
  const guardians = today.rows.flatMap((row) => row.guardians.map((g) => ({ ...g, child: row.student.firstName })));
  $("#guardian").innerHTML = guardians
    .map((g) => html`<option value="${g._id}">${g.child} · ${g.relation} — ${g.name} (${g.phone})</option>`)
    .join("");
  if (!guardianId || !guardians.some((g) => g._id === guardianId)) guardianId = guardians[0]?._id ?? null;
  $("#guardian").value = guardianId ?? "";
  selectGuardian(guardianId);
};

$("#guardian").addEventListener("change", (e) => selectGuardian(e.target.value));

const selectGuardian = async (id) => {
  guardianId = id;
  if (!id) return;
  history.replaceState(null, "", `?g=${id}`);
  source?.close();
  source = listen(`/phone/${id}/events`, {
    incoming_call: (data) => incoming(data),
    call_ended: (data) => {
      if (currentCall && data.callId === currentCall.callId) endCallScreen(data.status === "cancelled" ? "Дуудлага цуцлагдлаа" : "Дуудлага дууслаа");
      loadInbox();
    },
    sms: (sms) => {
      beep();
      navigator.vibrate?.(200);
      toast(`💬 ${sms.text.slice(0, 80)}…`);
      loadInbox();
    },
  });
  await loadInbox(true);
};

const loadInbox = async (resumeRinging = false) => {
  const inbox = await api(`/phone/${guardianId}/inbox`);
  $("#owner").textContent = inbox.guardian ? `${inbox.guardian.relation} · ${inbox.guardian.phone}` : "";
  const sms = [...inbox.sms].reverse();
  $("#thread").innerHTML = sms.length
    ? sms
        .map(
          (m) => html`<div class="bubble ${m.direction === "inbound" ? "out" : ""}">${m.sentText || m.text}<small>${formatDateTime(m.createdAt)}</small></div>`,
        )
        .join("")
    : `<div class="sub">Мессеж алга</div>`;
  $("#call-log").innerHTML = inbox.calls.length
    ? inbox.calls
        .map(
          (c) => html`<div class="item"><div class="item-head"><b>${PURPOSE_LABELS[c.purpose]}</b><span class="sub">${CALL_LABELS[c.status]} · ${formatDateTime(c.ringingAt)}</span></div>
          ${raw(c.transcript ? html`<div class="sub">Таны хариу: “${c.transcript}”</div>` : "")}</div>`,
        )
        .join("")
    : `<div class="sub">Дуудлага алга</div>`;
  if (resumeRinging && inbox.ringing && !currentCall) {
    incoming({ callId: inbox.ringing._id, purpose: inbox.ringing.purpose, from: status?.school ?? "Сургууль" });
  }
};

// ---- Call flow ---------------------------------------------------------
const incoming = (data) => {
  currentCall = { ...data };
  $("#caller").textContent = data.from || "Сургууль";
  $("#call-state").textContent = `Дуудлага ирж байна… (${PURPOSE_LABELS[data.purpose] ?? ""})`;
  $("#call-screen").classList.remove("hidden");
  $("#call-screen").classList.add("ringing");
  $("#in-call").classList.add("hidden");
  $("#ring-buttons").classList.remove("hidden");
  $("#hangup").classList.add("hidden");
  startRinging();
};

const endCallScreen = (message) => {
  stopRinging();
  speechSynthesis.cancel?.();
  stopRecognition();
  $("#call-state").textContent = message;
  $("#call-screen").classList.remove("ringing");
  setTimeout(() => {
    $("#call-screen").classList.add("hidden");
    $("#call-screen").classList.remove("in-call");
    currentCall = null;
  }, 1800);
};

$("#accept").addEventListener("click", async () => {
  if (!currentCall) return;
  stopRinging();
  try {
    const call = await api(`/calls/${currentCall.callId}/answer`, { method: "POST", body: {} });
    currentCall.purpose = call.purpose;
    $("#call-screen").classList.remove("ringing");
    $("#call-screen").classList.add("in-call");
    $("#call-state").textContent = "Ярьж байна";
    $("#ring-buttons").classList.add("hidden");
    $("#hangup").classList.remove("hidden");
    $("#in-call").classList.remove("hidden");
    $("#caption").textContent = call.script;
    $("#quick").innerHTML = (QUICK[call.purpose] ?? []).map((q) => html`<button type="button" data-quick="${q}">${q}</button>`).join("");
    setupMicHint();
    await speak(call.script, call.audioUrl);
  } catch (error) {
    toast(error.message, "danger");
    endCallScreen("Дуудлага дууссан");
  }
});

$("#decline").addEventListener("click", async () => {
  if (!currentCall) return;
  await api(`/calls/${currentCall.callId}/decline`, { method: "POST", body: {} }).catch(() => undefined);
  endCallScreen("Татгалзсан");
});

$("#hangup").addEventListener("click", () => endCallScreen("Дуудлага дууслаа"));

const sendReply = async ({ text, audio }) => {
  if (!currentCall) return;
  $("#call-state").textContent = "Хариуг боловсруулж байна…";
  try {
    const call = audio
      ? await api(`/calls/${currentCall.callId}/reply`, { method: "POST", body: audio, headers: { "Content-Type": audio.type || "audio/webm" } })
      : await api(`/calls/${currentCall.callId}/reply`, { method: "POST", body: { text } });
    $("#caption").textContent = `Та: “${call.transcript}”\n\n🏫 ${call.confirmation}`;
    $("#call-state").textContent = call.intent?.engine === "llm" ? `${modelLabel(call.intent.model)} ойлголоо ✓` : "Хүлээн авлаа ✓";
    await speak(call.confirmation, call.confirmationAudioUrl);
    endCallScreen("Дуудлага дууслаа");
    loadInbox();
  } catch (error) {
    $("#call-state").textContent = "Ярьж байна";
    toast(error.message, "warn");
  }
};

$("#reply-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#reply-input").value.trim();
  if (!text) return;
  $("#reply-input").value = "";
  sendReply({ text });
});

$("#quick").addEventListener("click", (e) => {
  const q = e.target.closest("[data-quick]")?.dataset.quick;
  if (q) sendReply({ text: q });
});

// ---- Speaking the reply ------------------------------------------------
// Oyu STT configured -> record audio and send it to the server.
// Otherwise -> browser SpeechRecognition (Chrome supports mn-MN).
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recorder = null;
let recognition = null;

/** Oyu Anir accepts WAV/MP3/OGG, but browsers record WebM: re-encode as 16 kHz mono WAV. */
const toWav16k = async (blob) => {
  const decoded = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
  const rate = 16_000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([view], { type: "audio/wav" });
};

const micMode = () => {
  if (status?.speech?.stt === "oyu" && navigator.mediaDevices?.getUserMedia && window.MediaRecorder) return "oyu";
  if (Recognition) return "browser";
  return "none";
};

const setupMicHint = () => {
  const mode = micMode();
  $("#mic").classList.toggle("hidden", mode === "none");
  $("#mic-hint").textContent =
    mode === "oyu"
      ? "🎤 дээр дараад хариугаа хэлээд, дахин дарж илгээнэ үү (Oyu STT)"
      : mode === "browser"
        ? "🎤 дээр дараад монголоор хэлнэ үү (browser яриа танигч)"
        : "Энэ browser яриа таних боломжгүй — доор бичнэ үү";
};

const stopRecognition = () => {
  try {
    recognition?.abort();
  } catch {}
  recognition = null;
  if (recorder?.state === "recording") recorder.stop();
  $("#mic").classList.remove("recording");
};

$("#mic").addEventListener("click", async () => {
  const mode = micMode();
  if (mode === "oyu") {
    if (recorder?.state === "recording") {
      recorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        $("#mic").classList.remove("recording");
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!blob.size) return;
        try {
          sendReply({ audio: await toWav16k(blob) });
        } catch (error) {
          toast(`Бичлэгийг хөрвүүлж чадсангүй: ${error.message}`, "warn");
        }
      };
      recorder.start();
      $("#mic").classList.add("recording");
      setTimeout(() => recorder?.state === "recording" && recorder.stop(), 15_000);
    } catch (error) {
      toast(`Микрофон ажиллахгүй байна: ${error.message}. HTTPS эсвэл localhost хэрэгтэй.`, "warn");
    }
    return;
  }
  if (mode === "browser") {
    if (recognition) {
      stopRecognition();
      return;
    }
    recognition = new Recognition();
    recognition.lang = "mn-MN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    let finalText = "";
    recognition.onresult = (event) => {
      const text = [...event.results].map((r) => r[0].transcript).join(" ");
      $("#reply-input").value = text;
      if (event.results[event.results.length - 1].isFinal) finalText = text;
    };
    recognition.onerror = (event) => toast(`Яриа танигч: ${event.error}`, "warn");
    recognition.onend = () => {
      $("#mic").classList.remove("recording");
      recognition = null;
      const text = (finalText || $("#reply-input").value).trim();
      if (text) {
        $("#reply-input").value = "";
        sendReply({ text });
      }
    };
    recognition.start();
    $("#mic").classList.add("recording");
  }
});

// ---- SMS reply ---------------------------------------------------------
$("#sms-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#sms-input").value.trim();
  if (!text || !guardianId) return;
  $("#sms-input").value = "";
  try {
    const r = await api(`/phone/${guardianId}/sms`, { method: "POST", body: { text } });
    toast(r.kind === "meeting" ? "Хурлын хариу бүртгэгдлээ" : r.intent ? `Багшид: ${r.intent.summary}` : "Илгээлээ");
    loadInbox();
  } catch (error) {
    toast(error.message, "danger");
  }
});

// ---- Boot --------------------------------------------------------------
const tickClock = () => {
  $("#clock").textContent = new Date().toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit", hour12: false });
};
tickClock();
setInterval(tickClock, 15_000);
speechSynthesis?.getVoices?.();

status = await api("/status").catch(() => null);
await loadGuardians().catch((error) => toast(error.message, "danger"));
