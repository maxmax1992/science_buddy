import { readFile } from "node:fs/promises";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";

// 2-page fixture with selectable text (one Claude transcription call, cached in .e2e/data).
const FIXTURE = "tests/fixtures/attention-note.pdf";
const PASSAGE = "Scaling by the square root of the key dimension keeps the softmax from saturating.";

async function seedPaper(baseUrl: string): Promise<string> {
  const body = new FormData();
  body.set("file", new File([await readFile(FIXTURE)], "attention-note.pdf", { type: "application/pdf" }));
  const res = await fetch(new URL("/api/papers", baseUrl), { method: "POST", body });
  expect(res.status).toBe(200);
  return (await res.json()).id; // content-addressed: re-uploading is a no-op
}

test("add-paper dialog rejects input that is not a paper", async ({ app, screen }) => {
  await app.open("/");
  await screen.getByRole("button", "Add paper").tap();
  const dialog = screen.getByRole("dialog");
  await dialog.getByLabel("arXiv id or link").fill("definitely not a paper");
  await dialog.getByRole("button", "Add paper").tap();
  await expect(dialog.getByText(/Use an arXiv id like/)).toBeVisible();
});

test(
  "highlight → ask → streamed answer stays pinned as an underline",
  { timeout: 360_000, tags: ["claude"] },
  async ({ app, screen, browser, agent }) => {
    const id = await seedPaper(app.baseUrl!);
    await app.open(`/#${id}`);
    await expect(browser.locator(".react-pdf__Page .textLayer span").first()).toBeVisible({ timeout: 30_000 });

    // Select one line of the introduction the way a user's drag would, then release the mouse over it.
    await browser.evaluate((passage) => {
      const span = [...document.querySelectorAll(".textLayer span")].find((s) => s.textContent?.trim() === passage);
      if (!span?.firstChild) throw new Error("passage not in the text layer");
      span.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.selectNodeContents(span);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      const b = span.getBoundingClientRect();
      span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: b.right, clientY: b.bottom }));
      return true;
    }, PASSAGE);

    await screen.getByRole("button", "Explain").tap();
    await expect(browser.locator(".sb-mark").first()).toBeVisible();
    await expect(screen.getByPlaceholder("Ask a follow-up…")).toBeVisible();

    // Claude reads the paper with tools, then streams; the copy action appears when the answer is complete.
    await expect(screen.getByRole("button", "Copy").first()).toBeVisible({ timeout: 300_000 });
    await agent.assert("the side panel explains why attention scores are scaled by the square root of the key dimension");

    // Fresh load: the underline is still there and clicking it reopens the same conversation.
    await app.open(`/#${id}`);
    await expect(screen.getByText("Questions on this paper")).toBeVisible({ timeout: 30_000 });
    const mark = browser.locator(".sb-mark").last();
    await mark.scrollIntoView();
    const box = await mark.boundingBox();
    if (!box) throw new Error("underline has no box");
    await screen.tapAt({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect(screen.getByPlaceholder("Ask a follow-up…")).toBeVisible();
    await expect(screen.getByText(/keeps the softmax from saturating/).first()).toBeVisible();
  },
);

test("follow-up question through the agent", { timeout: 360_000, tags: ["claude"] }, async ({ app, screen, agent }) => {
  const id = await seedPaper(app.baseUrl!);
  await app.open(`/#${id}`);
  await agent.act("in the 'Questions on this paper' list on the right, open the question 'Explain this passage.'");
  const followUp = screen.getByPlaceholder("Ask a follow-up…");
  await expect(followUp).toBeVisible(); // pins the act's outcome so the replay cache records it
  // Exact text goes through screen: as an agent step its end state holds Claude's live answer and never replays.
  await followUp.fill("What is d_k, in one sentence?");
  await followUp.press("Enter");
  await expect(screen.getByText("What is d_k, in one sentence?").last()).toBeVisible(); // earlier runs may have asked it too
  // npm run test:e2e starts from an empty library: the "Explain" answer plus this follow-up's answer.
  await expect(screen.getByRole("button", "Read aloud")).toHaveCount(2, { timeout: 300_000 });
});

test("opening an unknown paper id is a 404 and leaves the library intact", async ({ app }) => {
  const missing = await fetch(new URL("/api/papers/000000000000", app.baseUrl));
  expect(missing.status).toBe(404);
  const list = await fetch(new URL("/api/papers", app.baseUrl));
  expect(list.status).toBe(200);
});

test("local voice: Kokoro speech round-trips through Parakeet", { tags: ["voice"] }, async ({ app }) => {
  const tts = await fetch(new URL("/api/voice/tts", app.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "What does the Born rule say about the amplitudes?" }),
  });
  expect(tts.status).toBe(200);
  const asr = await fetch(new URL("/api/voice/asr", app.baseUrl), { method: "POST", body: await tts.arrayBuffer() });
  expect(asr.status).toBe(200);
  expect((await asr.json()).text.toLowerCase()).toContain("born rule");
});
