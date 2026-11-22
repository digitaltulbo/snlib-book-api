import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLoanHistoryOnce, LoanHistoryError, parseLoanHistory } from "../lib/loan-history.js";

const fixture = "<li class='logout'><a href='/intro/memberLogout.do'>로그아웃</a></li><div class='boardFilter'><span class='themeFC'>2</span></div><ul class='article-list'><li><p class='title'><a>숲속 100층짜리 집</a></p><p class='info'><span>등록번호 : CEM123</span><span>청구기호 : 유 833-이</span><span>소장도서관 : 중앙도서관</span><span>자료실 : 유아자료실</span><span>상태 : 반납완료</span><span>대출일 : 2026.11.14</span><span>반납일 : 2026.11.20</span></p></li><li><p class='title'>달님 안녕</p><p class='info'><span>대출일 : 2026.11.14</span><span>반납일 : 2026.11.20</span></p></li></ul>";

test("parses returned loans with dates and library metadata", () => {
  const result = parseLoanHistory(fixture);
  assert.equal(result.count, 2);
  assert.equal(result.hasMore, false);
  assert.equal(result.loans[0].title, "숲속 100층짜리 집");
  assert.equal(result.loans[0].loanDate, "2026.11.14");
  assert.equal(result.loans[0].returnDate, "2026.11.20");
  assert.equal(result.loans[0].library, "중앙도서관");
  assert.equal(result.loans[1].registrationNumber, null);
});

test("handles a genuinely empty loan history and rejects unexpected markup", () => {
  assert.equal(parseLoanHistory("<ul class='article-list'></ul>").count, 0);
  assert.throws(() => parseLoanHistory("<html><form action='/login'></form></html>"),
    (error: unknown) => error instanceof LoanHistoryError && error.code === "UPSTREAM_FORMAT_CHANGED");
});

test("uses an ephemeral session, rejects logged-out responses, does not follow login POST", async () => {
  const paths: string[] = [];
  let count = 0;
  const mockFetch: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    count++;
    if (count === 1) return new Response("login form", {
      status: 200, headers: { "set-cookie": "JSESSIONID=testSession; Path=/; HttpOnly" },
    });
    if (count === 2) {
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "manual");
      assert.match(String(init?.body), /userId=demo/);
      return new Response("", { status: 302, headers: { location: "/intro/index.do" } });
    }
    if (count === 3) {
      assert.match(String((init?.headers as Record<string, string>)?.Cookie), /JSESSIONID=testSession/);
      return new Response("<a href='/intro/memberLogout.do'>logout</a>", { status: 200 });
    }
    return new Response(fixture, { status: 200 });
  };
  const out = await fetchLoanHistoryOnce("demo", "secret", mockFetch);
  assert.equal(out.count, 2);
  assert.equal(paths.length, 4);
  assert.equal(paths.at(-1), "/intro/menu/10062/program/30021/mypage/loanHistoryList.do");
});

test("rejects invalid credentials and never returns a personal loan list", async () => {
  let count = 0;
  const mockFetch: typeof fetch = async () => {
    count++;
    if (count === 1) return new Response("<html>login</html>", { status: 200 });
    if (count === 2) return new Response("", { status: 302, headers: { location: "/intro/index.do" } });
    return new Response("<html>로그인</html>", { status: 200 });
  };
  await assert.rejects(fetchLoanHistoryOnce("demo", "wrong", mockFetch),
    (error: unknown) => error instanceof LoanHistoryError && error.code === "LOGIN_REJECTED");
  assert.equal(count, 3);
});

test("rejects cross-origin login redirects", async () => {
  let count = 0;
  const mockFetch: typeof fetch = async () => {
    count++;
    if (count === 1) return new Response("login page", { status: 200 });
    return new Response("", { status: 302, headers: { location: "https://example.com/" } });
  };
  await assert.rejects(fetchLoanHistoryOnce("demo", "secret", mockFetch),
    (error: unknown) => error instanceof LoanHistoryError && error.code === "UNSAFE_REDIRECT");
});
