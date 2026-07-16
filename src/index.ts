import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import Anthropic from "@anthropic-ai/sdk";

// Stage 1 — Chat loop
// An interactive REPL that remembers the conversation and streams replies
// token-by-token.
//   npm run dev
// Type your message and press Enter. Type "exit" or "quit" (or Ctrl+C) to leave.

const client = new Anthropic({
  // reads ANTHROPIC_API_KEY from the environment.
  // maxRetries: the SDK automatically retries transient failures (429 rate
  // limits, 5xx, and 529 "overloaded") with exponential backoff. Default is 2;
  // we bump it to ride out short capacity blips like the 529 we saw in Stage 0.
  maxRetries: 5,
});

const SYSTEM_PROMPT =
  "You are a concise, friendly CLI assistant. Keep answers short unless asked for detail.";

// Model is env-configurable so you can switch without editing code:
//   MODEL=claude-haiku-4-5 npm run dev
const MODEL = process.env.MODEL ?? "claude-sonnet-5";

// The conversation history. The API is stateless — we must send the FULL
// history on every request, which is how the model "remembers" earlier turns.
const messages: Anthropic.MessageParam[] = [];

const rl = readline.createInterface({ input: stdin, output: stdout });

console.log('Chat started. Type "exit" or "quit" to leave.\n');

while (true) {
  const userInput = (await rl.question("You: ")).trim();

  if (userInput === "") continue;
  if (userInput === "exit" || userInput === "quit") break;

  // Record the user's turn.
  messages.push({ role: "user", content: userInput });

  // Stream the assistant's reply so tokens print as they arrive.
  stdout.write("\nClaude: ");
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
    });

    // The "text" event fires for each chunk of text the model produces.
    stream.on("text", (delta) => stdout.write(delta));

    // finalMessage() waits for the stream to finish and returns the complete
    // Message — the same shape Stage 0 returned from create().
    const final = await stream.finalMessage();

    // Pull the assistant's text out and record its turn, so the next request
    // includes this reply in the history.
    const assistantText = final.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    messages.push({ role: "assistant", content: assistantText });

    stdout.write("\n\n");
  } catch (err) {
    // Drop the user turn we just added so the history stays consistent and the
    // message can be retried cleanly on the next prompt.
    messages.pop();
    if (err instanceof Anthropic.APIError && err.status === 529) {
      stdout.write(
        "\n[Claude is overloaded right now (529) — a temporary Anthropic-side capacity issue. Your message wasn't sent; try again in a moment.]\n\n",
      );
    } else {
      const detail = err instanceof Error ? err.message : String(err);
      stdout.write(`\n[Request failed: ${detail} — try again.]\n\n`);
    }
  }
}

rl.close();
console.log("Bye!");
