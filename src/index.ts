import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

// Stage 0 — Hello Claude
// A one-shot CLI: pass a question as arguments, get one answer back.
//   npm run dev -- "What is an AI agent, in one sentence?"

const client = new Anthropic({
  // reads ANTHROPIC_API_KEY from the environment.
  // maxRetries: the SDK automatically retries transient failures (429 rate
  // limits, 5xx, and 529 "overloaded") with exponential backoff. Default is 2;
  // we bump it to ride out short capacity blips like the 529 we just saw.
  maxRetries: 5,
});

// Everything after `npm run dev --` lands in process.argv from index 2 onward.
const question = process.argv.slice(2).join(" ").trim();

if (!question) {
  console.error('Usage: npm run dev -- "your question here"');
  process.exit(1);
}

const response = await client.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: question }],
});

// The response content is a list of blocks; print the text ones.
for (const block of response.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}
