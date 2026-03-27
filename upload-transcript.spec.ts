import { test, expect } from "@playwright/test";
import path from "path";

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";
const PDF_PATH = path.resolve(__dirname, "fixtures", "sample-transcript.pdf");

// Number of sequential uploads for performance testing
const PERF_ITERATIONS = 5;

test.describe("Transcript Upload", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/timeline`);
  });

  test("uploads a PDF and navigates to timeline", async ({ page }) => {
    // Upload file via the hidden input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(PDF_PATH);

    // Verify file is selected
    await expect(page.locator(".file-chip-name")).toContainText("File Selected:");

    // Click create
    await page.click("text=Create Timeline");

    // Should show uploading state
    await expect(page.locator(".create-button")).toContainText("Uploading…");

    // Should redirect to /timeline/:jobId
    await page.waitForURL(/\/timeline\/[^/]+$/, { timeout: 30_000 });

    // Should show loader while polling
    await expect(page.locator(".planner-title")).toContainText(
      "Preparing your academic plan",
    );

    // Wait for timeline to render (polling completes)
    await expect(page.locator(".timeline-main")).toBeVisible({
      timeout: 200_000,
    });

    // Verify data loaded — at least one semester should exist
    await expect(page.locator(".timeline-section")).toBeVisible();
  });

  test("rejects non-PDF files", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    // Listen for the alert
    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toContain("valid PDF");
      await dialog.accept();
    });

    await fileInput.setInputFiles({
      name: "fake.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a pdf"),
    });

    // Should remain in idle state
    await expect(page.locator(".drag-drop")).toContainText("Drag and Drop");
  });

  test("cancel removes selected file", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(PDF_PATH);

    await expect(page.locator(".file-chip-name")).toBeVisible();

    // Click remove
    await page.click(".file-chip-remove");

    // Should return to idle
    await expect(page.locator(".drag-drop")).toContainText("Drag and Drop");
  });
});

test.describe("Upload Performance", () => {
  const timings: { upload: number; poll: number; total: number }[] = [];

  for (let i = 0; i < PERF_ITERATIONS; i++) {
    test(`upload iteration ${i + 1}`, async ({ page }) => {
      const totalStart = Date.now();

      await page.goto(`${BASE_URL}/timeline`);

      // Upload
      const uploadStart = Date.now();
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(PDF_PATH);
      await page.click("text=Create Timeline");
      await page.waitForURL(/\/timeline\/[^/]+$/, { timeout: 30_000 });
      const uploadEnd = Date.now();

      // Poll until timeline renders
      const pollStart = Date.now();
      await expect(page.locator(".timeline-main")).toBeVisible({
        timeout: 200_000,
      });
      const pollEnd = Date.now();

      const timing = {
        upload: uploadEnd - uploadStart,
        poll: pollEnd - pollStart,
        total: Date.now() - totalStart,
      };
      timings.push(timing);

      console.log(
        `[Iteration ${i + 1}] Upload: ${timing.upload}ms | Poll: ${timing.poll}ms | Total: ${timing.total}ms`,
      );
    });
  }

  test.afterAll(() => {
    if (timings.length === 0) return;
    const avg = (arr: number[]) =>
      Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

    console.log("\n=== Performance Summary ===");
    console.log(`Iterations: ${timings.length}`);
    console.log(`Avg Upload: ${avg(timings.map((t) => t.upload))}ms`);
    console.log(`Avg Poll:   ${avg(timings.map((t) => t.poll))}ms`);
    console.log(`Avg Total:  ${avg(timings.map((t) => t.total))}ms`);
    console.log(
      `Min Total:  ${Math.min(...timings.map((t) => t.total))}ms`,
    );
    console.log(
      `Max Total:  ${Math.max(...timings.map((t) => t.total))}ms`,
    );
  });
});
