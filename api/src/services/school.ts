import type { Types } from "mongoose";
import { env } from "../config.ts";
import {
  type Attendance,
  type CallDoc,
  Calls,
  type ClassroomDoc,
  Classrooms,
  type DayRecordDoc,
  DayRecords,
  type GuardianDoc,
  Guardians,
  type StudentDoc,
  Students,
} from "../models.ts";
import { today } from "../time.ts";
import { cancelFlowsForStudent } from "./calls.ts";
import { notifyConsole } from "./events.ts";
import { chat } from "./llm.ts";

/** Creates the day's attendance/pickup record for every student (idempotent). */
export const ensureDay = async (date = today()) => {
  const students = await Students.find({}, { _id: 1, classroomId: 1 }).lean();
  if (!students.length) return;
  await DayRecords.bulkWrite(
    students.map((s) => ({
      updateOne: {
        filter: { studentId: s._id, date },
        update: { $setOnInsert: { studentId: s._id, classroomId: s.classroomId, date } },
        upsert: true,
      },
    })),
  );
};

export type StudentDay = {
  student: StudentDoc;
  guardians: GuardianDoc[];
  record: DayRecordDoc;
  lastCall: CallDoc | null;
};

export const dayView = async (date = today()) => {
  await ensureDay(date);

  const [classrooms, students, guardians, records, calls] = await Promise.all([
    Classrooms.find().sort({ name: 1 }).lean<ClassroomDoc[]>(),
    Students.find().sort({ firstName: 1 }).lean<StudentDoc[]>(),
    Guardians.find().lean<GuardianDoc[]>(),
    DayRecords.find({ date }).lean<DayRecordDoc[]>(),
    Calls.find({ studentId: { $ne: null }, ringingAt: { $gte: new Date(Date.now() - 36 * 60 * 60 * 1000) } })
      .sort({ ringingAt: -1 })
      .lean<CallDoc[]>(),
  ]);

  const guardianById = new Map(guardians.map((g) => [String(g._id), g]));
  const recordByStudent = new Map(records.map((r) => [String(r.studentId), r]));
  const lastCallByStudent = new Map<string, CallDoc>();
  for (const call of calls) {
    const key = String(call.studentId);
    if (today(call.ringingAt) === date && !lastCallByStudent.has(key)) lastCallByStudent.set(key, call);
  }

  const rows: StudentDay[] = students.flatMap((student) => {
    const record = recordByStudent.get(String(student._id));
    if (!record) return [];
    return [
      {
        student,
        guardians: student.guardianIds.map((id) => guardianById.get(String(id))).filter((g): g is GuardianDoc => Boolean(g)),
        record,
        lastCall: lastCallByStudent.get(String(student._id)) ?? null,
      },
    ];
  });

  return { date, classrooms, rows, counts: countsFor(rows) };
};

export const countsFor = (rows: StudentDay[]) => {
  const counts = {
    total: rows.length,
    present: 0,
    absent: 0,
    excused: 0,
    late: 0,
    unknown: 0,
    pickedUp: 0,
    waiting: 0,
    contacting: 0,
    coming: 0,
    unreachable: 0,
  };
  for (const { record } of rows) {
    const a = record.attendance;
    if (a === "present") counts.present++;
    else if (a === "absent") counts.absent++;
    else if (a === "excused") counts.excused++;
    else if (a === "late") counts.late++;
    else counts.unknown++;

    if (a !== "present" && a !== "late") continue;
    const p = record.pickup?.status ?? "waiting";
    if (p === "picked_up") counts.pickedUp++;
    else if (p === "waiting") counts.waiting++;
    else if (p === "contacting" || p === "informed") counts.contacting++;
    else if (p === "coming" || p === "someone_else") counts.coming++;
    else if (p === "unreachable" || p === "cannot_come") counts.unreachable++;
  }
  return counts;
};

