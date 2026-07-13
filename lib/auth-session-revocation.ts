export type SessionRevisionState = {
  tokenVersion: unknown;
  currentVersion: number | null | undefined;
  isActive: boolean | null | undefined;
};

export function isSessionRevisionInvalid({
  tokenVersion,
  currentVersion,
  isActive,
}: SessionRevisionState): boolean {
  return (
    isActive !== true ||
    typeof tokenVersion !== "number" ||
    typeof currentVersion !== "number" ||
    tokenVersion !== currentVersion
  );
}
