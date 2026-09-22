import { upsertHistoryBatch, validateInput } from "../../lib/history.js";

type Req = { method?: string; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => unknown; setHeader: (name: string, value: string) => void };

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  try {
    const values = (req.body as { books?: unknown } | undefined)?.books;
    if (!Array.isArray(values)) return res.status(400).json({ error: "BOOKS_ARRAY_REQUIRED" });
    if (!values.length || values.length > 20) return res.status(400).json({ error: "BOOKS_LIMIT_1_TO_20" });
    const books = await upsertHistoryBatch(values.map(validateInput));
    return res.status(200).json({ books });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HISTORY_ERROR";
    const clientError = /^(INVALID_|TITLE_REQUIRED)/.test(message);
    return res.status(clientError ? 400 : 502).json({ error: message });
  }
}
