/** Map raw uppercased client names to their display group label. */
export function buildClientGroupMap(rawNames: Set<string>): Map<string, string> {
  const groupMap = new Map<string, string>();
  const underscoreBaseByName = new Map<string, string>();

  for (const name of rawNames) {
    const underIdx = name.indexOf('_');
    if (underIdx > 0) {
      underscoreBaseByName.set(name, name.slice(0, underIdx));
    }
  }

  for (const name of rawNames) {
    const base = underscoreBaseByName.get(name);
    if (base && rawNames.has(base)) {
      groupMap.set(name, base);
    } else {
      groupMap.set(name, name);
    }
  }
  return groupMap;
}

export function collectUppercasedClientNames(
  projects: Array<{ prj_client: string }>,
): Set<string> {
  const rawSet = new Set<string>();
  for (const project of projects) {
    rawSet.add(project.prj_client.toUpperCase());
  }
  return rawSet;
}
