import { readFileSync } from "fs";
import { join } from "path";
import Changelog from "@/components/Changelog";
import { parseChangelog, type ChangelogEntry } from "@/lib/changelog";

function loadChangelog(): ChangelogEntry[] {
  try {
    const raw = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf-8");
    return parseChangelog(raw);
  } catch {
    return [];
  }
}

export default function ChangelogPage() {
  return <Changelog entries={loadChangelog()} />;
}