export const markAttendance = async (studentId: string, attendance: Attendance, note?: string, date = today()) => {
  await ensureDay(date);
  const record = await DayRecords.findOneAndUpdate(
    { studentId, date },
    { $set: { attendance, markedAt: new Date(), ...(note !== undefined ? { attendanceNote: note } : {}) } },
    { new: true },
  ).lean<DayRecordDoc>();
  notifyConsole("today", { studentId });
  return record;
};

export const markPickedUp = async (studentId: string, pickedUpBy?: string, date = today()) => {
  await ensureDay(date);
  await cancelFlowsForStudent(studentId, "late_pickup", date);
  const record = await DayRecords.findOneAndUpdate(
    { studentId, date },
    { $set: { "pickup.status": "picked_up", "pickup.pickedUpAt": new Date(), "pickup.pickedUpBy": pickedUpBy ?? "" } },
    { new: true },
  ).lean<DayRecordDoc>();
  notifyConsole("today", { studentId });
  return record;
};

export const resetPickup = async (studentId: string, date = today()) => {
  await cancelFlowsForStudent(studentId, "late_pickup", date);
  await DayRecords.updateOne({ studentId, date }, { $set: { pickup: { status: "waiting" } } });
  notifyConsole("today", { studentId });
};

export const studentsOf = async (ids: (string | Types.ObjectId)[]) =>
  Students.find({ _id: { $in: ids } }).lean<StudentDoc[]>();

/** The LLM (Gemma 4 / oyuLLM) drafts a short, polite SMS from the teacher's note. */
export const draftSms = async (note: string, teacherName = "") => {
  const fallback = `[${env.SCHOOL_NAME}] Эрхэм эцэг эх, ${note.trim().replace(/\.$/, "")}.${teacherName ? ` Багш ${teacherName}` : ""}`;
  try {
    const text = await chat(
      [
        {
          role: "system",
          content:
            "You write SMS messages from a Mongolian school teacher to parents. Write ONE polite, clear SMS in Mongolian Cyrillic, " +
            `at most 280 characters, starting with "[${env.SCHOOL_NAME}]". Keep every fact from the note (dates, times, items) and add nothing new. ` +
            "Return only the SMS text.",
        },
        { role: "user", content: `Teacher${teacherName ? ` (${teacherName})` : ""} note: ${note}` },
      ],
      { maxTokens: 220 },
    );
    return {
      text: text.replace(/^["']|["']$/g, "").trim().slice(0, 320),
      engine: "llm" as const,
      model: env.LLM_MODEL,
    };
  } catch {
    return { text: fallback, engine: "template" as const };
  }
};

/** End-of-day summary for the teacher. */
export const daySummary = async (date = today()) => {
  const view = await dayView(date);
  const c = view.counts;
  const issues = view.rows
    .filter(({ record }) => ["unreachable", "cannot_come", "coming", "someone_else", "informed"].includes(record.pickup?.status ?? "") || record.attendance === "absent" || record.attendance === "excused")
    .map(({ student, record }) => `${student.firstName}: ирц=${record.attendance}${record.attendanceNote ? ` (${record.attendanceNote})` : ""}, авалт=${record.pickup?.status}${record.pickup?.note ? ` (${record.pickup.note})` : ""}`);

  const fallback =
    `${date}: нийт ${c.total} сурагч, ирсэн ${c.present + c.late}, тасалсан ${c.absent + c.excused} (чөлөөтэй ${c.excused}). ` +
    `Авсан ${c.pickedUp}, хүлээгдэж буй ${c.waiting + c.contacting + c.coming}, холбогдож чадаагүй ${c.unreachable}.`;

  try {
    const text = await chat(
      [
        {
          role: "system",
          content:
            "Summarize a Mongolian school class's day for the teacher in 3-4 short Mongolian (Cyrillic) sentences. " +
            "Mention numbers and any child that needs attention. Use only the given facts.",
        },
        { role: "user", content: `${fallback}\nДэлгэрэнгүй:\n${issues.join("\n") || "онцгой зүйлгүй"}` },
      ],
      { maxTokens: 300 },
    );
    return { text, engine: "llm" as const, model: env.LLM_MODEL };
  } catch {
    return { text: fallback, engine: "template" as const };
  }
};
