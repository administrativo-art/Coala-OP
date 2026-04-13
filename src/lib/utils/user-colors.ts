/**
 * User color system — automatically assigns maximally distinct colors.
 *
 * Palette: 12 colors spread 30° apart on the hue wheel, ordered so that
 * the first N users always get the most visually distinct set:
 *   user 1 → red (0°), user 2 → cyan (180°), user 3 → lime (90°),
 *   user 4 → violet (270°) … pairs of complementary hues.
 */
export const USER_COLOR_PALETTE: string[] = [
  '#dc2626', // red      0°
  '#0891b2', // cyan     180°
  '#65a30d', // lime     90°
  '#7c3aed', // violet   270°
  '#ea580c', // orange   30°
  '#2563eb', // blue     210°
  '#16a34a', // green    120°
  '#c026d3', // fuchsia  300°
  '#ca8a04', // amber    60°
  '#0f766e', // teal     150°
  '#4338ca', // indigo   240°
  '#db2777', // pink     330°
];

/**
 * Pick the next available color for a new user.
 * Iterates the palette in order; if all are taken, returns the least-used one.
 */
export function pickUserColor(usedColors: (string | undefined)[]): string {
  const used = new Set(usedColors.filter(Boolean) as string[]);
  const available = USER_COLOR_PALETTE.find(c => !used.has(c));
  if (available) return available;

  // All colors taken — pick the least-used one
  const counts = new Map(USER_COLOR_PALETTE.map(c => [c, 0]));
  usedColors.forEach(c => {
    if (c && counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  });
  return [...counts.entries()].sort(([, a], [, b]) => a - b)[0][0];
}

/**
 * Get the display color for a user.
 * Uses the stored color if available; otherwise derives one deterministically
 * from the user ID (consistent across sessions, no Firestore write needed).
 */
export function getUserColor(userId: string, storedColor?: string): string {
  if (storedColor) return storedColor;
  let hash = 0;
  for (const ch of userId) {
    hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  }
  return USER_COLOR_PALETTE[Math.abs(hash) % USER_COLOR_PALETTE.length];
}
