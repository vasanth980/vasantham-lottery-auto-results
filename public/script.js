// ===============================
// FETCH LATEST VERIFIED RESULT
// ===============================
async function loadLatestResult() {
    const button = document.getElementById("fetchLatestBtn");
    const status = document.getElementById("fetchStatus");
    const drawInfo = document.getElementById("drawInfo");
    const textArea = document.getElementById("resultText");

    button.disabled = true;
    button.textContent = "Fetching and verifying...";
    status.className = "fetch-status loading";
    status.textContent = "Contacting the result API and checking the official LOTIS publication...";
    drawInfo.hidden = true;
    drawInfo.textContent = "";

    try {
        const response = await fetch("/api/results/latest", {
            method: "GET",
            headers: { "Accept": "application/json" },
            cache: "no-store"
        });
        const data = await response.json();

        if (!response.ok || !data.verified || !data.resultText) {
            const reason = data.message || "The result could not be verified.";
            throw new Error(reason);
        }

        textArea.value = data.resultText;
        status.className = "fetch-status success";
        status.textContent = "Official verification successful. You can now check your ticket ranges.";
        drawInfo.hidden = false;
        drawInfo.textContent = `${data.drawName} | Draw: ${data.drawCode} | Date: ${data.drawDate} | Verified: ${new Date(data.verifiedAt).toLocaleString()}`;

        // Reuse the existing result parsing, range matching and image rendering.
        checkResults();
    } catch (error) {
        status.className = "fetch-status error";
        status.textContent = `Automatic result unavailable: ${error.message}`;
        console.error("Automatic result fetch failed:", error);
    } finally {
        button.disabled = false;
        button.textContent = "Fetch Latest Verified Result";
    }
}

// ===============================
// 🔷 DEBUG LOGGER
// ===============================
function debug(label, value) {
    console.log("------------");
    console.log(label);
    console.log(value);
    console.log("------------");
}
// ===============================
// 🔷 ADD / REMOVE RANGE
// ===============================

function addRange() {
    const container = document.getElementById("rangeContainer");

    const div = document.createElement("div");
    div.className = "range-row";

    div.innerHTML = `
    <input type="number" placeholder="Start Number" class="start" />
    <input type="number" placeholder="End Number" class="end" />
    <button class="remove-btn" onclick="removeRange(this)">-</button>
  `;

    container.appendChild(div);
}

function removeRange(btn) {
    btn.parentElement.remove();
}

// ===============================
// 🔷 CHECK RESULTS (DEBUG MODE)
// ===============================

function checkResults() {

    document.getElementById("resultContainer").style.display = "block";
    const textArea = document.getElementById("resultText");
    const container = document.querySelector("#resultContent .result-sheet");
    const downloadBtn = document.getElementById("downloadImageBtn");
    if (!textArea || !container) return;

    const text = textArea.value.trim();
    container.innerHTML = "";

    if (!text) {
        alert("Paste result text first.");
        return;
    }

    const ranges = getRanges();
    const prizeSections = parseResult(text);

   if (prizeSections.length === 0) {
    alert("Parsing failed.");
    downloadBtn.disabled = true; // keep disabled
    return;
}
 
   //container.classList.add("result-sheet");

    // 🔷 ADD HEADER DYNAMICALLY
 
    let matchCount = 0;

    prizeSections.forEach(section => {

        const sectionDiv = document.createElement("div");
        sectionDiv.className = "sheet-section";

        const title = document.createElement("div");
        title.className = "sheet-title";
        title.innerText = `${section.prizeName.replace(/\*/g,"")} : ₹${section.amount}/-`;

        const numbersDiv = document.createElement("div");
        numbersDiv.className = "sheet-numbers";

        // Special display for Consolation Prize
if (section.prizeName.toLowerCase().includes("consolation")) {

    const seriesGroups = {};

    section.tickets.forEach(ticket => {

        const series = ticket.substring(0, 2);
        const number = ticket.substring(2);

        if (!seriesGroups[number]) {
            seriesGroups[number] = [];
        }

        seriesGroups[number].push(series);

        // Preserve match counting
        for (let range of ranges) {
            const ticketNumber = parseInt(number);

            if (ticketNumber >= range.start && ticketNumber <= range.end) {
                matchCount++;
                break;
            }
        }
    });

    Object.keys(seriesGroups).forEach(number => {

        const num = document.createElement("div");
        num.className = "sheet-number consolation-series";

        num.innerText =
            seriesGroups[number].join(", ") + " - " + number;

        numbersDiv.appendChild(num);
    });

} else {

    // Existing logic for all other prizes
    section.tickets.forEach(ticket => {

        let isMatched = false;

        for (let range of ranges) {

            // FULL TICKET (Ignore series)
            if (/^[A-Z]{2}\d{6}$/i.test(ticket)) {

                const number = parseInt(ticket.substring(2));

                if (number >= range.start && number <= range.end) {
                    isMatched = true;
                    matchCount++;
                    break;
                }
            }

            // 4 DIGIT PRIZE
            else if (/^\d{4}$/.test(ticket)) {

                const number = parseInt(ticket);
                const startLast4 = range.start % 10000;
                const endLast4 = range.end % 10000;

                if (number >= startLast4 && number <= endLast4) {
                    isMatched = true;
                    matchCount++;
                    break;
                }
            }
        }
        
        const num = document.createElement("div");
        num.className = "sheet-number";
        num.innerText = ticket.replace(/\*/g, "");

        if (isMatched) {
            num.classList.add("highlight");
        }

        numbersDiv.appendChild(num);
    });
}

        sectionDiv.appendChild(title);
        sectionDiv.appendChild(numbersDiv);
        container.appendChild(sectionDiv);
    });

    if (ranges.length > 0) {
        alert("Total Matches Found: " + matchCount);
    }
    downloadBtn.disabled = false; // enable after success
}

