const { execFileSync } = require("node:child_process");

const API_BASE = "https://indialotteryapi.com/wp-json/klr/v1";
const OFFICIAL_LISTING_URLS = [
  process.env.OFFICIAL_RESULTS_URL || "https://www.lotteryagent.kerala.gov.in/result/public/",
  "https://result.keralalotteries.com/",
  "https://result.keralalotteries.com/weblotteryresult.php"
];

const PRIZE_KEYS = [
  ["1st", "1st Prize"],
  ["consolation", "Consolation Prize"],
  ["2nd", "2nd Prize"],
  ["3rd", "3rd Prize"],
  ["4th", "4th Prize"],
  ["5th", "5th Prize"],
  ["6th", "6th Prize"],
  ["7th", "7th Prize"],
  ["8th", "8th Prize"],
  ["9th", "9th Prize"]
];

function describeFetchError(error) {
  const cause = error && error.cause;
  const code = cause && cause.code ? ` (${cause.code})` : "";
  if (error && error.name === "TimeoutError") return "request timed out after 20 seconds";
  return `${error && error.message ? error.message : "network request failed"}${code}`;
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "VasanthamLotteryResultChecker/1.1", Accept: "text/html,application/json,*/*" },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    throw new Error(`${url}: ${describeFetchError(error)}`);
  }
}

async function fetchOfficialDocument(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "VasanthamLotteryResultChecker/1.1", Accept: "application/pdf,text/html,*/*" },
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    throw new Error(`${url}: ${describeFetchError(error)}`);
  }
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  const isPdf = contentType.includes("application/pdf") || bytes.subarray(0, 5).toString() === "%PDF-";
  if (!isPdf) return bytes.toString("utf8");

  try {
    // LOTIS publishes draw sheets as PDFs. Poppler's pdftotext extracts the
    // searchable text while preserving the number columns and leading zeros.
    return execFileSync("pdftotext", ["-layout", "-", "-"], {
      input: bytes,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 15000
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("The official LOTIS result is a PDF, but pdftotext is not installed on the server. Install Poppler (poppler-utils) on the Render service to enable official cross-verification.");
    }
    throw new Error(`Could not extract text from the official LOTIS PDF: ${error.message}`);
  }
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "VasanthamLotteryResultChecker/1.1" },
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    throw new Error(`Third-party API ${url}: ${describeFetchError(error)}`);
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error("No lottery result is available for the selected date yet.");
    throw new Error(`Third-party API ${url}: HTTP ${response.status}`);
  }
  try { return await response.json(); }
  catch { throw new Error(`Third-party API ${url}: response was not valid JSON.`); }
}

