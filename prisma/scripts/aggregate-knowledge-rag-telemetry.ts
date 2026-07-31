import { readFile } from "node:fs/promises";
import {
  aggregateKnowledgeRagTelemetry,
  parseKnowledgeRagTelemetryLine,
} from "../../lib/knowledge-rag-telemetry";

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value?.slice(prefix.length).trim() || null;
}

async function main(): Promise<void> {
  const inputPath = argument("input");
  if (!inputPath) {
    throw new Error(
      "ระบุไฟล์ log ด้วย --input=<path> (รองรับบรรทัด [knowledge-rag] JSON และไม่ส่งออก query hash รายตัว)",
    );
  }
  const raw = await readFile(inputPath, "utf8");
  const events = raw
    .split(/\r?\n/)
    .map(parseKnowledgeRagTelemetryLine)
    .filter((event) => event !== null);
  const summary = aggregateKnowledgeRagTelemetry(events);
  console.log(
    JSON.stringify(
      {
        privacy: "aggregate-only; no question, answer, customer id or individual query hash",
        ...summary,
      },
      null,
      2,
    ),
  );
  if (events.length === 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
