import type { Types } from "mongoose";
import {
  CallFlows,
  Calls,
  Classrooms,
  type ClassroomDoc,
  DayRecords,
  type GuardianDoc,
  Guardians,
  Meetings,
  SmsMessages,
  type StudentDoc,
  Students,
} from "../models.ts";
import { syncGuardian } from "./erxes.ts";
import { notifyConsole } from "./events.ts";

// The class roster: students and their guardians, entered by the teacher.
// A guardian is one person with one phone number; siblings share the same
// guardian record, so a parent is never called twice for the same reason.

type Id = string | Types.ObjectId;

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

export type GuardianInput = {
  name: string;
  relation: string;
  phone: string;
  canPickup?: boolean;
};

/**
 * Normalizes a phone number: strips spaces/dashes and the +976 prefix.
 * Mongolian numbers are 8 digits; other numbers need a leading "+".
 */
export const normalizePhone = (raw: string) => {
  const compact = raw.trim().replace(/[\s\-().]/g, "");
  const local = compact.replace(/^(\+?976)(?=\d{8}$)/, "");
  if (/^\d{8}$/.test(local)) return local;
  if (/^\+\d{8,15}$/.test(local)) return local;
  throw httpError(400, `Утасны дугаар буруу байна: "${raw.trim()}" (8 оронтой дугаар оруулна уу)`);
};

const cleanGuardian = (input: GuardianInput) => {
  const name = input.name.trim();
  const relation = input.relation.trim() || "асран хамгаалагч";
  if (!name) throw httpError(400, "Асран хамгаалагчийн нэр хоосон байна");
  return { name, relation, phone: normalizePhone(input.phone), canPickup: input.canPickup ?? true };
};

const defaultClassroom = async () => {
  const classroom = await Classrooms.findOne().sort({ createdAt: 1 }).lean<ClassroomDoc>();
  if (classroom) return classroom;
  const created = await Classrooms.create({ name: "1а" });
  return created.toObject() as ClassroomDoc;
};

const syncLater = (guardian: GuardianDoc, childNames: string[]) => {
  void syncGuardian(guardian, childNames).catch((error) => console.warn("[erxes] sync:", (error as Error).message));
};

/** Finds the guardian with this phone (a sibling's parent) or creates one. */
const findOrCreateGuardian = async (input: GuardianInput) => {
  const clean = cleanGuardian(input);
  const existing = await Guardians.findOne({ phone: clean.phone }).lean<GuardianDoc>();
  if (existing) return { guardian: existing, created: false };
  const created = await Guardians.create(clean);
  return { guardian: created.toObject() as GuardianDoc, created: true };
};

export const rosterView = async () => {
  const [classroom, students, guardians] = await Promise.all([
    defaultClassroom(),
    Students.find().sort({ firstName: 1, lastName: 1 }).lean<StudentDoc[]>(),
    Guardians.find().lean<GuardianDoc[]>(),
  ]);
  const byId = new Map(guardians.map((g) => [String(g._id), g]));
  return {
    classroom,
    students: students.map((student) => ({
      ...student,
      guardians: student.guardianIds.map((id) => byId.get(String(id))).filter((g): g is GuardianDoc => Boolean(g)),
    })),
  };
};

export const addStudent = async (input: { firstName: string; lastName?: string; guardians: GuardianInput[] }) => {
  const firstName = input.firstName.trim();
  if (!firstName) throw httpError(400, "Сурагчийн нэр хоосон байна");
  // Validate every guardian before writing anything.
  input.guardians.forEach(cleanGuardian);

  const classroom = await defaultClassroom();
  const guardianIds: Types.ObjectId[] = [];
  for (const g of input.guardians) {
    const { guardian } = await findOrCreateGuardian(g);
    if (!guardianIds.some((id) => String(id) === String(guardian._id))) guardianIds.push(guardian._id);
  }
  const student = await Students.create({
    firstName,
    lastName: input.lastName?.trim() ?? "",
    classroomId: classroom._id,
    guardianIds,
  });
  for (const id of guardianIds) {
    const guardian = await Guardians.findById(id).lean<GuardianDoc>();
    if (guardian) syncLater(guardian, [firstName]);
  }
  notifyConsole("today", {});
  return student.toObject();
};

export const updateStudent = async (studentId: Id, patch: { firstName?: string; lastName?: string }) => {
  const update: Record<string, string> = {};
  if (patch.firstName !== undefined) {
    if (!patch.firstName.trim()) throw httpError(400, "Сурагчийн нэр хоосон байна");
    update.firstName = patch.firstName.trim();
  }
  if (patch.lastName !== undefined) update.lastName = patch.lastName.trim();
  const student = await Students.findByIdAndUpdate(studentId, update, { new: true }).lean();
  if (!student) throw httpError(404, "Сурагч олдсонгүй");
  notifyConsole("today", {});
  return student;
};

/** Deletes guardians that no longer belong to any student. */
const removeOrphans = async (guardianIds: Id[]) => {
  for (const id of guardianIds) {
    if (!(await Students.exists({ guardianIds: id }))) await Guardians.deleteOne({ _id: id });
  }
};

export const deleteStudent = async (studentId: Id) => {
  const student = await Students.findById(studentId).lean<StudentDoc>();
  if (!student) throw httpError(404, "Сурагч олдсонгүй");
  await Students.deleteOne({ _id: studentId });
  await DayRecords.deleteMany({ studentId });
  await CallFlows.updateMany({ studentId, status: "active" }, { status: "cancelled" });
  await Calls.updateMany({ studentId, status: "ringing" }, { status: "cancelled", endedAt: new Date() });
  await removeOrphans(student.guardianIds);
  notifyConsole("today", {});
};

