import { lookupBook } from "../lib/snlib.js";

for (const title of ["알사탕", "수박 수영장", "사과가 쿵!"]) {
  const book = await lookupBook(title);
  console.log(JSON.stringify({
    query: book.query,
    found: book.found,
    ...(book.found ? {
      matchedTitle: book.matchedTitle,
      matchConfidence: book.matchConfidence,
      author: book.author,
      isbn: book.isbn,
      holdings: book.libraries.length,
      available: book.libraries.filter((x) => x.status.includes("대출가능")).length,
      transfer: book.libraries.filter((x) => x.interlibraryCandidate).length,
      central: book.centralLibrary,
      interlibraryLoan: book.interlibraryLoan,
    } : { error: book.error }),
  }));
}
