// A group summary must not make its newest check look like every listing's date.
export function sourceCheckRange(values) {
  const dates = values.filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value || "")).sort();
  if (!dates.length) return "Date not recorded";
  return dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} to ${dates.at(-1)}`;
}