function cleanToken(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractTokens(value) {
  const values = Array.isArray(value) ? value : [value];
  const tokens = [];
  for (const item of values) {
    if (item == null) continue;
    const source = typeof item === "string" || typeof item === "number" ? String(item) :
      (item.ticket || item.number || item.value || "");
    const matches = source.match(/[A-Z]{2}\s*\d{6}|\b\d{4}\b/g) || [];
    for (const match of matches) {
      const token = cleanToken(match);
      if (token && !tokens.includes(token)) tokens.push(token);
    }
  }
  return tokens;
}

function normalizeApiResult(data) {
  if (!data || typeof data !== "object" || !data.draw_date || !data.draw_code) {
    throw new Error("Third-party API returned an incomplete draw record.");
  }
  const prizes = data.prizes || {};
  const amounts = prizes.amounts || {};
  const normalized = {};
  for (const [key] of PRIZE_KEYS) normalized[key] = extractTokens(prizes[key]);

  const firstTicket = data.first && data.first.ticket;
  if (firstTicket) normalized["1st"] = extractTokens(firstTicket);
  if (!normalized["1st"].length && prizes.first) normalized["1st"] = extractTokens(prizes.first);

  return {
    drawDate: String(data.draw_date),
    drawName: String(data.draw_name || "Kerala Lottery"),
    drawCode: String(data.draw_code).toUpperCase(),
    prizes: normalized,
    amounts
  };
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlToText(html) {
  return decodeHtml(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|td|th|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

function findOfficialResultUrl(listingHtml, draw, listingUrl) {
  const rows = listingHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const dateDmy = draw.drawDate.split("-").reverse().join("/");
  const targetCode = draw.drawCode.replace(/\s+/g, "").toUpperCase();

  for (const row of rows) {
    const rowText = htmlToText(row).toUpperCase().replace(/\s+/g, " ");
    const codeMatch = rowText.replace(/\s/g, "").includes(targetCode);
    const dateMatch = rowText.includes(dateDmy);
    if (!codeMatch || !dateMatch) continue;
    const hrefs = [...row.matchAll(/href\s*=\s*["']([^"']+)["']/gi)];
    for (const href of hrefs) {
      const target = decodeHtml(href[1]).replace(/&amp;/g, "&").trim();
      if (!target || target === "#" || /^javascript:/i.test(target)) continue;
      return new URL(target, listingUrl).href;
    }
    const onclick = row.match(/(?:location\.href|window\.open)\s*\(?\s*["']([^"']+)["']/i);
    if (onclick && !/^javascript:/i.test(onclick[1])) {
      return new URL(decodeHtml(onclick[1]), listingUrl).href;
    }
  }
  return null;
}

function parseOfficialResult(html, draw) {
  let text = htmlToText(html);
  // Remove repeated PDF page footers so page numbers and timestamps are not
  // mistaken for 4-digit winning numbers. Also ignore the post-result advice.
  text = text
    .replace(/Page\s+\d+\s+Modernization\s*&\s*IT\s+Software\s+Division\s*:\s*Department\s+of\s+State\s+Lotteries\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/gi, " ")
    .replace(/The prize winners are advised[\s\S]*$/i, " ");
  const headings = [];
  const headingRegex = /\b(1st|2nd|3rd|4th|5th|6th|7th|8th|9th|cons(?:olation)?)\s*Prize\b/gi;
  let match;
  while ((match = headingRegex.exec(text)) !== null) {
    const raw = match[1].toLowerCase();
    const key = raw.startsWith("cons") ? "consolation" : raw;
    if (PRIZE_KEYS.some(([prizeKey]) => prizeKey === key)) {
      headings.push({ key, index: match.index, end: headingRegex.lastIndex });
    }
  }

  const official = {};
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const sectionText = text.slice(heading.end, headings[i + 1]?.index ?? text.length)
      // Prize amounts (for example, "Rs :5000/-") are not winning numbers.
      .replace(/\bRs\s*[:.]?\s*₹?\s*[\d,]+\s*\/-?/gi, " ");
    official[heading.key] = extractTokens(sectionText);
  }

  if (!official["1st"]?.length || Object.keys(official).length < 3) {
    throw new Error("Could not read the prize numbers from the official result page.");
  }

  // Confirm that the official document itself identifies the requested draw.
  const normalizedText = text.toUpperCase().replace(/\s+/g, " ");
  const codeFound = normalizedText.replace(/\s/g, "").includes(draw.drawCode.replace(/\s/g, "").toUpperCase());
  const dateDmy = draw.drawDate.split("-").reverse().join("/");
  const dateFound = normalizedText.includes(dateDmy);
  if (!codeFound || !dateFound) {
    throw new Error("Official result document does not match the API draw code and date.");
  }
  return official;
}

function comparePrizes(apiPrizes, officialPrizes) {
  const differences = [];
  for (const [key, label] of PRIZE_KEYS) {
    const apiNumbers = [...(apiPrizes[key] || [])].sort();
    const officialNumbers = [...(officialPrizes[key] || [])].sort();
    if (JSON.stringify(apiNumbers) !== JSON.stringify(officialNumbers)) {
      differences.push({
        prize: label,
        apiCount: apiNumbers.length,
        officialCount: officialNumbers.length,
        missingFromApi: officialNumbers.filter(number => !apiNumbers.includes(number)),
        missingFromOfficial: apiNumbers.filter(number => !officialNumbers.includes(number))
      });
    }
  }
  return differences;
}

function toLegacyResultText(draw) {
  return PRIZE_KEYS
    .filter(([key]) => draw.prizes[key] && draw.prizes[key].length)
    .map(([key, label]) => {
      const amount = draw.amounts[key] || draw.amounts[key === "consolation" ? "consolation" : key] || "As published";
      const amountText = String(amount).replace(/^₹/, "").replace(/\/-$/, "").replace(/\/$/, "");
      return `*${label} :* Amount: ₹${amountText}/-\n${draw.prizes[key].join("\n")}`;
    }).join("\n\n");
}

async function getVerifiedResult(apiUrl, requestedDate = null) {
  const apiRaw = await fetchJson(apiUrl);
  const apiDraw = normalizeApiResult(apiRaw);

  if (requestedDate && apiDraw.drawDate !== requestedDate) {
    throw new Error(`The API returned ${apiDraw.drawDate}, not the selected date ${requestedDate}. No result was displayed.`);
  }

  let officialUrl = null;
  let officialListingUrl = null;
  let officialHtml = null;
  const sourceErrors = [];

  for (const listingUrl of OFFICIAL_LISTING_URLS) {
    try {
      const listingHtml = await fetchText(listingUrl);
      const candidateUrl = findOfficialResultUrl(listingHtml, apiDraw, listingUrl);
      if (!candidateUrl) {
        sourceErrors.push(`${listingUrl}: draw ${apiDraw.drawCode} dated ${apiDraw.drawDate} was not listed`);
        continue;
      }
      const candidateHtml = await fetchOfficialDocument(candidateUrl);
      parseOfficialResult(candidateHtml, apiDraw);
      officialUrl = candidateUrl;
      officialListingUrl = listingUrl;
      officialHtml = candidateHtml;
      break;
    } catch (error) {
      sourceErrors.push(error.message);
    }
  }

  if (!officialUrl || !officialHtml) {
    const detail = sourceErrors.length ? ` Sources checked: ${sourceErrors.join(" | ")}` : "";
    throw new Error(`The official LOTIS result for ${apiDraw.drawCode} (${apiDraw.drawDate}) could not be located and read. The result has not been verified.${detail}`);
  }

  const officialPrizes = parseOfficialResult(officialHtml, apiDraw);
  const differences = comparePrizes(apiDraw.prizes, officialPrizes);
  if (differences.length) {
    const error = new Error("The third-party API and official result do not match. Automatic checking is blocked.");
    error.details = differences;
    error.draw = { drawName: apiDraw.drawName, drawCode: apiDraw.drawCode, drawDate: apiDraw.drawDate };
    throw error;
  }

  return {
    verified: true,
    verificationStatus: "MATCHED",
    drawName: apiDraw.drawName,
    drawCode: apiDraw.drawCode,
    drawDate: apiDraw.drawDate,
    prizes: apiDraw.prizes,
    resultText: toLegacyResultText(apiDraw),
    sources: { thirdPartyApi: apiUrl, officialListing: officialListingUrl, officialResult: officialUrl },
    verifiedAt: new Date().toISOString()
  };
}

async function getVerifiedLatestResult() {
  return getVerifiedResult(`${API_BASE}/latest`);
}

async function getVerifiedResultByDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Please select a valid date in YYYY-MM-DD format.");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("The selected date is invalid.");
  }
  return getVerifiedResult(`${API_BASE}/by-date?date=${encodeURIComponent(date)}`, date);
}

module.exports = { getVerifiedLatestResult, getVerifiedResultByDate };