export const addGuardianToStudent = async (studentId: Id, input: GuardianInput) => {
  const student = await Students.findById(studentId).lean<StudentDoc>();
  if (!student) throw httpError(404, "Сурагч олдсонгүй");
  if (student.guardianIds.length >= 6) throw httpError(400, "Нэг сурагчид 6 хүртэл асран хамгаалагч бүртгэнэ");

  const { guardian } = await findOrCreateGuardian(input);
  if (student.guardianIds.some((id) => String(id) === String(guardian._id))) {
    throw httpError(409, `${guardian.phone} дугаартай хүн аль хэдийн бүртгэгдсэн байна`);
  }
  await Students.updateOne({ _id: studentId }, { $push: { guardianIds: guardian._id } });
  syncLater(guardian, [student.firstName]);
  notifyConsole("today", {});
  return guardian;
};

export const updateGuardian = async (guardianId: Id, patch: Partial<GuardianInput>) => {
  const update: Partial<GuardianInput> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw httpError(400, "Нэр хоосон байна");
    update.name = patch.name.trim();
  }
  if (patch.relation !== undefined) update.relation = patch.relation.trim() || "асран хамгаалагч";
  if (patch.canPickup !== undefined) update.canPickup = patch.canPickup;
  if (patch.phone !== undefined) {
    const phone = normalizePhone(patch.phone);
    const taken = await Guardians.findOne({ phone, _id: { $ne: guardianId } }).lean<GuardianDoc>();
    if (taken) throw httpError(409, `${phone} дугаар ${taken.name}-д бүртгэлтэй байна`);
    update.phone = phone;
  }
  const guardian = await Guardians.findByIdAndUpdate(guardianId, update, { new: true }).lean<GuardianDoc>();
  if (!guardian) throw httpError(404, "Асран хамгаалагч олдсонгүй");
  if (update.phone) {
    // A new number is a new erxes contact lookup.
    await Guardians.updateOne({ _id: guardianId }, { $unset: { erxesCustomerId: 1 } });
    const children = await Students.find({ guardianIds: guardianId }).lean<StudentDoc[]>();
    syncLater(guardian, children.map((c) => c.firstName));
  }
  notifyConsole("today", {});
  return guardian;
};

export const removeGuardianFromStudent = async (studentId: Id, guardianId: Id) => {
  const result = await Students.updateOne({ _id: studentId }, { $pull: { guardianIds: guardianId } });
  if (!result.matchedCount) throw httpError(404, "Сурагч олдсонгүй");
  await removeOrphans([guardianId]);
  notifyConsole("today", {});
};

/** Moves a guardian earlier or later in the child's call order. */
export const moveGuardian = async (studentId: Id, guardianId: Id, direction: "up" | "down") => {
  const student = await Students.findById(studentId).lean<StudentDoc>();
  if (!student) throw httpError(404, "Сурагч олдсонгүй");
  const ids = student.guardianIds.map(String);
  const from = ids.indexOf(String(guardianId));
  if (from === -1) throw httpError(404, "Асран хамгаалагч олдсонгүй");
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return student.guardianIds;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  await Students.updateOne({ _id: studentId }, { guardianIds: ids });
  notifyConsole("today", {});
  return ids;
};

export type ImportResult = {
  studentsCreated: number;
  guardiansAdded: number;
  errors: { line: number; text: string; error: string }[];
};

/**
 * Imports pasted rows (Excel/Sheets copy = tab separated, or comma/semicolon):
 *   Сурагчийн нэр | Овог | Хэн (ээж, аав…) | Асран хамгаалагчийн нэр | Утас
 * Rows with the same student name go to the same student; existing students
 * get the new guardians. A header row is skipped automatically.
 */
export const importRoster = async (text: string): Promise<ImportResult> => {
  const result: ImportResult = { studentsCreated: 0, guardiansAdded: 0, errors: [] };
  const classroom = await defaultClassroom();
  const lines = text.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const cells = line.split(line.includes("\t") ? "\t" : /[;,]/).map((c) => c.trim());
    const [firstName = "", lastName = "", relation = "", name = "", phone = ""] = cells;

    if (!/\d/.test(phone) && index === lines.findIndex((l) => l.trim())) continue; // header row
    try {
      if (cells.length < 5) throw httpError(400, "5 багана хэрэгтэй: нэр, овог, хэн, асран хамгаалагчийн нэр, утас");
      if (!firstName) throw httpError(400, "Сурагчийн нэр хоосон");
      const guardianInput = { name, relation, phone };
      cleanGuardian(guardianInput);

      let student = await Students.findOne({ classroomId: classroom._id, firstName, lastName }).lean<StudentDoc>();
      if (!student) {
        student = (await Students.create({ firstName, lastName, classroomId: classroom._id, guardianIds: [] })).toObject() as StudentDoc;
        result.studentsCreated++;
      }
      const { guardian } = await findOrCreateGuardian(guardianInput);
      if (!student.guardianIds.some((id) => String(id) === String(guardian._id))) {
        await Students.updateOne({ _id: student._id }, { $push: { guardianIds: guardian._id } });
        syncLater(guardian, [firstName]);
        result.guardiansAdded++;
      }
    } catch (error) {
      result.errors.push({ line: index + 1, text: line.trim().slice(0, 120), error: (error as Error).message });
    }
  }
  notifyConsole("today", {});
  return result;
};

/** Removes every student, guardian and their history; keeps the class settings. */
export const clearRoster = async () => {
  await defaultClassroom();
  await Promise.all([
    Students.deleteMany({}),
    Guardians.deleteMany({}),
    DayRecords.deleteMany({}),
    CallFlows.deleteMany({}),
    Calls.deleteMany({}),
    SmsMessages.deleteMany({}),
    Meetings.deleteMany({}),
  ]);
  notifyConsole("today", {});
};
