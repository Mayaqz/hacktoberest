import { z } from "zod";
import { env } from "../config.ts";
import { OUTCOMES, type Outcome, type Purpose } from "../models.ts";
import { chat, extractJson } from "./llm.ts";

export type Intent = {
  outcome: Outcome;
  etaMinutes?: number;
  pickupPerson?: string;
  reason?: string;
  summary: string;
  engine: "llm" | "rules";
  /** LLM_MODEL when engine is "llm" (Gemma 4, oyuLLM…). */
  model?: string;
};

export type ReplyContext = {
  purpose: Purpose;
  studentName: string;
  guardianRelation: string;
  /** Local "HH:mm" when the reply was given, for "17:30-д очно" style answers. */
  nowTime: string;
};

const intentSchema = z.object({
  outcome: z.enum(OUTCOMES),
  etaMinutes: z.number().int().min(0).max(600).nullish(),
  pickupPerson: z.string().max(60).nullish(),
  reason: z.string().max(200).nullish(),
  summary: z.string().min(1).max(300),
});

const OUTCOME_HELP: Record<Purpose, string> = {
  late_pickup:
    '"coming" (guardian is on the way; set etaMinutes if a time is given), ' +
    '"someone_else" (another person will pick the child up; set pickupPerson), ' +
    '"cannot_come" (nobody can come), "already_picked" (says the child was already picked up), "unknown".',
  absence:
    '"absent_reason" (child is absent; put the reason in reason), ' +
    '"coming" (child will arrive late; set etaMinutes if given), "unknown".',
  meeting: '"attending" (will come to the meeting), "not_attending" (will not come), "unknown".',
};

const allowedOutcomes: Record<Purpose, readonly Outcome[]> = {
  late_pickup: ["coming", "someone_else", "cannot_come", "already_picked", "unknown"],
  absence: ["absent_reason", "coming", "unknown"],
  meeting: ["attending", "not_attending", "unknown"],
};

const systemPrompt = (ctx: ReplyContext) =>
  [
    "You are the assistant of a Mongolian school teacher. A guardian answered an automated phone call.",
    "Read the guardian's reply (Mongolian, possibly with speech-recognition errors) and return ONLY a JSON object:",
    '{"outcome": string, "etaMinutes": number|null, "pickupPerson": string|null, "reason": string|null, "summary": string}',
    `Allowed outcomes for this call: ${OUTCOME_HELP[ctx.purpose]}`,
    `The current local time is ${ctx.nowTime}. Convert clock times ("17:30-д", "5 цагт") into minutes from now.`,
    "Mongolian numbers: нэг 1, хоёр 2, гурав 3, дөрөв 4, тав 5, арав 10, арван тав 15, хорь 20, гуч 30, хагас цаг 30, нэг цаг 60.",
    "summary: one short sentence in Mongolian Cyrillic telling the teacher what the guardian said, mentioning who and when.",
    "Never invent information that is not in the reply.",
  ].join("\n");

/** A usable summary is Mongolian Cyrillic, short, and not an echo of the prompt. */
const isMongolianSummary = (summary: string) => {
  const cyrillic = (summary.match(/[а-яөүё]/gi) ?? []).length;
  const latin = (summary.match(/[a-z]/gi) ?? []).length;
  return cyrillic >= 4 && latin <= cyrillic / 4 && !/teacher|sentence|summary|json/i.test(summary);
};

/**
 * Interprets a guardian reply with the LLM (Gemma 4 or oyuLLM), cross-checked by keyword rules.
 * The rules only match explicit phrases ("эмээ нь авна", "чадахгүй"), so when
 * they are sure and the model disagrees, the rules win; when they are not
 * sure, the model decides. No model or a bad answer -> rules alone.
 */
