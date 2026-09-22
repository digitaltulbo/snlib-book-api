import type { ChildId } from "../../lib/history.js";
import { CHILDREN, listHistoryAudit } from "../../lib/history.js";

type Req = { method?: string; query: Record<string, string | string[] | undefined> };
type Res = { status: (code: number) => Res; json: (body: unknown) => unknown; setHeader: (name: string, value: string) => void };
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function handler(req: Req, res: Res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  try {
    const child = one(req.query.child) as ChildId;
    const limitRaw = one(req.query.limit) ?? "50";
    const limit = Number(limitRaw);
    if (!CHILDREN.includes(child)) return res.status(400).json({ error: "INVALID_CHILD" });
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) return res.status(400).json({ error: "INVALID_LIMIT" });
    return res.status(200).json({ child, entries: await listHistoryAudit(child, limit) });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "HISTORY_ERROR" });
  }
}
