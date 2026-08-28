export type GithubBackupProgressStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "UNKNOWN";

export type GithubWorkflowStep = {
  name: string;
  status: string | null;
  conclusion: string | null;
};

export type GithubBackupProgress = {
  percent: number;
  stage: number;
  totalStages: number;
  label: string;
  isIndeterminate: boolean;
  startedAt: string | null;
};

const TOTAL_STAGES = 7;

const STAGES = [
  { stage: 1, activePercent: 5, completedPercent: 15, label: "เตรียม GitHub runner" },
  { stage: 2, activePercent: 20, completedPercent: 30, label: "ตรวจสิทธิ์และสำรองฐานข้อมูล PostgreSQL" },
  { stage: 3, activePercent: 35, completedPercent: 50, label: "รวบรวมรายการและไฟล์รูป" },
  { stage: 4, activePercent: 53, completedPercent: 55, label: "สร้างรายงาน backup" },
  { stage: 5, activePercent: 60, completedPercent: 90, label: "อัปโหลดและตรวจไฟล์บน Google Drive" },
  { stage: 6, activePercent: 93, completedPercent: 95, label: "จัดการอายุการเก็บ backup" },
  { stage: 7, activePercent: 97, completedPercent: 99, label: "สรุปผลและแจ้งเตือน" },
] as const;

const resolveStage = (stepName: string): (typeof STAGES)[number] => {
  const name = stepName.toLowerCase();
  if (name.includes("notify telegram") || name.includes("complete job") || name.includes("post run")) return STAGES[6];
  if (name.includes("apply retention")) return STAGES[5];
  if (name.includes("upload to google drive")) return STAGES[4];
  if (name.includes("write report")) return STAGES[3];
  if (name.includes("fetch previous blob index") || name.includes("sync vercel blob")) return STAGES[2];
  if (name.includes("guard against rls") || name.includes("dump postgresql")) return STAGES[1];
  return STAGES[0];
};

const isPendingStep = (step: GithubWorkflowStep): boolean =>
  step.status === "queued" || step.status === "pending" || step.status === "waiting";

const isFailedStep = (step: GithubWorkflowStep): boolean =>
  Boolean(step.conclusion && step.conclusion !== "success" && step.conclusion !== "skipped");

export const deriveGithubBackupProgress = (
  runStatus: GithubBackupProgressStatus,
  steps: GithubWorkflowStep[],
  startedAt: string | null,
): GithubBackupProgress => {
  if (runStatus === "SUCCESS") {
    return {
      percent: 100,
      stage: TOTAL_STAGES,
      totalStages: TOTAL_STAGES,
      label: "สำรองข้อมูลสำเร็จ",
      isIndeterminate: false,
      startedAt,
    };
  }

  if (runStatus === "QUEUED") {
    return {
      percent: 0,
      stage: 0,
      totalStages: TOTAL_STAGES,
      label: "รอ GitHub เริ่มงาน",
      isIndeterminate: true,
      startedAt,
    };
  }

  const failedStep = steps.find(isFailedStep);
  const activeStep = steps.find((step) => step.status === "in_progress")
    ?? steps.find(isPendingStep);
  const lastCompletedStep = [...steps]
    .reverse()
    .find((step) => step.status === "completed" && step.conclusion !== "skipped");
  const focusStep = failedStep ?? activeStep ?? lastCompletedStep;

  if (!focusStep) {
    return {
      percent: runStatus === "FAILED" || runStatus === "CANCELLED" ? 0 : 5,
      stage: runStatus === "FAILED" || runStatus === "CANCELLED" ? 0 : 1,
      totalStages: TOTAL_STAGES,
      label: runStatus === "FAILED" ? "Backup ล้มเหลว" : runStatus === "CANCELLED" ? "Backup ถูกยกเลิก" : "กำลังเริ่มงานบน GitHub",
      isIndeterminate: runStatus === "RUNNING" || runStatus === "UNKNOWN",
      startedAt,
    };
  }

  const stage = resolveStage(focusStep.name);
  const failed = Boolean(failedStep) || runStatus === "FAILED" || runStatus === "CANCELLED";
  const completed = focusStep.status === "completed" && !failed;

  return {
    percent: completed ? stage.completedPercent : stage.activePercent,
    stage: stage.stage,
    totalStages: TOTAL_STAGES,
    label: failed
      ? `${runStatus === "CANCELLED" ? "ถูกยกเลิก" : "ผิดพลาด"}ระหว่าง${stage.label}`
      : stage.label,
    isIndeterminate: !failed && (runStatus === "RUNNING" || runStatus === "UNKNOWN"),
    startedAt,
  };
};
