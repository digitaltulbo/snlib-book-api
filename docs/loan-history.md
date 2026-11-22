# Personal SNLib loan history (proposed endpoint)

This feature is **different from** `/api/history`, which contains the app's own reading records.

The proposed `POST /api/loan-history` reads a signed-in patron's Seongnam Library loan history, including returned books. It follows the account-page route `/intro/menu/10062/program/30021/mypage/loanHistoryList.do` identified in the publicly available `snlib-cli` implementation.

## Security and setup

- The endpoint is **disabled by default** (503). Set a new random `LOAN_HISTORY_API_KEY` of at least 32 characters in the Vercel project's server-side environment. Never commit that key.
- Call it with `Authorization: Bearer <LOAN_HISTORY_API_KEY>`, a JSON body with `userId` and `password`, and HTTPS. Do not paste credentials into AI chat, public tickets, URLs, logs, or shell history.
- Login credentials and session cookies are used only in a single invocation. They are not written to Redis, logs, cookies on the caller, or the returned JSON. Cookies are kept in memory for the account lookup and discarded when the function ends.
- Requests are not redirected to third-party origins and login POST is never followed automatically. Response cache is disabled.
- This implementation depends on the library's member login flow; its actual behavior must be validated by the account owner before enabling it. There is no supported OAuth or token delegation in this project.
- **Prefer a local trusted client** over giving a long-lived account password to a cloud function. The third-party `snlib-cli` project can query loan history locally using an ephemeral user session; review its code and supply credentials only locally if adopting it.

### Request example (placeholders only)

```http
POST /api/loan-history HTTP/1.1
Authorization: Bearer <SERVER_CONFIGURED_SECRET>
Content-Type: application/json

{"userId":"<MEMBER_ID>","password":"<PASSWORD>"}
```

A successful response has `loans`, `count`, `page`, `hasMore`, `source`, and `checkedAt`. A loan includes title, registration number, call number, library, room, status, loan date, and return date (nullable). `hasMore:true` means the upstream page contains more records than we returned; **do not assume the result is complete**.

HTTP 401 signifies an API key or upstream authentication problem. 503 signals missing server setup. 502 means the remote site or parser failed. Never label a failed lookup as an empty history.

## Local tests

```sh
npm ci
npm run check
npm run test:loan-history
```

The fixture tests cover known markup and mocked login/session flows. They **do not** prove actual credentials work, production browsing/session cookies work, or all historical pages were fetched. Keep production changes behind review and explicit owner testing.

## Follow-up

- Verify against real account with explicit owner authorization.
- Inspect current library HTML for changes, confirm login and account selectors.
- Add authenticated pagination for complete history rather than silently treating the first page as complete.
- Map confirmed loan events to Notion only after the user assigns each borrowed book to a child; loans do not prove reading.
