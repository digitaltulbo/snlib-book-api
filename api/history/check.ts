import type { ChildId } from "../../lib/history.js";
import { CHILDREN, checkHistory } from "../../lib/history.js";

type Req = { method?: string; body?: unknown };
type Res = { status: (code: number) => Res; json: (body: unknown) => unknown; setHeader: (name: string, value: string) => void };

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  try {
    const body = req.body as { child?: unknown; titles?: unknown } | undefined;
    const child = body?.child as ChildId;
    if (!CHILDREN.includes(child)) return res.status(400).json({ error: "INVALID_CHILD" });
    if (!Array.isArray(body?.titles) || !body.titles.every((title) => typeof title === "string" && title.trim())) {
      return res.status(400).json({ error: "TITLES_ARRAY_REQUIRED" });
    }
    if (!body.titles.length || body.titles.length > 50) return res.status(400).json({ error: "TITLES_LIMIT_1_TO_50" });
    return res.status(200).json({ child, results: await checkHistory(child, body.titles as string[]) });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "HISTORY_ERROR" });
  }
}
