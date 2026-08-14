/** Read-only rollout report for MODEL_GROUNDING_SHADOW telemetry. */
import { db } from "@/lib/db";

type ShadowPayload = {
  channel?: "line" | "messenger";
  evaluated?: boolean;
  rawModel?: string | null;
  candidateModel?: string | null;
  wouldChange?: boolean;
  evidenceSource?: string;
  downstreamFrameModel?: string | null;
  downstreamResolvedModel?: string | null;
};

const MIN_SAMPLE_PER_CHANNEL = 200;

async function run(): Promise<void> {
  const rows = await db.lineAiAuditLog.findMany({
    where: { action: "MODEL_GROUNDING_SHADOW" },
    select: { payload: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`MODEL_GROUNDING_SHADOW: ${rows.length} events`);
  if (rows.length === 0) {
    console.log("ยังไม่มีข้อมูลหลัง deploy — production behavior ยังเป็น baseline เดิม");
    return;
  }

  for (const channel of ["line", "messenger"] as const) {
    const items = rows
      .map((row) => ({ ...((row.payload ?? {}) as ShadowPayload), createdAt: row.createdAt }))
      .filter((row) => row.channel === channel);
    const evaluated = items.filter((row) => row.evaluated === true);
    const unavailable = items.filter((row) => row.evidenceSource === "LOOKUP_UNAVAILABLE");
    const changes = evaluated.filter((row) => row.wouldChange === true);
    const candidateDrops = evaluated.filter((row) => !row.candidateModel);
    const dangerousCarry = candidateDrops.filter(
      (row) =>
        row.downstreamFrameModel &&
        row.rawModel &&
        row.downstreamFrameModel.toLowerCase() !== row.rawModel.toLowerCase(),
    );
    const sources = new Map<string, number>();
    for (const row of items) {
      const key = row.evidenceSource ?? "UNKNOWN";
      sources.set(key, (sources.get(key) ?? 0) + 1);
    }

    console.log(`\n${channel.toUpperCase()}`);
    console.log(`  events=${items.length} evaluated=${evaluated.length} wouldChange=${changes.length}`);
    console.log(`  candidateDrop=${candidateDrops.length} lookupUnavailable=${unavailable.length}`);
    if (channel === "line") console.log(`  different-model frame carry risk=${dangerousCarry.length}`);
    console.log(`  evidence=${Array.from(sources).map(([key, count]) => `${key}:${count}`).join(" ")}`);
    console.log(
      `  sample gate=${items.length >= MIN_SAMPLE_PER_CHANNEL ? "PASS" : `WAIT (${items.length}/${MIN_SAMPLE_PER_CHANNEL})`}`,
    );
    console.log(`  availability gate=${unavailable.length === 0 ? "PASS" : "FAIL"}`);
    if (channel === "line") console.log(`  frame-safety gate=${dangerousCarry.length === 0 ? "PASS" : "FAIL"}`);
  }

  console.log(
    "\nหมายเหตุ: ต้อง review candidate DROP จากข้อความต้นทางก่อน rollout; report นี้ไม่อนุมัติ flip อัตโนมัติ",
  );
}

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
