import { generateText, Output, type ModelMessage } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import type {
  ExecutorObservation,
  StepExecutor,
  StepExecutorContext,
  StepVerdict,
} from "e2e";
import { z } from "zod";

// e2e's built-in agent needs tool-calling API models; Claude subscriptions only reach Claude Code.
// So this executor runs the loop itself: observe → Claude picks ONE action (structured output) → act → repeat.

// Haiku picks clicks fast; Sonnet judges assertions, where accuracy matters more than latency.
const ACT_MODEL = process.env.E2E_ACT_MODEL ?? "haiku";
const JUDGE_MODEL = process.env.E2E_JUDGE_MODEL ?? "sonnet";
const MAX_TURNS = 15;

const SYSTEM = `You drive a web app inside an end-to-end test. Each turn you get the goal, what you already did, the current screen as one node per line ("#id role "name" ..."), and usually a screenshot.
First check whether the goal is ALREADY achieved on the current screen; if so set done=true, success=true, action "none".
Otherwise pick exactly ONE next action on a node id from the CURRENT screen. Set done=true with success=false only when the goal clearly cannot be achieved. Never invent ids, and don't wander into unrelated parts of the app.`;

// Pages like a 60-page PDF put thousands of plain-text nodes on screen. Past this size, send only what can be acted on
// (plus landmarks/headings for orientation); the screenshot still shows the content.
const MAX_SCREEN_CHARS = 20_000;
const ACTIONABLE =
  /^\s*#\S+ (button|link|textbox|searchbox|combobox|checkbox|radio|radiogroup|switch|slider|tab|tablist|menuitem\w*|option|listitem|dialog|alert|status|complementary|region|navigation|main|form|banner)\b/;
const compact = (text: string) =>
  text.length <= MAX_SCREEN_CHARS
    ? text
    : `${text
        .split("\n")
        .filter((line, i) => i < 6 || ACTIONABLE.test(line))
        .join("\n")
        .slice(
          0,
          MAX_SCREEN_CHARS,
        )}\n(plain text nodes omitted — see the screenshot)`;

const Decision = z.object({
  done: z.boolean(),
  success: z.boolean().describe("Only meaningful when done"),
  action: z.enum(["tap", "type", "press", "scroll_down", "scroll_up", "none"]),
  id: z.string().describe("Target node id without '#', or empty"),
  text: z
    .string()
    .describe(
      "Text to type for 'type', key name (e.g. Enter, Escape) for 'press', else empty",
    ),
  summary: z
    .string()
    .describe("One sentence: what you are doing and why, or the final outcome"),
});

const Judgment = z.object({
  pass: z.boolean(),
  summary: z
    .string()
    .describe("One sentence citing what on screen supports the verdict"),
});

const model = (id: string) =>
  claudeCode(id, {
    systemPrompt: SYSTEM,
    tools: [],
    permissionPrompts: "none",
    persistSession: false,
  });

async function ask<T>(
  ctx: StepExecutorContext,
  modelId: string,
  schema: z.ZodType<T>,
  prompt: string,
  screen: ExecutorObservation,
) {
  const content: Extract<ModelMessage, { role: "user" }>["content"] = [
    {
      type: "text",
      text: `${prompt}\n\nCurrent screen (${screen.path ?? ""}):\n${compact(screen.text)}`,
    },
  ];
  if (screen.pixels)
    content.push({
      type: "file",
      mediaType: "image/png",
      data: {
        type: "data",
        data: Buffer.from(screen.pixels.data).toString("base64"),
      },
    });
  const { output, usage } = await generateText({
    model: model(modelId),
    output: Output.object({ schema }),
    messages: [{ role: "user", content }],
    abortSignal: ctx.attempt.signal,
  });
  ctx.budgets.recordModelCall({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  return output;
}

export const claudeExecutor: StepExecutor = {
  name: "claude-subscription",
  version: "1",
  async runStep(ctx) {
    const { kind, instruction, params } = ctx.step;
    const goal = params
      ? `${instruction}\nParameters: ${JSON.stringify(params)}`
      : instruction;

    if (kind === "assert") {
      const screen = await ctx.observe({ pixels: true });
      const verdict = await ask(
        ctx,
        JUDGE_MODEL,
        Judgment,
        `Judge this assertion about the screen: ${goal}`,
        screen,
      );
      return {
        status: verdict.pass ? "passed" : "failed",
        summary: verdict.summary,
        errorCode: verdict.pass ? undefined : "ASSERTION_FAILED",
      };
    }

    const history: string[] = [];
    try {
      return await loop();
    } finally {
      ctx.attachTranscript(`Goal: ${goal}\n${history.join("\n")}`); // shows up in the report for failed/slow steps
    }

    async function loop(): Promise<StepVerdict> {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const screen = await ctx.observe({ pixels: true });
        const d = await ask(
          ctx,
          ACT_MODEL,
          Decision,
          `Goal: ${goal}\n\nDone so far:\n${history.join("\n") || "(nothing yet)"}`,
          screen,
        );
        if (d.done) {
          history.push(
            `done (${d.success ? "success" : "failure"}): ${d.summary}`,
          );
          return {
            status: d.success ? "passed" : "failed",
            summary: d.summary,
          };
        }
        const target = { id: d.id.replace(/^#/, "") };
        try {
          if (d.action === "tap") await ctx.actions.tap(target);
          else if (d.action === "type") await ctx.actions.type(target, d.text);
          else if (d.action === "press")
            await (d.id
              ? ctx.actions.press(target, d.text)
              : ctx.actions.pressKey(d.text));
          else if (d.action === "scroll_down" || d.action === "scroll_up")
            await ctx.actions.scroll(
              d.action === "scroll_down" ? "down" : "up",
            );
          history.push(
            `${turn + 1}. ${d.action} #${target.id}${d.text ? ` "${d.text}"` : ""}: ${d.summary}`,
          );
        } catch (e) {
          history.push(
            `${turn + 1}. FAILED (${d.action} #${target.id}): ${(e as Error).message}`,
          );
        }
      }
      return {
        status: "blocked",
        errorCode: "STEP_BUDGET_EXHAUSTED",
        summary: `No conclusion after ${MAX_TURNS} actions:\n${history.join("\n")}`,
      };
    }
  },
};
