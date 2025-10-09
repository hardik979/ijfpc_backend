// lib/receipt-pdf.js
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

export async function htmlToPdf({
  html,
  filename = `Receipt_${Date.now()}.pdf`,
}) {
  const outDir = path.join(process.cwd(), "tmp");
  await fs.promises.mkdir(outDir, { recursive: true });
  const filePath = path.join(outDir, filename);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");
    await page.pdf({
      path: filePath,
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return { filePath, filename };
  } finally {
    await browser.close();
  }
}
