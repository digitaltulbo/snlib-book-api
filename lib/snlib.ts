import { load } from "cheerio";

const BASE = "https://www.snlib.go.kr/intro/menu/10041/program/30009/";
const SPECIAL_EDITION = /\[?(점자|큰글자|전자책|e-?book|dvd|비디오|오디오북|데이지)\]?/gi;
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const lookupCache = new Map<string, { expiresAt: number; value: BookLookup }>();

export type LibraryHolding = {
  library: string;
  status: string;
  location: string;
  callNumber: string;
  registrationNumber: string;
  reservation: string;
  interlibraryCandidate: boolean;
};

export type FoundBook = {
  query: string;
  found: true;
  matchedTitle: string;
  matchConfidence: "exact" | "normalized" | "partial";
  author: string | null;
  isbn: string | null;
  libraries: LibraryHolding[];
  centralLibrary: LibraryHolding[];
  pangyoEasyTheOne: { owned: "unknown" };
  interlibraryLoan: {
    candidateAvailable: boolean;
    sourceLibrary: string | null;
    pickupLibrary: "판교이지더원";
    pickupEligibility: "verify_at_application";
  };
};

export type NoMatch = {
  query: string;
  found: false;
  error: "NO_MATCH";
};

export type BookLookup = FoundBook | NoMatch;

export class SnlibRequestError extends Error {}
export class SnlibParserError extends Error {}

const clean = (value = "") => value.replace(/\s+/g, " ").trim();
const trimTitle = (value: string) => clean(value).replace(/[\s/:;,.-]+$/g, "");
const comparableTitle = (value: string) =>
  trimTitle(value)
    .replace(/[:\-~]\s*[^:]{1,25}$/g, "")
    .replace(/\((?:[0-9]+|[상중하]|[가-힣]\d*)\)$/g, "")
    .replace(/\b(?:\d+권|제?\d+권|[0-9]+편|시리즈)\b/gi, "")
    .replace(/\b(?:part|vol(?:ume)?|book)\s*\d+\b/gi, "")
    .replace(SPECIAL_EDITION, "")
    .replace(/[\[\](){}]/g, "")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("ko-KR");
const isSpecialEdition = (value: string) => /\[?(점자|큰글자|전자책|e-?book|dvd|비디오|오디오북|데이지)\]?/i.test(value);

