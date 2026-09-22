import { mapWithConcurrency, SnlibParserError, SnlibRequestError, lookupBook } from "../../lib/snlib.js";

type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => unknown;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  const titles = (req.body as { titles?: unknown } | undefined)?.titles;
  if (!Array.isArray(titles) || !titles.every((title: unknown) => typeof title === "string")) {
    return res.status(400).json({ error: "TITLES_ARRAY_REQUIRED" });
  }
  if (!titles.length || titles.length > 20) {
    return res.status(400).json({ error: "TITLES_LIMIT_1_TO_20" });
  }

  try {
    res.setHeader("Cache-Control", "no-store");
    const books = await mapWithConcurrency(titles, 3, lookupBook);
    return res.status(200).json({ books });
  } catch (error) {
    const code = error instanceof SnlibParserError ? "PARSER_ERROR" : "UPSTREAM_ERROR";
    if (error instanceof SnlibRequestError || error instanceof SnlibParserError) {
      return res.status(502).json({ error: code });
    }
    return res.status(502).json({ error: "UPSTREAM_ERROR" });
  }
}
