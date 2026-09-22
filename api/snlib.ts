import { SnlibParserError, SnlibRequestError, lookupBook } from "../lib/snlib.js";

type VercelRequest = { method?: string; query: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => unknown;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const raw = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;
  const title = typeof raw === "string" ? raw : "";
  if (!title.trim()) return res.status(400).json({ error: "TITLE_REQUIRED" });

  try {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(await lookupBook(title));
  } catch (error) {
    if (error instanceof SnlibParserError) {
      return res.status(502).json({ query: title, error: "PARSER_ERROR" });
    }
    if (error instanceof SnlibRequestError) {
      return res.status(502).json({ query: title, error: "UPSTREAM_ERROR" });
    }
    return res.status(502).json({ query: title, error: "UPSTREAM_ERROR" });
  }
}
