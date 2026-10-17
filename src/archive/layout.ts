import path from "node:path"
import type { Lane } from "./types.ts"

export function laneOf(directory: string, projectRoot: string): Lane {
  if (directory === projectRoot) return { kind: "root", path: "" }
  const rel = path.relative(projectRoot, directory)
  if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return { kind: "nested", path: rel }
  }
  return { kind: "external", path: directory }
}

/** Session directory relative to the archive dir. */
export function sessionRelDir(parentRelDir: string | null, id: string): string {
  if (parentRelDir === null) return path.join("sessions", id)
  return path.join(parentRelDir, "subagents", id)
}
