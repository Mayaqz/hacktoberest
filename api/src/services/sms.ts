import { randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import { env } from "../config.ts";
import { type GuardianDoc, type SmsDoc, SmsMessages } from "../models.ts";
import { logToErxes } from "./erxes.ts";
import { notifyConsole, notifyPhone } from "./events.ts";

// SMS gateway adapter. With SMS_HTTP_URL set, each message is POSTed as JSON
// {to, text, from} with a Bearer token; adapt `deliver` to the operator's API.
// Without it the message is "simulated": stored and shown on the phone page.

export const smsStatus = () => ({ provider: env.SMS_HTTP_URL ? "http" : "simulator", latin: env.SMS_LATIN });

const LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", ө: "u", п: "p", р: "r", с: "s", т: "t", у: "u",
  ү: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "ii", ь: "i",
  э: "e", ю: "yu", я: "ya",
};

/** Mongolian Cyrillic -> the Latin spelling people use in SMS ("Сайн байна уу" -> "Sain baina uu"). */
export const toLatin = (text: string) =>
  [...text]
    .map((char) => {
      const lower = char.toLowerCase();
      const mapped = LATIN[lower];
      if (mapped === undefined) return char;
      return char === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    })
    .join("");

const deliver = async (to: string, text: string) => {
  if (!env.SMS_HTTP_URL) return { status: "simulated" as const, provider: "simulator" };

  const response = await fetch(env.SMS_HTTP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.SMS_HTTP_TOKEN ? { Authorization: `Bearer ${env.SMS_HTTP_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ to, text, ...(env.SMS_SENDER ? { from: env.SMS_SENDER } : {}) }),
  });
  if (!response.ok) throw new Error(`SMS gateway ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return { status: "sent" as const, provider: "http" };
};

type SendOptions = {
  guardian: GuardianDoc;
  text: string;
  purpose: SmsDoc["purpose"];
  batchId?: string;
  meetingId?: Types.ObjectId;
  studentId?: Types.ObjectId;
};

export const sendSms = async ({ guardian, text, purpose, batchId, meetingId, studentId }: SendOptions) => {
  const sentText = env.SMS_LATIN ? toLatin(text) : text;
  let status: SmsDoc["status"] = "failed";
  let provider = env.SMS_HTTP_URL ? "http" : "simulator";
  let error: string | undefined;

  try {
    ({ status, provider } = await deliver(guardian.phone, sentText));
  } catch (e) {
    error = (e as Error).message;
  }

  const sms = await SmsMessages.create({
    guardianId: guardian._id,
    phone: guardian.phone,
    text,
    sentText,
    purpose,
    direction: "outbound",
    status,
    provider,
    error,
    batchId,
    meetingId,
    studentId,
  });

  notifyPhone(guardian._id, "sms", sms.toJSON());
  notifyConsole("sms", { _id: sms._id, status });
  void logToErxes(guardian, `SMS (${purpose}): ${text}${error ? ` — алдаа: ${error}` : ""}`);
  return sms;
};

/** Sends the same text to many guardians; returns the batch id and per-message results. */
export const sendBulkSms = async (guardians: GuardianDoc[], text: string, purpose: SmsDoc["purpose"] = "bulk", extra: Partial<SendOptions> = {}) => {
  const batchId = randomUUID();
  const results = [];
  for (const guardian of guardians) {
    results.push(await sendSms({ ...extra, guardian, text, purpose, batchId }));
  }
  return { batchId, results };
};
