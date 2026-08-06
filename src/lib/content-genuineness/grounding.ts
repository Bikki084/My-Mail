/**
 * Lightweight check: rewrite should not introduce high-signal claim words absent from sources.
 */
export function rewriteIntroducesUngroundedClaims(
  rewritePlain: string,
  sourcesPlain: string,
): boolean {
  const claimWords =
    rewritePlain
      .toLowerCase()
      .match(
        /\b(free|winner|prize|guaranteed|urgent|limited|discount|%\s*off|crypto|bitcoin|viagra|casino|lottery|wire transfer|act now)\b/g,
      ) ?? [];
  if (claimWords.length === 0) return false;
  const source = sourcesPlain.toLowerCase();
  return claimWords.some((w) => !source.includes(w));
}