function getLibraryName(location: string) {
  const key = location.match(/^\[([^\]]+)\]/)?.[1] ?? "";
  const names: Record<string, string> = {
    중앙: "중앙도서관",
    고등: "고등도서관",
    구미: "구미도서관",
    논골: "논골도서관",
    무지개: "무지개도서관",
    복정: "복정도서관",
    분당: "분당도서관",
    서현: "서현도서관",
    수내: "수내도서관",
    수정: "수정도서관",
    운중: "운중도서관",
    위례: "위례도서관",
    중원: "중원도서관",
    중어: "중원어린이도서관",
    판교: "판교도서관",
    판어: "판교어린이도서관",
    중앙동: "중앙동작은도서관",
    구미1동: "구미1동작은도서관",
    금광2동: "금광2동작은도서관",
    도촌동: "도촌동작은도서관",
    상대원3동: "상대원3동작은도서관",
    서현청소년: "서현청소년작은도서관",
    수내1동: "수내1동작은도서관",
    수진2동: "수진2동작은도서관",
    야탑1동: "야탑1동작은도서관",
  };
  return names[key] ?? (key ? `${key}도서관` : "알 수 없는 도서관");
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url: URL, retries = 2) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html",
          "User-Agent": "snlib-book-api/1.0 (public catalog lookup)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return response;
      if (response.status < 500 || attempt === retries) {
        throw new SnlibRequestError(`SNLib returned HTTP ${response.status}`);
      }
      lastError = new SnlibRequestError(`SNLib returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    }
    await wait((attempt + 1) * 250);
  }
  throw new SnlibRequestError(`SNLib request failed: ${String(lastError)}`);
}

async function fetchHtml(path: string, params: Record<string, string>) {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetchWithRetry(url);
  return response.text();
}

function searchParams(title: string) {
  return {
    searchType: "SIMPLE",
    searchCategory: "BOOK",
    searchKey: "TITLE",
    searchKeyword: title,
    searchPbLibrary: "ALL",
    searchSort: "TITLE",
    searchOrder: "ASC",
    searchRecordCount: "50",
    currentPageNo: "1",
    viewStatus: "IMAGE",
  };
}

type SearchCandidate = {
  title: string;
  recKey: string;
  bookKey: string;
  publishFormCode: string;
};

function selectCandidate(html: string, query: string): {
  candidate: SearchCandidate;
  confidence: FoundBook["matchConfidence"];
  score: number;
} | null {
  const $ = load(html);
  const items = $(".resultList.imageType > li").length
    ? $(".resultList.imageType > li")
    : $(".resultList > li");
  const candidates: SearchCandidate[] = [];

  items.each((_, item) => {
    const link = $(item).find('dt.tit a[onclick*="fnSearchResultDetail"]').first();
    const onclick = link.attr("onclick") ?? "";
    const keys = onclick.match(
      /fnSearchResultDetail\((\d+),\s*(\d+),\s*'([^']+)'\)/,
    );
    const title = trimTitle(link.text());
    if (keys && title) {
      candidates.push({
        title,
        recKey: keys[1],
        bookKey: keys[2],
        publishFormCode: keys[3],
      });
    }
  });

  const rawQuery = trimTitle(query).toLocaleLowerCase("ko-KR");
  const normalizedQuery = comparableTitle(query);
  const scored = candidates
    .map((candidate) => {
      const rawTitle = trimTitle(candidate.title).toLocaleLowerCase("ko-KR");
      const normalizedTitle = comparableTitle(candidate.title);
      const specialPenalty = isSpecialEdition(candidate.title) ? 20 : 0;
      if (rawTitle === rawQuery) return { candidate, score: specialPenalty, confidence: "exact" as const };
      if (normalizedTitle === normalizedQuery) return { candidate, score: 100 + specialPenalty, confidence: "normalized" as const };
      if (normalizedTitle.includes(normalizedQuery)) {
        return { candidate, score: 200 + specialPenalty + normalizedTitle.length, confidence: "partial" as const };
      }
      return null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => a.score - b.score);

  return scored.length
    ? { candidate: scored[0].candidate, confidence: scored[0].confidence, score: scored[0].score }
    : null;
}

function getInfoValue($: ReturnType<typeof load>, heading: string) {
  let value = "";
  $(".bookInfoTbl th").each((_, th) => {
    if (clean($(th).text()) === heading) value = clean($(th).next("td").text());
  });
  return value || null;
}

function parseHoldings(html: string): LibraryHolding[] {
  const $ = load(html);
  const tables = $("table.tbl.hasLibrary");
  if (!tables.length) throw new SnlibParserError("Holding table selector was not found");

  const holdings: LibraryHolding[] = [];
  tables.each((_, table) => {
    $(table).find("tbody tr").each((_, row) => {
      const cells = $(row).find("td").map((_, td) => clean($(td).text())).get();
      if (cells.length < 8) return;
      const [, statusCell, callNumberCell, registrationNumber, , location, reservation, loan] = cells;
      const status = clean(statusCell).replace(/(대출(?:가능|불가))\s*\[/, "$1 [");
      if (!status || !location) return;

      const interlibraryCandidate =
        status.includes("대출가능") && loan === "신청하기" &&
        $(row).find('[onclick*="fnBandLillApplyPop"]').length > 0;

      holdings.push({
        library: getLibraryName(location),
        status,
        location,
        callNumber: clean(callNumberCell.replace("청구기호출력", "")),
        registrationNumber,
        reservation,
        interlibraryCandidate,
      });
    });
  });
  return holdings;
}

export async function lookupBook(rawTitle: string): Promise<BookLookup> {
  const query = clean(rawTitle);
  if (!query) return { query, found: false, error: "NO_MATCH" };
  const cacheKey = comparableTitle(query);
  const now = Date.now();
  const cached = lookupCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) lookupCache.delete(cacheKey);

  const params = searchParams(query);
  const resultHtml = await fetchHtml("plusSearchResultList.do", params);
  let selected = selectCandidate(resultHtml, query);

  // TITLE 정렬 결과에서 특수판이 일반판보다 먼저 나오는 경우가 있어,
  // 완전 일치 일반판을 찾을 때까지만 추가 페이지를 제한적으로 확인한다.
  if (!selected || selected.score > 0) {
    for (let page = 2; page <= 4; page += 1) {
      const nextHtml = await fetchHtml("plusSearchResultList.do", {
        ...params,
        currentPageNo: String(page),
      });
      const next = selectCandidate(nextHtml, query);
      if (next && (!selected || next.score < selected.score)) selected = next;
      if (selected?.score === 0) break;
    }
  }
  if (!selected) {
    const noMatch: BookLookup = { query, found: false, error: "NO_MATCH" };
    lookupCache.set(cacheKey, { value: noMatch, expiresAt: now + LOOKUP_CACHE_TTL_MS });
    return noMatch;
  }

  const detailHtml = await fetchHtml("plusSearchResultDetail.do", {
    ...params,
    recKey: selected.candidate.recKey,
    bookKey: selected.candidate.bookKey,
    publishFormCode: selected.candidate.publishFormCode,
  });

  const $ = load(detailHtml);
  const heading = clean($(".resultViewDetail h4").first().text());
  if (!heading) throw new SnlibParserError("Book title selector was not found");

  const standardNumber = getInfoValue($, "표준번호") ?? "";
  const isbn = standardNumber.match(/ISBN:\s*([0-9X-]+)/i)?.[1] ?? null;
  const libraries = parseHoldings(detailHtml);
  const centralLibrary = libraries.filter((holding) => holding.library === "중앙도서관");
  const interlibraryCandidates = libraries.filter((holding) => holding.interlibraryCandidate);
  const preferredCandidate =
    interlibraryCandidates.find((holding) => holding.library === "판교도서관") ??
    interlibraryCandidates[0] ??
    null;

  const output: BookLookup = {
    query,
    found: true,
    matchedTitle: heading,
    matchConfidence: selected.confidence,
    author: getInfoValue($, "저자사항"),
    isbn,
    libraries,
    centralLibrary,
    pangyoEasyTheOne: { owned: "unknown" },
    interlibraryLoan: {
      candidateAvailable: interlibraryCandidates.length > 0,
      sourceLibrary: preferredCandidate?.library ?? null,
      pickupLibrary: "판교이지더원",
      pickupEligibility: "verify_at_application",
    },
  };
  lookupCache.set(cacheKey, { value: output, expiresAt: now + LOOKUP_CACHE_TTL_MS });
  return output;
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  const runner = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      output[index] = await worker(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, runner));
  return output;
}
