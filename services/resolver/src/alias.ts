export type AliasExistsResult = 'match' | 'maybe_needs_suffix' | 'not_found';

export function evaluateAliasExists(hasExact: boolean, hasBase: boolean, hasSuffixed: boolean, suffixProvided: boolean): AliasExistsResult {
  if (suffixProvided) return hasExact ? 'match' : 'not_found';
  if (hasBase) return 'match';
  return hasSuffixed ? 'maybe_needs_suffix' : 'not_found';
}
