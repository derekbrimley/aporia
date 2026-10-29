import { getScenario as load } from "@rematter/scenario";
export function getScenario(id: string, version?: string) {
  return load(id, version);
}
