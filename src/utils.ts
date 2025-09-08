export function patch(old: number[], diff: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < diff.length) {
    if (diff[i]) {
      out.push(...old.slice(out.length, out.length + diff[i]));
    }
    i++;
    if (i < diff.length && diff[i]) {
      out.push(...diff.slice(i + 1, i + 1 + diff[i]));
      i += diff[i];
    }
    i++;
  }
  return out;
}

export function getAdjacentIndices(index: number, width: number, height: number): number[] {
  const row = Math.floor(index / width);
  const col = index % width;
  const adjacent: number[] = [];

  if (col > 0) adjacent.push(index - 1);
  if (col < width - 1) adjacent.push(index + 1);
  if (row > 0) adjacent.push(index - width);
  if (row < height - 1) adjacent.push(index + width);

  return adjacent;
}
