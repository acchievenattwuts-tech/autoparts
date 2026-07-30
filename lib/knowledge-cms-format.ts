import { formatDateTimeThai } from "@/lib/th-date";

export function formatKnowledgeTimestamp(value: Date | string): string {
  return formatDateTimeThai(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
