// Shared helpers for the teacher console and the phone simulator.

export const api = async (path, { method = "GET", body, headers } = {}) => {
  const isRaw = body instanceof Blob;
  const init = { method, headers: isRaw ? headers : { "Content-Type": "application/json", ...headers } };
  if (body !== undefined) init.body = isRaw ? body : JSON.stringify(body);
  const response = await fetch(`/api${path}`, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
};

export const ATTENDANCE_LABELS = {
  unknown: "Бүртгээгүй",
  present: "Ирсэн",
  absent: "Тасалсан",
  late: "Хоцорсон",
  excused: "Чөлөөтэй",
};

export const PICKUP_LABELS = {
  waiting: "Хүлээж байна",
  contacting: "Залгаж байна",
  informed: "Мэдэгдсэн",
  coming: "Ирж байна",
  someone_else: "Өөр хүн авна",
  cannot_come: "Ирж чадахгүй",
  unreachable: "Холбогдсонгүй",
  picked_up: "Авсан",
};

export const PICKUP_TONE = {
  waiting: "muted",
  contacting: "info",
  informed: "info",
  coming: "ok",
  someone_else: "ok",
  cannot_come: "danger",
  unreachable: "danger",
  picked_up: "done",
};

export const CALL_LABELS = {
  ringing: "Дуугарч байна",
  answered: "Ярьж байна",
  completed: "Дууссан",
  no_answer: "Аваагүй",
  declined: "Татгалзсан",
  failed: "Алдаа",
  cancelled: "Цуцалсан",
};

export const PURPOSE_LABELS = {
  late_pickup: "Хүүхэд авалт",
  absence: "Тасалсан",
  meeting: "Хурал",
};

export const SMS_PURPOSE_LABELS = {
  late_pickup: "Хүүхэд авалт",
  absence: "Тасалсан",
  meeting_reminder: "Хурлын сануулга",
  bulk: "Олон хүнд",
  inbound: "Ирсэн",
};

/** Display name of the AI model that produced a result ("gemma4:e4b" -> "Gemma 4"). */
export const modelLabel = (model) => {
  if (!model) return "AI";
  if (/^gemma4/i.test(model)) return "Gemma 4";
  if (/^gemma3/i.test(model)) return "Gemma 3";
  return model;
};

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const html = (strings, ...values) =>
  strings.reduce((out, str, i) => {
    const value = values[i - 1];
    const rendered = value && value.__html !== undefined ? value.__html : Array.isArray(value) ? value.map((v) => (v && v.__html !== undefined ? v.__html : escapeHtml(v))).join("") : escapeHtml(value);
    return out + rendered + str;
  });

/** Marks a string as already-safe HTML for the `html` tag. */
export const raw = (value) => ({ __html: value });

export const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

export const formatDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("mn-MN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    : "";

/** Subscribes to server-sent events and reconnects automatically. */
export const listen = (path, handlers) => {
  const source = new EventSource(`/api${path}`);
  for (const [event, handler] of Object.entries(handlers)) {
    source.addEventListener(event, (e) => handler(JSON.parse(e.data || "{}")));
  }
  return source;
};

let toastTimer;
export const toast = (message, tone = "info") => {
  let box = document.querySelector(".toast");
  if (!box) {
    box = document.createElement("div");
    box.className = "toast";
    box.setAttribute("role", "status");
    document.body.append(box);
  }
  box.textContent = message;
  box.dataset.tone = tone;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 4500);
};
