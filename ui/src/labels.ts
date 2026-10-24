export const ATTENDANCE_LABELS: Record<string, string> = {
  unknown: "Бүртгээгүй",
  present: "Ирсэн",
  absent: "Тасалсан",
  late: "Хоцорсон",
  excused: "Чөлөөтэй",
};

export const PICKUP_LABELS: Record<string, string> = {
  waiting: "Хүлээж байна",
  contacting: "Залгаж байна",
  informed: "Мэдэгдсэн",
  coming: "Ирж байна",
  someone_else: "Өөр хүн авна",
  cannot_come: "Ирж чадахгүй",
  unreachable: "Холбогдсонгүй",
  picked_up: "Авсан",
};

export const CALL_LABELS: Record<string, string> = {
  ringing: "Дуугарч байна",
  answered: "Ярьж байна",
  completed: "Дууссан",
  no_answer: "Аваагүй",
  declined: "Татгалзсан",
  failed: "Алдаа",
  cancelled: "Цуцалсан",
};

export const PURPOSE_LABELS: Record<string, string> = {
  late_pickup: "Хүүхэд авалт",
  absence: "Тасалсан",
  meeting: "Хурал",
};

export type Tone = "success" | "info" | "warning" | "destructive" | "secondary";

export const PICKUP_TONE: Record<string, Tone> = {
  waiting: "secondary",
  contacting: "info",
  informed: "info",
  coming: "success",
  someone_else: "success",
  cannot_come: "destructive",
  unreachable: "destructive",
  picked_up: "secondary",
};

export const callTone = (status: string): Tone =>
  status === "completed" ? "success" : status === "ringing" || status === "answered" ? "info" : "warning";

export const formatTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
