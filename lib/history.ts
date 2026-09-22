import { Redis } from "@upstash/redis";
import { lookupBook, mapWithConcurrency } from "./snlib.js";

export const CHILDREN = ["soohyun", "yujin"] as const;
export const STATUSES = ["read", "recommended", "favorite", "skip"] as const;
export const REACTIONS = ["love", "good", "neutral", "not_interested"] as const;

export type ChildId = (typeof CHILDREN)[number];
export type HistoryStatus = (typeof STATUSES)[number];
export type Reaction = (typeof REACTIONS)[number];

export type HistoryBook = {
  child: ChildId;
  title: string;
  author: string | null;
  isbn: string | null;
  status: HistoryStatus;
  reaction: Reaction | null;
  dateAdded: string;
  dateRead: string | null;
  excludeUntil: string | null;
  notes: string | null;
};

export type HistoryInput = {
  child: ChildId;
  title: string;
  author?: string | null;
  isbn?: string | null;
  status: HistoryStatus;
  reaction?: Reaction | null;
  dateAdded?: string;
  dateRead?: string | null;
  excludeUntil?: string | null;
  notes?: string | null;
};

function redis() {
  const url = process.env.HISTORY_KV_REST_API_URL;
  const token = process.env.HISTORY_KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("HISTORY_STORAGE_NOT_CONFIGURED");
  return new Redis({ url, token });
}

const keyForChild = (child: ChildId) => `snlib:history:${child}`;

export function normalizeTitle(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\[?(점자|큰글자|전자책|e-?book|dvd|오디오북|데이지)\]?/gi, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function normalizeAuthor(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function recordKey(book: Pick<HistoryBook, "isbn" | "title" | "author">) {
  if (book.isbn) return `isbn:${book.isbn.replace(/[^0-9X]/gi, "").toUpperCase()}`;
  return `title:${normalizeTitle(book.title)}:${normalizeAuthor(book.author)}`;
}

export function todaySeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function validateInput(value: unknown): HistoryInput {
  if (!value || typeof value !== "object") throw new Error("INVALID_BOOK");
  const input = value as Record<string, unknown>;
  if (!CHILDREN.includes(input.child as ChildId)) throw new Error("INVALID_CHILD");
  if (typeof input.title !== "string" || !input.title.trim()) throw new Error("TITLE_REQUIRED");
  if (!STATUSES.includes(input.status as HistoryStatus)) throw new Error("INVALID_STATUS");
  if (input.reaction != null && !REACTIONS.includes(input.reaction as Reaction)) throw new Error("INVALID_REACTION");
  for (const field of ["dateAdded", "dateRead", "excludeUntil"] as const) {
    if (input[field] != null && !isDate(input[field])) throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  for (const field of ["author", "isbn", "notes"] as const) {
    if (input[field] != null && typeof input[field] !== "string") throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return {
    child: input.child as ChildId,
    title: input.title.trim(),
    author: input.author as string | null | undefined,
    isbn: input.isbn as string | null | undefined,
    status: input.status as HistoryStatus,
    reaction: input.reaction as Reaction | null | undefined,
    dateAdded: input.dateAdded as string | undefined,
    dateRead: input.dateRead as string | null | undefined,
    excludeUntil: input.excludeUntil as string | null | undefined,
    notes: input.notes as string | null | undefined,
  };
}

function parseStored(value: unknown): HistoryBook | null {
  if (!value) return null;
  if (typeof value === "object") return value as HistoryBook;
  if (typeof value !== "string") return null;
  try { return JSON.parse(value) as HistoryBook; } catch { return null; }
}

export async function listHistory(child: ChildId, status?: HistoryStatus) {
  const raw = await redis().hgetall<Record<string, unknown>>(keyForChild(child));
  const books = Object.values(raw ?? {})
    .map(parseStored)
    .filter((book): book is HistoryBook => Boolean(book))
    .filter((book) => !status || book.status === status)
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || a.title.localeCompare(b.title, "ko"));
  return books;
}

async function enrich(input: HistoryInput) {
  if (input.isbn && input.author) return input;
  const lookup = await lookupBook(input.title);
  if (!lookup.found) return input;
  return {
    ...input,
    title: lookup.matchedTitle || input.title,
    author: input.author ?? lookup.author,
    isbn: input.isbn ?? lookup.isbn,
  };
}

export async function upsertHistory(rawInput: HistoryInput) {
  const input = await enrich(rawInput);
  const existingBooks = await listHistory(input.child);
  const normalized = normalizeTitle(input.title);
  const existing = existingBooks.find((book) =>
    (input.isbn && book.isbn === input.isbn) ||
    normalizeTitle(book.title) === normalized,
  );
  const today = todaySeoul();
  const book: HistoryBook = {
    child: input.child,
    title: input.title,
    author: input.author ?? existing?.author ?? null,
    isbn: input.isbn ?? existing?.isbn ?? null,
    status: input.status,
    reaction: input.reaction !== undefined ? input.reaction : existing?.reaction ?? null,
    dateAdded: input.dateAdded ?? existing?.dateAdded ?? today,
    dateRead: input.dateRead !== undefined ? input.dateRead : existing?.dateRead ?? null,
    excludeUntil: input.excludeUntil !== undefined ? input.excludeUntil : existing?.excludeUntil ?? null,
    notes: input.notes !== undefined ? input.notes : existing?.notes ?? null,
  };
  const newField = recordKey(book);
  const oldField = existing ? recordKey(existing) : null;
  const client = redis();
  await client.hset(keyForChild(book.child), { [newField]: JSON.stringify(book) });
  if (oldField && oldField !== newField) await client.hdel(keyForChild(book.child), oldField);
  return book;
}

export async function upsertHistoryBatch(inputs: HistoryInput[]) {
  return mapWithConcurrency(inputs, 3, upsertHistory);
}

export async function deleteHistory(child: ChildId, title: string) {
  const books = await listHistory(child);
  const normalized = normalizeTitle(title);
  const matches = books.filter((book) => normalizeTitle(book.title) === normalized);
  if (!matches.length) return 0;
  await redis().hdel(keyForChild(child), ...matches.map(recordKey));
  return matches.length;
}

function plusDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function plusMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function exclusionReason(book: HistoryBook, today = todaySeoul()) {
  if (book.status === "read") return "read";
  if (book.status === "favorite") return "favorite";
  if (book.status === "recommended") {
    return today <= plusDays(book.dateAdded, 56) ? "recently_recommended" : null;
  }
  if (book.status === "skip") {
    const until = book.excludeUntil ?? plusMonths(book.dateAdded, 6);
    return today <= until ? "skip" : null;
  }
  return null;
}

export async function checkHistory(child: ChildId, titles: string[]) {
  const books = await listHistory(child);
  return titles.map((title) => {
    const normalized = normalizeTitle(title);
    const book = books.find((item) => normalizeTitle(item.title) === normalized);
    const reason = book ? exclusionReason(book) : null;
    return { title, exclude: Boolean(reason), reason };
  });
}
