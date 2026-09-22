import type { ChildId } from "../../lib/history.js";
import { CHILDREN, favoriteQueue, listHistory, normalizeTitle, todaySeoul, upsertHistory } from "../../lib/history.js";

type Req = { method?: string; query: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => unknown; setHeader: (name: string, value: string) => void };
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const child = one(req.query.child) as ChildId;
      if (!CHILDREN.includes(child)) return res.status(400).json({ error: "INVALID_CHILD" });
      return res.status(200).json({ child, queue: await favoriteQueue(child) });
    }

    if (req.method === "POST") {
      const body = req.body as { child?: unknown; title?: unknown; dateRead?: unknown } | undefined;
      const child = body?.child as ChildId;
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const dateRead = typeof body?.dateRead === "string" ? body.dateRead : todaySeoul();
      if (!CHILDREN.includes(child)) return res.status(400).json({ error: "INVALID_CHILD" });
      if (!title) return res.status(400).json({ error: "TITLE_REQUIRED" });
      const books = await listHistory(child, "favorite");
      const normalized = normalizeTitle(title);
      const target = books.find((book) => normalizeTitle(book.title) === normalized);
      if (!target) return res.status(404).json({ error: "FAVORITE_NOT_FOUND" });
      const updated = await upsertHistory({
        child,
        title: target.title,
        author: target.author,
        isbn: target.isbn,
        status: "read",
        reaction: target.reaction,
        dateAdded: target.dateAdded,
        dateRead,
        excludeUntil: target.excludeUntil,
        notes: target.notes,
      });
      return res.status(200).json({ book: updated, queue: await favoriteQueue(child) });
    }
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "HISTORY_ERROR" });
  }
}