export const interpretReply = async (text: string, ctx: ReplyContext): Promise<Intent> => {
  const reply = text.trim();
  const rules = parseReplyRules(reply, ctx);
  if (!reply) return rules;

  try {
    const content = await chat(
      [
        { role: "system", content: systemPrompt(ctx) },
        {
          role: "user",
          content: `Child: ${ctx.studentName}. Guardian: ${ctx.guardianRelation}.\nReply: """${reply}"""`,
        },
      ],
      { json: true, maxTokens: 200 },
    );
    const parsed = intentSchema.parse(extractJson(content));
    if (!allowedOutcomes[ctx.purpose].includes(parsed.outcome)) throw new Error("outcome not allowed for purpose");
    if (rules.outcome !== "unknown" && rules.outcome !== parsed.outcome) return rules;

    // Keep only the fields that belong to the outcome. A number spelled out in
    // the reply ("арван таван минут") is parsed exactly by the rules, so it wins
    // over the model's arithmetic (small models miscount).
    const timed = parsed.outcome === "coming" || parsed.outcome === "someone_else";
    return {
      outcome: parsed.outcome,
      etaMinutes: timed ? (rules.etaMinutes ?? parsed.etaMinutes ?? undefined) : undefined,
      pickupPerson:
        parsed.outcome === "someone_else"
          ? (rules.pickupPerson ?? parsed.pickupPerson?.replace(/\s+нь$/, "") ?? undefined)
          : undefined,
      reason: parsed.outcome === "absent_reason" ? (parsed.reason ?? rules.reason) : undefined,
      summary: isMongolianSummary(parsed.summary) ? parsed.summary : rules.summary,
      engine: "llm",
      model: env.LLM_MODEL,
    };
  } catch {
    return rules;
  }
};

// ---------------------------------------------------------------------------
// Rule-based fallback for Mongolian replies.

const UNITS: Record<string, number> = {
  нэг: 1,
  хоёр: 2,
  гурав: 3,
  гурван: 3,
  дөрөв: 4,
  дөрвөн: 4,
  тав: 5,
  таван: 5,
  зургаа: 6,
  зургаан: 6,
  долоо: 7,
  долоон: 7,
  найм: 8,
  найман: 8,
  ес: 9,
  есөн: 9,
};

const TENS: Record<string, number> = {
  арав: 10,
  арван: 10,
  хорь: 20,
  хорин: 20,
  гуч: 30,
  гучин: 30,
  дөч: 40,
  дөчин: 40,
  тавь: 50,
  тавин: 50,
  жар: 60,
  жаран: 60,
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.,!?;"«»()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Replaces Mongolian number words with digits: "хорин тав минут" -> "25 минут". */
const wordsToDigits = (text: string) => {
  const words = text.split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const tens = TENS[word];
    if (tens !== undefined) {
      const unit = UNITS[words[i + 1] ?? ""];
      if (unit !== undefined) {
        out.push(String(tens + unit));
        i++;
      } else {
        out.push(String(tens));
      }
      continue;
    }
    const unit = UNITS[word];
    out.push(unit !== undefined ? String(unit) : word);
  }
  return out.join(" ");
};

const parseTimeToMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Minutes until a mentioned time, or undefined. */
export const extractEtaMinutes = (raw: string, nowTime: string): number | undefined => {
  const text = wordsToDigits(normalize(raw));
  const now = parseTimeToMinutes(nowTime);

  if (/цаг хагас/.test(text)) return 90;
  if (/хагас цаг/.test(text)) return 30;

  const clock = /(\d{1,2})[:.](\d{2})/.exec(text);
  if (clock) {
    let target = Number(clock[1]) * 60 + Number(clock[2]);
    // "5:30" in the afternoon means 17:30.
    if (target < now && target + 12 * 60 > now) target += 12 * 60;
    if (target >= now) return target - now;
  }

  const minutes = /(\d{1,3}) ?мин/.exec(text);
  if (minutes) return Number(minutes[1]);

  const hoursAfter = /(\d{1,2}) ?цаг(ийн|ын)? (дараа|болоод|орчим)/.exec(text);
  if (hoursAfter) return Number(hoursAfter[1]) * 60;

  const atHour = /(\d{1,2}) ?цагт/.exec(text);
  if (atHour) {
    let target = Number(atHour[1]) * 60;
    if (target < now && target + 12 * 60 > now) target += 12 * 60;
    if (target >= now) return target - now;
  }

  if (/удахгүй|одоохон|ойрхон|хэдхэн минут|дөхөж/.test(text)) return 10;
  return undefined;
};

