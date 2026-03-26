export function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // increment along the first column of each row
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // increment each column in the first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

export function didYouMean(target: string, candidates: Iterable<string>): string {
  const c = Array.from(candidates);
  if (c.length === 0) return "";
  
  // Calculate distance, sort to find top matches
  const scored = c.map(word => {
     // Optional: compare based on last segment for dot-separated IDs,
     // but the ticket says "unknown context paymnts", so exact is fine.
     return {
       word,
       distance: levenshtein(target.toLowerCase(), word.toLowerCase())
     }
  });
  
  scored.sort((a, b) => a.distance - b.distance);
  
  // Filter for 'reasonable' confidence. Rule of thumb: distance should be <= 3 and <= 40% of length
  const threshold = Math.min(3, Math.max(1, Math.floor(target.length * 0.4)));
  const valid = scored.filter(s => s.distance <= threshold).slice(0, 3);
  
  if (valid.length === 0) return "";
  return ` Did you mean ${valid.map(v => `"${v.word}"`).join(" or ")}?`;
}
