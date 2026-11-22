import { load } from "cheerio";

const BASE_URL = "https://www.snlib.go.kr";
const LOGIN_PAGE = "/intro/memberLogin.do";
const LOGIN_ACTION = "/intro/menu/10068/program/30025/memberLoginProc.do";
const LOGIN_CHECK = "/intro/menu/10060/program/30019/mypage/loanStatusList.do";
const HISTORY_PAGE = "/intro/menu/10062/program/30021/mypage/loanHistoryList.do";

export type LoanHistoryItem = {
  title: string;
  registrationNumber: string | null;
  callNumber: string | null;
  library: string | null;
  room: string | null;
  status: string | null;
  loanDate: string | null;
  returnDate: string | null;
};

export class LoanHistoryError extends Error {
  constructor(public readonly code: string, public readonly httpStatus = 502) {
    super(code);
    this.name = "LoanHistoryError";
  }
}

function clean(input: string | undefined): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

function valueOrNull(input: string | undefined): string | null {
  return clean(input) || null;
}

export function parseLoanHistory(html: string) {
  const $ = load(html);
  const rows = $("ul.article-list > li").filter((_, element) =>
    !$(element).hasClass("checkArea") && $(element).find(".emptyNote").length === 0
  );
  const listFound = $("ul.article-list").length > 0;
  if (!listFound) throw new LoanHistoryError("UPSTREAM_FORMAT_CHANGED");

  const loans: LoanHistoryItem[] = [];
  rows.each((_, row) => {
    const title = clean($(row).find(".title").first().text());
    if (!title) return;
    const fields = new Map<string, string>();
    $(row).find(".info span").each((__, span) => {
      const value = clean($(span).text());
      const separator = value.indexOf(":");
      if (separator >= 0) fields.set(clean(value.slice(0, separator)), clean(value.slice(separator + 1)));
    });
    loans.push({
      title,
      registrationNumber: valueOrNull(fields.get("등록번호")),
      callNumber: valueOrNull(fields.get("청구기호")),
      library: valueOrNull(fields.get("소장도서관")),
      room: valueOrNull(fields.get("자료실")),
      status: valueOrNull(fields.get("상태")),
      loanDate: valueOrNull(fields.get("대출일")),
      returnDate: valueOrNull(fields.get("반납일")),
    });
  });
  const totalRaw = clean($(".boardFilter .themeFC").first().text()).replace(/,/g, "");
  const count = /^\d+$/.test(totalRaw) ? Number(totalRaw) : loans.length;
  if (rows.length > 0 && loans.length === 0) throw new LoanHistoryError("UPSTREAM_FORMAT_CHANGED");
  if (count > 0 && loans.length === 0) throw new LoanHistoryError("UPSTREAM_FORMAT_CHANGED");
  return {
    loans,
    count,
    page: 1,
    hasMore: count > loans.length,
    source: "snlib_authenticated_loan_history" as const,
  };
}

type Transport = typeof fetch;
type FetchReply = { response: Response; body: string };
type HttpVerb = "GET" | "POST";

function collectSetCookies(headers: Headers): string[] {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [];
  if (values.length > 0) return values;
  const raw = headers.get("set-cookie") ?? "";
  return raw ? raw.split(/,(?=\s*[^;,\s=]+=)/) : [];
}

export async function fetchLoanHistoryOnce(
  userId: string,
  password: string,
  transport: Transport = fetch,
) {
  const cookies = new Map<string, string>();
  async function request(path: string, method: HttpVerb, form?: URLSearchParams): Promise<FetchReply> {
    const url = new URL(path, BASE_URL);
    if (url.origin !== BASE_URL) throw new LoanHistoryError("UNSAFE_UPSTREAM_URL");
    const cookieValue = [...cookies.entries()].map(([key, value]) => key + "=" + value).join("; ");
    let response: Response;
    try {
      response = await transport(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(12000),
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (compatible; snlib-book-api/2.0)",
          Referer: BASE_URL + LOGIN_PAGE,
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(cookieValue ? { Cookie: cookieValue } : {}),
        },
        ...(form ? { body: form.toString() } : {}),
      });
    } catch {
      throw new LoanHistoryError("UPSTREAM_NETWORK_ERROR");
    }

    const destination = response.headers.get("location");
    if (destination && new URL(destination, BASE_URL).origin !== BASE_URL) {
      throw new LoanHistoryError("UNSAFE_REDIRECT");
    }
    for (const header of collectSetCookies(response.headers)) {
      const pair = header.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(key)) {
        if (value) cookies.set(key, value);
        else cookies.delete(key);
      }
    }

    if (response.status >= 400) {
      if (response.status === 401 || response.status === 403) throw new LoanHistoryError("LOGIN_REJECTED", 401);
      throw new LoanHistoryError("UPSTREAM_HTTP_ERROR");
    }
    if (response.status >= 300 && response.status < 400 && method === "GET") {
      throw new LoanHistoryError("LOGIN_REQUIRED", 401);
    }
    // The login POST may redirect, but its destination is never followed.
    const body = response.status >= 300 ? "" : await response.text();
    return { response, body };
  }

  await request(LOGIN_PAGE, "GET");
  const form = new URLSearchParams({
    returnUrl: "aHR0cHM6Ly9zbmxpYi5nby5rci9pbnRyby9pbmRleC5kbw==",
    userId,
    password,
  });
  await request(LOGIN_ACTION, "POST", form);
  const verified = await request(LOGIN_CHECK, "GET");
  if (!load(verified.body)('a[href*="memberLogout"]').length) {
    throw new LoanHistoryError("LOGIN_REJECTED", 401);
  }
  const history = await request(HISTORY_PAGE, "GET");
  if (!load(history.body)('a[href*="memberLogout"]').length) {
    throw new LoanHistoryError("SESSION_REJECTED", 401);
  }
  return {
    ...parseLoanHistory(history.body),
    checkedAt: new Date().toISOString(),
  };
}
