import { fetchLoanHistoryOnce, LoanHistoryError } from "../lib/loan-history.js";
import { timingSafeEqual } from "node:crypto";

type Request = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (data: unknown) => unknown;
  setHeader: (name: string, value: string) => void;
};
function compareSecret(input: string, actual: string) {
  const a = Buffer.from(input, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: Request, res: ResponseLike) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const expectedKey = process.env.LOAN_HISTORY_API_KEY;
  if (!expectedKey || expectedKey.length < 32) {
    return res.status(503).json({ error: "LOAN_HISTORY_NOT_CONFIGURED" });
  }
  const authorization = req.headers.authorization;
  const provided = typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!compareSecret(provided, expectedKey)) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "INVALID_BODY" });
  }
  const input = body as Record<string, unknown>;
  const id = input.userId;
  const password = input.password;
  if (typeof id !== "string" || typeof password !== "string" ||
      id.length < 1 || id.length > 100 || password.length < 1 || password.length > 256) {
    return res.status(400).json({ error: "INVALID_CREDENTIALS" });
  }
  try {
    const result = await fetchLoanHistoryOnce(id, password);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof LoanHistoryError) {
      return res.status(error.httpStatus).json({ error: error.code });
    }
    return res.status(502).json({ error: "LOAN_HISTORY_ERROR" });
  }
}
