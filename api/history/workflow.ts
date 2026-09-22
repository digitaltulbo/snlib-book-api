import type { ChildId, HistoryStatus } from "../../lib/history.js";
import { CHILDREN, STATUSES, checkHistory, upsertHistoryBatch } from "../../lib/history.js";
import { lookupBook, mapWithConcurrency } from "../../lib/snlib.js";
import { verifyWriteAuth } from "../../lib/write-auth.js";

type Req = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type Res = { status: (code: number) => Res; json: (body: unknown) => unknown; setHeader: (name: string, value: string) => void };

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  try {
    const body = req.body as {
      child?: unknown;
      titles?: unknown;
      status?: unknown;
      save?: unknown;
    } | undefined;
    const child = body?.child as ChildId;
    const titles = body?.titles;
    const status = (body?.status ?? "read") as HistoryStatus;
    const save = body?.save === true;
    if (!CHILDREN.includes(child)) return res.status(400).json({ error: "INVALID_CHILD" });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "INVALID_STATUS" });
    if (!Array.isArray(titles) || !titles.every((title) => typeof title === "string" && title.trim())) {
      return res.status(400).json({ error: "TITLES_ARRAY_REQUIRED" });
    }
    if (!titles.length || titles.length > 50) return res.status(400).json({ error: "TITLES_LIMIT_1_TO_50" });

    const lookups = await mapWithConcurrency(titles as string[], 3, lookupBook);
    const matchedTitles = lookups.map((book) => (book.found ? book.matchedTitle : book.query));
    const checks = await checkHistory(child, matchedTitles);
    const checkByTitle = new Map(checks.map((item) => [item.title, item]));

    const items = lookups.map((lookup, index) => {
      const matchedTitle = matchedTitles[index];
      return {
        query: (titles as string[])[index],
        lookup,
        history: checkByTitle.get(matchedTitle) ?? null,
      };
    });

    const savedInputs = items
      .filter((item) => item.lookup.found && item.history && !item.history.exclude)
      .map((item) => ({
        child,
        title: item.lookup.found ? item.lookup.matchedTitle : item.query,
        author: item.lookup.found ? item.lookup.author : null,
        isbn: item.lookup.found ? item.lookup.isbn : null,
        status,
      }));

    if (save) {
      const auth = verifyWriteAuth(req.headers);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    }
    const saved = save && savedInputs.length ? await upsertHistoryBatch(savedInputs) : [];
    return res.status(200).json({
      child,
      status,
      save,
      items,
      savedCount: saved.length,
      saved,
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "WORKFLOW_ERROR" });
  }
}
