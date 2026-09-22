import type { ChildId, HistoryStatus } from "../lib/history.js";
import { CHILDREN, STATUSES, deleteHistory, listHistory, upsertHistory, validateInput } from "../lib/history.js";

type Req = { method?: string; query: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => unknown; setHeader: (name: string, value: string) => void };
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const child = one(req.query.child) as ChildId;
      const status = one(req.query.status) as HistoryStatus | undefined;
      if (!CHILDREN.includes(child)) return res.status(400).json({ error: "INVALID_CHILD" });
      if (status && !STATUSES.includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });
      return res.status(200).json({ child, books: await listHistory(child, status) });
    }
    if (req.method === "POST") {
      const book = await upsertHistory(validateInput(req.body));
      return res.status(200).json({ book });
    }
    if (req.method === "DELETE") {
      const child = one(req.query.child) as ChildId;
      const title = one(req.query.title) ?? "";
      if (!CHILDREN.includes(child)) return res.status(400).json({ error: "INVALID_CHILD" });
      if (!title.trim()) return res.status(400).json({ error: "TITLE_REQUIRED" });
      return res.status(200).json({ deleted: await deleteHistory(child, title) });
    }
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HISTORY_ERROR";
    const clientError = /^(INVALID_|TITLE_REQUIRED)/.test(message);
    return res.status(clientError ? 400 : 502).json({ error: message });
  }
}