const PEOPLE = [
  "эмээ",
  "өвөө",
  "аав",
  "ээж",
  "ах",
  "эгч",
  "авга",
  "нагац",
  "хөрш",
  "найз",
  "жолооч",
  "нөхөр",
  "эхнэр",
  "дүү",
];

const findPerson = (text: string, self: string) => {
  for (const person of PEOPLE) {
    // "эмээ нь авна", "эмээ нь 15 минутын дараа ирж авна": the person, up to six words, then the action.
    const re = new RegExp(
      `(^| )${person}\\S*( \\S+){0,6} (авна|авах|очно|ирнэ|очих|ирэх|авчихна|авъя|явуулна)`,
    );
    if (re.test(text) && !self.toLowerCase().includes(person)) return person;
  }
  return undefined;
};

const ABSENCE_REASONS: [RegExp, string][] = [
  [/өвч|өвдс|өвдөө|халуур|ханиад|томуу|гэдэс|толгой/, "Өвчтэй"],
  [/эмнэлэг|эмч/, "Эмнэлэгт үзүүлж байгаа"],
  [/хөдөө|аял|аялал|орон нутаг/, "Хөдөө/аялалд явсан"],
  [/чөлөө|ажилтай|гэрийн ажил|гэр бүлийн/, "Гэр бүлийн шалтгаантай чөлөө"],
];

export const parseReplyRules = (raw: string, ctx: ReplyContext): Intent => {
  const text = normalize(raw);
  const eta = extractEtaMinutes(raw, ctx.nowTime);
  const result = (outcome: Outcome, summary: string, extra: Partial<Intent> = {}): Intent => ({
    outcome,
    summary,
    engine: "rules",
    ...extra,
  });

  if (!text) return result("unknown", "Хариу өгөөгүй");

  if (ctx.purpose === "meeting") {
    if (/(ирэх|очих|оролцох)гүй|чадахгүй|боломжгүй|үгүй|завгүй|^2$/.test(text)) {
      return result("not_attending", `${ctx.guardianRelation} хуралд ирэхгүй`);
    }
    if (/ирнэ|очно|оролцоно|тийм|за |^за$|болно|^1$/.test(text)) {
      return result("attending", `${ctx.guardianRelation} хуралд ирнэ`);
    }
    return result("unknown", `Хариу: "${raw.trim()}"`);
  }

  if (ctx.purpose === "absence") {
    for (const [pattern, reason] of ABSENCE_REASONS) {
      if (pattern.test(text)) return result("absent_reason", `${reason}`, { reason });
    }
    if (/хоцор|замдаа|ирж явна|удахгүй|очно|ирнэ/.test(text)) {
      return result(
        "coming",
        eta !== undefined ? `${eta} минутын дараа ирнэ` : "Хоцорч ирнэ",
        { etaMinutes: eta },
      );
    }
    return result("unknown", `Хариу: "${raw.trim()}"`, { reason: raw.trim() });
  }

  // late_pickup
  if (/авчихсан|авсан|авчихлаа|аваад явсан|аваад гарсан/.test(text) && !/авна/.test(text)) {
    return result("already_picked", "Хүүхдээ авсан гэж хэлсэн");
  }

  const person = findPerson(text, ctx.guardianRelation);
  if (person) {
    return result(
      "someone_else",
      eta !== undefined ? `${capitalize(person)} нь ${eta} минутын дараа авна` : `${capitalize(person)} нь авна`,
      { pickupPerson: person, etaMinutes: eta },
    );
  }

  if (/чадахгүй|амжихгүй|боломжгүй|очихгүй|ирэхгүй|ирж чадахгүй/.test(text)) {
    return result("cannot_come", `${ctx.guardianRelation} ирж чадахгүй`);
  }

  if (/очно|ирнэ|явж байна|гарлаа|гарч байна|замдаа|хүрнэ|ирж байна|очиж байна|одоо|удахгүй|минут|цагт/.test(text)) {
    return result(
      "coming",
      eta !== undefined
        ? `${capitalize(ctx.guardianRelation)} ${eta} минутын дараа ирнэ`
        : `${capitalize(ctx.guardianRelation)} замдаа явж байна`,
      { etaMinutes: eta },
    );
  }

  return result("unknown", `Хариу: "${raw.trim()}"`);
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
