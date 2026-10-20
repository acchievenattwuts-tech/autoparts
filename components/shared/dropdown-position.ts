const VIEWPORT_EDGE_GAP = 8;

/**
 * A dropdown list is pinned under its trigger's left edge with a minimum width,
 * so a trigger in the right column of a phone layout pushes the list past the
 * right edge of the screen. Shift it back inside (and narrow it only if the screen
 * itself is too narrow); a list that already fits keeps its position.
 */
export const fitDropdownToViewport = (
  left: number,
  width: number,
  viewportWidth: number,
): { left: number; width: number } => {
  const fittedWidth = Math.min(width, viewportWidth - VIEWPORT_EDGE_GAP * 2);
  const maxLeft = viewportWidth - fittedWidth - VIEWPORT_EDGE_GAP;
  const fittedLeft = left > maxLeft ? Math.max(VIEWPORT_EDGE_GAP, maxLeft) : left;
  return { left: fittedLeft, width: fittedWidth };
};

/** Excludes the vertical scrollbar, unlike `window.innerWidth`. */
export const readViewportWidth = (): number => document.documentElement.clientWidth;