// ===============================
// 🔷 PARSE RESULT TEXT
// ===============================

function parseResult(text) {

    // 🔥 Remove unwanted parts first
    text = text.replace(/```[\s\S]*?```/g, "");  // remove code block
    text = text.replace(/https?:\/\/\S+/g, "");  // remove links
    text = text.replace(/_To view[\s\S]*/i, ""); // remove footer part

    let parsed = [];

    const regex = /\*(.*?)Prize\s*:\*\s*Amount:\s*₹?([\d,]+)\/-(.*?)(?=\*\d+\s|\*Consolation|\*To view|$)/gs;

    let match;

    while ((match = regex.exec(text)) !== null) {

        const prizeName = match[1].trim() + " Prize";
        const amount = match[2];
        const numbersRaw = match[3];

        // 🔥 Keep only valid tickets (RK123456 or 4-digit)
        const tickets = numbersRaw
            .replace(/\n/g, " ")
            .split(/\s+/)
            .filter(t => /^[A-Z]{2}\d{6}$/.test(t) || /^\d{4}$/.test(t));

        parsed.push({
            prizeName,
            amount,
            tickets
        });
    }

    return parsed;
}
// ===============================
// 🔷 GET RANGES
// ===============================

function getRanges() {

    const rows = document.querySelectorAll(".range-row");
    let ranges = [];

    rows.forEach(row => {

        const start = parseInt(row.querySelector(".start").value);
        const end = parseInt(row.querySelector(".end").value);

        if (!isNaN(start) && !isNaN(end)) {
            ranges.push({ start, end });
        }

    });

    return ranges;
}

async function downloadImage() {

    const element = document.getElementById("resultContainer");

    if (!element.innerHTML.trim()) {
        alert("No result to download.");
        return;
    }
    window.scrollTo(0,0);

    /* Save original styles */
    const originalWidth = element.style.width;
    const originalMaxWidth = element.style.maxWidth;

    /* Force desktop layout for capture */
    element.style.width = "900px";
    element.style.maxWidth = "900px";

    const canvas = await html2canvas(element, {
    scale: 3,
    useCORS: true,
    backgroundColor: "#ffffff",
    windowWidth: 900,
    scrollX: 0,
    scrollY: -window.scrollY
});

    /* Restore styles */
    element.style.width = originalWidth;
    element.style.maxWidth = originalMaxWidth;

    const today = new Date();

    const formattedDate =
        today.getDate().toString().padStart(2, '0') + "-" +
        (today.getMonth() + 1).toString().padStart(2, '0') + "-" +
        today.getFullYear();

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `Vasantham-Lottery-Result -${formattedDate}.png`;
    link.click();
}
// Automatically attempt to load the latest verified draw when the page opens.
document.addEventListener("DOMContentLoaded", () => {
    loadLatestResult();
});
