const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { getVerifiedLatestResult, getVerifiedResultByDate } = require("./lottery-results");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Health endpoint for Render (optional).
app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));

// Cache successful verification briefly to avoid repeated requests to
// the public result sources when multiple visitors open the page.
let latestResultCache = null;
let latestResultCacheUntil = 0;

// Fetch the latest result and return it only after third-party/official
// LOTIS cross-verification succeeds.
app.get("/api/results/latest", async (_req, res) => {
  try {
    if (latestResultCache && Date.now() < latestResultCacheUntil) {
      res.set("Cache-Control", "no-store");
      return res.json(latestResultCache);
    }

    const result = await getVerifiedLatestResult();
    latestResultCache = result;
    latestResultCacheUntil = Date.now() + 2 * 60 * 1000;
    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (error) {
    latestResultCache = null;
    latestResultCacheUntil = 0;
    console.error("Latest result verification failed:", error);
    res.status(502).json({
      verified: false,
      verificationStatus: "NOT_VERIFIED",
      message: error.message || "The latest result could not be verified.",
      details: error.details || null,
      draw: error.draw || null
    });
  }
});

// Fetch and verify a result for an explicitly selected draw date.
app.get("/api/results/by-date", async (req, res) => {
  const date = String(req.query.date || "");
  try {
    const result = await getVerifiedResultByDate(date);
    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (error) {
    console.error(`Result lookup failed for ${date || "(missing date)"}:`, error);
    const notFound = /No lottery result is available/i.test(error.message);
    res.status(notFound ? 404 : 502).json({
      verified: false,
      verificationStatus: "NOT_VERIFIED",
      message: error.message || "The selected result could not be verified.",
      details: error.details || null,
      draw: error.draw || null
    });
  }
});

// Existing PDF endpoint. This requires BROWSERLESS_TOKEN when it is used.
app.post("/generate-pdf", async (req, res) => {
  if (!process.env.BROWSERLESS_TOKEN) {
    return res.status(503).json({
      error: "PDF generation is not configured. Add BROWSERLESS_TOKEN in Render."
    });
  }

  let browser;
  try {
    const { htmlContent } = req.body || {};
    if (typeof htmlContent !== "string" || !htmlContent.trim()) {
      return res.status(400).json({ error: "htmlContent is required." });
    }

    browser = await puppeteer.connect({
      browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="full-result.pdf"'
    });
    res.send(pdfBuffer);
  } catch (error) {
    console.error("PDF Error:", error);
    res.status(500).json({ error: "PDF generation failed." });
  } finally {
    if (browser) {
      try { await browser.close(); } catch (closeError) {
        console.error("Browser close error:", closeError);
      }
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
