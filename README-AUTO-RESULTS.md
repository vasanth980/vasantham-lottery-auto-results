# Vasantham Lottery – automatic result fetching

## What changed

- Added `GET /api/results/latest` to the existing Express server.
- The backend reads the latest draw from the IndiaLotteryAPI JSON endpoint.
- It locates the same draw in the Kerala State Lotteries public results listing and downloads the official draw document.
- It compares the draw date, draw code, and all available prize-number groups (1st, consolation, 2nd–9th).
- The endpoint returns `verified: true` only when all compared groups match. If a source is unavailable, the draw is missing, or any number differs, the endpoint returns `502` with `verified: false`; the frontend does not load the result into the checker.
- The frontend tries to fetch the latest verified draw when the page opens. The button can be used to retry. After a successful fetch, click the existing **Check Results** button to run your ticket ranges.
- Existing range matching, result rendering, image download, and PDF generation are retained.
- Successful verification is cached in server memory for two minutes to avoid repeated external requests.

## Official PDF text extraction requirement

The official Kerala State Lotteries result portal serves draw sheets as PDFs. The backend uses the Poppler `pdftotext` command to extract searchable text while preserving leading zeroes in 4-digit prize numbers.

The supplied `Dockerfile` installs `poppler-utils` (which provides `pdftotext`) so PDF verification works consistently on Render. For deployment, select the **Docker** runtime for the existing Render web service so Render builds this Dockerfile. The existing `PORT` environment variable is read by Express automatically.

If you keep the Native Node runtime instead, make sure `pdftotext` is installed and on `PATH`. If the command is missing, the API deliberately returns `NOT_VERIFIED` rather than trusting the third-party result by itself. The frontend displays the reason and leaves the manual paste workflow available.

## Environment

- Node.js 18 or newer is required (uses native `fetch` and `AbortSignal.timeout`).
- Existing `BROWSERLESS_TOKEN` configuration is still used only by the existing `/generate-pdf` route.
- Optional `OFFICIAL_RESULTS_URL` can override the primary LOTIS public listing URL. The Department's result portal is also checked as a fallback.

## API response

Successful response:

```json
{
  "verified": true,
  "verificationStatus": "MATCHED",
  "drawName": "Dhanalekshmi",
  "drawCode": "DL-76",
  "drawDate": "2026-11-04",
  "prizes": {},
  "resultText": "...",
  "sources": {
    "thirdPartyApi": "...",
    "officialListing": "...",
    "officialResult": "..."
  },
  "verifiedAt": "..."
}
```

A failed verification returns HTTP 502 and `verified: false`. Do not bypass this status or automatically check tickets against an unverified response.

## Deployment checks

1. Push the updated source files, including `Dockerfile`, to the GitHub repository.
2. In Render, configure the existing web service to use the **Docker** runtime / Dockerfile build.
3. Add `BROWSERLESS_TOKEN` in Render only if you use the `/generate-pdf` endpoint; it is not needed for automatic lottery-result fetching or image downloads.
4. Deploy the service.
5. Open `/api/results/latest` and confirm it returns `verified: true` for a published draw.
6. Open the website, wait for the verification status, enter ticket ranges, and click **Check Results**.
7. Test the manual paste flow and image/PDF downloads to confirm the existing features still work.

## Date-based result lookup and fetch diagnostics

The page now supports selecting a draw date. The backend calls the Kerala results API `/by-date?date=YYYY-MM-DD`, confirms that the returned draw date is exactly the selected date, and then cross-checks the numbers against the official LOTIS/result publication before displaying anything.

The official source list includes the LOTIS public listing and the `result.keralalotteries.com` public results archive. Server logs now include the URL and network/HTTP failure reason for each source, which makes Render fetch failures easier to diagnose. A date with no published result, or a result that cannot be verified against the official publication, is not displayed as verified.

The existing latest-result button, manual result entry, ticket-range matching, image generation, and PDF endpoint are retained. PDF generation still requires `BROWSERLESS_TOKEN` in the Render environment.
