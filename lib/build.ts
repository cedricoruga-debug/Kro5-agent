// Which deploy a page or response came from. A page left open across a deploy keeps running the old
// app code against the new server, so the app reloads itself when the two stop matching.
export const BUILD = process.env.KRO5_BUILD ?? "dev";
export const BUILD_HEADER = "X-KRO5-Build";

export function isStale(res: Response): boolean {
  const build = res.headers.get(BUILD_HEADER);
  return Boolean(build) && build !== BUILD;
}
