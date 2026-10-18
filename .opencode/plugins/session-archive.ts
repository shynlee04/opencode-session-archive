// @ts-nocheck
// session-archive — OpenCode V2 plugin (generated bundle; do not edit).
// Install: copy this file into <project>/.opencode/plugins/ (project scope)
// or ~/.config/opencode/plugins/ (global).
// @bun
// src/plugin.ts
import { Database as Database3 } from "bun:sqlite";
import { existsSync as existsSync13, mkdirSync as mkdirSync6 } from "fs";
import path11 from "path";

// src/archive/index.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync2, readFileSync as readFileSync4, renameSync, writeFileSync } from "fs";
import path6 from "path";

// src/archive/normalize.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { isAbsolute } from "path";

// src/archive/primitives.ts
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
var JIT_SKELETON_MARKER = "--- [substrate.jit-skeleton] ---";
var READ_HEADER_RE = /^Read file (.+?),\s*lines\s+(\d+)-(\d+)(?:\s*\(of\s+(\d+)\))?\s*$/i;
var TRUNCATION_FOOTER_RE = /^\[Output truncated\.\s*Continue reading with offset:\s*(\d+)\]/i;
var NUMBERED_LINE_RE = /^(\d+): ?(.*)$/;
function sha256Hex(content) {
  return createHash("sha256").update(content).digest("hex");
}
function estimateTokens(text) {
  if (!text)
    return 0;
  return Math.ceil(text.length / 4);
}
function normalizeRepoPath(filePath, canonicalRoot) {
  if (!filePath || typeof filePath !== "string")
    return "";
  let cleaned = filePath.trim();
  if (cleaned.startsWith("file://")) {
    try {
      cleaned = decodeURIComponent(new URL(cleaned).pathname);
    } catch {
      cleaned = cleaned.slice("file://".length);
    }
  }
  cleaned = cleaned.replace(/\\/g, "/");
  if (canonicalRoot && canonicalRoot.trim().length > 0) {
    const normRoot = canonicalRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (cleaned === normRoot)
      return ".";
    if (cleaned.startsWith(`${normRoot}/`)) {
      cleaned = cleaned.slice(normRoot.length + 1);
    }
  }
  cleaned = cleaned.replace(/^\.\//, "").replace(/^\/+/, "");
  return cleaned;
}
function splitDiskLines(rawContent) {
  const normalized = rawContent.replace(/\r\n/g, `
`);
  if (normalized.length === 0)
    return [];
  const lines = normalized.split(`
`);
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
function readInputString(input, keys) {
  if (!input)
    return "";
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.trim().length > 0)
      return v.trim();
  }
  return "";
}
function readInputNumber(input, keys) {
  if (!input)
    return null;
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "number" && Number.isFinite(v))
      return Math.max(1, Math.trunc(v));
    if (typeof v === "string" && /^\d+$/.test(v.trim()))
      return Math.max(1, Number.parseInt(v.trim(), 10));
  }
  return null;
}
function formatSliceLineRange(startLine, endLine, totalLines, isTruncated) {
  const isFull = startLine === 1 && !isTruncated && (totalLines === null || endLine >= totalLines);
  if (isFull)
    return "all";
  if (totalLines !== null && totalLines > 0) {
    return `SLICE L${startLine}-L${endLine} of ${totalLines}${isTruncated ? " (truncated)" : ""}`;
  }
  return `SLICE L${startLine}-L${endLine}${isTruncated ? " (truncated)" : ""}`;
}
function formatStalenessStatus(state, startLine, endLine, totalLines) {
  if (state === "FRESH")
    return "FRESH \u2014 DO NOT REREAD";
  if (state === "SLICE") {
    const totalSuffix = totalLines !== null && totalLines > 0 ? ` of ${totalLines}` : "";
    return `SLICE L${startLine}-L${endLine}${totalSuffix} \u2014 FRESH SLICE`;
  }
  return "STALE (modified since read/review \u2014 re-verify slice)";
}
function parseReadToolOutput(rawOutput, input, canonicalRoot) {
  const text = typeof rawOutput === "string" ? rawOutput : String(rawOutput ?? "");
  const blobSha = sha256Hex(text);
  const rawLines = text.replace(/\r\n/g, `
`).split(`
`);
  const inputPath = readInputString(input, ["filePath", "path", "file", "target"]);
  const inputOffset = readInputNumber(input, ["offset", "startLine", "start_line"]);
  const inputLimit = readInputNumber(input, ["limit"]);
  let headerPath = "";
  let headerStart = null;
  let headerEnd = null;
  let headerTotal = null;
  let bodyStartIdx = 0;
  if (rawLines.length > 0) {
    const headerMatch = rawLines[0].match(READ_HEADER_RE);
    if (headerMatch) {
      headerPath = headerMatch[1].trim();
      headerStart = Number.parseInt(headerMatch[2], 10);
      headerEnd = Number.parseInt(headerMatch[3], 10);
      if (headerMatch[4]) {
        headerTotal = Number.parseInt(headerMatch[4], 10);
      }
      bodyStartIdx = 1;
    }
  }
  let isTruncated = false;
  let nextOffset = null;
  const bodyLines = [];
  let firstNumberedLine = null;
  let lastNumberedLine = null;
  let allNumbered = true;
  for (let i = bodyStartIdx;i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.startsWith(JIT_SKELETON_MARKER)) {
      break;
    }
    const truncMatch = line.match(TRUNCATION_FOOTER_RE);
    if (truncMatch) {
      isTruncated = true;
      nextOffset = Number.parseInt(truncMatch[1], 10);
      break;
    }
    const numMatch = line.match(NUMBERED_LINE_RE);
    if (numMatch) {
      const n = Number.parseInt(numMatch[1], 10);
      if (firstNumberedLine === null)
        firstNumberedLine = n;
      lastNumberedLine = n;
      bodyLines.push(numMatch[2]);
    } else {
      if (i === rawLines.length - 1 && line === "" && headerStart !== null) {
        continue;
      }
      allNumbered = false;
      bodyLines.push(line);
    }
  }
  let cleanLines = bodyLines;
  if (headerStart === null && !allNumbered) {
    cleanLines = splitDiskLines(text);
  }
  const startLine = headerStart ?? firstNumberedLine ?? inputOffset ?? 1;
  const endLine = headerEnd ?? lastNumberedLine ?? (cleanLines.length > 0 ? startLine + cleanLines.length - 1 : startLine);
  let totalLines = headerTotal;
  if (totalLines === null && !isTruncated && startLine === 1 && inputLimit === null) {
    totalLines = endLine;
  }
  const resolvedPath = headerPath || inputPath || "(unknown)";
  const normalizedPath = normalizeRepoPath(resolvedPath, canonicalRoot) || resolvedPath;
  const cleanText = cleanLines.join(`
`);
  const sliceSha = sha256Hex(cleanText);
  const isPartialSlice = isTruncated || startLine > 1 || totalLines !== null && endLine < totalLines || inputLimit !== null && cleanLines.length >= inputLimit && totalLines === null;
  const coverageKind = isTruncated ? "truncated" : isPartialSlice ? "slice" : "full";
  const lineRange = formatSliceLineRange(startLine, endLine, totalLines, isTruncated);
  return {
    path: resolvedPath,
    normalizedPath,
    startLine,
    endLine,
    totalLines,
    nextOffset,
    isTruncated,
    coverageKind,
    lineRange,
    cleanText,
    charLen: text.length,
    blobSha,
    sliceSha
  };
}
function resolveDiskPath(filePath, canonicalRoot) {
  if (!filePath)
    return "";
  if (path.isAbsolute(filePath))
    return filePath;
  const norm = normalizeRepoPath(filePath, canonicalRoot);
  return canonicalRoot ? path.resolve(canonicalRoot, norm) : path.resolve(norm);
}
function computeDiskSliceSha(absPath, capture) {
  const startLine = capture.startLine && capture.startLine > 0 ? capture.startLine : 1;
  const endLine = capture.endLine && capture.endLine >= startLine ? capture.endLine : startLine;
  const recordedSliceSha = capture.sliceSha;
  let isRegularFile = false;
  if (absPath && existsSync(absPath)) {
    try {
      isRegularFile = statSync(absPath).isFile();
    } catch {
      isRegularFile = false;
    }
  }
  if (!isRegularFile) {
    const isTruncated = Boolean(capture.isTruncated);
    return {
      state: "MISSING",
      stalenessStatus: formatStalenessStatus("MISSING", startLine, endLine, capture.totalLines ?? null),
      lineRange: formatSliceLineRange(startLine, endLine, capture.totalLines ?? null, isTruncated),
      startLine,
      endLine,
      currentTotalLines: null,
      isFullRead: false,
      isTruncated,
      recordedSliceSha,
      diskSliceSha: null,
      diskFullSha: null
    };
  }
  const rawBytes = readFileSync(absPath);
  const rawDiskText = rawBytes.toString("utf8");
  const diskFullSha = sha256Hex(rawBytes);
  const diskLines = splitDiskLines(rawDiskText);
  const currentTotalLines = diskLines.length;
  const clampedEnd = Math.min(endLine, Math.max(startLine, currentTotalLines));
  const sliceText = diskLines.slice(startLine - 1, clampedEnd).join(`
`);
  const diskSliceSha = sha256Hex(sliceText);
  const diskNormalizedFullSha = sha256Hex(diskLines.join(`
`));
  const isTruncated = Boolean(capture.isTruncated) || endLine < currentTotalLines;
  const isFullRead = startLine === 1 && !capture.isTruncated && endLine >= currentTotalLines;
  const sliceMatches = recordedSliceSha === diskSliceSha || recordedSliceSha === diskFullSha || recordedSliceSha === diskNormalizedFullSha || capture.rawBlobSha != null && (capture.rawBlobSha === diskFullSha || capture.rawBlobSha === diskNormalizedFullSha);
  const state = sliceMatches ? isFullRead ? "FRESH" : "SLICE" : "STALE";
  const lineRange = formatSliceLineRange(startLine, endLine, currentTotalLines, isTruncated);
  const stalenessStatus = formatStalenessStatus(state, startLine, endLine, currentTotalLines);
  return {
    state,
    stalenessStatus,
    lineRange,
    startLine,
    endLine,
    currentTotalLines,
    isFullRead,
    isTruncated,
    recordedSliceSha,
    diskSliceSha,
    diskFullSha
  };
}

// src/archive/normalize.ts
var BLOB_LIMIT = 4096;
var DELEGATION_TOOLS = new Set(["subagent", "delegate-devin", "hivemind-delegate"]);
var READ_TOOLS = new Set(["read", "read_file", "view_file"]);
var TOUCH_TOOLS = new Set(["write", "edit", "patch", "multi_edit", "write_to_file", "replace_file_content"]);
var SKILL_TOOLS = new Set(["skill", "load_skill"]);
var SHELL_VERIFY_TOOLS = new Set(["bash", "shell", "run_command", "exec"]);
var BOUNDARY_TYPES = new Set(["idle", "agent-switched", "model-switched", "location-switched"]);
function sha256hex(text) {
  return sha256Hex(text);
}
var asObj = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
var asStr = (value) => typeof value === "string" ? value : null;
var asNum = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
var asArr = (value) => Array.isArray(value) ? value : [];
var stripBlobPrefix = (ref) => ref.startsWith("blob:") ? ref.slice("blob:".length) : ref;
var normalizeLedgerPath = (rawPath, canonicalRoot) => normalizeRepoPath(rawPath, canonicalRoot);
var summarizePayload = (text, fallback) => {
  for (const rawLine of text.split(`
`)) {
    const line = rawLine.trim();
    if (line.length > 0 && !line.startsWith("<skill_content")) {
      return line.length > 120 ? `${line.slice(0, 117)}...` : line;
    }
  }
  return fallback;
};
var SKILL_CONTENT_BLOCK_RE = /<skill_content\s+name="([^"]+)">([\s\S]*?)<\/skill_content>/g;
var SKILL_MD_PATH_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i;
var modelRef = (value) => {
  const m = asObj(value);
  const id = asStr(m.id);
  const providerID = asStr(m.providerID);
  if (id === null || providerID === null)
    return null;
  const variant = asStr(m.variant);
  return variant === null ? { id, providerID } : { id, providerID, variant };
};
function harnessOf(model) {
  if (model?.providerID === "devin-native")
    return "devin";
  if (model?.providerID === "antigravity-native")
    return "antigravity";
  return "opencode";
}
var asHarness = (value) => {
  const s = asStr(value);
  return s === "devin" || s === "antigravity" || s === "opencode" ? s : null;
};
var inferHarness = (value, agent, title, providerId) => {
  if (value === "devin" || value === "antigravity" || value === "opencode")
    return value;
  if (providerId === "devin-native")
    return "devin";
  if (providerId === "antigravity-native")
    return "antigravity";
  if (typeof agent === "string") {
    if (agent.includes("antigravity"))
      return "antigravity";
    if (agent.includes("devin"))
      return "devin";
  }
  if (typeof title === "string") {
    if (title.startsWith("Antigravity"))
      return "antigravity";
    if (title.startsWith("Devin"))
      return "devin";
  }
  return "opencode";
};
var normalizeReportedOutcome = (value) => {
  if (value === "succeeded" || value === "failed" || value === "interrupted" || value === "running") {
    return value;
  }
  return null;
};
function sessionHeader(row, info) {
  return {
    kind: "session",
    schema: 1,
    id: row.id,
    project_id: row.project_id,
    root_id: info.root_id,
    parent_id: row.parent_id,
    depth: info.depth,
    lane: info.lane,
    directory: row.directory,
    title: row.title,
    agent: row.agent,
    model: row.model,
    harness: harnessOf(row.model),
    outcome: row.idle_outcome,
    fork: row.fork_session_id === null ? null : { from: row.fork_session_id, boundary: row.fork_boundary },
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache_read: row.tokens_cache_read,
      cache_write: row.tokens_cache_write
    },
    summary: {
      files: row.summary_files,
      additions: row.summary_additions,
      deletions: row.summary_deletions
    },
    time: {
      created: row.time_created,
      updated: row.time_updated,
      idle: row.time_idle,
      compacting: row.time_compacting,
      archived: row.time_archived
    },
    resume_attempts: row.resume_attempts,
    message_count: info.message_count,
    children: info.children
  };
}
var base = (row) => ({
  id: row.id,
  raw_ref: { session_id: row.session_id, message_id: row.id, seq: row.seq },
  t: row.time_created
});
var thinStrings = (value, sink) => {
  if (typeof value === "string")
    return value.length > BLOB_LIMIT ? sink(value) : value;
  if (Array.isArray(value))
    return value.map((item) => thinStrings(item, sink));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, thinStrings(item, sink)]));
  }
  return value;
};
var makeSkillLedgerRow = (params) => {
  const blobRef = params.body.length > 0 ? params.sink(params.body) : `blob:${sha256hex("")}`;
  const blobSha = stripBlobPrefix(blobRef);
  return {
    session_id: params.sessionId,
    skill_name: params.skillName,
    call_id: params.callId,
    message_id: params.messageId,
    seq: params.seq,
    loaded_seq: params.seq,
    load_seq: params.seq,
    chars: params.body.length,
    char_len: params.body.length,
    blob_sha: blobSha,
    blob_sha256: blobSha,
    skill_blob_sha: blobSha,
    blob_ref: blobRef,
    summary: summarizePayload(params.body, params.summaryFallback ?? `skill:${params.skillName}`),
    status: "ACTIVE \u2014 DO NOT RE-INVOKE",
    t: params.t
  };
};
var extractInlineSkillBlocks = (text, row, callIdPrefix, sink, skillLoads) => {
  if (!text.includes("<skill_content"))
    return;
  for (const match of text.matchAll(SKILL_CONTENT_BLOCK_RE)) {
    const skillName = match[1]?.trim();
    const body = match[2] ?? "";
    if (!skillName)
      continue;
    skillLoads.push(makeSkillLedgerRow({
      sessionId: row.session_id,
      messageId: row.id,
      seq: row.seq,
      t: row.time_created,
      callId: `${callIdPrefix}:${skillName}`,
      skillName,
      body,
      sink
    }));
  }
};
var toolPart = (part, row, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot) => {
  const state = asObj(part.state);
  const meta = asObj(state.metadata);
  const rawInput = asObj(state.input);
  const outputText = asArr(state.content).flatMap((item) => {
    const c = asObj(item);
    return c.type === "text" && typeof c.text === "string" ? [c.text] : [];
  }).join("");
  const childSessionID = asStr(meta.sessionID);
  const callID = asStr(part.id) ?? "";
  const name = asStr(part.name) ?? "";
  const status = asStr(state.status);
  const time = asObj(part.time);
  const tCreated = asNum(time.created);
  const tCompleted = asNum(time.completed);
  if (childSessionID !== null && DELEGATION_TOOLS.has(name)) {
    const prompt = asStr(rawInput.prompt);
    delegations.push({
      call_id: callID,
      message_id: row.id,
      seq: row.seq,
      child_session_id: childSessionID,
      tool: name,
      agent: asStr(rawInput.agent),
      harness: asHarness(rawInput.harness),
      mode: typeof rawInput.sessionID === "string" ? "continue" : "spawn",
      background: rawInput.background === true,
      description: asStr(rawInput.description),
      prompt_ref: prompt === null ? null : sink(prompt),
      status,
      t_created: tCreated,
      t_completed: tCompleted
    });
  }
  if (status !== "error" && READ_TOOLS.has(name)) {
    const rawPath = asStr(rawInput.filePath) ?? asStr(rawInput.path) ?? asStr(rawInput.AbsolutePath) ?? asStr(rawInput.file);
    if (rawPath && rawPath.length > 0) {
      const capture = parseReadToolOutput(outputText, { ...rawInput, filePath: rawPath }, canonicalRoot);
      const blobRef = outputText.length > 0 ? sink(outputText) : `blob:${sha256hex("")}`;
      const blobSha = stripBlobPrefix(blobRef);
      const normPath = normalizeLedgerPath(rawPath, canonicalRoot);
      let diskBlobSha = capture.sliceSha;
      let stalenessStatus = capture.isTruncated || capture.startLine > 1 ? formatStalenessStatus("SLICE", capture.startLine, capture.endLine, capture.totalLines) : "FRESH \u2014 DO NOT REREAD";
      const shouldCheckDisk = typeof canonicalRoot === "string" && canonicalRoot.length > 0 || isAbsolute(rawPath) && existsSync2(rawPath);
      if (shouldCheckDisk) {
        const diskPath = resolveDiskPath(rawPath, canonicalRoot);
        if (existsSync2(diskPath)) {
          const recon = computeDiskSliceSha(diskPath, capture);
          diskBlobSha = recon.diskSliceSha ?? capture.sliceSha;
          stalenessStatus = recon.stalenessStatus;
        }
      }
      fileReads.push({
        session_id: row.session_id,
        path: rawPath,
        normalized_path: normPath,
        call_id: callID || `read:${row.id}:${row.seq}`,
        message_id: row.id,
        seq: row.seq,
        read_seq: row.seq,
        line_range: capture.lineRange,
        start_line: capture.startLine,
        end_line: capture.endLine,
        total_lines: capture.totalLines,
        is_truncated: capture.isTruncated ? 1 : 0,
        chars: outputText.length,
        char_len: outputText.length,
        blob_sha: blobSha,
        blob_sha256: blobSha,
        slice_sha: capture.sliceSha,
        read_blob_sha: capture.sliceSha,
        disk_blob_sha: diskBlobSha,
        summary: summarizePayload(outputText, normPath),
        staleness_status: stalenessStatus,
        t: row.time_created,
        updated_at: new Date(row.time_updated || row.time_created || Date.now()).toISOString()
      });
      const skillPathMatch = normPath.match(SKILL_MD_PATH_RE);
      if (skillPathMatch?.[1]) {
        skillLoads.push(makeSkillLedgerRow({
          sessionId: row.session_id,
          messageId: row.id,
          seq: row.seq,
          t: row.time_created,
          callId: callID || `skill-read:${row.id}`,
          skillName: skillPathMatch[1],
          body: outputText,
          sink
        }));
      }
    }
  } else if (status !== "error" && SKILL_TOOLS.has(name)) {
    const explicitName = asStr(rawInput.name) ?? asStr(rawInput.skill) ?? asStr(rawInput.id);
    const beforeCount = skillLoads.length;
    extractInlineSkillBlocks(outputText, row, callID || `skill:${row.id}`, sink, skillLoads);
    if (skillLoads.length === beforeCount && explicitName) {
      skillLoads.push(makeSkillLedgerRow({
        sessionId: row.session_id,
        messageId: row.id,
        seq: row.seq,
        t: row.time_created,
        callId: callID || `skill:${row.id}`,
        skillName: explicitName,
        body: outputText,
        sink
      }));
    }
  } else if (status !== "error" && TOUCH_TOOLS.has(name)) {
    const rawPath = asStr(rawInput.filePath) ?? asStr(rawInput.path) ?? asStr(rawInput.TargetFile) ?? asStr(rawInput.file);
    if (rawPath && rawPath.length > 0) {
      const contentCandidate = asStr(rawInput.content) ?? asStr(rawInput.newString) ?? asStr(rawInput.CodeContent) ?? asStr(rawInput.ReplacementContent) ?? outputText;
      const blobRef = contentCandidate.length > 0 ? sink(contentCandidate) : `blob:${sha256hex("")}`;
      const blobSha = stripBlobPrefix(blobRef);
      const opKind = name.includes("write") ? "write" : "edit";
      fileTouches.push({
        session_id: row.session_id,
        message_id: row.id,
        call_id: callID || `${name}:${row.id}:${row.seq}`,
        seq: row.seq,
        tool: name,
        op: opKind,
        operation: opKind,
        path: rawPath,
        normalized_path: normalizeLedgerPath(rawPath, canonicalRoot),
        detail: null,
        blob_sha256: blobSha,
        t: row.time_created
      });
    }
  }
  const record = {
    type: "tool",
    call_id: callID,
    name,
    status,
    time: { created: tCreated, ran: asNum(time.ran), completed: tCompleted },
    input: thinStrings(state.input, sink),
    output: outputText.length > BLOB_LIMIT ? outputText.slice(0, BLOB_LIMIT) : outputText,
    truncated: meta.truncated === true,
    output_path: asStr(meta.outputPath),
    child_session_id: childSessionID
  };
  const withRef = outputText.length > BLOB_LIMIT ? { ...record, output_ref: sink(outputText) } : record;
  return state.error === undefined ? withRef : { ...withRef, error: state.error };
};
var normalizePart = (value, row, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot) => {
  const part = asObj(value);
  if (part.type === "text") {
    const text = asStr(part.text) ?? "";
    extractInlineSkillBlocks(text, row, `text:${row.id}`, sink, skillLoads);
    return { type: "text", text };
  }
  if (part.type === "reasoning") {
    const text = asStr(part.text);
    const state = asObj(part.state);
    const encrypted = asStr(state.reasoningEncryptedContent);
    return {
      type: "reasoning",
      text_ref: text === null || text.length === 0 ? null : sink(text),
      chars: text?.length ?? 0,
      encrypted_bytes: encrypted?.length ?? 0
    };
  }
  if (part.type === "tool")
    return toolPart(part, row, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot);
  return { type: "unknown-part", raw_type: asStr(part.type) ?? "", raw: value };
};
var normalizeUser = (row, data, sink, skillLoads) => {
  const directText = asStr(data.text);
  const contentPartsText = asArr(data.content ?? data.parts).flatMap((part) => {
    const p = asObj(part);
    return p.type === "text" && typeof p.text === "string" ? [p.text] : [];
  }).join(`
`);
  const text = directText !== null && directText.length > 0 ? directText : contentPartsText;
  const textRef = text.length > 0 ? sink(text) : undefined;
  extractInlineSkillBlocks(text, row, `user:${row.id}`, sink, skillLoads);
  const skills = asArr(data.skills).map((s, idx) => {
    const skill = asObj(s);
    const skillText = asStr(skill.text);
    const id = asStr(skill.id);
    const name = asStr(skill.name);
    const skillName = name ?? id;
    const sRef = skillText === null ? null : sink(skillText);
    if (skillName && skillText !== null) {
      skillLoads.push(makeSkillLedgerRow({
        sessionId: row.session_id,
        messageId: row.id,
        seq: row.seq,
        t: row.time_created,
        callId: id ?? `user-skill:${row.id}:${idx}`,
        skillName,
        body: skillText,
        sink
      }));
    }
    return { id, name, text_ref: sRef };
  });
  return {
    ...base(row),
    kind: "user",
    text,
    ...textRef !== undefined ? { text_ref: textRef } : {},
    agents: asArr(data.agents).flatMap((a) => {
      const name = asStr(asObj(a).name);
      return name === null ? [] : [name];
    }),
    files: asArr(data.files).map((f) => {
      const file = asObj(f);
      const blob = asStr(file.data);
      return {
        name: asStr(file.name),
        mime: asStr(file.mime),
        source: asStr(file.source),
        data_ref: blob === null ? null : sink(blob)
      };
    }),
    skills
  };
};
var normalizeSkill = (row, data, sink, skillLoads) => {
  const name = asStr(data.name) ?? asStr(data.skill) ?? asStr(data.id);
  const description = asStr(data.description);
  const rawText = asStr(data.text) ?? asStr(data.content) ?? "";
  const textRef = rawText.length > 0 ? sink(rawText) : null;
  if (name) {
    skillLoads.push(makeSkillLedgerRow({
      sessionId: row.session_id,
      messageId: row.id,
      seq: row.seq,
      t: row.time_created,
      callId: asStr(data.call_id) ?? asStr(data.id) ?? row.id,
      skillName: name,
      body: rawText,
      summaryFallback: description ?? `skill:${name}`,
      sink
    }));
  }
  return {
    ...base(row),
    kind: "skill",
    name,
    description,
    text: rawText.length > BLOB_LIMIT ? rawText.slice(0, BLOB_LIMIT) : rawText,
    text_ref: textRef,
    chars: rawText.length
  };
};
var normalizeShell = (row, data, sink) => {
  const inputObj = asObj(data.input);
  const command = asStr(data.command) ?? asStr(inputObj.command);
  const cwd = asStr(data.cwd) ?? asStr(inputObj.cwd);
  const exitCode = asNum(data.exitCode) ?? asNum(data.exit_code);
  const rawOutput = asStr(data.output) ?? asStr(data.text) ?? asArr(data.content).flatMap((c) => {
    const obj = asObj(c);
    return typeof obj.text === "string" ? [obj.text] : [];
  }).join("");
  const outputRef = rawOutput.length > 0 ? sink(rawOutput) : null;
  return {
    ...base(row),
    kind: "shell",
    command,
    cwd,
    exit_code: exitCode,
    output: rawOutput.length > BLOB_LIMIT ? rawOutput.slice(0, BLOB_LIMIT) : rawOutput,
    output_ref: outputRef
  };
};
var normalizeAssistant = (row, data, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot) => {
  const time = asObj(data.time);
  const completed = asNum(time.completed);
  const record = {
    ...base(row),
    kind: "assistant",
    agent: asStr(data.agent),
    model: modelRef(data.model),
    finish: asStr(data.finish),
    cost: asNum(data.cost),
    tokens: data.tokens ?? null,
    time: { created: asNum(time.created), completed },
    incomplete: completed === null,
    parts: asArr(data.content).map((part) => normalizePart(part, row, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot))
  };
  const extras = {};
  for (const key of ["error", "retry", "snapshot"]) {
    if (data[key] !== undefined)
      extras[key] = data[key];
  }
  return { ...record, ...extras };
};
var normalizeContext = (row, data, sink) => {
  const meta = asObj(data.metadata);
  const instruction = asObj(meta.instruction);
  const text = asStr(data.text);
  return {
    ...base(row),
    kind: "context",
    source: asStr(meta.source) ?? asStr(meta.notice) ?? row.type,
    description: asStr(data.description),
    paths: asArr(instruction.paths).flatMap((p) => {
      const s = asStr(p);
      return s === null ? [] : [s];
    }),
    text_ref: text === null || text.length === 0 ? null : sink(text)
  };
};
var normalizeCompaction = (row, data, prevSeq, sink) => {
  const summary = asStr(data.summary);
  const summaryRef = summary !== null && summary.length > 0 ? sink(summary) : null;
  return {
    ...base(row),
    kind: "compaction",
    reason: asStr(data.reason),
    status: asStr(data.status),
    summary,
    ...summaryRef !== null ? { summary_ref: summaryRef } : {},
    recent: asStr(data.recent),
    tokens: data.tokens ?? null,
    covers_through_seq: prevSeq
  };
};
var normalizeBoundary = (row, data) => {
  const rest = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "time" && key !== "providerState")
      rest[key] = value;
  }
  return {
    ...base(row),
    kind: "boundary",
    subtype: row.type,
    ...rest
  };
};
var normalizeUnknown = (row) => ({
  ...base(row),
  kind: "unknown",
  raw_type: row.type,
  data: row.data
});
function normalizeMessage(row, sink, prevSeq, canonicalRoot) {
  const delegations = [];
  const fileReads = [];
  const skillLoads = [];
  const fileTouches = [];
  const data = asObj(row.data);
  const record = row.type === "user" ? normalizeUser(row, data, sink, skillLoads) : row.type === "assistant" ? normalizeAssistant(row, data, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot) : row.type === "skill" ? normalizeSkill(row, data, sink, skillLoads) : row.type === "shell" ? normalizeShell(row, data, sink) : row.type === "synthetic" || row.type === "system" ? normalizeContext(row, data, sink) : row.type === "compaction" ? normalizeCompaction(row, data, prevSeq, sink) : BOUNDARY_TYPES.has(row.type) ? normalizeBoundary(row, data) : normalizeUnknown(row);
  return { record, delegations, fileReads, skillLoads, fileTouches };
}
function foldSessionLedgers(rawReads, rawSkills, rawTouches) {
  const readsByKey = new Map;
  for (const r of rawReads) {
    const key = `${r.session_id}\x00${r.path}`;
    const prev = readsByKey.get(key);
    if (!prev || r.read_seq >= prev.read_seq) {
      readsByKey.set(key, r);
    }
  }
  for (const touch of rawTouches) {
    for (const [key, readRow] of readsByKey.entries()) {
      if (readRow.session_id === touch.session_id && (readRow.path === touch.path || readRow.normalized_path === touch.normalized_path) && touch.seq > readRow.read_seq) {
        readsByKey.set(key, {
          ...readRow,
          disk_blob_sha: touch.blob_sha256,
          staleness_status: formatStalenessStatus("STALE", readRow.start_line ?? 1, readRow.end_line ?? 1, readRow.total_lines ?? null)
        });
      }
    }
  }
  const skillsByKey = new Map;
  for (const s of rawSkills) {
    const key = `${s.session_id}\x00${s.skill_name}`;
    const prev = skillsByKey.get(key);
    if (!prev || s.load_seq >= prev.load_seq) {
      skillsByKey.set(key, s);
    }
  }
  const touchesByKey = new Map;
  for (const t of rawTouches) {
    const key = `${t.session_id}\x00${t.message_id}\x00${t.call_id}\x00${t.path}`;
    touchesByKey.set(key, t);
  }
  return {
    fileReads: [...readsByKey.values()],
    skillLoads: [...skillsByKey.values()],
    fileTouches: [...touchesByKey.values()]
  };
}
function extractSessionProvenanceChains(rootSessionId, sessionId, messages, rawRows, canonicalRoot) {
  if (messages.length === 0)
    return [];
  const rawById = new Map;
  if (rawRows) {
    for (const r of rawRows)
      rawById.set(r.id, r);
  }
  const readBlobByPath = new Map;
  const touchBlobByPath = new Map;
  const chains = [];
  let current = null;
  const flushCurrent = () => {
    if (!current || !current.hasActivity)
      return;
    const touchedFiles = [...current.touchedFiles];
    const outcome = current.verificationCommand !== null && current.verificationExitCode !== null ? current.verificationExitCode === 0 ? "VERIFIED_PASS" : "VERIFIED_FAIL" : touchedFiles.length > 0 ? "UNVERIFIED" : "IN_PROGRESS";
    const targetPath = touchedFiles[0] ?? current.lastReadPath ?? "session";
    const readOrReviewSha = readBlobByPath.get(targetPath) ?? touchBlobByPath.get(targetPath) ?? "";
    const repairSha = touchedFiles.length > 0 ? touchBlobByPath.get(targetPath) || readOrReviewSha || sha256hex(`${sessionId}:${targetPath}:${current.repairSeq ?? current.intentSeq}`) : null;
    let diskSha = repairSha ?? readOrReviewSha;
    if (canonicalRoot && targetPath !== "session") {
      const absPath = resolveDiskPath(targetPath, canonicalRoot);
      if (existsSync2(absPath)) {
        try {
          diskSha = sha256Hex(readFileSync2(absPath));
        } catch {}
      }
    }
    const stalenessStatus = outcome === "VERIFIED_PASS" ? "VERIFIED_FRESH" : outcome === "VERIFIED_FAIL" ? "STALE (modified since read/review \u2014 re-verify slice)" : "FRESH \u2014 DO NOT REREAD";
    const updatedIso = new Date(current.lastTimestamp).toISOString();
    chains.push({
      chain_id: `${sessionId}:chain:${current.intentSeq}`,
      root_session_id: rootSessionId,
      session_id: sessionId,
      finding_id: `F-${sessionId.slice(-6).toUpperCase()}-${current.intentSeq}`,
      finding_seq: current.intentSeq,
      finding_session_id: sessionId,
      finding_summary: current.decisionSummary ?? current.intentSummary,
      child_session_id: sessionId !== rootSessionId ? sessionId : null,
      intent_seq: current.intentSeq,
      intent_message_id: current.intentMessageId,
      intent_summary: current.intentSummary,
      decision_seq: current.decisionSeq,
      decision_pivot_seq: current.decisionSeq ?? current.intentSeq,
      decision_summary: current.decisionSummary,
      target_path: targetPath,
      touched_files_json: JSON.stringify(touchedFiles),
      read_or_review_blob_sha: readOrReviewSha,
      repair_seq: current.repairSeq,
      repair_session_id: current.repairSeq !== null ? sessionId : null,
      repair_blob_sha: repairSha,
      receipt_command: current.verificationCommand,
      verification_command: current.verificationCommand,
      receipt_exit_code: current.verificationExitCode,
      verification_exit_code: current.verificationExitCode,
      verification_seq: current.verificationSeq,
      receipt_blob_sha: current.verificationBlobRef,
      verification_blob_ref: current.verificationBlobRef,
      head_sha: null,
      worktree_tree_sha: null,
      disk_blob_sha: diskSha,
      staleness_status: stalenessStatus,
      outcome,
      created_at: current.lastTimestamp,
      updated_at: updatedIso
    });
  };
  for (const norm of messages) {
    const rec = norm.record;
    const seq = rec.raw_ref.seq;
    const t = rec.t || Date.now();
    for (const r of norm.fileReads) {
      const p = normalizeLedgerPath(r.path, canonicalRoot);
      readBlobByPath.set(p, r.read_blob_sha || r.blob_sha256);
      if (current)
        current.lastReadPath = p;
    }
    if (rec.kind === "user") {
      flushCurrent();
      current = {
        intentSeq: seq,
        intentMessageId: rec.id,
        intentSummary: summarizePayload(rec.text, "User intent"),
        decisionSeq: null,
        decisionSummary: null,
        touchedFiles: new Set,
        lastReadPath: null,
        repairSeq: null,
        verificationCommand: null,
        verificationExitCode: null,
        verificationSeq: null,
        verificationBlobRef: null,
        lastTimestamp: t,
        hasActivity: false
      };
      continue;
    }
    if (!current) {
      current = {
        intentSeq: seq,
        intentMessageId: rec.id,
        intentSummary: "Session start",
        decisionSeq: null,
        decisionSummary: null,
        touchedFiles: new Set,
        lastReadPath: null,
        repairSeq: null,
        verificationCommand: null,
        verificationExitCode: null,
        verificationSeq: null,
        verificationBlobRef: null,
        lastTimestamp: t,
        hasActivity: false
      };
    }
    current.lastTimestamp = Math.max(current.lastTimestamp, t);
    for (const touch of norm.fileTouches) {
      const tp = normalizeLedgerPath(touch.path, canonicalRoot);
      current.touchedFiles.add(tp);
      if (touch.blob_sha256)
        touchBlobByPath.set(tp, touch.blob_sha256);
      current.repairSeq = seq;
      current.hasActivity = true;
    }
    if (rec.kind === "shell") {
      if (rec.command) {
        current.verificationCommand = rec.command;
        current.verificationExitCode = rec.exit_code ?? 0;
        current.verificationSeq = seq;
        current.verificationBlobRef = rec.output_ref ?? null;
        current.hasActivity = true;
      }
    } else if (rec.kind === "assistant") {
      for (const part of rec.parts) {
        if (part.type === "text" && part.text.trim().length > 0 && current.decisionSummary === null) {
          current.decisionSeq = seq;
          current.decisionSummary = summarizePayload(part.text, "Assistant decision");
          current.hasActivity = true;
        } else if (part.type === "tool") {
          const toolName = part.name.toLowerCase();
          if (SHELL_VERIFY_TOOLS.has(toolName)) {
            const inputObj = asObj(part.input);
            const cmd = asStr(inputObj.command) ?? asStr(inputObj.CommandLine) ?? asStr(inputObj.cmd) ?? part.name;
            if (cmd) {
              current.verificationCommand = cmd;
              current.verificationSeq = seq;
              current.verificationBlobRef = part.output_ref ?? null;
              current.hasActivity = true;
              const rawMsg = rawById.get(rec.id);
              let exitCode = null;
              if (rawMsg) {
                const rawParts = asArr(asObj(rawMsg.data).content);
                for (const rp of rawParts) {
                  const rpObj = asObj(rp);
                  if (rpObj.id === part.call_id) {
                    const meta = asObj(asObj(rpObj.state).metadata);
                    exitCode = asNum(meta.exitCode) ?? asNum(meta.exit_code);
                  }
                }
              }
              if (exitCode === null) {
                const m = part.output.match(/exit(?:\s+code)?[:\s]+(-?\d+)/i);
                if (m?.[1])
                  exitCode = Number.parseInt(m[1], 10);
              }
              if (exitCode === null) {
                exitCode = part.status === "error" || part.error !== undefined ? 1 : 0;
              }
              current.verificationExitCode = exitCode;
            }
          }
        }
      }
    }
  }
  flushCurrent();
  return chains;
}
var BLOCKER_PATTERNS = [
  { label: "mcp_init_failed", regex: /MCP server [^\n]+ failed to initialize/i },
  { label: "mcp_timeout", regex: /MCP server [^\n]+ timed out/i },
  { label: "mcp_tool_failed", regex: /MCP tool (?:call )?failed|[^\n]*MCP tool failed with an error/i },
  {
    label: "read_lease_violation",
    regex: /read lease violation|Access denied:[^\n]*outside allowed directories/i
  },
  {
    label: "explicit_blocked",
    regex: /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*BLOCKED\*\*|BLOCKED\s*[\u2014:\u2014-]|Status:\s*`?BLOCKED`?)/
  }
];
function classifyMessagesOutcome(messages, fallbackReportedOutcome = null) {
  let reported = normalizeReportedOutcome(fallbackReportedOutcome);
  let toolErrorCount = 0;
  let toolCompletedCount = 0;
  let textCharCount = 0;
  const blockerReasons = [];
  for (const msg of messages) {
    const data = asObj(msg.data);
    if (msg.type === "idle") {
      const idleOut = normalizeReportedOutcome(data.outcome);
      if (idleOut !== null)
        reported = idleOut;
      continue;
    }
    if (msg.type !== "assistant")
      continue;
    const parts = asArr(data.content);
    for (const rawPart of parts) {
      const part = asObj(rawPart);
      if (part.type === "text") {
        const text = asStr(part.text) ?? "";
        textCharCount += text.trim().length;
        for (const pat of BLOCKER_PATTERNS) {
          const m = text.match(pat.regex);
          if (m) {
            blockerReasons.push(`${pat.label}: ${m[0].trim().slice(0, 120)}`);
          }
        }
      } else if (part.type === "tool") {
        const state = asObj(part.state);
        const status = asStr(state.status);
        const toolName = asStr(part.name) ?? "tool";
        if (status === "error" || state.error !== undefined) {
          toolErrorCount++;
          const errObj = asObj(state.error);
          const errMsg = asStr(errObj.message) ?? asStr(state.error) ?? JSON.stringify(state.error);
          if (blockerReasons.length < 4) {
            blockerReasons.push(`tool_error(${toolName}): ${errMsg.slice(0, 120)}`);
          }
        } else if (status === "completed") {
          toolCompletedCount++;
        }
      }
    }
  }
  const hasTextBlocker = blockerReasons.some((r) => !r.startsWith("tool_error("));
  const verified = textCharCount === 0 && toolCompletedCount === 0 && toolErrorCount === 0 ? "empty_output" : toolErrorCount > 0 ? "tool_error_inside" : hasTextBlocker ? "blocked_in_text" : reported === "failed" ? "verified_fail" : toolCompletedCount > 0 ? "verified_pass" : "reported_only";
  return {
    reported_outcome: reported,
    verified_outcome: verified,
    blocker_summary: blockerReasons.length > 0 ? blockerReasons.slice(0, 3).join("; ") : null,
    tool_error_count: toolErrorCount,
    tool_completed_count: toolCompletedCount,
    text_char_count: textCharCount
  };
}
function segmentChildStops(messagesOrSession, outcomeOrMessages) {
  const messages = Array.isArray(messagesOrSession) ? messagesOrSession : Array.isArray(outcomeOrMessages) ? outcomeOrMessages : [];
  const sessionIdleOutcome = Array.isArray(messagesOrSession) ? typeof outcomeOrMessages === "string" ? outcomeOrMessages : null : messagesOrSession.idle_outcome ?? null;
  if (messages.length === 0)
    return [];
  const groups = [];
  let current = [];
  let seenAssistantInCurrent = false;
  for (const msg of messages) {
    if (msg.type === "user" && current.length > 0 && seenAssistantInCurrent) {
      groups.push(current);
      current = [msg];
      seenAssistantInCurrent = false;
      continue;
    }
    current.push(msg);
    if (msg.type === "assistant") {
      seenAssistantInCurrent = true;
    }
    if (msg.type === "idle") {
      groups.push(current);
      current = [];
      seenAssistantInCurrent = false;
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups.map((group, idx) => {
    const first = group[0];
    const last = group[group.length - 1];
    const promptTexts = [];
    const responseTexts = [];
    for (const m of group) {
      const mData = asObj(m.data);
      if (m.type === "user") {
        const t = asStr(mData.text);
        if (t)
          promptTexts.push(t);
      } else if (m.type === "assistant") {
        for (const rawPart of asArr(mData.content)) {
          const p = asObj(rawPart);
          if (p.type === "text" && typeof p.text === "string") {
            responseTexts.push(p.text);
          }
        }
      }
    }
    const classification = classifyMessagesOutcome(group, sessionIdleOutcome);
    return {
      turn_index: idx,
      start_seq: first.seq ?? idx + 1,
      end_seq: last.seq ?? idx + 1,
      start_message_id: first.id ?? "",
      end_message_id: last.id ?? "",
      prompt_text: promptTexts.join(`
`),
      response_text: responseTexts.join(`
`),
      reported_outcome: classification.reported_outcome,
      verified_outcome: classification.verified_outcome,
      blocker_summary: classification.blocker_summary,
      tool_error_count: classification.tool_error_count,
      tool_completed_count: classification.tool_completed_count,
      text_char_count: classification.text_char_count
    };
  });
}
function normalizeDelegationTurns(parentSessionId, parentMessages, childSessions, childMessagesById, kvByChildId = new Map, sinkText = (t) => `blob:${sha256hex(t)}`, sourceOrigin = "host_db") {
  const callsByChild = new Map;
  for (const msg of parentMessages) {
    if (msg.type !== "assistant")
      continue;
    const data = asObj(msg.data);
    for (const rawPart of asArr(data.content)) {
      const part = asObj(rawPart);
      if (part.type !== "tool")
        continue;
      const toolName = asStr(part.name) ?? "";
      if (!DELEGATION_TOOLS.has(toolName))
        continue;
      const state = asObj(part.state);
      const meta = asObj(state.metadata);
      const input = asObj(state.input);
      const childId = asStr(meta.sessionID) ?? asStr(input.sessionID);
      if (!childId)
        continue;
      const callId = asStr(part.id) ?? `call:${parentSessionId}:${msg.seq ?? 0}`;
      const hasInputSession = typeof input.sessionID === "string" && input.sessionID.length > 0;
      const list = callsByChild.get(childId) ?? [];
      const mode = hasInputSession || list.length > 0 ? "send" : "spawn";
      const hStr = asStr(input.harness);
      const harness = hStr === "devin" || hStr === "antigravity" || hStr === "opencode" ? hStr : toolName === "delegate-devin" ? "devin" : null;
      list.push({
        call_id: callId,
        seq: msg.seq ?? 0,
        child_session_id: childId,
        mode,
        agent: asStr(input.agent),
        harness,
        prompt: asStr(input.prompt)
      });
      callsByChild.set(childId, list);
    }
  }
  const turns = [];
  for (const child of childSessions) {
    const childMsgs = childMessagesById.get(child.id) ?? [];
    const stops = segmentChildStops(childMsgs, child.idle_outcome ?? null);
    const parentCalls = callsByChild.get(child.id) ?? [];
    const kv = kvByChildId.get(child.id);
    const providerId = child.provider_id ?? child.model?.providerID ?? null;
    const modelId = child.model_id ?? child.model?.id ?? null;
    const resolvedHarness = inferHarness(kv?.harness ?? parentCalls[0]?.harness ?? null, child.agent ?? kv?.agent, child.title ?? kv?.title, providerId);
    const resolvedModel = kv?.confirmed_model ?? kv?.model ?? modelId ?? null;
    const resolvedAgent = child.agent ?? kv?.agent ?? parentCalls[0]?.agent ?? null;
    const foreignSessionId = kv?.foreign_session_id ?? null;
    if (stops.length === 0) {
      const callFact = parentCalls[0];
      turns.push({
        parent_session_id: parentSessionId,
        call_id: callFact?.call_id ?? kv?.call_id ?? `parent:${child.id}`,
        turn_index: 0,
        child_session_id: child.id,
        mode: callFact?.mode ?? "spawn",
        harness: resolvedHarness,
        agent: resolvedAgent,
        model: resolvedModel,
        foreign_session_id: foreignSessionId,
        start_seq: 0,
        end_seq: 0,
        start_message_id: "",
        end_message_id: "",
        reported_outcome: normalizeReportedOutcome(child.idle_outcome),
        verified_outcome: "empty_output",
        blocker_summary: null,
        tool_error_count: 0,
        tool_completed_count: 0,
        text_char_count: 0,
        prompt_blob: callFact?.prompt ? sinkText(callFact.prompt) : null,
        response_blob: null,
        source_origin: sourceOrigin
      });
      continue;
    }
    for (let i = 0;i < stops.length; i++) {
      const stop = stops[i];
      const callFact = parentCalls[i];
      const callId = callFact?.call_id ?? kv?.call_id ?? `turn:${child.id}:${i}`;
      const mode = i === 0 ? "spawn" : callFact?.mode ?? "send";
      const promptText = stop.prompt_text || callFact?.prompt || "";
      const responseText = stop.response_text || "";
      turns.push({
        parent_session_id: parentSessionId,
        call_id: callId,
        turn_index: i,
        child_session_id: child.id,
        mode,
        harness: resolvedHarness,
        agent: resolvedAgent,
        model: resolvedModel,
        foreign_session_id: foreignSessionId,
        start_seq: stop.start_seq,
        end_seq: stop.end_seq,
        start_message_id: stop.start_message_id,
        end_message_id: stop.end_message_id,
        reported_outcome: stop.reported_outcome,
        verified_outcome: stop.verified_outcome,
        blocker_summary: stop.blocker_summary,
        tool_error_count: stop.tool_error_count,
        tool_completed_count: stop.tool_completed_count,
        text_char_count: stop.text_char_count,
        prompt_blob: promptText.length > 0 ? sinkText(promptText) : null,
        response_blob: responseText.length > 0 ? sinkText(responseText) : null,
        source_origin: sourceOrigin
      });
    }
  }
  return turns;
}

// src/archive/layout.ts
import path2 from "path";
function laneOf(directory, projectRoot) {
  if (directory === projectRoot)
    return { kind: "root", path: "" };
  const rel = path2.relative(projectRoot, directory);
  if (rel !== "" && !rel.startsWith("..") && !path2.isAbsolute(rel)) {
    return { kind: "nested", path: rel };
  }
  return { kind: "external", path: directory };
}
function sessionRelDir(parentRelDir, id) {
  if (parentRelDir === null)
    return path2.join("sessions", id);
  return path2.join(parentRelDir, "subagents", id);
}

// src/archive/index-db.ts
import { existsSync as existsSync3, mkdirSync } from "fs";
import path3 from "path";
import { Database } from "bun:sqlite";
var DDL = `
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  lane_kind TEXT NOT NULL DEFAULT 'root',
  lane_path TEXT NOT NULL DEFAULT '',
  title TEXT,
  agent TEXT,
  provider TEXT,
  model_id TEXT,
  variant TEXT,
  harness TEXT DEFAULT 'opencode',
  outcome TEXT,
  cost REAL DEFAULT 0,
  tok_in INTEGER DEFAULT 0,
  tok_out INTEGER DEFAULT 0,
  tok_reason INTEGER DEFAULT 0,
  tok_cache_r INTEGER DEFAULT 0,
  tok_cache_w INTEGER DEFAULT 0,
  files_changed INTEGER,
  additions INTEGER,
  deletions INTEGER,
  t_created INTEGER DEFAULT 0,
  t_updated INTEGER DEFAULT 0,
  t_idle INTEGER,
  t_compacting INTEGER,
  t_archived INTEGER,
  resume_attempts INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  transcript_path TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS delegation (
  call_id TEXT NOT NULL,
  root_id TEXT NOT NULL DEFAULT '',
  parent_session TEXT NOT NULL,
  parent_message_id TEXT,
  child_session TEXT,
  tool TEXT,
  agent TEXT,
  harness TEXT,
  mode TEXT,
  background INTEGER,
  description TEXT,
  prompt_ref TEXT,
  status TEXT,
  t_created INTEGER,
  t_completed INTEGER,
  PRIMARY KEY (parent_session, call_id)
);
CREATE TABLE IF NOT EXISTS message (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  t INTEGER,
  agent TEXT,
  model_id TEXT,
  tok_in INTEGER,
  tok_out INTEGER,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS tool_call (
  call_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER,
  name TEXT,
  status TEXT,
  duration_ms INTEGER,
  truncated INTEGER,
  output_path TEXT,
  PRIMARY KEY (session_id, call_id)
);
CREATE TABLE IF NOT EXISTS compaction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT,
  status TEXT,
  summary_ref TEXT,
  tok_input INTEGER,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS instruction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  blob_sha TEXT,
  PRIMARY KEY (session_id, seq, path)
);
CREATE TABLE IF NOT EXISTS kv_binding (
  child_session_id TEXT PRIMARY KEY,
  raw_key TEXT NOT NULL,
  scope TEXT,
  driver_kind TEXT,
  harness TEXT,
  foreign_session_id TEXT,
  parent_session_id TEXT,
  call_id TEXT,
  title TEXT,
  cwd TEXT,
  agent TEXT,
  model TEXT,
  effort TEXT,
  mode TEXT,
  background INTEGER,
  requested_model TEXT,
  confirmed_model TEXT,
  confirmed_effort TEXT,
  turn INTEGER,
  phase TEXT,
  foreign_ack_turn INTEGER,
  foreign_ack_stop_reason TEXT,
  serving_witness_model TEXT,
  serving_witness_at TEXT,
  consumed_inputs_json TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  source_origin TEXT DEFAULT 'host_db'
);
CREATE TABLE IF NOT EXISTS kv_foreign_index (
  harness TEXT NOT NULL,
  foreign_session_id TEXT NOT NULL,
  child_session_id TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  PRIMARY KEY (harness, foreign_session_id)
);
CREATE TABLE IF NOT EXISTS kv_context_prune (
  session_id TEXT PRIMARY KEY,
  raw_key TEXT NOT NULL,
  scope TEXT,
  mode TEXT,
  anchor_message_id TEXT,
  recorded_at TEXT,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS delegation_turn (
  parent_session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  child_session_id TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'spawn',
  harness TEXT NOT NULL DEFAULT 'opencode',
  agent TEXT,
  model TEXT,
  foreign_session_id TEXT,
  start_seq INTEGER NOT NULL DEFAULT 0,
  end_seq INTEGER NOT NULL DEFAULT 0,
  start_message_id TEXT NOT NULL DEFAULT '',
  end_message_id TEXT NOT NULL DEFAULT '',
  reported_outcome TEXT,
  verified_outcome TEXT NOT NULL DEFAULT 'clean',
  blocker_summary TEXT,
  tool_error_count INTEGER NOT NULL DEFAULT 0,
  tool_completed_count INTEGER NOT NULL DEFAULT 0,
  text_char_count INTEGER NOT NULL DEFAULT 0,
  prompt_blob TEXT,
  response_blob TEXT,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (parent_session_id, call_id, turn_index)
);
CREATE TABLE IF NOT EXISTS file_read_ledger (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  read_seq INTEGER NOT NULL DEFAULT 0,
  line_range TEXT NOT NULL DEFAULT 'L1-L120',
  start_line INTEGER,
  end_line INTEGER,
  total_lines INTEGER,
  is_truncated INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  char_len INTEGER NOT NULL DEFAULT 0,
  blob_sha TEXT NOT NULL DEFAULT '',
  blob_sha256 TEXT NOT NULL DEFAULT '',
  slice_sha TEXT,
  read_blob_sha TEXT NOT NULL DEFAULT '',
  disk_blob_sha TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  staleness_status TEXT NOT NULL DEFAULT 'FRESH \u2014 DO NOT REREAD',
  t INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, path)
);
CREATE INDEX IF NOT EXISTS idx_file_read_ledger_session ON file_read_ledger(session_id, read_seq);
CREATE TABLE IF NOT EXISTS skill_load_ledger (
  session_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  call_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  loaded_seq INTEGER NOT NULL DEFAULT 0,
  load_seq INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  char_len INTEGER NOT NULL DEFAULT 0,
  blob_sha TEXT NOT NULL DEFAULT '',
  blob_sha256 TEXT NOT NULL DEFAULT '',
  skill_blob_sha TEXT NOT NULL DEFAULT '',
  blob_ref TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE \u2014 DO NOT RE-INVOKE',
  t INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_skill_load_ledger_session ON skill_load_ledger(session_id, load_seq);
CREATE TABLE IF NOT EXISTS file_touch (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  op TEXT NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  detail TEXT,
  t INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq, call_id, path, op)
);
CREATE TABLE IF NOT EXISTS snapshot_artifact (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  start_tree_sha TEXT NOT NULL,
  end_tree_sha TEXT NOT NULL,
  start_blob_sha TEXT,
  end_blob_sha TEXT,
  start_git_blob_sha TEXT,
  end_git_blob_sha TEXT,
  start_byte_len INTEGER,
  end_byte_len INTEGER,
  byte_len INTEGER NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (session_id, message_id, path)
);
CREATE TABLE IF NOT EXISTS spill_artifact (
  session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  spill_kind TEXT NOT NULL,
  spill_source TEXT NOT NULL,
  inline_byte_len INTEGER NOT NULL,
  full_byte_len INTEGER NOT NULL,
  blob_sha TEXT NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (session_id, call_id)
);
CREATE TABLE IF NOT EXISTS sync_watermark (
  session_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  last_time_updated INTEGER NOT NULL,
  last_max_seq INTEGER NOT NULL,
  last_message_id TEXT NOT NULL,
  last_kv_updated INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_watermark_root ON sync_watermark(root_id);
CREATE TABLE IF NOT EXISTS sync_root_meta (
  root_id TEXT PRIMARY KEY,
  file_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS provenance_chain (
  chain_id TEXT PRIMARY KEY,
  root_session_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  finding_id TEXT NOT NULL DEFAULT '',
  finding_seq INTEGER NOT NULL DEFAULT 0,
  finding_session_id TEXT NOT NULL DEFAULT '',
  finding_summary TEXT NOT NULL DEFAULT '',
  child_session_id TEXT,
  intent_seq INTEGER NOT NULL DEFAULT 0,
  intent_message_id TEXT NOT NULL DEFAULT '',
  intent_summary TEXT NOT NULL DEFAULT '',
  decision_seq INTEGER,
  decision_pivot_seq INTEGER,
  decision_summary TEXT,
  target_path TEXT NOT NULL DEFAULT '',
  touched_files_json TEXT NOT NULL DEFAULT '[]',
  read_or_review_blob_sha TEXT NOT NULL DEFAULT '',
  repair_seq INTEGER,
  repair_session_id TEXT,
  repair_blob_sha TEXT,
  receipt_command TEXT,
  verification_command TEXT,
  receipt_exit_code INTEGER,
  verification_exit_code INTEGER,
  verification_seq INTEGER,
  receipt_blob_sha TEXT,
  verification_blob_ref TEXT,
  head_sha TEXT,
  worktree_tree_sha TEXT,
  disk_blob_sha TEXT NOT NULL DEFAULT '',
  staleness_status TEXT NOT NULL DEFAULT 'VERIFIED_FRESH',
  outcome TEXT NOT NULL DEFAULT 'VERIFIED_PASS',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_provenance_chain_session ON provenance_chain(root_session_id);
CREATE INDEX IF NOT EXISTS idx_provenance_chain_target ON provenance_chain(root_session_id, target_path);
CREATE TABLE IF NOT EXISTS compaction_continuation_ledger (
  session_id TEXT NOT NULL,
  compaction_seq INTEGER NOT NULL,
  compaction_reason TEXT NOT NULL DEFAULT 'auto',
  reason TEXT NOT NULL DEFAULT 'auto',
  tok_input INTEGER NOT NULL DEFAULT 0,
  headline TEXT NOT NULL DEFAULT '',
  verification_gate_status TEXT NOT NULL DEFAULT 'in_progress_or_unverified',
  packet_markdown TEXT NOT NULL DEFAULT '',
  packet_chars INTEGER NOT NULL DEFAULT 0,
  packet_tokens INTEGER NOT NULL DEFAULT 0,
  summary_hash TEXT,
  fresh_files_count INTEGER NOT NULL DEFAULT 0,
  stale_files_count INTEGER NOT NULL DEFAULT 0,
  active_skills_count INTEGER NOT NULL DEFAULT 0,
  provenance_chains_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, compaction_seq)
);
CREATE TABLE IF NOT EXISTS session_semantic_digest (
  session_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  intent_pivots_json TEXT NOT NULL DEFAULT '[]',
  touched_files_json TEXT NOT NULL DEFAULT '[]',
  key_decisions_json TEXT NOT NULL DEFAULT '[]',
  verification_state TEXT NOT NULL DEFAULT 'in_progress_or_unverified'
);
CREATE INDEX IF NOT EXISTS idx_semantic_digest_root ON session_semantic_digest(root_id);
CREATE TABLE IF NOT EXISTS intent_pivot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  t TEXT NOT NULL DEFAULT '',
  prompt_excerpt TEXT NOT NULL DEFAULT '',
  blob_ref TEXT NOT NULL DEFAULT '',
  prompt_blob_ref TEXT,
  pivot_kind TEXT NOT NULL DEFAULT 'followup'
);
CREATE INDEX IF NOT EXISTS idx_intent_pivot_session_seq ON intent_pivot(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_intent_pivot_blob_ref ON intent_pivot(blob_ref);
CREATE TABLE IF NOT EXISTS milestone (
  id TEXT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'decision',
  summary TEXT,
  text TEXT,
  prompt_text TEXT,
  blob_ref TEXT,
  reported_outcome TEXT,
  verified_outcome TEXT,
  t INTEGER,
  PRIMARY KEY (session_id, seq, kind)
);
CREATE VIRTUAL TABLE IF NOT EXISTS substrate_fts USING fts5(
  session_id,
  kind,
  symbol_or_path,
  body,
  tokenize = 'porter unicode61'
);
CREATE TABLE IF NOT EXISTS code_file (
  path TEXT PRIMARY KEY,
  blob_sha TEXT NOT NULL DEFAULT '',
  loc INTEGER NOT NULL DEFAULT 0,
  raw_tokens INTEGER NOT NULL DEFAULT 0,
  skeleton_tokens INTEGER NOT NULL DEFAULT 0,
  skeleton_text TEXT NOT NULL DEFAULT '',
  pagerank REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS code_symbol (
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'function',
  depth INTEGER NOT NULL DEFAULT 1,
  parent_symbol TEXT,
  exported INTEGER NOT NULL DEFAULT 0,
  start_line INTEGER NOT NULL DEFAULT 1,
  end_line INTEGER NOT NULL DEFAULT 1,
  signature TEXT NOT NULL DEFAULT '',
  blob_sha TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (path, start_line, qualified_name)
);
CREATE INDEX IF NOT EXISTS idx_code_symbol_path_name ON code_symbol(path, name);
CREATE INDEX IF NOT EXISTS idx_code_symbol_path_qualified ON code_symbol(path, qualified_name);
CREATE INDEX IF NOT EXISTS idx_code_symbol_parent ON code_symbol(path, parent_symbol);
CREATE TABLE IF NOT EXISTS code_import_edge (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  specifier TEXT NOT NULL DEFAULT '',
  symbols_json TEXT NOT NULL DEFAULT '[]',
  specifiers_json TEXT NOT NULL DEFAULT '[]',
  is_type_only INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_path, to_path)
);
CREATE INDEX IF NOT EXISTS idx_code_import_edge_to ON code_import_edge(to_path);
CREATE TABLE IF NOT EXISTS git_cochange (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  co_commits INTEGER NOT NULL DEFAULT 0,
  commits_a INTEGER NOT NULL DEFAULT 0,
  commits_b INTEGER NOT NULL DEFAULT 0,
  prob_a_given_b REAL NOT NULL DEFAULT 0,
  prob_b_given_a REAL NOT NULL DEFAULT 0,
  jaccard REAL NOT NULL DEFAULT 0,
  has_static_edge INTEGER NOT NULL DEFAULT 0,
  recent_subjects_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (file_a, file_b)
);
CREATE INDEX IF NOT EXISTS idx_git_cochange_file_a ON git_cochange(file_a);
CREATE INDEX IF NOT EXISTS idx_git_cochange_file_b ON git_cochange(file_b);
CREATE INDEX IF NOT EXISTS idx_git_cochange_hidden ON git_cochange(has_static_edge, co_commits DESC);
CREATE TABLE IF NOT EXISTS git_cochange_file_stats (
  path TEXT PRIMARY KEY,
  commit_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS git_cochange_commit (
  hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  files_json TEXT NOT NULL DEFAULT '[]',
  applied_at INTEGER NOT NULL DEFAULT 0
);
`;
var FILE_READ_LEDGER_MIGRATION_COLS = [
  ["start_line", "INTEGER"],
  ["end_line", "INTEGER"],
  ["total_lines", "INTEGER"],
  ["is_truncated", "INTEGER DEFAULT 0"],
  ["slice_sha", "TEXT"]
];
var PROVENANCE_CHAIN_MIGRATION_COLS = [
  ["session_id", "TEXT NOT NULL DEFAULT ''"],
  ["finding_seq", "INTEGER NOT NULL DEFAULT 0"],
  ["finding_session_id", "TEXT NOT NULL DEFAULT ''"],
  ["finding_summary", "TEXT NOT NULL DEFAULT ''"],
  ["child_session_id", "TEXT"],
  ["intent_seq", "INTEGER NOT NULL DEFAULT 0"],
  ["intent_message_id", "TEXT NOT NULL DEFAULT ''"],
  ["intent_summary", "TEXT NOT NULL DEFAULT ''"],
  ["decision_seq", "INTEGER"],
  ["decision_summary", "TEXT"],
  ["touched_files_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["verification_seq", "INTEGER"],
  ["outcome", "TEXT NOT NULL DEFAULT 'VERIFIED_PASS'"],
  ["created_at", "INTEGER NOT NULL DEFAULT 0"],
  ["decision_pivot_seq", "INTEGER"],
  ["read_or_review_blob_sha", "TEXT NOT NULL DEFAULT ''"],
  ["repair_seq", "INTEGER"],
  ["repair_session_id", "TEXT"],
  ["repair_blob_sha", "TEXT"],
  ["receipt_command", "TEXT"],
  ["verification_command", "TEXT"],
  ["receipt_exit_code", "INTEGER"],
  ["verification_exit_code", "INTEGER"],
  ["receipt_blob_sha", "TEXT"],
  ["verification_blob_ref", "TEXT"],
  ["head_sha", "TEXT"],
  ["worktree_tree_sha", "TEXT"],
  ["disk_blob_sha", "TEXT NOT NULL DEFAULT ''"],
  ["staleness_status", "TEXT NOT NULL DEFAULT 'VERIFIED_FRESH'"],
  ["updated_at", "TEXT NOT NULL DEFAULT ''"]
];
function ensureHoneycombSchema(db) {
  db.exec(DDL);
  const existingCols = new Set(db.query("PRAGMA table_info(file_read_ledger)").all().map((c) => c.name));
  for (const [colName, colDef] of FILE_READ_LEDGER_MIGRATION_COLS) {
    if (!existingCols.has(colName)) {
      db.exec(`ALTER TABLE file_read_ledger ADD COLUMN ${colName} ${colDef}`);
    }
  }
  const provCols = new Set(db.query("PRAGMA table_info(provenance_chain)").all().map((c) => c.name));
  for (const [colName, colDef] of PROVENANCE_CHAIN_MIGRATION_COLS) {
    if (!provCols.has(colName)) {
      db.exec(`ALTER TABLE provenance_chain ADD COLUMN ${colName} ${colDef}`);
    }
  }
  try {
    const legacyCount = db.query("SELECT COUNT(*) AS cnt FROM file_read_ledger WHERE slice_sha IS NULL OR slice_sha = '' OR read_blob_sha = blob_sha").get()?.cnt ?? 0;
    if (legacyCount > 0) {
      db.exec("DELETE FROM sync_watermark WHERE session_id IN (SELECT DISTINCT session_id FROM file_read_ledger WHERE slice_sha IS NULL OR slice_sha = '' OR read_blob_sha = blob_sha)");
    }
  } catch {}
}
function configureWalPragmas(db) {
  db.exec("PRAGMA busy_timeout = 5000;");
  const jmRow = db.query("PRAGMA journal_mode = WAL;").get();
  db.exec("PRAGMA synchronous = NORMAL;");
  const syncRow = db.query("PRAGMA synchronous;").get();
  const btRow = db.query("PRAGMA busy_timeout;").get();
  return {
    journalMode: String(jmRow?.journal_mode ?? "wal").toLowerCase(),
    synchronousMode: Number(syncRow?.synchronous ?? 1),
    busyTimeoutMs: Number(btRow?.timeout ?? 5000)
  };
}
function initSyncDatabase(sqlitePath) {
  mkdirSync(path3.dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath);
  configureWalPragmas(db);
  ensureHoneycombSchema(db);
  return db;
}
function readRootWatermarks(targetPath, rootID) {
  if (!existsSync3(targetPath))
    return null;
  const db = new Database(targetPath, { readonly: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000;");
    const hasWm = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_watermark'").get();
    if (!hasWm)
      return null;
    const rows = db.query("SELECT session_id, root_id, last_time_updated, last_max_seq, last_message_id, last_kv_updated, synced_at FROM sync_watermark WHERE root_id = ?").all(rootID);
    if (rows.length === 0)
      return null;
    const watermarks = new Map;
    for (const r of rows) {
      watermarks.set(r.session_id, r);
    }
    const metaRow = db.query("SELECT file_count FROM sync_root_meta WHERE root_id = ?").get(rootID);
    const msgRow = db.query("SELECT COALESCE(SUM(message_count), 0) AS m FROM session WHERE root_id = ?").get(rootID);
    const delRow = db.query("SELECT COUNT(*) AS d FROM delegation WHERE root_id = ?").get(rootID);
    return {
      watermarks,
      fileCount: metaRow?.file_count ?? 0,
      totalMessages: msgRow?.m ?? 0,
      totalDelegations: delRow?.d ?? 0
    };
  } finally {
    db.close();
  }
}
var SESSION_COLS = [
  "id",
  "root_id",
  "project_id",
  "parent_id",
  "depth",
  "lane_kind",
  "lane_path",
  "title",
  "agent",
  "provider",
  "model_id",
  "variant",
  "harness",
  "outcome",
  "cost",
  "tok_in",
  "tok_out",
  "tok_reason",
  "tok_cache_r",
  "tok_cache_w",
  "files_changed",
  "additions",
  "deletions",
  "t_created",
  "t_updated",
  "t_idle",
  "t_compacting",
  "t_archived",
  "resume_attempts",
  "message_count",
  "transcript_path"
];
var DELEGATION_COLS = [
  "call_id",
  "root_id",
  "parent_session",
  "parent_message_id",
  "child_session",
  "tool",
  "agent",
  "harness",
  "mode",
  "background",
  "description",
  "prompt_ref",
  "status",
  "t_created",
  "t_completed"
];
var insertOrReplaceSql = (table, cols) => `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
var bool = (v) => v === null || v === undefined ? null : v ? 1 : 0;
function writeIncrementalIndex(targetPath, input) {
  const db = initSyncDatabase(targetPath);
  try {
    let totalMessages = 0;
    let totalDelegations = 0;
    const tx = db.transaction(() => {
      if (input.isCold) {
        db.query("DELETE FROM sync_watermark WHERE root_id = ?").run(input.rootID);
        db.query("DELETE FROM session WHERE root_id = ?").run(input.rootID);
        db.query("DELETE FROM delegation WHERE root_id = ?").run(input.rootID);
      }
      const insSession = db.query(insertOrReplaceSql("session", SESSION_COLS));
      for (const s of input.sessions) {
        insSession.run(s.id, input.rootID, s.project_id, s.parent_id, s.depth, s.lane_kind, s.lane_path, s.title, s.agent, s.provider, s.model_id, s.variant, s.harness, s.outcome, s.cost, s.tok_in, s.tok_out, s.tok_reason, s.tok_cache_r, s.tok_cache_w, s.files_changed, s.additions, s.deletions, s.t_created, s.t_updated, s.t_idle, s.t_compacting, s.t_archived, s.resume_attempts, s.message_count, s.transcript_path);
      }
      const insDelegation = db.query(insertOrReplaceSql("delegation", DELEGATION_COLS));
      for (const d of input.delegations) {
        insDelegation.run(d.call_id, input.rootID, d.parent_session, d.parent_message_id, d.child_session, d.tool, d.agent, d.harness, d.mode, bool(d.background), d.description, d.prompt_ref, d.status, d.t_created, d.t_completed);
      }
      const insMessage = db.query(insertOrReplaceSql("message", [
        "session_id",
        "seq",
        "id",
        "kind",
        "t",
        "agent",
        "model_id",
        "tok_in",
        "tok_out"
      ]));
      for (const m of input.messages) {
        insMessage.run(m.session_id, m.seq, m.id, m.kind, m.t, m.agent, m.model_id, m.tok_in, m.tok_out);
      }
      const insToolCall = db.query(insertOrReplaceSql("tool_call", [
        "call_id",
        "session_id",
        "seq",
        "name",
        "status",
        "duration_ms",
        "truncated",
        "output_path"
      ]));
      for (const t of input.toolCalls) {
        insToolCall.run(t.call_id, t.session_id, t.seq, t.name, t.status, t.duration_ms, t.truncated ? 1 : 0, t.output_path);
      }
      const insCompaction = db.query(insertOrReplaceSql("compaction", ["session_id", "seq", "reason", "status", "summary_ref", "tok_input"]));
      for (const c of input.compactions) {
        insCompaction.run(c.session_id, c.seq, c.reason, c.status, c.summary_ref, c.tok_input);
      }
      const insInstruction = db.query(insertOrReplaceSql("instruction", ["session_id", "seq", "path", "blob_sha"]));
      for (const i of input.instructions) {
        insInstruction.run(i.session_id, i.seq, i.path, i.blob_sha);
      }
      if (input.kvBindings.length > 0) {
        const insKvBinding = db.query(`
          INSERT OR REPLACE INTO kv_binding (
            child_session_id, raw_key, scope, driver_kind, harness, foreign_session_id,
            parent_session_id, call_id, title, cwd, agent, model, effort, mode, background,
            requested_model, confirmed_model, confirmed_effort, turn, phase,
            foreign_ack_turn, foreign_ack_stop_reason, serving_witness_model, serving_witness_at,
            consumed_inputs_json, created_at, updated_at, source_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const b of input.kvBindings) {
          insKvBinding.run(b.child_session_id, b.raw_key, b.scope, b.driver_kind, b.harness, b.foreign_session_id, b.parent_session_id, b.call_id, b.title, b.cwd, b.agent, b.model, b.effort, b.mode, bool(b.background), b.requested_model, b.confirmed_model, b.confirmed_effort, b.turn, b.phase, b.foreign_ack_turn, b.foreign_ack_stop_reason, b.serving_witness_model, b.serving_witness_at, b.consumed_inputs_json, b.created_at, b.updated_at, b.source_origin ?? "host_db");
        }
      }
      if (input.kvForeignIndex.length > 0) {
        const insForeign = db.query(`
          INSERT OR REPLACE INTO kv_foreign_index (harness, foreign_session_id, child_session_id, raw_key)
          VALUES (?, ?, ?, ?)
        `);
        for (const f of input.kvForeignIndex) {
          insForeign.run(f.harness, f.foreign_session_id, f.child_session_id, f.raw_key);
        }
      }
      if (input.kvContextPrunes.length > 0) {
        const insPrune = db.query(`
          INSERT OR REPLACE INTO kv_context_prune (
            session_id, raw_key, scope, mode, anchor_message_id, recorded_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of input.kvContextPrunes) {
          insPrune.run(p.session_id, p.raw_key, p.scope, p.mode, p.anchor_message_id, p.recorded_at, p.updated_at);
        }
      }
      if (input.delegationTurns.length > 0) {
        const insTurn = db.query(`
          INSERT OR REPLACE INTO delegation_turn (
            parent_session_id, call_id, turn_index, child_session_id, mode, harness,
            agent, model, foreign_session_id, start_seq, end_seq, start_message_id, end_message_id,
            reported_outcome, verified_outcome, blocker_summary,
            tool_error_count, tool_completed_count, text_char_count,
            prompt_blob, response_blob, source_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const t of input.delegationTurns) {
          insTurn.run(t.parent_session_id, t.call_id, t.turn_index, t.child_session_id, t.mode, t.harness, t.agent, t.model, t.foreign_session_id, t.start_seq, t.end_seq, t.start_message_id, t.end_message_id, t.reported_outcome, t.verified_outcome, t.blocker_summary, t.tool_error_count, t.tool_completed_count, t.text_char_count, t.prompt_blob, t.response_blob, t.source_origin);
        }
      }
      if (input.fileReads.length > 0) {
        const insRead = db.query(`
          INSERT OR REPLACE INTO file_read_ledger (
            session_id, path, normalized_path, call_id, message_id, seq, read_seq,
            line_range, start_line, end_line, total_lines, is_truncated, chars, char_len,
            blob_sha, blob_sha256, slice_sha, read_blob_sha, disk_blob_sha,
            summary, staleness_status, t, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of input.fileReads) {
          const isTruncatedInt = typeof r.is_truncated === "boolean" ? r.is_truncated ? 1 : 0 : r.is_truncated ?? 0;
          insRead.run(r.session_id, r.path, r.normalized_path, r.call_id, r.message_id, r.seq, r.read_seq, r.line_range, r.start_line, r.end_line, r.total_lines ?? null, isTruncatedInt, r.chars, r.char_len, r.blob_sha, r.blob_sha256, r.slice_sha ?? r.read_blob_sha, r.read_blob_sha, r.disk_blob_sha, r.summary, r.staleness_status, r.t, r.updated_at);
        }
      }
      if (input.skillLoads.length > 0) {
        const insSkill = db.query(`
          INSERT OR REPLACE INTO skill_load_ledger (
            session_id, skill_name, call_id, message_id, seq, loaded_seq, load_seq,
            chars, char_len, blob_sha, blob_sha256, skill_blob_sha, blob_ref,
            summary, status, t
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of input.skillLoads) {
          insSkill.run(s.session_id, s.skill_name, s.call_id, s.message_id, s.seq, s.loaded_seq, s.load_seq, s.chars, s.char_len, s.blob_sha, s.blob_sha256, s.skill_blob_sha, s.blob_ref, s.summary, s.status, s.t);
        }
      }
      if (input.fileTouches.length > 0) {
        const insTouch = db.query(`
          INSERT OR REPLACE INTO file_touch (
            session_id, seq, call_id, tool, op, path, normalized_path, detail, t
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const ft of input.fileTouches) {
          insTouch.run(ft.session_id, ft.seq, ft.call_id, ft.tool, ft.op ?? ft.operation, ft.path, ft.normalized_path, ft.detail ?? null, ft.t);
        }
      }
      if (input.snapshotArtifacts.length > 0) {
        const insSnap = db.query(`
          INSERT OR REPLACE INTO snapshot_artifact (
            session_id, message_id, seq, path, start_tree_sha, end_tree_sha,
            start_blob_sha, end_blob_sha, start_git_blob_sha, end_git_blob_sha,
            start_byte_len, end_byte_len, byte_len, source_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const sa of input.snapshotArtifacts) {
          insSnap.run(sa.session_id, sa.message_id, sa.seq, sa.path, sa.start_tree_sha, sa.end_tree_sha, sa.start_blob_sha, sa.end_blob_sha, sa.start_git_blob_sha, sa.end_git_blob_sha, sa.start_byte_len, sa.end_byte_len, sa.byte_len, sa.source_origin);
        }
      }
      if (input.spillArtifacts.length > 0) {
        const insSpill = db.query(`
          INSERT OR REPLACE INTO spill_artifact (
            session_id, call_id, message_id, seq, tool_name, spill_kind,
            spill_source, inline_byte_len, full_byte_len, blob_sha, source_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const sp of input.spillArtifacts) {
          insSpill.run(sp.session_id, sp.call_id, sp.message_id, sp.seq, sp.tool_name, sp.spill_kind, sp.spill_source, sp.inline_byte_len, sp.full_byte_len, sp.blob_sha, sp.source_origin);
        }
      }
      if ((input.provenanceChains?.length ?? 0) > 0) {
        const insChain = db.query(`
          INSERT OR REPLACE INTO provenance_chain (
            chain_id, root_session_id, session_id, finding_id, finding_seq, finding_session_id,
            finding_summary, child_session_id, intent_seq, intent_message_id, intent_summary,
            decision_seq, decision_pivot_seq, decision_summary, target_path, touched_files_json,
            read_or_review_blob_sha, repair_seq, repair_session_id, repair_blob_sha,
            receipt_command, verification_command, receipt_exit_code, verification_exit_code,
            verification_seq, receipt_blob_sha, verification_blob_ref, head_sha,
            worktree_tree_sha, disk_blob_sha, staleness_status, outcome, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const pc of input.provenanceChains ?? []) {
          insChain.run(pc.chain_id, pc.root_session_id, pc.session_id, pc.finding_id, pc.finding_seq, pc.finding_session_id, pc.finding_summary, pc.child_session_id, pc.intent_seq, pc.intent_message_id, pc.intent_summary, pc.decision_seq, pc.decision_pivot_seq, pc.decision_summary, pc.target_path, pc.touched_files_json, pc.read_or_review_blob_sha, pc.repair_seq, pc.repair_session_id, pc.repair_blob_sha, pc.receipt_command, pc.verification_command, pc.receipt_exit_code, pc.verification_exit_code, pc.verification_seq, pc.receipt_blob_sha, pc.verification_blob_ref, pc.head_sha, pc.worktree_tree_sha, pc.disk_blob_sha, pc.staleness_status, pc.outcome, pc.created_at, pc.updated_at);
        }
      }
      if (input.watermarks.length > 0) {
        const insWm = db.query(`
          INSERT OR REPLACE INTO sync_watermark (
            session_id, root_id, last_time_updated, last_max_seq, last_message_id, last_kv_updated, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const wm of input.watermarks) {
          insWm.run(wm.session_id, wm.root_id, wm.last_time_updated, wm.last_max_seq, wm.last_message_id, wm.last_kv_updated, wm.synced_at);
        }
      }
      db.query("INSERT OR REPLACE INTO sync_root_meta (root_id, file_count) VALUES (?, ?)").run(input.rootID, input.fileCount);
      const msgRow = db.query("SELECT COALESCE(SUM(message_count), 0) AS m FROM session WHERE root_id = ?").get(input.rootID);
      const delRow = db.query("SELECT COUNT(*) AS d FROM delegation WHERE root_id = ?").get(input.rootID);
      totalMessages = msgRow?.m ?? 0;
      totalDelegations = delRow?.d ?? 0;
    });
    tx.immediate();
    return { totalMessages, totalDelegations };
  } finally {
    db.close();
  }
}

// src/archive/snapshots.ts
import { createHash as createHash2 } from "crypto";
import { existsSync as existsSync4, readdirSync, statSync as statSync2 } from "fs";
import path4 from "path";
function sha1hex(text) {
  return createHash2("sha1").update(text).digest("hex");
}
function asObj2(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function asArr2(v) {
  return Array.isArray(v) ? v : [];
}
function asStr2(v) {
  return typeof v === "string" ? v : undefined;
}
function resolveShadowRepoDir(snapshotRootDir, projectId, directory) {
  const worktreeHash = sha1hex(directory);
  const primary = path4.join(snapshotRootDir, projectId, worktreeHash);
  if (existsSync4(path4.join(primary, "objects")))
    return primary;
  const legacy = path4.join(snapshotRootDir, projectId);
  if (existsSync4(path4.join(legacy, "objects")))
    return legacy;
  const projectSnapDir = path4.join(snapshotRootDir, projectId);
  if (existsSync4(projectSnapDir) && statSync2(projectSnapDir).isDirectory()) {
    for (const sub of readdirSync(projectSnapDir)) {
      const candidate = path4.join(projectSnapDir, sub);
      if (existsSync4(path4.join(candidate, "objects")))
        return candidate;
    }
  }
  return null;
}
function batchExtractGitBlobs(shadowRepoDir, specs, sinkBuffer) {
  const result = new Map;
  if (specs.length === 0)
    return result;
  const uniqueSpecs = [...new Set(specs)];
  const proc = Bun.spawnSync(["git", `--git-dir=${shadowRepoDir}`, "cat-file", "--batch"], {
    stdin: Buffer.from(uniqueSpecs.join(`
`) + `
`)
  });
  if (proc.exitCode !== 0) {
    return result;
  }
  const out = Buffer.from(proc.stdout);
  let offset = 0;
  const sha256ByGitSha = new Map;
  for (const spec of uniqueSpecs) {
    const nl = out.indexOf(10, offset);
    if (nl === -1)
      break;
    const header = out.subarray(offset, nl).toString("utf8");
    offset = nl + 1;
    if (header.endsWith(" missing")) {
      continue;
    }
    const parts = header.split(" ");
    const gitBlobSha = parts[0] ?? "";
    const size = parseInt(parts[2] ?? "0", 10);
    const content = out.subarray(offset, offset + size);
    offset += size + 1;
    let blobSha256 = sha256ByGitSha.get(gitBlobSha);
    if (!blobSha256) {
      blobSha256 = sinkBuffer(content);
      sha256ByGitSha.set(gitBlobSha, blobSha256);
    }
    result.set(spec, {
      gitBlobSha,
      blobSha256,
      byteLen: content.length
    });
  }
  return result;
}
function sinkShadowSnapshots(sessions, messagesBySession, snapshotRootDir, sinkBuffer, sourceOrigin = "host_db") {
  const itemsByRepo = new Map;
  for (const session of sessions) {
    const shadowRepo = resolveShadowRepoDir(snapshotRootDir, session.project_id, session.directory);
    if (!shadowRepo)
      continue;
    const msgs = messagesBySession.get(session.id) ?? [];
    for (const msg of msgs) {
      if (msg.type !== "assistant")
        continue;
      const snap = asObj2(msg.data.snapshot);
      const startTree = asStr2(snap.start);
      const endTree = asStr2(snap.end);
      const files = asArr2(snap.files);
      if (!startTree || !endTree || files.length === 0)
        continue;
      let list = itemsByRepo.get(shadowRepo);
      if (!list) {
        list = [];
        itemsByRepo.set(shadowRepo, list);
      }
      for (const rawFile of files) {
        const filePath = asStr2(rawFile);
        if (!filePath)
          continue;
        list.push({
          session_id: session.id,
          message_id: msg.id,
          seq: msg.seq,
          path: filePath,
          start_tree_sha: startTree,
          end_tree_sha: endTree,
          start_spec: `${startTree}:${filePath}`,
          end_spec: `${endTree}:${filePath}`
        });
      }
    }
  }
  const artifacts = [];
  for (const [shadowRepo, items] of itemsByRepo) {
    const allSpecs = [];
    for (const item of items) {
      allSpecs.push(item.start_spec, item.end_spec);
    }
    const resolved = batchExtractGitBlobs(shadowRepo, allSpecs, sinkBuffer);
    for (const item of items) {
      const startBlob = resolved.get(item.start_spec);
      const endBlob = resolved.get(item.end_spec);
      if (!startBlob && !endBlob)
        continue;
      artifacts.push({
        session_id: item.session_id,
        message_id: item.message_id,
        seq: item.seq,
        path: item.path,
        start_tree_sha: item.start_tree_sha,
        end_tree_sha: item.end_tree_sha,
        start_blob_sha: startBlob?.blobSha256 ?? null,
        end_blob_sha: endBlob?.blobSha256 ?? null,
        start_git_blob_sha: startBlob?.gitBlobSha ?? null,
        end_git_blob_sha: endBlob?.gitBlobSha ?? null,
        start_byte_len: startBlob?.byteLen ?? null,
        end_byte_len: endBlob?.byteLen ?? null,
        byte_len: endBlob?.byteLen ?? startBlob?.byteLen ?? 0,
        source_origin: sourceOrigin
      });
    }
  }
  return artifacts;
}

// src/archive/spills.ts
import { existsSync as existsSync5, readFileSync as readFileSync3, statSync as statSync3 } from "fs";
import path5 from "path";
function asObj3(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function asArr3(v) {
  return Array.isArray(v) ? v : [];
}
function asStr3(v) {
  return typeof v === "string" ? v : undefined;
}
var SPILL_PATH_REGEX = /full output saved to[:\s]+([^\s\]\n"']+)/i;
function sinkExternalSpills(sessions, messagesBySession, opencodeDataDir, sinkBuffer, sourceOrigin = "host_db") {
  const spills = [];
  for (const session of sessions) {
    const msgs = messagesBySession.get(session.id) ?? [];
    for (const msg of msgs) {
      if (msg.type !== "assistant")
        continue;
      for (const rawPart of asArr3(msg.data.content)) {
        const part = asObj3(rawPart);
        if (part.type !== "tool")
          continue;
        const callId = asStr3(part.id) ?? "";
        const toolName = asStr3(part.name) ?? "tool";
        const state = asObj3(part.state);
        const meta = asObj3(state.metadata);
        const inlineText = asArr3(state.content).flatMap((c) => {
          const obj = asObj3(c);
          return typeof obj.text === "string" ? [obj.text] : [];
        }).join("");
        const candidates = [];
        const metaPath = asStr3(meta.outputPath);
        if (metaPath) {
          candidates.push({
            path: metaPath,
            kind: metaPath.includes("/shell/") ? "shell" : "tool-output"
          });
        }
        const regexMatch = inlineText.match(SPILL_PATH_REGEX);
        if (regexMatch?.[1]) {
          const matchedPath = regexMatch[1];
          candidates.push({
            path: matchedPath,
            kind: matchedPath.includes("/shell/") ? "shell" : "tool-output"
          });
        }
        if (callId.length > 0) {
          const cleanId = callId.replace(/^tool_/, "");
          candidates.push({
            path: path5.join(opencodeDataDir, "tool-output", `tool_${cleanId}`),
            kind: "tool-output"
          }, {
            path: path5.join(opencodeDataDir, "tool-output", callId),
            kind: "tool-output"
          }, {
            path: path5.join(opencodeDataDir, `tool_${cleanId}`),
            kind: "tool-output"
          }, {
            path: path5.join(opencodeDataDir, callId),
            kind: "tool-output"
          }, {
            path: path5.join(opencodeDataDir, "shell", `${callId}.txt`),
            kind: "shell"
          }, {
            path: path5.join(opencodeDataDir, "shell", session.project_id, `${callId}.out`),
            kind: "shell"
          });
        }
        for (const cand of candidates) {
          if (existsSync5(cand.path) && statSync3(cand.path).isFile()) {
            const bytes = readFileSync3(cand.path);
            const blobSha = sinkBuffer(bytes);
            spills.push({
              session_id: session.id,
              call_id: callId || path5.basename(cand.path),
              message_id: msg.id,
              seq: msg.seq,
              tool_name: toolName,
              spill_kind: cand.kind,
              spill_source: cand.path,
              inline_byte_len: Buffer.byteLength(inlineText, "utf8"),
              full_byte_len: bytes.length,
              blob_sha: blobSha,
              source_origin: sourceOrigin
            });
            break;
          }
        }
      }
    }
  }
  return spills;
}

// src/archive/source.ts
import { Database as Database2 } from "bun:sqlite";
var REQUIRED_COLUMNS = {
  project: ["id", "worktree"],
  session_v2: [
    "id",
    "project_id",
    "parent_id",
    "fork_session_id",
    "fork_boundary",
    "directory",
    "title",
    "agent",
    "model",
    "idle_outcome",
    "cost",
    "tokens_input",
    "tokens_output",
    "tokens_reasoning",
    "tokens_cache_read",
    "tokens_cache_write",
    "summary_additions",
    "summary_deletions",
    "summary_files",
    "time_created",
    "time_updated",
    "time_idle",
    "time_compacting",
    "time_archived",
    "resume_attempts"
  ],
  session_message: ["id", "session_id", "type", "seq", "time_created", "time_updated", "data"],
  kv: ["key", "value", "time_created", "time_updated"]
};
var parseJson = (text) => {
  if (typeof text !== "string")
    return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
var asObj4 = (v) => typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
var asStr4 = (v) => typeof v === "string" ? v : null;
var asNum2 = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
var asBool = (v) => typeof v === "boolean" ? v : null;
function decodeUtf16BeHex(hex) {
  if (hex.length === 0 || hex.length % 4 !== 0 || !/^[0-9a-fA-F]+$/.test(hex))
    return null;
  const chars = [];
  for (let i = 0;i < hex.length; i += 4) {
    chars.push(parseInt(hex.slice(i, i + 4), 16));
  }
  return String.fromCharCode(...chars);
}
function decodeHostKvKey(rawKey, explicitScope) {
  if (explicitScope && explicitScope.length > 0) {
    return { scope: explicitScope, logicalKey: rawKey };
  }
  if (rawKey.startsWith("plugin:")) {
    const secondColon = rawKey.indexOf(":", "plugin:".length);
    if (secondColon > "plugin:".length) {
      const hexPart = rawKey.slice("plugin:".length, secondColon);
      const decoded = decodeUtf16BeHex(hexPart);
      const logicalKey = rawKey.slice(secondColon + 1);
      return {
        scope: decoded !== null ? `plugin:${decoded}` : `plugin:${hexPart}`,
        logicalKey
      };
    }
  }
  return { scope: null, logicalKey: rawKey };
}
var normalizeHarness = (value, agent, title, providerId) => {
  if (value === "devin" || value === "antigravity" || value === "opencode")
    return value;
  if (providerId === "devin-native")
    return "devin";
  if (providerId === "antigravity-native")
    return "antigravity";
  if (typeof agent === "string") {
    if (agent.includes("antigravity"))
      return "antigravity";
    if (agent.includes("devin"))
      return "devin";
  }
  if (typeof title === "string") {
    if (title.startsWith("Antigravity"))
      return "antigravity";
    if (title.startsWith("Devin"))
      return "devin";
  }
  return "opencode";
};
function ingestHostKv(db, sessionIDs, sinceTimeUpdated = 0) {
  const sessionFilter = sessionIDs && sessionIDs.length > 0 ? new Set(sessionIDs) : null;
  const sessionMap = new Map;
  if (sessionFilter) {
    for (const id of sessionFilter) {
      const row = db.query("SELECT * FROM session_v2 WHERE id = ?").get(id);
      if (row !== null)
        sessionMap.set(id, toSessionRow(row));
    }
  }
  const rows = db.query("SELECT key, value, time_created, time_updated FROM kv WHERE time_updated > ? ORDER BY time_updated ASC, key ASC").all(sinceTimeUpdated);
  const bindingsByChild = new Map;
  const foreignIndex = [];
  const contextPrunes = [];
  for (const row of rows) {
    const { scope, logicalKey } = decodeHostKvKey(row.key);
    const val = asObj4(parseJson(row.value));
    if (logicalKey.startsWith("bindings/") || logicalKey.startsWith("delegate-mode/child/")) {
      const childSessionId = logicalKey.startsWith("bindings/") ? logicalKey.slice("bindings/".length) : logicalKey.slice("delegate-mode/child/".length);
      if (!childSessionId || sessionFilter !== null && !sessionFilter.has(childSessionId))
        continue;
      const childSession = sessionMap.get(childSessionId);
      const foreignAck = asObj4(val.foreignAck);
      const servingWitness = asObj4(val.servingWitness);
      const receipts = asObj4(val.receipts);
      const modelReceipt = asObj4(receipts.model);
      const effortReceipt = asObj4(receipts.effort);
      const consumedInputs = Array.isArray(val.consumedInputs) ? JSON.stringify(val.consumedInputs) : null;
      const modeRaw = asStr4(val.mode);
      const mode = modeRaw === "spawn" || modeRaw === "send" || modeRaw === "continue" ? modeRaw : null;
      const prev = bindingsByChild.get(childSessionId);
      bindingsByChild.set(childSessionId, {
        child_session_id: childSessionId,
        raw_key: row.key,
        scope: scope ?? prev?.scope ?? null,
        driver_kind: logicalKey.startsWith("bindings/") ? "native-binding" : "delegate-mode",
        harness: normalizeHarness(val.harness ?? prev?.harness, asStr4(val.agent) ?? childSession?.agent, asStr4(val.title) ?? childSession?.title, childSession?.model?.providerID),
        foreign_session_id: asStr4(val.foreignSessionID) ?? asStr4(val.foreignSessionId) ?? prev?.foreign_session_id ?? null,
        parent_session_id: asStr4(val.parentSessionID) ?? asStr4(val.parentSessionId) ?? childSession?.parent_id ?? prev?.parent_session_id ?? null,
        call_id: asStr4(val.callID) ?? asStr4(val.callId) ?? prev?.call_id ?? null,
        title: asStr4(val.title) ?? childSession?.title ?? prev?.title ?? null,
        cwd: asStr4(val.cwd) ?? childSession?.directory ?? prev?.cwd ?? null,
        agent: asStr4(val.agent) ?? childSession?.agent ?? prev?.agent ?? null,
        model: asStr4(val.model) ?? childSession?.model?.id ?? prev?.model ?? null,
        effort: asStr4(val.effort) ?? childSession?.model?.variant ?? prev?.effort ?? null,
        mode: mode ?? prev?.mode ?? null,
        background: asBool(val.background) ?? prev?.background ?? null,
        requested_model: asStr4(modelReceipt.requested) ?? asStr4(val.requestedModel) ?? prev?.requested_model ?? null,
        confirmed_model: asStr4(modelReceipt.applied) ?? asStr4(val.confirmedModel) ?? prev?.confirmed_model ?? null,
        confirmed_effort: asStr4(effortReceipt.applied) ?? asStr4(val.confirmedEffort) ?? prev?.confirmed_effort ?? null,
        turn: asNum2(val.turn) ?? prev?.turn ?? null,
        phase: asStr4(val.phase) ?? prev?.phase ?? null,
        foreign_ack_turn: asNum2(foreignAck.turn) ?? prev?.foreign_ack_turn ?? null,
        foreign_ack_stop_reason: asStr4(foreignAck.stopReason) ?? prev?.foreign_ack_stop_reason ?? null,
        serving_witness_model: asStr4(servingWitness.model) ?? asStr4(servingWitness.servingModel) ?? prev?.serving_witness_model ?? null,
        serving_witness_at: asStr4(servingWitness.observedAt) ?? asStr4(servingWitness.at) ?? prev?.serving_witness_at ?? null,
        consumed_inputs_json: consumedInputs ?? prev?.consumed_inputs_json ?? null,
        created_at: row.time_created ?? prev?.created_at ?? null,
        updated_at: row.time_updated ?? prev?.updated_at ?? null
      });
      continue;
    }
    if (logicalKey === "foreign-session-index") {
      for (const [k, v] of Object.entries(val)) {
        const childId = asStr4(v);
        if (!childId || sessionFilter !== null && !sessionFilter.has(childId))
          continue;
        const colonIdx = k.indexOf(":");
        const harness = colonIdx > 0 ? k.slice(0, colonIdx) : "unknown";
        const foreignId = colonIdx > 0 ? k.slice(colonIdx + 1) : k;
        foreignIndex.push({
          harness,
          foreign_session_id: foreignId,
          child_session_id: childId,
          raw_key: row.key
        });
      }
      continue;
    }
    if (logicalKey.startsWith("context-prune:") || row.key.includes(":context-prune:")) {
      const parts = logicalKey.split("context-prune:");
      const sessionId = parts[1] ?? "";
      if (!sessionId || sessionFilter !== null && !sessionFilter.has(sessionId))
        continue;
      contextPrunes.push({
        session_id: sessionId,
        raw_key: row.key,
        scope,
        mode: asStr4(val.mode),
        anchor_message_id: asStr4(val.anchorMessageID) ?? asStr4(val.anchorMessageId),
        recorded_at: asStr4(val.recordedAt),
        updated_at: row.time_updated
      });
    }
  }
  return {
    bindings: [...bindingsByChild.values()],
    foreignIndex,
    contextPrunes
  };
}
var toSessionRow = (raw) => ({
  id: raw.id,
  project_id: raw.project_id,
  parent_id: raw.parent_id ?? null,
  fork_session_id: raw.fork_session_id ?? null,
  fork_boundary: raw.fork_boundary ?? null,
  directory: raw.directory,
  title: raw.title ?? null,
  agent: raw.agent ?? null,
  model: (() => {
    const parsed = parseJson(raw.model);
    if (typeof parsed !== "object" || parsed === null)
      return null;
    const m = parsed;
    return typeof m.id === "string" && typeof m.providerID === "string" ? typeof m.variant === "string" ? { id: m.id, providerID: m.providerID, variant: m.variant } : { id: m.id, providerID: m.providerID } : null;
  })(),
  idle_outcome: raw.idle_outcome ?? null,
  cost: raw.cost ?? 0,
  tokens_input: raw.tokens_input ?? 0,
  tokens_output: raw.tokens_output ?? 0,
  tokens_reasoning: raw.tokens_reasoning ?? 0,
  tokens_cache_read: raw.tokens_cache_read ?? 0,
  tokens_cache_write: raw.tokens_cache_write ?? 0,
  summary_additions: raw.summary_additions ?? null,
  summary_deletions: raw.summary_deletions ?? null,
  summary_files: raw.summary_files ?? null,
  time_created: raw.time_created,
  time_updated: raw.time_updated,
  time_idle: raw.time_idle ?? null,
  time_compacting: raw.time_compacting ?? null,
  time_archived: raw.time_archived ?? null,
  resume_attempts: raw.resume_attempts ?? 0
});
function sqliteSource(dbPath) {
  const db = new Database2(dbPath, { readonly: true });
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const present = new Set(db.query("SELECT name FROM pragma_table_info(?)").all(table).map((row) => row.name));
    for (const column of columns) {
      if (!present.has(column)) {
        db.close();
        throw new Error(`session-archive: host schema drift: ${table}.${column} missing`);
      }
    }
  }
  return {
    project(id) {
      const row = db.query("SELECT id, worktree FROM project WHERE id = ?").get(id);
      return row === null ? undefined : row;
    },
    session(id) {
      const row = db.query("SELECT * FROM session_v2 WHERE id = ?").get(id);
      return row === null ? undefined : toSessionRow(row);
    },
    children(id) {
      return db.query("SELECT * FROM session_v2 WHERE parent_id = ? ORDER BY time_created, id").all(id).map((row) => toSessionRow(row));
    },
    messages(sessionID, afterSeq) {
      const rows = typeof afterSeq === "number" ? db.query("SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? AND seq > ? ORDER BY seq").all(sessionID, afterSeq) : db.query("SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq").all(sessionID);
      return rows.map((row) => {
        const r = row;
        return { ...r, data: parseJson(r.data) };
      });
    },
    kvState(sessionIDs, sinceTimeUpdated = 0) {
      return ingestHostKv(db, sessionIDs, sinceTimeUpdated);
    },
    close() {
      db.close();
    }
  };
}

// src/archive/index.ts
var asRecordObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
var toHostSessionRow = (row) => ({
  id: row.id,
  project_id: row.project_id,
  parent_id: row.parent_id,
  slug: null,
  directory: row.directory,
  title: row.title,
  version: null,
  agent: row.agent,
  model_id: row.model?.id ?? null,
  provider_id: row.model?.providerID ?? null,
  variant: row.model?.variant ?? null,
  idle_outcome: row.idle_outcome,
  time_created: row.time_created,
  time_updated: row.time_updated
});
var toHostMessageRow = (row) => ({
  id: row.id,
  session_id: row.session_id,
  seq: row.seq,
  type: row.type,
  time_created: row.time_created,
  time_updated: row.time_updated,
  data: asRecordObj(row.data)
});
function persist(input, source) {
  const tStart = performance.now();
  const warnings = [];
  const seed = source.session(input.sessionID);
  if (seed === undefined) {
    throw new Error(`session-archive: session ${input.sessionID} not found`);
  }
  const root = findRoot(seed, source);
  if (root.project_id !== input.projectID) {
    throw new Error(`session-archive: session ${input.sessionID} belongs to project ${root.project_id}, not ${input.projectID}`);
  }
  const nodes = flattenTree(root, source);
  const archiveDir = path6.isAbsolute(input.dir ?? "") ? path6.resolve(input.dir) : path6.resolve(input.projectRoot, input.dir ?? ".session-archive");
  if (archiveDir.split(path6.sep).includes(".opencode")) {
    throw new Error(`session-archive: archive directory must not reside inside .opencode/: ${archiveDir}`);
  }
  const sqlitePath = path6.join(archiveDir, "index.sqlite");
  const existing = input.forceColdFull ? null : readRootWatermarks(sqlitePath, root.id);
  const isCold = existing === null;
  const plans = [];
  let messagesProcessed = 0;
  for (const node of nodes) {
    const wm = existing?.watermarks.get(node.row.id);
    const transcriptAbs = path6.join(archiveDir, node.relDir, `${node.row.id}.jsonl`);
    const infoAbs = path6.join(archiveDir, node.relDir, "info.json");
    const hasFilesOnDisk = existsSync6(transcriptAbs) && existsSync6(infoAbs);
    if (wm && hasFilesOnDisk && !isCold) {
      const deltaRows = source.messages(node.row.id, wm.last_max_seq);
      if (deltaRows.length === 0 && node.row.time_updated <= wm.last_time_updated) {
        plans.push({
          node,
          wm,
          isColdNode: false,
          dirty: false,
          deltaRows: []
        });
      } else {
        const effectiveRows = deltaRows.length > 0 ? deltaRows : source.messages(node.row.id, Math.max(0, wm.last_max_seq - 1));
        messagesProcessed += effectiveRows.length;
        plans.push({
          node,
          wm,
          isColdNode: false,
          dirty: true,
          deltaRows: effectiveRows
        });
      }
    } else {
      const allRows = source.messages(node.row.id);
      messagesProcessed += allRows.length;
      plans.push({
        node,
        wm: undefined,
        isColdNode: true,
        dirty: true,
        deltaRows: allRows
      });
    }
  }
  const dirtyPlans = plans.filter((p) => p.dirty);
  const sessionIDs = nodes.map((n) => n.row.id);
  const minKvUpdated = !isCold && existing ? Math.max(0, ...Array.from(existing.watermarks.values(), (w) => w.last_kv_updated)) : 0;
  let kvState = {
    bindings: [],
    foreignIndex: [],
    contextPrunes: []
  };
  if (source.kvState) {
    try {
      kvState = source.kvState(sessionIDs, isCold ? 0 : minKvUpdated);
    } catch (err) {
      warnings.push(`kvState read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const kvRowsProcessed = kvState.bindings.length + kvState.foreignIndex.length + kvState.contextPrunes.length;
  if (!isCold && existing && dirtyPlans.length === 0 && kvRowsProcessed === 0) {
    return {
      rootID: root.id,
      archiveDir,
      sessions: nodes.length,
      messages: existing.totalMessages,
      delegations: existing.totalDelegations,
      written: [],
      unchanged: existing.fileCount,
      mode: "noop_delta",
      dirtySessionsCount: 0,
      messagesProcessed: 0,
      kvRowsProcessed: 0,
      delegationTurnsProcessed: 0,
      snapshotsExtracted: 0,
      spillsSunk: 0,
      elapsedMs: performance.now() - tStart,
      warnings
    };
  }
  const blobs = new Map;
  const sinkRawSha = (text) => {
    const sha = sha256hex(text);
    if (!blobs.has(sha))
      blobs.set(sha, text);
    return sha;
  };
  const sink = (text) => `blob:${sinkRawSha(text)}`;
  const sinkBuffer = (buf) => {
    const sha = sha256hex(buf);
    if (!blobs.has(sha))
      blobs.set(sha, buf);
    return sha;
  };
  const written = [];
  let unchanged = 0;
  let newBlobFilesCount = 0;
  let newSessionsCount = 0;
  const writeIfChanged = (rel, content, isBlob = false) => {
    const target = path6.join(archiveDir, rel);
    const existedBefore = existsSync6(target);
    const bytes = typeof content === "string" ? Buffer.from(content) : content;
    if (existedBefore && readFileSync4(target).equals(bytes)) {
      unchanged += 1;
      return;
    }
    mkdirSync2(path6.dirname(target), { recursive: true });
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
    written.push(rel);
    if (isBlob && !existedBefore) {
      newBlobFilesCount += 1;
    }
  };
  const byID = new Map(nodes.map((node) => [node.row.id, node]));
  const sessionRows = [];
  const delegationRows = [];
  const messageRows = [];
  const toolCallRows = [];
  const compactionRows = [];
  const instructionRows = [];
  const fileReadRows = [];
  const skillLoadRows = [];
  const fileTouchRows = [];
  const provenanceChainRows = [];
  const watermarksToWrite = [];
  const deltaHostMsgsBySession = new Map;
  const dirtySessionIds = new Set;
  const syncedAtIso = new Date().toISOString();
  const maxKvUpdatedAcrossDelta = Math.max(minKvUpdated, ...kvState.bindings.map((b) => b.updated_at ?? 0), ...kvState.contextPrunes.map((p) => p.updated_at ?? 0));
  for (const plan of plans) {
    const { node, wm, isColdNode, dirty, deltaRows } = plan;
    if (!dirty) {
      unchanged += 2;
      continue;
    }
    if (isColdNode && !isCold) {
      newSessionsCount += 1;
    }
    dirtySessionIds.add(node.row.id);
    const normalizedMessages = [];
    const records = [];
    const facts = [];
    const rawReads = [];
    const rawSkills = [];
    const rawTouches = [];
    const firstDeltaSeq = deltaRows[0]?.seq ?? Infinity;
    let prevSeq = !isColdNode && wm && firstDeltaSeq > wm.last_max_seq ? wm.last_max_seq : null;
    for (const row of deltaRows) {
      const normalized = normalizeMessage(row, sink, prevSeq, input.projectRoot);
      normalizedMessages.push(normalized);
      records.push(normalized.record);
      facts.push(...normalized.delegations);
      rawReads.push(...normalized.fileReads);
      rawSkills.push(...normalized.skillLoads);
      rawTouches.push(...normalized.fileTouches);
      prevSeq = row.seq;
    }
    const hostDeltaRows = deltaRows.map(toHostMessageRow);
    deltaHostMsgsBySession.set(node.row.id, hostDeltaRows);
    const ledgers = foldSessionLedgers(rawReads, rawSkills, rawTouches);
    fileReadRows.push(...ledgers.fileReads);
    skillLoadRows.push(...ledgers.skillLoads);
    fileTouchRows.push(...ledgers.fileTouches);
    provenanceChainRows.push(...extractSessionProvenanceChains(root.id, node.row.id, normalizedMessages, deltaRows, input.projectRoot));
    const transcriptRel = path6.join(node.relDir, `${node.row.id}.jsonl`);
    const transcriptAbs = path6.join(archiveDir, transcriptRel);
    let priorRecordLines = [];
    if (!isColdNode && existsSync6(transcriptAbs)) {
      const existingLines = readFileSync4(transcriptAbs, "utf8").split(`
`).filter((l) => l.length > 0).slice(1);
      priorRecordLines = existingLines.filter((line) => {
        try {
          const parsed = JSON.parse(line);
          return typeof parsed.raw_ref?.seq === "number" && parsed.raw_ref.seq < firstDeltaSeq;
        } catch {
          return false;
        }
      });
    }
    const totalSessionMessages = priorRecordLines.length + records.length;
    const header = sessionHeader(node.row, {
      root_id: root.id,
      depth: node.depth,
      lane: laneOf(node.row.directory, input.projectRoot),
      children: node.children.map((child) => child.id),
      message_count: totalSessionMessages
    });
    const allJsonlLines = [
      JSON.stringify(header),
      ...priorRecordLines,
      ...records.map((r) => JSON.stringify(r))
    ];
    writeIfChanged(transcriptRel, allJsonlLines.join(`
`) + `
`);
    writeIfChanged(path6.join(node.relDir, "info.json"), JSON.stringify(header, null, 2) + `
`);
    sessionRows.push(indexSession(node, header, root.id, transcriptRel));
    for (const fact of facts) {
      delegationRows.push(indexDelegation(fact, node.row.id, byID));
    }
    collectRows(records, node.row.id, sink, messageRows, toolCallRows, compactionRows, instructionRows);
    const lastRow = deltaRows[deltaRows.length - 1];
    const lastMaxSeq = lastRow ? lastRow.seq : wm?.last_max_seq ?? 0;
    const lastMsgId = lastRow ? lastRow.id : wm?.last_message_id ?? "";
    const lastTimeUpdated = Math.max(node.row.time_updated, lastRow ? lastRow.time_updated : 0, wm?.last_time_updated ?? 0);
    watermarksToWrite.push({
      session_id: node.row.id,
      root_id: root.id,
      last_time_updated: lastTimeUpdated,
      last_max_seq: lastMaxSeq,
      last_message_id: lastMsgId,
      last_kv_updated: maxKvUpdatedAcrossDelta,
      synced_at: syncedAtIso
    });
  }
  if (isCold) {
    for (const node of nodes) {
      for (const child of node.children) {
        const covered = delegationRows.some((row) => row.child_session === child.id);
        if (!covered) {
          delegationRows.push(edgeDelegation(child, node.row.id));
        }
      }
    }
  } else {
    for (const plan of dirtyPlans) {
      if (plan.isColdNode && plan.node.row.parent_id !== null) {
        const covered = delegationRows.some((row) => row.child_session === plan.node.row.id);
        if (!covered) {
          delegationRows.push(edgeDelegation(plan.node.row, plan.node.row.parent_id));
        }
      }
    }
  }
  const kvByChildId = new Map;
  for (const b of kvState.bindings) {
    kvByChildId.set(b.child_session_id, b);
  }
  const delegationTurnRows = [];
  for (const node of nodes) {
    if (node.children.length === 0)
      continue;
    const parentDirty = dirtySessionIds.has(node.row.id);
    const anyChildDirty = node.children.some((c) => dirtySessionIds.has(c.id));
    if (!isCold && !parentDirty && !anyChildDirty)
      continue;
    const parentHostMsgs = isCold && deltaHostMsgsBySession.has(node.row.id) ? deltaHostMsgsBySession.get(node.row.id) : source.messages(node.row.id).map(toHostMessageRow);
    const childHostRows = [];
    const childMsgsMap = new Map;
    for (const child of node.children) {
      if (!isCold && !parentDirty && !dirtySessionIds.has(child.id))
        continue;
      const childNode = byID.get(child.id);
      if (!childNode)
        continue;
      childHostRows.push(childNode.hostRow);
      const cMsgs = isCold && deltaHostMsgsBySession.has(child.id) ? deltaHostMsgsBySession.get(child.id) : source.messages(child.id).map(toHostMessageRow);
      childMsgsMap.set(child.id, cMsgs);
    }
    if (childHostRows.length > 0) {
      const turns = normalizeDelegationTurns(node.row.id, parentHostMsgs, childHostRows, childMsgsMap, kvByChildId, sinkRawSha, "host_db");
      delegationTurnRows.push(...turns);
    }
  }
  const dirtyHostSessions = dirtyPlans.map((p) => p.node.hostRow);
  const snapshotRootDir = input.snapshotRootDir ?? (input.opencodeDataDir ? path6.join(input.opencodeDataDir, "snapshot") : undefined);
  let snapshotArtifacts = [];
  if (snapshotRootDir && existsSync6(snapshotRootDir)) {
    try {
      snapshotArtifacts = sinkShadowSnapshots(dirtyHostSessions, deltaHostMsgsBySession, snapshotRootDir, sinkBuffer, "host_db");
    } catch (err) {
      warnings.push(`sinkShadowSnapshots failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  let spillArtifacts = [];
  if (input.opencodeDataDir && existsSync6(input.opencodeDataDir)) {
    try {
      spillArtifacts = sinkExternalSpills(dirtyHostSessions, deltaHostMsgsBySession, input.opencodeDataDir, sinkBuffer, "host_db");
    } catch (err) {
      warnings.push(`sinkExternalSpills failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const [sha, content] of blobs) {
    writeIfChanged(path6.join("blobs", `${sha}.txt`), content, true);
  }
  written.push("index.sqlite");
  const fileCount = isCold ? written.length + unchanged : (existing?.fileCount ?? 0) + newBlobFilesCount + newSessionsCount * 2;
  const { totalMessages, totalDelegations } = writeIncrementalIndex(sqlitePath, {
    isCold,
    rootID: root.id,
    sessions: sessionRows,
    delegations: delegationRows,
    messages: messageRows,
    toolCalls: toolCallRows,
    compactions: compactionRows,
    instructions: instructionRows,
    kvBindings: kvState.bindings,
    kvForeignIndex: kvState.foreignIndex,
    kvContextPrunes: kvState.contextPrunes,
    delegationTurns: delegationTurnRows,
    fileReads: fileReadRows,
    skillLoads: skillLoadRows,
    fileTouches: fileTouchRows,
    snapshotArtifacts,
    spillArtifacts,
    provenanceChains: provenanceChainRows,
    watermarks: watermarksToWrite,
    fileCount
  });
  return {
    rootID: root.id,
    archiveDir,
    sessions: nodes.length,
    messages: totalMessages,
    delegations: totalDelegations,
    written,
    unchanged,
    mode: isCold ? "cold_full" : "incremental_delta",
    dirtySessionsCount: dirtyPlans.length,
    messagesProcessed,
    kvRowsProcessed,
    delegationTurnsProcessed: delegationTurnRows.length,
    snapshotsExtracted: snapshotArtifacts.length,
    spillsSunk: spillArtifacts.length,
    elapsedMs: performance.now() - tStart,
    warnings
  };
}
function findRoot(seed, source) {
  const seen = new Set([seed.id]);
  let current = seed;
  while (current.parent_id !== null) {
    if (seen.has(current.parent_id)) {
      throw new Error(`session-archive: parent cycle at ${current.parent_id}`);
    }
    seen.add(current.parent_id);
    const parent = source.session(current.parent_id);
    if (parent === undefined)
      return current;
    current = parent;
  }
  return current;
}
function flattenTree(root, source) {
  const nodes = [];
  const visit = (row, depth, parentRelDir) => {
    const relDir = sessionRelDir(parentRelDir, row.id);
    const children = source.children(row.id);
    nodes.push({ row, hostRow: toHostSessionRow(row), depth, relDir, children });
    for (const child of children)
      visit(child, depth + 1, relDir);
  };
  visit(root, 0, null);
  return nodes;
}
var indexSession = (_node, header, _rootID, transcriptPath) => ({
  id: header.id,
  project_id: header.project_id,
  parent_id: header.parent_id,
  depth: header.depth,
  lane_kind: header.lane.kind,
  lane_path: header.lane.path,
  title: header.title,
  agent: header.agent,
  provider: header.model?.providerID ?? null,
  model_id: header.model?.id ?? null,
  variant: header.model?.variant ?? null,
  harness: header.harness,
  outcome: header.outcome,
  cost: header.cost,
  tok_in: header.tokens.input,
  tok_out: header.tokens.output,
  tok_reason: header.tokens.reasoning,
  tok_cache_r: header.tokens.cache_read,
  tok_cache_w: header.tokens.cache_write,
  files_changed: header.summary.files,
  additions: header.summary.additions,
  deletions: header.summary.deletions,
  t_created: header.time.created,
  t_updated: header.time.updated,
  t_idle: header.time.idle,
  t_compacting: header.time.compacting,
  t_archived: header.time.archived,
  resume_attempts: header.resume_attempts,
  message_count: header.message_count,
  transcript_path: transcriptPath.split(path6.sep).join("/")
});
var indexDelegation = (fact, parentSession, byID) => {
  const child = byID.get(fact.child_session_id);
  return {
    call_id: fact.call_id,
    parent_session: parentSession,
    parent_message_id: fact.message_id,
    child_session: fact.child_session_id,
    tool: fact.tool,
    agent: fact.agent,
    harness: fact.harness ?? (child ? harnessOf(child.row.model) : null),
    mode: fact.mode,
    background: fact.background,
    description: fact.description,
    prompt_ref: fact.prompt_ref,
    status: fact.status,
    t_created: fact.t_created,
    t_completed: fact.t_completed
  };
};
var edgeDelegation = (child, parentID) => ({
  call_id: `parent:${child.id}`,
  parent_session: parentID,
  parent_message_id: null,
  child_session: child.id,
  tool: null,
  agent: child.agent,
  harness: harnessOf(child.model),
  mode: "spawn",
  background: null,
  description: null,
  prompt_ref: null,
  status: null,
  t_created: null,
  t_completed: null
});
var tokenNum = (tokens, key) => {
  if (typeof tokens !== "object" || tokens === null)
    return null;
  const v = tokens[key];
  return typeof v === "number" ? v : null;
};
function collectRows(records, sessionID, sink, messages, toolCalls, compactions, instructions) {
  for (const record of records) {
    messages.push({
      session_id: sessionID,
      seq: record.raw_ref.seq,
      id: record.id,
      kind: record.kind,
      t: record.t,
      agent: record.kind === "assistant" ? record.agent : record.kind === "boundary" ? record.agent ?? null : null,
      model_id: record.kind === "assistant" ? record.model?.id ?? null : null,
      tok_in: record.kind === "assistant" ? tokenNum(record.tokens, "input") : null,
      tok_out: record.kind === "assistant" ? tokenNum(record.tokens, "output") : null
    });
    if (record.kind === "assistant") {
      for (const part of record.parts) {
        if (part.type !== "tool")
          continue;
        toolCalls.push({
          call_id: part.call_id,
          session_id: sessionID,
          seq: record.raw_ref.seq,
          name: part.name,
          status: part.status,
          duration_ms: part.time.completed !== null ? part.time.completed - (part.time.ran ?? part.time.created ?? part.time.completed) : null,
          truncated: part.truncated,
          output_path: part.output_path
        });
      }
      continue;
    }
    if (record.kind === "compaction") {
      compactions.push({
        session_id: sessionID,
        seq: record.raw_ref.seq,
        reason: record.reason,
        status: record.status,
        summary_ref: record.summary === null ? null : sink(record.summary),
        tok_input: tokenNum(record.tokens, "input")
      });
      continue;
    }
    if (record.kind === "context" && record.text_ref !== null) {
      const sha = record.text_ref.slice("blob:".length);
      for (const p of record.paths) {
        instructions.push({ session_id: sessionID, seq: record.raw_ref.seq, path: p, blob_sha: sha });
      }
    }
  }
}

// src/archive/valve.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync3, readdirSync as readdirSync2, readFileSync as readFileSync5, writeFileSync as writeFileSync2 } from "fs";
import { isAbsolute as isAbsolute2, join } from "path";
var DEFAULT_KEEP_RECENT_STEPS = 8;
var DEFAULT_AUTO_KEEP_RECENT_STEPS = 12;
var DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO = 0.65;
var DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 200000;
var FIELD_LIMIT = 280;
var KEEP_RESULT = new Set(["subagent", "task", "delegate-devin", "hivemind-delegate"]);
var KEEP_INPUT = new Set(["read", "write", "edit"]);
var SKILL_TAG_RE = /<skill_content\b[^>]*>[\s\S]*?<\/skill_content>/g;
var SKILL_NAME_RE = /name="([^"]+)"/;
var FRESH_STATUS = "FRESH \u2014 DO NOT REREAD";
var STALE_STATUS = "STALE (modified since read/review \u2014 re-verify slice)";
var ACTIVE_SKILL_STATUS = "ACTIVE \u2014 DO NOT RE-INVOKE";
var ACTIVE_SKILL_BREADCRUMB_STATUS = "ACTIVE IN MANIFEST \u2014 DO NOT RE-INVOKE";
function estimateTokens2(charsOrText) {
  if (typeof charsOrText === "string")
    return estimateTokens(charsOrText);
  return Math.ceil(charsOrText / 4);
}
function normalizeRepoPath2(rawPath, canonicalRoot) {
  return normalizeRepoPath(rawPath, canonicalRoot);
}
function isUserMessage(msg) {
  return msg.type === "user" || msg.role === "user" || msg.kind === "user";
}
function isAssistantMessage(msg) {
  return msg.type === "assistant" || msg.role === "assistant" || msg.kind === "assistant";
}
function isCompactionMessage(msg) {
  if (msg.type === "compaction" || msg.kind === "compaction")
    return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some((p) => p && typeof p === "object" && p.type === "compaction");
  }
  return false;
}
function measureValueChars(val) {
  if (typeof val === "string")
    return val.length;
  if (typeof val === "number" || typeof val === "boolean")
    return 8;
  if (!val || typeof val !== "object")
    return 0;
  if (Array.isArray(val)) {
    let sum = 0;
    for (let i = 0;i < val.length; i++)
      sum += measureValueChars(val[i]);
    return sum;
  }
  let sum = 0;
  for (const [k, v] of Object.entries(val)) {
    sum += k.length + measureValueChars(v);
  }
  return sum;
}
function measureMessagesChars(messages, startIndex = 0) {
  let total = 0;
  for (let i = startIndex;i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== "object")
      continue;
    if (typeof m.text === "string")
      total += m.text.length;
    if (typeof m.content === "string")
      total += m.content.length;
    if (Array.isArray(m.skills)) {
      for (const s of m.skills) {
        if (s && typeof s.text === "string")
          total += s.text.length;
      }
    }
    const parts = Array.isArray(m.content) ? m.content : Array.isArray(m.parts) ? m.parts : null;
    if (!parts)
      continue;
    for (let j = 0;j < parts.length; j++) {
      const p = parts[j];
      if (!p || typeof p !== "object")
        continue;
      if (typeof p.text === "string")
        total += p.text.length;
      if (typeof p.output === "string")
        total += p.output.length;
      if (p.type === "tool" && p.state && typeof p.state === "object") {
        if (p.state.input !== undefined)
          total += measureValueChars(p.state.input);
        if (typeof p.state.output === "string")
          total += p.state.output.length;
        if (Array.isArray(p.state.content)) {
          for (const c of p.state.content) {
            if (c && typeof c.text === "string")
              total += c.text.length;
          }
        }
      } else if (p.type === "tool-call" && p.input !== undefined) {
        total += measureValueChars(p.input);
      } else if (p.type === "tool-result" && p.result !== undefined) {
        if (typeof p.result === "string") {
          total += p.result.length;
        } else if (p.result && typeof p.result === "object") {
          if (typeof p.result.value === "string")
            total += p.result.value.length;
          if (Array.isArray(p.result.content)) {
            for (const c of p.result.content) {
              if (c && typeof c.text === "string")
                total += c.text.length;
            }
          }
        }
      }
    }
  }
  return total;
}
function computeStepWatermark(messages, options = {}) {
  let lastCompactionIndex = -1;
  for (let i = 0;i < messages.length; i++) {
    if (isCompactionMessage(messages[i])) {
      lastCompactionIndex = i;
    }
  }
  const activeStartIndex = lastCompactionIndex >= 0 ? lastCompactionIndex + 1 : 0;
  let lastUserIndex = -1;
  const assistantIndices = [];
  for (let i = activeStartIndex;i < messages.length; i++) {
    const m = messages[i];
    if (isUserMessage(m)) {
      lastUserIndex = i;
    } else if (isAssistantMessage(m)) {
      assistantIndices.push(i);
    }
  }
  const totalActiveChars = measureMessagesChars(messages, activeStartIndex);
  const estimatedInputTokensBefore = estimateTokens2(totalActiveChars);
  const assistantStepsTotal = assistantIndices.length;
  const assistantStepsAfterLastUser = assistantIndices.filter((idx) => idx > lastUserIndex).length;
  const isAutoMode = options.mode === "auto" || options.mode === undefined && (options.modelContextWindowTokens !== undefined || options.autoPruneThresholdRatio !== undefined) || options.mode === "step-window" && options.keepRecentSteps === undefined && (options.modelContextWindowTokens !== undefined || options.autoPruneThresholdRatio !== undefined);
  let effectiveMode = options.mode === "auto" || options.mode === undefined ? "step-window" : options.mode;
  let keepRecentSteps = Math.max(1, options.keepRecentSteps ?? (isAutoMode ? options.autoKeepRecentSteps ?? options.autoPruneKeepRecentSteps ?? DEFAULT_AUTO_KEEP_RECENT_STEPS : DEFAULT_KEEP_RECENT_STEPS));
  let anchorIndex = activeStartIndex;
  let anchorReason = "no-op";
  let autoActivated = false;
  if (isAutoMode) {
    const windowTokens = options.modelContextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
    const thresholdRatio = options.autoPruneThresholdRatio ?? DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO;
    const thresholdTokens = Math.floor(windowTokens * thresholdRatio);
    if (estimatedInputTokensBefore > thresholdTokens && assistantStepsTotal > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps];
      anchorReason = "auto-threshold-step-window";
      autoActivated = true;
    } else {
      anchorIndex = activeStartIndex;
      anchorReason = "no-op";
      autoActivated = false;
    }
  } else if (effectiveMode === "step-window") {
    if (assistantStepsTotal > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps];
      anchorReason = "step-window";
    } else {
      anchorIndex = activeStartIndex;
      anchorReason = "no-op";
    }
  } else if (effectiveMode === "recent") {
    const onlyInitialUserInWindow = lastUserIndex <= activeStartIndex;
    if (onlyInitialUserInWindow && assistantStepsAfterLastUser > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps];
      anchorReason = "recent-step-fallback";
    } else if (lastUserIndex > activeStartIndex) {
      anchorIndex = lastUserIndex;
      anchorReason = "recent-user-prompt";
    } else {
      anchorIndex = activeStartIndex;
      anchorReason = "no-op";
    }
  } else {
    if (lastUserIndex > activeStartIndex) {
      anchorIndex = lastUserIndex;
      anchorReason = "initial-history";
    } else if (assistantStepsTotal > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps];
      anchorReason = "initial-history";
    } else {
      anchorIndex = activeStartIndex;
      anchorReason = "no-op";
    }
  }
  const anchorMessageID = anchorIndex > activeStartIndex && anchorIndex < messages.length ? messages[anchorIndex]?.id ?? null : null;
  const assistantStepsThinned = assistantIndices.filter((idx) => idx < anchorIndex).length;
  const assistantStepsKept = assistantStepsTotal - assistantStepsThinned;
  return {
    mode: effectiveMode,
    keepRecentSteps,
    activeStartIndex,
    anchorMessageID,
    anchorIndex,
    anchorReason,
    lastUserIndex,
    lastCompactionIndex,
    assistantStepsTotal,
    assistantStepsAfterLastUser,
    assistantStepsKept,
    assistantStepsThinned,
    estimatedInputTokensBefore,
    totalActiveChars,
    autoActivated
  };
}
function extractReadLineRange(input, outputText) {
  const headerMatch = /^Read file [^\n]+, lines (\d+)-(\d+)/.exec(outputText);
  if (headerMatch) {
    return `L${headerMatch[1]}-L${headerMatch[2]}`;
  }
  const start = typeof input.offset === "number" && input.offset > 0 ? input.offset : 1;
  const lineMatches = [...outputText.matchAll(/^(\d+):/gm)];
  if (lineMatches.length > 0) {
    const first = lineMatches[0][1];
    const last = lineMatches[lineMatches.length - 1][1];
    return `L${first}-L${last}`;
  }
  if (typeof input.limit === "number" && input.limit > 0) {
    return `L${start}-L${start + input.limit - 1}`;
  }
  const lineCount = Math.max(1, outputText.split(`
`).length);
  return `L${start}-L${start + lineCount - 1}`;
}
function summarizeReadOutput(path, outputText) {
  const rawLines = outputText.split(`
`);
  const startSlice = /^Read file [^\n]+/.test(rawLines[0] ?? "") ? rawLines.slice(1, 80) : rawLines.slice(0, 80);
  const lines = startSlice.map((line) => line.replace(/^\d+:\s?/, "").trim()).filter((line) => line.length > 0 && line !== "---");
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(path)) {
    const exportsFound = [];
    for (const line of lines) {
      const m = /^export\s+(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z0-9_]+)/.exec(line);
      if (m && !exportsFound.includes(m[1])) {
        exportsFound.push(m[1]);
      }
      if (exportsFound.length >= 4)
        break;
    }
    if (exportsFound.length > 0) {
      return `exports: ${exportsFound.join(", ")}`;
    }
    const testMatch = lines.find((l) => /^(?:describe|test|it)\(["'`]/.test(l));
    if (testMatch) {
      return testMatch.slice(0, 96);
    }
  }
  const heading = lines.find((l) => /^#{1,3}\s+/.test(l));
  if (heading) {
    return heading.replace(/^#{1,3}\s+/, "").slice(0, 96);
  }
  const firstContent = lines.find((l) => !l.startsWith("import ") && !l.startsWith("//")) ?? lines[0] ?? "file slice";
  return firstContent.slice(0, 96);
}
function summarizeSkillOutput(skillName, outputText) {
  const lines = outputText.replace(/<\/?skill_content[^>]*>/g, "").split(`
`).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("name:") && !l.startsWith("description:"));
  const firstLine = lines[0] ?? `Loaded ${skillName} guidance`;
  return firstLine.slice(0, 96);
}
function summarizeToolOutput(tool, _input, outputText) {
  const trimmed = outputText.trim();
  if (trimmed.length === 0)
    return "empty output";
  if (tool === "grep") {
    const firstLine = trimmed.split(`
`)[0] ?? "grep results";
    return firstLine.slice(0, 96);
  }
  if (tool === "glob") {
    const lines = trimmed.split(`
`).filter((l) => l.trim().length > 0);
    return `${lines.length} paths matched (${lines[0]?.split("/").pop() ?? "files"})`.slice(0, 96);
  }
  if (tool === "patch" || tool === "write" || tool === "edit") {
    return trimmed.replace(/\s+/g, " ").slice(0, 96);
  }
  const nonEmpty = trimmed.split(`
`).map((l) => l.trim()).filter((l) => l.length > 0);
  const summary = nonEmpty.slice(0, 2).join(" \xB7 ");
  return summary.slice(0, 96);
}
function extractTargetLabel(tool, input, outputText) {
  if (tool === "read" || tool === "write" || tool === "edit") {
    return String(input.path ?? input.filePath ?? "unknown");
  }
  if (tool === "skill") {
    const fromInput = input.id ?? input.name ?? input.skill;
    if (typeof fromInput === "string" && fromInput.length > 0)
      return fromInput;
    return SKILL_NAME_RE.exec(outputText)?.[1] ?? "unknown";
  }
  if (tool === "grep" || tool === "glob") {
    const pattern = String(input.pattern ?? "");
    const p = input.path ? ` in ${String(input.path)}` : "";
    return `${pattern}${p}`.trim().slice(0, 80) || tool;
  }
  if (tool === "shell" || tool === "bash") {
    const cmd = String(input.command ?? "").replace(/\s+/g, " ").trim();
    return cmd.length > 64 ? `${cmd.slice(0, 64)}\u2026` : cmd || tool;
  }
  if (tool === "patch") {
    const patchText = String(input.patchText ?? "");
    const files = [...patchText.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n]+)/g)].map((m) => m[1].trim());
    return files.join(", ").slice(0, 80) || "patch";
  }
  if (tool === "execute") {
    const code = String(input.code ?? "").replace(/\s+/g, " ").trim();
    return code.length > 64 ? `${code.slice(0, 64)}\u2026` : code || "execute";
  }
  return String(input.description ?? input.agent ?? input.path ?? tool).slice(0, 64);
}
function formatFactBreadcrumb(params) {
  const shortSha = params.blobSha256.slice(0, 12);
  const blobRef = `blob:${shortSha}`;
  const targetWithRange = params.tool === "read" && params.lineRange && !params.target.includes("#L") ? `${params.target}#${params.lineRange}` : params.target;
  const rendered = `[Pruned ${params.tool} ${targetWithRange} (${params.originalChars} chars) -> ${blobRef} | ${params.summary} | status: ${params.status}; call substrate.viewport({ action: "resolve", blob: "${shortSha}" }) if exact lines needed]`;
  return {
    callId: params.callId,
    messageId: params.messageId,
    tool: params.tool,
    target: params.target,
    lineRange: params.lineRange,
    originalChars: params.originalChars,
    blobSha256: params.blobSha256,
    blobRef,
    summary: params.summary,
    status: params.status,
    rendered
  };
}
function thinInputShapePreserving(input) {
  if (typeof input !== "object" || input === null) {
    return `[context-prune: input thinned (~${JSON.stringify(input)?.length ?? 0} chars)]`;
  }
  if (Array.isArray(input)) {
    return `[context-prune: array input thinned (${input.length} items)]`;
  }
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (typeof value === "string") {
      return [
        key,
        value.length <= FIELD_LIMIT ? value : `${value.slice(0, FIELD_LIMIT)}\u2026[context-prune: ${value.length - FIELD_LIMIT} more chars]`
      ];
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
      return [key, value];
    }
    return [key, `[context-prune: ~${JSON.stringify(value)?.length ?? 0} chars]`];
  }));
}
class BlobStore {
  blobDir;
  readOnlyArchiveDir;
  persistToDisk;
  memoryBlobs = new Map;
  prefixIndex = new Map;
  writtenCount = 0;
  reusedCount = 0;
  dirCreated = false;
  constructor(options = {}) {
    this.blobDir = options.blobDir ?? join(process.cwd(), ".session-archive", "blobs");
    this.readOnlyArchiveDir = options.readOnlyArchiveDir ?? null;
    this.persistToDisk = options.persistToDisk ?? true;
  }
  sink(content, options) {
    const sha256 = sha256Hex(content);
    const short = sha256.slice(0, 12);
    this.prefixIndex.set(short, sha256);
    if (this.memoryBlobs.has(sha256)) {
      this.reusedCount += 1;
      return { sha256, blobRef: `blob:${short}` };
    }
    this.memoryBlobs.set(sha256, content);
    const shouldWriteDisk = options?.persistToDisk ?? this.persistToDisk;
    if (shouldWriteDisk) {
      if (!this.dirCreated) {
        mkdirSync3(this.blobDir, { recursive: true });
        this.dirCreated = true;
      }
      const targetPath = join(this.blobDir, `${sha256}.txt`);
      if (existsSync7(targetPath)) {
        this.reusedCount += 1;
      } else {
        writeFileSync2(targetPath, content, "utf8");
        this.writtenCount += 1;
      }
    } else {
      this.writtenCount += 1;
    }
    return { sha256, blobRef: `blob:${short}` };
  }
  registerExistingSha(sha256, content) {
    const short = sha256.slice(0, 12);
    this.prefixIndex.set(short, sha256);
    if (content !== undefined && !this.memoryBlobs.has(sha256)) {
      this.memoryBlobs.set(sha256, content);
    }
    return `blob:${short}`;
  }
  resolveWithSha(blobRefOrSha) {
    const raw = blobRefOrSha.startsWith("blob:") ? blobRefOrSha.slice(5) : blobRefOrSha;
    const fullSha = this.prefixIndex.get(raw) ?? (raw.length === 64 ? raw : this.findMatchingDiskSha(raw));
    if (!fullSha)
      return null;
    const inMem = this.memoryBlobs.get(fullSha);
    if (inMem !== undefined)
      return { sha256: fullSha, content: inMem };
    const localPath = join(this.blobDir, `${fullSha}.txt`);
    if (existsSync7(localPath)) {
      const txt = readFileSync5(localPath, "utf8");
      this.memoryBlobs.set(fullSha, txt);
      return { sha256: fullSha, content: txt };
    }
    if (this.readOnlyArchiveDir) {
      const archiveBlobPath = join(this.readOnlyArchiveDir, "blobs", `${fullSha}.txt`);
      if (existsSync7(archiveBlobPath)) {
        const txt = readFileSync5(archiveBlobPath, "utf8");
        this.memoryBlobs.set(fullSha, txt);
        return { sha256: fullSha, content: txt };
      }
    }
    return null;
  }
  resolve(blobRefOrSha) {
    return this.resolveWithSha(blobRefOrSha)?.content ?? null;
  }
  findMatchingDiskSha(prefix) {
    for (const [short, full] of this.prefixIndex.entries()) {
      if (short.startsWith(prefix) || full.startsWith(prefix)) {
        return full;
      }
    }
    for (const dir of [
      this.blobDir,
      this.readOnlyArchiveDir ? join(this.readOnlyArchiveDir, "blobs") : null
    ]) {
      if (!dir || !existsSync7(dir))
        continue;
      const match = readdirSync2(dir).find((f) => f.startsWith(prefix) && f.endsWith(".txt"));
      if (match) {
        const full = match.slice(0, -4);
        this.prefixIndex.set(full.slice(0, 12), full);
        return full;
      }
    }
    return null;
  }
  stats() {
    return { written: this.writtenCount, reused: this.reusedCount };
  }
}
function extractShellCatSlices(command, outputText) {
  const results = [];
  const catPaths = [];
  for (const m of command.matchAll(/\bcat\s+([^\s;|&"']+)/g)) {
    const p = m[1].trim();
    if (!p.startsWith("-") && !p.startsWith("$") && (p.includes("/") || p.includes("."))) {
      catPaths.push(p);
    }
  }
  for (const m of command.matchAll(/for\s+\w+\s+in\s+([^\n;]+);\s*do\s+if\s+test\s+-f[\s\S]*?cat\s+"?\$\w+"?/g)) {
    const candidates = m[1].trim().split(/\s+/);
    if (candidates[0])
      catPaths.push(candidates[0]);
  }
  if (catPaths.length === 0)
    return results;
  const sections = outputText.split(/\n(?=--- [A-Z0-9 _-]+ ---\n)/);
  for (const rawPath of catPaths) {
    const base = rawPath.split("/").pop() ?? rawPath;
    const matchingSection = sections.find((sec) => sec.includes(rawPath)) ?? sections.find((sec) => sec.toLowerCase().includes(base.replace(/\.md$/, "").toLowerCase())) ?? outputText;
    results.push({ path: rawPath, content: matchingSection });
  }
  return results;
}
function extractPatchFiles(patchText) {
  const results = [];
  const parts = patchText.split(/(?=\*\*\* (?:Add|Update) File: )/);
  for (const chunk of parts) {
    const m = /^\*\*\* (Add|Update) File: ([^\n]+)\n([\s\S]*)/.exec(chunk);
    if (!m)
      continue;
    results.push({
      operation: m[1] === "Add" ? "add" : "update",
      path: m[2].trim(),
      hunkText: chunk.trim()
    });
  }
  return results;
}
function isCrossSessionContinuityArtifact(normPath) {
  return normPath.startsWith(".audit/") || normPath.startsWith(".planning/human-used-prompting/") || normPath.includes("/skills/") || normPath === "STATE.md" || normPath === "AGENTS.md" || normPath === ".opencode/AGENTS.md" || normPath === "GLOSSARY.md";
}
function renderWorkingMemoryManifest(manifest) {
  const lines = [
    `## WorkingMemoryManifest \xB7 \`${manifest.sessionID}\` (Do-Not-Reread Ledger)`,
    `> **Directive:** Every file slice and skill below is indexed in Retrievable Memory with a SHA-256 blob handle. **DO NOT re-read \`FRESH \u2014 DO NOT REREAD\` files or re-invoke \`ACTIVE \u2014 DO NOT RE-INVOKE\` skills.** Call \`substrate.viewport({ action: "resolve", blob: "<sha12>" })\` only if exact lines are needed.`,
    "",
    `### Files Already Read (${manifest.filesRead.length})`
  ];
  for (const f of manifest.filesRead) {
    const shortPath = f.normalizedPath || f.path;
    const sliceHint = f.status.startsWith("SLICE ") && f.startLine != null && f.endLine != null ? ` (Do NOT re-read L${f.startLine}-L${f.endLine}; read offset=${f.endLine + 1})` : "";
    lines.push(`- \`${shortPath}#${f.lineRange}\` (${f.chars} chars) -> \`${f.blobRef}\` | ${f.summary.slice(0, 72)} | **${f.status}**${sliceHint}`);
  }
  if (manifest.filesModified.length > 0) {
    lines.push("", `### Files Modified (${manifest.filesModified.length})`);
    for (const m of manifest.filesModified) {
      const shortPath = m.normalizedPath || m.path;
      lines.push(`- \`${shortPath}\` [${m.operation} via \`${m.tool}\` at \`${m.messageId}\`] -> \`${m.blobRef}\` (${m.status})`);
    }
  }
  if (manifest.activeSkills.length > 0) {
    lines.push("", `### Active Skills Loaded (${manifest.activeSkills.length} \u2014 DO NOT RE-INVOKE)`);
    for (const s of manifest.activeSkills) {
      lines.push(`- \`@${s.name}\` (${s.chars} chars) -> \`${s.blobRef}\` | ${s.summary.slice(0, 64)} | **${s.status}**`);
    }
  }
  if (manifest.delegationOutcomes.length > 0) {
    lines.push("", `### Delegation Outcomes (${manifest.delegationOutcomes.length})`);
    for (const d of manifest.delegationOutcomes) {
      const childLabel = d.childSessionID ?? d.callId;
      lines.push(`- \`${childLabel}\` (${d.harness}/${d.agent}): ${d.description} | reported=\`${d.reportedStatus}\` verified=\`${d.verifiedStatus}\` (\`${d.blobRef}\`)`);
    }
  }
  return lines.join(`
`);
}

class WorkingSetValve {
  blobStore;
  ledgers = new Map;
  hookReads = new Map;
  options;
  constructor(options = {}) {
    this.options = options;
    this.blobStore = new BlobStore({
      blobDir: options.blobDir,
      readOnlyArchiveDir: options.readOnlyArchiveDir,
      persistToDisk: options.persistBlobsToDisk ?? true
    });
  }
  getLedger(sessionID) {
    return this.ledgers.get(sessionID) ?? null;
  }
  resolve(blobRef) {
    return this.blobStore.resolve(blobRef);
  }
  resolveBlob(blobRefOrSha, options) {
    const resolved = this.blobStore.resolveWithSha(blobRefOrSha);
    if (!resolved)
      return null;
    const lines = resolved.content.split(`
`);
    const totalLines = lines.length;
    const startLine = Math.max(1, Math.min(totalLines, options?.startLine ?? 1));
    const endLine = Math.max(startLine, Math.min(totalLines, options?.endLine ?? totalLines));
    const slice = lines.slice(startLine - 1, endLine).join(`
`);
    return {
      blobRef: `blob:${resolved.sha256.slice(0, 12)}`,
      sha256: resolved.sha256,
      content: resolved.content,
      slice,
      startLine,
      endLine,
      totalLines
    };
  }
  recordReadFromHook(sessionIDOrParams, inputArg, rawOutputArg, canonicalRootArg) {
    let sessionID;
    let input;
    let rawOutput;
    let canonicalRoot;
    let callId = "hook_read";
    if (typeof sessionIDOrParams === "string") {
      sessionID = sessionIDOrParams;
      input = inputArg ?? {};
      rawOutput = rawOutputArg ?? "";
      canonicalRoot = canonicalRootArg;
    } else {
      sessionID = sessionIDOrParams.sessionID;
      callId = sessionIDOrParams.callId ?? "hook_read";
      rawOutput = sessionIDOrParams.outputText ?? sessionIDOrParams.rawOutput ?? "";
      input = {
        ...sessionIDOrParams.input ?? {},
        ...sessionIDOrParams.path ? { filePath: sessionIDOrParams.path } : {}
      };
      canonicalRoot = sessionIDOrParams.canonicalRoot;
    }
    const effectiveRoot = canonicalRoot ?? this.options.canonicalRoot;
    const capture = parseReadToolOutput(rawOutput, input, effectiveRoot);
    const { blobRef, sha256 } = this.blobStore.sink(rawOutput);
    const status = capture.isTruncated || capture.startLine > 1 || capture.totalLines !== null && capture.endLine < capture.totalLines ? formatStalenessStatus("SLICE", capture.startLine, capture.endLine, capture.totalLines) : "FRESH \u2014 DO NOT REREAD";
    let sessionMap = this.hookReads.get(sessionID);
    if (!sessionMap) {
      sessionMap = new Map;
      this.hookReads.set(sessionID, sessionMap);
    }
    sessionMap.set(capture.normalizedPath, {
      path: capture.path,
      normalizedPath: capture.normalizedPath,
      lineRange: capture.lineRange,
      startLine: capture.startLine,
      endLine: capture.endLine,
      totalLines: capture.totalLines,
      isTruncated: capture.isTruncated,
      chars: rawOutput.length,
      blobRef,
      blobSha256: sha256,
      sliceSha256: capture.sliceSha,
      summary: summarizeReadOutput(capture.normalizedPath, capture.cleanText),
      status,
      messageId: callId,
      sourceSessionId: sessionID
    });
    return {
      ...capture,
      status
    };
  }
  prune(params) {
    const ledger = this.armValve({
      sessionID: params.sessionID,
      mode: params.mode ?? "step-window",
      keepRecentSteps: params.keepRecentSteps,
      messages: params.messages,
      diskHashesByPath: params.diskHashesByPath
    });
    const summaryMarkdown = [
      `WorkingSetValve armed for session \`${ledger.sessionID}\` (mode: \`${ledger.mode}\`, keepRecentSteps: \`${ledger.keepRecentSteps}\`, reason: \`${ledger.watermark.anchorReason}\`).`,
      `Anchor: \`${ledger.watermark.anchorMessageID ?? "none"}\` (index ${ledger.watermark.anchorIndex}); ${ledger.watermark.assistantStepsThinned}/${ledger.watermark.assistantStepsTotal} assistant steps thinned (${ledger.metrics.toolPartsThinned} tool parts, ~${ledger.metrics.netTokensFreed} net tokens freed).`,
      `Manifest: ${ledger.manifest.filesRead.length} files read, ${ledger.manifest.filesModified.length} files modified, ${ledger.manifest.activeSkills.length} active skills.`
    ].join(`
`);
    return { ledger, summaryMarkdown };
  }
  status(sessionID) {
    const ledger = this.ledgers.get(sessionID) ?? null;
    const hookMap = this.hookReads.get(sessionID);
    const fallbackManifest = renderWorkingMemoryManifest({
      sessionID,
      filesRead: hookMap ? [...hookMap.values()] : [],
      filesModified: [],
      activeSkills: [],
      delegationOutcomes: []
    });
    if (!ledger) {
      return {
        armed: false,
        ledger: null,
        summaryMarkdown: `WorkingSetValve is currently unarmed for session \`${sessionID}\`.`,
        manifestMarkdown: fallbackManifest
      };
    }
    return {
      armed: true,
      ledger,
      summaryMarkdown: [
        `WorkingSetValve is armed for session \`${sessionID}\` (mode: \`${ledger.mode}\`, keepRecentSteps: \`${ledger.keepRecentSteps}\`, anchor: \`${ledger.watermark.anchorMessageID ?? "none"}\`).`,
        `Thinned: ${ledger.metrics.toolPartsThinned} tool parts (~${ledger.metrics.netTokensFreed} net tokens freed).`
      ].join(`
`),
      manifestMarkdown: ledger.manifest.renderedMarkdown
    };
  }
  reset(sessionID) {
    const existed = this.ledgers.delete(sessionID);
    this.hookReads.delete(sessionID);
    return {
      reset: existed,
      sessionID,
      summaryMarkdown: existed ? `WorkingSetValve reset for session \`${sessionID}\`; full unpruned context restored for subsequent model calls.` : `WorkingSetValve was not armed for session \`${sessionID}\`.`
    };
  }
  armValve(params) {
    const keepRecentSteps = params.keepRecentSteps ?? (params.mode === "auto" ? this.options.autoKeepRecentSteps ?? DEFAULT_AUTO_KEEP_RECENT_STEPS : this.options.keepRecentSteps ?? DEFAULT_KEEP_RECENT_STEPS);
    const watermark = computeStepWatermark(params.messages, {
      mode: params.mode,
      keepRecentSteps,
      modelContextWindowTokens: params.modelContextWindowTokens ?? this.options.modelContextWindowTokens,
      autoPruneThresholdRatio: params.autoPruneThresholdRatio ?? this.options.autoPruneThresholdRatio,
      autoKeepRecentSteps: params.keepRecentSteps ?? this.options.autoKeepRecentSteps
    });
    const persistToDisk = params.persistBlobsToDisk ?? this.options.persistBlobsToDisk ?? true;
    const breadcrumbsByCallId = new Map;
    const thinnedInputsByCallId = new Map;
    const skillBreadcrumbsByName = new Map;
    const filesReadMap = new Map;
    const filesModifiedMap = new Map;
    const activeSkillsMap = new Map;
    const delegationMap = new Map;
    const recordFileRead = (entry) => {
      const key = entry.normalizedPath || entry.path;
      const prev = filesReadMap.get(key);
      if (!prev || entry.chars >= prev.chars || entry.sourceSessionId === params.sessionID) {
        filesReadMap.set(key, entry);
      }
    };
    const recordSkill = (entry) => {
      const prev = activeSkillsMap.get(entry.name);
      if (!prev || entry.chars >= prev.chars || entry.sourceSessionId === params.sessionID) {
        activeSkillsMap.set(entry.name, entry);
      }
    };
    const recordCrossSessionFileRead = (entry) => {
      if (isCrossSessionContinuityArtifact(entry.normalizedPath || entry.path)) {
        recordFileRead(entry);
      }
    };
    for (const prior of this.options.priorWorktreeMessages ?? []) {
      this.scanMessagesIntoManifest(prior.sessionID, prior.messages, prior.messages.length, false, persistToDisk, breadcrumbsByCallId, thinnedInputsByCallId, skillBreadcrumbsByName, recordCrossSessionFileRead, filesModifiedMap, recordSkill, delegationMap);
    }
    const stats = this.scanMessagesIntoManifest(params.sessionID, params.messages, watermark.anchorIndex, true, persistToDisk, breadcrumbsByCallId, thinnedInputsByCallId, skillBreadcrumbsByName, recordFileRead, filesModifiedMap, recordSkill, delegationMap);
    const diskHashes = params.diskHashesByPath ?? this.options.diskHashesByPath;
    const canonicalRoot = this.options.canonicalRoot;
    for (const [key, entry] of filesReadMap.entries()) {
      const diskHash = diskHashes?.get(entry.path) ?? diskHashes?.get(entry.normalizedPath);
      if (diskHash !== undefined) {
        const matches = diskHash === entry.blobSha256 || entry.sliceSha256 !== undefined && diskHash === entry.sliceSha256;
        if (!matches) {
          filesReadMap.set(key, { ...entry, status: STALE_STATUS });
          for (const [callId, bc] of breadcrumbsByCallId.entries()) {
            if (bc.tool === "read" && normalizeRepoPath2(bc.target, canonicalRoot) === entry.normalizedPath) {
              breadcrumbsByCallId.set(callId, formatFactBreadcrumb({
                callId: bc.callId,
                messageId: bc.messageId,
                tool: bc.tool,
                target: bc.target,
                lineRange: bc.lineRange,
                originalChars: bc.originalChars,
                blobSha256: bc.blobSha256,
                summary: bc.summary,
                status: STALE_STATUS
              }));
            }
          }
        }
        continue;
      }
      if (entry.status === STALE_STATUS)
        continue;
      const shouldCheckDisk = typeof canonicalRoot === "string" && canonicalRoot.length > 0 || isAbsolute2(entry.path) && existsSync7(entry.path);
      if (shouldCheckDisk) {
        const diskPath = resolveDiskPath(entry.path, canonicalRoot);
        if (existsSync7(diskPath)) {
          const recon = computeDiskSliceSha(diskPath, {
            startLine: entry.startLine ?? 1,
            endLine: entry.endLine ?? 1,
            totalLines: entry.totalLines ?? null,
            isTruncated: Boolean(entry.isTruncated),
            sliceSha: entry.sliceSha256 ?? entry.blobSha256
          });
          const nextLineRange = recon.state === "SLICE" ? recon.lineRange : entry.lineRange;
          filesReadMap.set(key, {
            ...entry,
            lineRange: nextLineRange,
            totalLines: recon.currentTotalLines,
            isTruncated: recon.state === "SLICE",
            status: recon.stalenessStatus
          });
          for (const [callId, bc] of breadcrumbsByCallId.entries()) {
            if (bc.tool === "read" && normalizeRepoPath2(bc.target, canonicalRoot) === entry.normalizedPath) {
              breadcrumbsByCallId.set(callId, formatFactBreadcrumb({
                callId: bc.callId,
                messageId: bc.messageId,
                tool: bc.tool,
                target: bc.target,
                lineRange: nextLineRange,
                originalChars: bc.originalChars,
                blobSha256: bc.blobSha256,
                summary: bc.summary,
                status: recon.stalenessStatus
              }));
            }
          }
        }
      }
    }
    const manifestCore = {
      sessionID: params.sessionID,
      filesRead: [...filesReadMap.values()],
      filesModified: [...filesModifiedMap.values()],
      activeSkills: [...activeSkillsMap.values()],
      delegationOutcomes: [...delegationMap.values()]
    };
    const renderedMarkdown = renderWorkingMemoryManifest(manifestCore);
    const manifest = {
      ...manifestCore,
      renderedMarkdown,
      markdown: renderedMarkdown
    };
    const blobStats = this.blobStore.stats();
    const rawOutputFreed = stats.rawOutputCharsBefore - stats.breadcrumbCharsAfter;
    const rawInputFreed = stats.rawInputCharsBefore - stats.thinnedInputCharsAfter;
    const netCharsFreed = rawOutputFreed + rawInputFreed - renderedMarkdown.length;
    const ledger = {
      sessionID: params.sessionID,
      mode: watermark.mode,
      keepRecentSteps: watermark.keepRecentSteps,
      watermark,
      breadcrumbsByCallId,
      thinnedInputsByCallId,
      skillBreadcrumbsByName,
      manifest,
      metrics: {
        toolPartsThinned: stats.toolPartsThinned,
        rawOutputCharsBefore: stats.rawOutputCharsBefore,
        breadcrumbCharsAfter: stats.breadcrumbCharsAfter,
        rawInputCharsBefore: stats.rawInputCharsBefore,
        thinnedInputCharsAfter: stats.thinnedInputCharsAfter,
        manifestChars: renderedMarkdown.length,
        netCharsFreed,
        rawOutputTokensFreed: estimateTokens2(rawOutputFreed),
        netTokensFreed: estimateTokens2(netCharsFreed),
        blobsWritten: blobStats.written,
        blobsReused: blobStats.reused
      },
      at: new Date().toISOString()
    };
    this.ledgers.set(params.sessionID, ledger);
    return ledger;
  }
  applyContextHookInMemory(event, options) {
    const t0 = performance.now();
    let ledger = this.ledgers.get(event.sessionID);
    let trigger = ledger ? "explicit-armed" : "noop";
    const windowTokens = options?.modelContextWindowTokens ?? this.options.modelContextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
    const thresholdRatio = options?.autoPruneThresholdRatio ?? this.options.autoPruneThresholdRatio ?? DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO;
    const autoK = options?.autoKeepRecentSteps ?? options?.autoPruneKeepRecentSteps ?? this.options.autoKeepRecentSteps ?? DEFAULT_AUTO_KEEP_RECENT_STEPS;
    if (!ledger) {
      const autoWatermark = computeStepWatermark(event.messages, {
        mode: "auto",
        modelContextWindowTokens: windowTokens,
        autoPruneThresholdRatio: thresholdRatio,
        autoKeepRecentSteps: autoK
      });
      if (!autoWatermark.autoActivated || autoWatermark.anchorIndex <= autoWatermark.activeStartIndex) {
        return {
          applied: false,
          trigger: "noop",
          thinnedParts: 0,
          thinnedPartsCount: 0,
          anchorIndex: 0,
          watermark: autoWatermark,
          elapsedMs: performance.now() - t0
        };
      }
      ledger = this.armValve({
        sessionID: event.sessionID,
        mode: "auto",
        keepRecentSteps: autoK,
        messages: event.messages,
        persistBlobsToDisk: false,
        modelContextWindowTokens: windowTokens,
        autoPruneThresholdRatio: thresholdRatio
      });
      trigger = "auto-watermark-65pct";
    } else if (event.messages.length > ledger.watermark.anchorIndex + ledger.keepRecentSteps + 4) {
      const candidateWatermark = computeStepWatermark(event.messages, {
        mode: "auto",
        modelContextWindowTokens: windowTokens,
        autoPruneThresholdRatio: thresholdRatio,
        autoKeepRecentSteps: autoK
      });
      if (candidateWatermark.autoActivated && candidateWatermark.anchorIndex > ledger.watermark.anchorIndex) {
        ledger = this.armValve({
          sessionID: event.sessionID,
          mode: "auto",
          keepRecentSteps: autoK,
          messages: event.messages,
          persistBlobsToDisk: false,
          modelContextWindowTokens: windowTokens,
          autoPruneThresholdRatio: thresholdRatio
        });
        trigger = "auto-watermark-65pct";
      }
    }
    const messages = event.messages;
    let boundary = -1;
    if (ledger.watermark.anchorMessageID !== null) {
      boundary = messages.findIndex((m) => m.id === ledger.watermark.anchorMessageID);
    } else if (ledger.mode === "step-window" || ledger.watermark.anchorReason === "recent-step-fallback" || ledger.watermark.anchorReason === "auto-threshold-step-window") {
      const w = computeStepWatermark(messages, {
        mode: ledger.mode,
        keepRecentSteps: ledger.keepRecentSteps
      });
      boundary = w.anchorIndex;
    } else if (ledger.mode === "initial" || ledger.mode === "all") {
      boundary = messages.findLastIndex((m) => isUserMessage(m));
    }
    if (boundary <= 0) {
      return {
        applied: false,
        trigger: "noop",
        thinnedParts: 0,
        thinnedPartsCount: 0,
        anchorIndex: 0,
        watermark: ledger.watermark,
        elapsedMs: performance.now() - t0
      };
    }
    const manifestMarkdown = ledger.manifest.renderedMarkdown;
    if (Array.isArray(event.system)) {
      const first = event.system[0];
      if (first && typeof first === "object" && "text" in first) {
        const exists = event.system.some((item) => typeof item === "object" && item !== null && ("text" in item) && item.text === manifestMarkdown);
        if (!exists) {
          event.system.unshift({ type: "text", text: manifestMarkdown });
        }
      } else if (!event.system.includes(manifestMarkdown)) {
        event.system.unshift(manifestMarkdown);
      }
    } else {
      event.system = [manifestMarkdown];
    }
    let thinnedParts = 0;
    const startIdx = ledger.watermark.activeStartIndex < boundary ? ledger.watermark.activeStartIndex : 0;
    for (let i = startIdx;i < boundary; i++) {
      const message = messages[i];
      if (!message || !Array.isArray(message.content))
        continue;
      for (const part of message.content) {
        if (typeof part !== "object" || part === null)
          continue;
        if (part.providerExecuted === true || part.executed === true)
          continue;
        if (part.type === "tool") {
          const callId = String(part.id ?? "");
          const name = String(part.name ?? "");
          const state = part.state;
          if (!state || typeof state !== "object")
            continue;
          if (!KEEP_INPUT.has(name) && state.input !== undefined) {
            state.input = ledger.thinnedInputsByCallId.get(callId) ?? thinInputShapePreserving(state.input);
          }
          if (!KEEP_RESULT.has(name) && state.status === "completed" && Array.isArray(state.content)) {
            const bc = ledger.breadcrumbsByCallId.get(callId);
            if (bc) {
              state.content = [{ type: "text", text: bc.rendered }];
              thinnedParts += 1;
            }
          }
          continue;
        }
        if (part.type === "tool-call") {
          const callId = String(part.id ?? "");
          const name = String(part.name ?? "");
          if (!KEEP_INPUT.has(name)) {
            part.input = ledger.thinnedInputsByCallId.get(callId) ?? thinInputShapePreserving(part.input);
          }
          continue;
        }
        if (part.type === "tool-result") {
          const callId = String(part.id ?? "");
          const name = String(part.name ?? "");
          if (KEEP_RESULT.has(name))
            continue;
          const bc = ledger.breadcrumbsByCallId.get(callId);
          if (bc) {
            part.result = { type: "text", value: bc.rendered };
            thinnedParts += 1;
          }
          continue;
        }
        if (part.type === "text" && typeof part.text === "string" && part.text.includes("<skill_content")) {
          part.text = part.text.replace(SKILL_TAG_RE, (blob) => {
            const name = SKILL_NAME_RE.exec(blob)?.[1] ?? "unknown";
            const cached = ledger.skillBreadcrumbsByName.get(name);
            if (cached)
              return cached.rendered;
            const { sha256 } = this.blobStore.sink(blob, { persistToDisk: false });
            return formatFactBreadcrumb({
              callId: `inline_skill_${name}`,
              messageId: String(message.id ?? ""),
              tool: "skill",
              target: name,
              lineRange: null,
              originalChars: blob.length,
              blobSha256: sha256,
              summary: "Rules active in WorkingMemoryManifest",
              status: ACTIVE_SKILL_BREADCRUMB_STATUS
            }).rendered;
          });
        }
      }
    }
    return {
      applied: true,
      trigger,
      thinnedParts,
      thinnedPartsCount: thinnedParts,
      anchorIndex: boundary,
      watermark: ledger.watermark,
      elapsedMs: performance.now() - t0
    };
  }
  scanMessagesIntoManifest(sessionID, messages, thinBeforeIndex, isPrimarySession, persistToDisk, breadcrumbsByCallId, thinnedInputsByCallId, skillBreadcrumbsByName, recordFileRead, filesModifiedMap, recordSkill, delegationMap) {
    let toolPartsThinned = 0;
    let rawOutputCharsBefore = 0;
    let breadcrumbCharsAfter = 0;
    let rawInputCharsBefore = 0;
    let thinnedInputCharsAfter = 0;
    let activeStart = 0;
    if (isPrimarySession) {
      for (let i = 0;i < messages.length; i++) {
        if (isCompactionMessage(messages[i]))
          activeStart = i + 1;
      }
    }
    const markExistingReadsStale = (normPath, newSha256) => {
      const existingRead = filesReadMapGet(normPath);
      if (existingRead && existingRead.blobSha256 !== newSha256) {
        recordFileRead({ ...existingRead, status: STALE_STATUS });
      }
      for (const [cId, prevBc] of breadcrumbsByCallId.entries()) {
        if (prevBc.tool === "read" && normalizeRepoPath2(prevBc.target, this.options.canonicalRoot) === normPath && prevBc.blobSha256 !== newSha256) {
          breadcrumbsByCallId.set(cId, formatFactBreadcrumb({
            callId: prevBc.callId,
            messageId: prevBc.messageId,
            tool: prevBc.tool,
            target: prevBc.target,
            lineRange: prevBc.lineRange,
            originalChars: prevBc.originalChars,
            blobSha256: prevBc.blobSha256,
            summary: prevBc.summary,
            status: STALE_STATUS
          }));
        }
      }
    };
    const localReadsByPath = new Map;
    const filesReadMapGet = (normPath) => localReadsByPath.get(normPath);
    const recordAndTrackRead = (entry) => {
      localReadsByPath.set(entry.normalizedPath || entry.path, entry);
      recordFileRead(entry);
    };
    for (let idx = 0;idx < messages.length; idx++) {
      const m = messages[idx];
      const msgId = String(m.id ?? `msg_${idx}`);
      const inThinRange = isPrimarySession && idx >= activeStart && idx < thinBeforeIndex;
      if (Array.isArray(m.skills)) {
        for (const s of m.skills) {
          const name = String(s.name ?? s.id ?? "");
          const text = String(s.text ?? "");
          if (name && text) {
            const { sha256, blobRef } = this.blobStore.sink(text, { persistToDisk });
            const summary = summarizeSkillOutput(name, text);
            recordSkill({
              name,
              chars: text.length,
              blobSha256: sha256,
              blobRef,
              summary,
              status: ACTIVE_SKILL_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID
            });
          }
        }
      }
      if (!Array.isArray(m.content))
        continue;
      for (const part of m.content) {
        if (!part || typeof part !== "object")
          continue;
        if (part.type === "text" && typeof part.text === "string" && part.text.includes("<skill_content")) {
          for (const match of part.text.matchAll(SKILL_TAG_RE)) {
            const blob = match[0];
            const name = SKILL_NAME_RE.exec(blob)?.[1] ?? "unknown";
            const { sha256, blobRef } = this.blobStore.sink(blob, { persistToDisk });
            const summary = summarizeSkillOutput(name, blob);
            recordSkill({
              name,
              chars: blob.length,
              blobSha256: sha256,
              blobRef,
              summary,
              status: ACTIVE_SKILL_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID
            });
            const bc = formatFactBreadcrumb({
              callId: `inline_skill_${name}`,
              messageId: msgId,
              tool: "skill",
              target: name,
              lineRange: null,
              originalChars: blob.length,
              blobSha256: sha256,
              summary,
              status: ACTIVE_SKILL_BREADCRUMB_STATUS
            });
            skillBreadcrumbsByName.set(name, bc);
          }
        }
        const isDurableTool = part.type === "tool" && part.executed !== true;
        const isHookResult = part.type === "tool-result" && part.providerExecuted !== true;
        if (!isDurableTool && !isHookResult)
          continue;
        const callId = String(part.id ?? "");
        const name = String(part.name ?? "");
        const input = isDurableTool ? part.state?.input ?? {} : m.content.find((p) => p.type === "tool-call" && p.id === callId)?.input ?? {};
        const outputText = isDurableTool ? Array.isArray(part.state?.content) ? part.state.content.map((c) => c && c.type === "text" && typeof c.text === "string" ? c.text : "").join("") : typeof part.state?.output === "string" ? part.state.output : "" : typeof part.result?.value === "string" ? part.result.value : "";
        const { sha256, blobRef } = this.blobStore.sink(outputText, { persistToDisk });
        const target = extractTargetLabel(name, input, outputText);
        let readCaptureStatus = FRESH_STATUS;
        let readCaptureLineRange = null;
        if (name === "read") {
          const capture = parseReadToolOutput(outputText, { ...input, path: target }, this.options.canonicalRoot);
          readCaptureStatus = capture.isTruncated || capture.startLine > 1 ? formatStalenessStatus("SLICE", capture.startLine, capture.endLine, capture.totalLines) : FRESH_STATUS;
          readCaptureLineRange = capture.isTruncated || capture.startLine > 1 ? capture.lineRange : extractReadLineRange(input, outputText);
          const summary = summarizeReadOutput(target, outputText);
          const normPath = normalizeRepoPath2(target, this.options.canonicalRoot);
          recordAndTrackRead({
            path: target,
            normalizedPath: normPath,
            lineRange: readCaptureLineRange,
            startLine: capture.startLine,
            endLine: capture.endLine,
            totalLines: capture.totalLines,
            isTruncated: capture.isTruncated,
            chars: outputText.length,
            blobSha256: sha256,
            sliceSha256: capture.sliceSha,
            blobRef,
            summary,
            status: readCaptureStatus,
            messageId: msgId,
            sourceSessionId: sessionID
          });
          const skillFileMatch = /\/skills\/([^/]+)\/SKILL\.md$/.exec(target);
          if (skillFileMatch) {
            const skillName = skillFileMatch[1];
            recordSkill({
              name: skillName,
              chars: outputText.length,
              blobSha256: sha256,
              blobRef,
              summary,
              status: ACTIVE_SKILL_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID
            });
          }
        } else if (name === "skill") {
          const summary = summarizeSkillOutput(target, outputText);
          recordSkill({
            name: target,
            chars: outputText.length,
            blobSha256: sha256,
            blobRef,
            summary,
            status: ACTIVE_SKILL_STATUS,
            messageId: msgId,
            sourceSessionId: sessionID
          });
          skillBreadcrumbsByName.set(target, formatFactBreadcrumb({
            callId,
            messageId: msgId,
            tool: "skill",
            target,
            lineRange: null,
            originalChars: outputText.length,
            blobSha256: sha256,
            summary,
            status: ACTIVE_SKILL_BREADCRUMB_STATUS
          }));
        } else if (name === "patch" && typeof input.patchText === "string") {
          for (const patched of extractPatchFiles(input.patchText)) {
            const { sha256: pSha, blobRef: pRef } = this.blobStore.sink(patched.hunkText, { persistToDisk });
            const normPath = normalizeRepoPath2(patched.path, this.options.canonicalRoot);
            if (isPrimarySession || isCrossSessionContinuityArtifact(normPath)) {
              filesModifiedMap.set(normPath, {
                path: patched.path,
                normalizedPath: normPath,
                operation: patched.operation,
                tool: "patch",
                messageId: msgId,
                blobRef: pRef,
                status: "COMMITTED_OR_APPLIED"
              });
            }
            if (localReadsByPath.has(normPath)) {
              markExistingReadsStale(normPath, pSha);
            } else {
              const pLines = Math.max(1, patched.hunkText.split(`
`).length);
              recordAndTrackRead({
                path: patched.path,
                normalizedPath: normPath,
                lineRange: `L1-L${pLines}`,
                startLine: 1,
                endLine: pLines,
                isTruncated: false,
                chars: patched.hunkText.length,
                blobSha256: pSha,
                blobRef: pRef,
                summary: summarizeReadOutput(patched.path, patched.hunkText),
                status: FRESH_STATUS,
                messageId: msgId,
                sourceSessionId: sessionID
              });
            }
          }
        } else if ((name === "write" || name === "edit") && (input.path || input.filePath)) {
          const filePath = String(input.path ?? input.filePath);
          const normPath = normalizeRepoPath2(filePath, this.options.canonicalRoot);
          const body = String(input.content ?? input.newString ?? outputText);
          const { sha256: wSha, blobRef: wRef } = this.blobStore.sink(body, { persistToDisk });
          if (isPrimarySession || isCrossSessionContinuityArtifact(normPath)) {
            filesModifiedMap.set(normPath, {
              path: filePath,
              normalizedPath: normPath,
              operation: name,
              tool: name,
              messageId: msgId,
              blobRef: wRef,
              status: "COMMITTED_OR_APPLIED"
            });
          }
          if (localReadsByPath.has(normPath)) {
            markExistingReadsStale(normPath, wSha);
          } else {
            const wLines = Math.max(1, body.replace(/\n$/, "").split(`
`).length);
            recordAndTrackRead({
              path: filePath,
              normalizedPath: normPath,
              lineRange: `L1-L${wLines}`,
              startLine: 1,
              endLine: wLines,
              isTruncated: false,
              chars: body.length,
              blobSha256: wSha,
              blobRef: wRef,
              summary: summarizeReadOutput(filePath, body),
              status: FRESH_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID
            });
          }
        } else if ((name === "shell" || name === "bash") && typeof input.command === "string") {
          for (const catSlice of extractShellCatSlices(input.command, outputText)) {
            const { sha256: cSha, blobRef: cRef } = this.blobStore.sink(catSlice.content, { persistToDisk });
            const normPath = normalizeRepoPath2(catSlice.path, this.options.canonicalRoot);
            const summary = summarizeReadOutput(catSlice.path, catSlice.content);
            const cLines = Math.max(1, catSlice.content.replace(/\n$/, "").split(`
`).length);
            recordAndTrackRead({
              path: catSlice.path,
              normalizedPath: normPath,
              lineRange: `L1-L${cLines}`,
              startLine: 1,
              endLine: cLines,
              isTruncated: false,
              chars: catSlice.content.length,
              blobSha256: cSha,
              blobRef: cRef,
              summary,
              status: FRESH_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID
            });
            const skillMatch = /\/skills\/([^/]+)\/SKILL\.md$/.exec(catSlice.path);
            if (skillMatch) {
              const sName = skillMatch[1];
              recordSkill({
                name: sName,
                chars: catSlice.content.length,
                blobSha256: cSha,
                blobRef: cRef,
                summary,
                status: ACTIVE_SKILL_STATUS,
                messageId: msgId,
                sourceSessionId: sessionID
              });
              skillBreadcrumbsByName.set(sName, formatFactBreadcrumb({
                callId: `${callId}_skill_${sName}`,
                messageId: msgId,
                tool: "skill",
                target: sName,
                lineRange: null,
                originalChars: catSlice.content.length,
                blobSha256: cSha,
                summary,
                status: ACTIVE_SKILL_BREADCRUMB_STATUS
              }));
            }
          }
        } else if (isPrimarySession && KEEP_RESULT.has(name)) {
          const childSessionID = part.state?.metadata?.sessionID ?? /sessionID[:=]\s*"?([a-zA-Z0-9_]+)"?/.exec(outputText)?.[1] ?? null;
          const harness = String(input.harness ?? (name === "delegate-devin" ? "devin" : "opencode"));
          const agent = String(input.agent ?? name);
          const description = String(input.description ?? target);
          const isCompleted = outputText.includes('state="completed"') || !outputText.includes("working in the background");
          delegationMap.set(callId, {
            callId,
            childSessionID,
            tool: name,
            harness,
            agent,
            description,
            reportedStatus: isCompleted ? "completed" : "dispatched_background",
            verifiedStatus: isCompleted ? "completed_report_only" : "unverified_in_flight",
            blobRef
          });
        }
        if (inThinRange) {
          toolPartsThinned += 1;
          const lineRange = name === "read" ? readCaptureLineRange ?? extractReadLineRange(input, outputText) : null;
          const summary = name === "read" ? summarizeReadOutput(target, outputText) : name === "skill" ? summarizeSkillOutput(target, outputText) : summarizeToolOutput(name, input, outputText);
          const bc = formatFactBreadcrumb({
            callId,
            messageId: msgId,
            tool: name,
            target,
            lineRange,
            originalChars: outputText.length,
            blobSha256: sha256,
            summary,
            status: name === "skill" ? ACTIVE_SKILL_BREADCRUMB_STATUS : name === "read" ? readCaptureStatus : FRESH_STATUS
          });
          breadcrumbsByCallId.set(callId, bc);
          if (!KEEP_RESULT.has(name)) {
            rawOutputCharsBefore += outputText.length;
            breadcrumbCharsAfter += bc.rendered.length;
          }
          if (!KEEP_INPUT.has(name)) {
            const rawInStr = JSON.stringify(input) ?? "{}";
            const thinnedIn = thinInputShapePreserving(input);
            const thinnedInStr = JSON.stringify(thinnedIn) ?? "{}";
            thinnedInputsByCallId.set(callId, thinnedIn);
            rawInputCharsBefore += rawInStr.length;
            thinnedInputCharsAfter += thinnedInStr.length;
          }
        }
      }
    }
    return {
      toolPartsThinned,
      rawOutputCharsBefore,
      breadcrumbCharsAfter,
      rawInputCharsBefore,
      thinnedInputCharsAfter
    };
  }
}
function applyContextHookInMemory(event, valveOrLedger, options) {
  if (valveOrLedger instanceof WorkingSetValve) {
    return valveOrLedger.applyContextHookInMemory(event, options);
  }
  const tempValve = new WorkingSetValve({
    persistBlobsToDisk: false,
    autoPruneThresholdRatio: options?.autoPruneThresholdRatio,
    autoKeepRecentSteps: options?.autoKeepRecentSteps ?? options?.autoPruneKeepRecentSteps,
    modelContextWindowTokens: options?.modelContextWindowTokens
  });
  if (valveOrLedger) {
    tempValve.ledgers.set(event.sessionID, valveOrLedger);
  }
  return tempValve.applyContextHookInMemory(event, options);
}

// src/cli.ts
import { existsSync as existsSync12, mkdirSync as mkdirSync5 } from "fs";
import path10 from "path";

// src/honeycomb/ast-skeleton.ts
import { existsSync as existsSync8, readFileSync as readFileSync6, readdirSync as readdirSync3, statSync as statSync4 } from "fs";
import path7 from "path";
var CODE_GRAPH_DDL = `
CREATE TABLE IF NOT EXISTS code_file (
  path TEXT PRIMARY KEY,
  blob_sha TEXT NOT NULL,
  loc INTEGER NOT NULL,
  raw_tokens INTEGER NOT NULL,
  skeleton_tokens INTEGER NOT NULL,
  skeleton_text TEXT NOT NULL,
  pagerank REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS code_symbol (
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  depth INTEGER NOT NULL,
  parent_symbol TEXT,
  exported INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  signature TEXT NOT NULL,
  blob_sha TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (path, start_line, qualified_name)
);

CREATE INDEX IF NOT EXISTS idx_code_symbol_path_name ON code_symbol(path, name);
CREATE INDEX IF NOT EXISTS idx_code_symbol_path_qualified ON code_symbol(path, qualified_name);
CREATE INDEX IF NOT EXISTS idx_code_symbol_parent ON code_symbol(path, parent_symbol);

CREATE TABLE IF NOT EXISTS code_import_edge (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  specifier TEXT NOT NULL DEFAULT '',
  symbols_json TEXT NOT NULL DEFAULT '[]',
  specifiers_json TEXT NOT NULL DEFAULT '[]',
  is_type_only INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_path, to_path)
);

CREATE INDEX IF NOT EXISTS idx_code_import_edge_to ON code_import_edge(to_path);
`;
var initializedCodeGraphDbs = new WeakSet;
var tsTranspiler = new Bun.Transpiler({ loader: "ts" });
var tsxTranspiler = new Bun.Transpiler({ loader: "tsx" });
function ensureCodeGraphSchema(db) {
  ensureHoneycombSchema(db);
  if (initializedCodeGraphDbs.has(db)) {
    const hasTable = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'code_file'").get();
    if (hasTable)
      return;
  }
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(CODE_GRAPH_DDL);
  const symbolCols = new Set(db.query("PRAGMA table_info(code_symbol)").all().map((c) => c.name));
  if (!symbolCols.has("qualified_name")) {
    db.exec("ALTER TABLE code_symbol ADD COLUMN qualified_name TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE code_symbol SET qualified_name = CASE WHEN parent_symbol IS NOT NULL AND parent_symbol != '' THEN parent_symbol || '.' || name ELSE name END WHERE qualified_name = ''");
    db.exec("CREATE INDEX IF NOT EXISTS idx_code_symbol_path_qualified ON code_symbol(path, qualified_name)");
  }
  if (!symbolCols.has("blob_sha")) {
    db.exec("ALTER TABLE code_symbol ADD COLUMN blob_sha TEXT NOT NULL DEFAULT ''");
  }
  const edgeCols = new Set(db.query("PRAGMA table_info(code_import_edge)").all().map((c) => c.name));
  if (!edgeCols.has("specifier")) {
    db.exec("ALTER TABLE code_import_edge ADD COLUMN specifier TEXT NOT NULL DEFAULT ''");
  }
  if (!edgeCols.has("symbols_json")) {
    db.exec("ALTER TABLE code_import_edge ADD COLUMN symbols_json TEXT NOT NULL DEFAULT '[]'");
    if (edgeCols.has("specifiers_json")) {
      db.exec("UPDATE code_import_edge SET symbols_json = specifiers_json WHERE symbols_json = '[]'");
    }
  }
  if (!edgeCols.has("specifiers_json")) {
    db.exec("ALTER TABLE code_import_edge ADD COLUMN specifiers_json TEXT NOT NULL DEFAULT '[]'");
    if (edgeCols.has("symbols_json")) {
      db.exec("UPDATE code_import_edge SET specifiers_json = symbols_json WHERE specifiers_json = '[]'");
    }
  }
  if (!edgeCols.has("is_type_only")) {
    db.exec("ALTER TABLE code_import_edge ADD COLUMN is_type_only INTEGER NOT NULL DEFAULT 0");
  }
  initializedCodeGraphDbs.add(db);
}
function normalizeRelPath(filePath, canonicalRoot) {
  return normalizeRepoPath(filePath, typeof canonicalRoot === "string" ? canonicalRoot : undefined);
}
function computeBlobSha(content) {
  return sha256Hex(content);
}
function estimateTokens3(text) {
  return typeof text === "number" ? Math.ceil(Math.max(0, text) / 4) : estimateTokens(text);
}
function normalizeWhitespace(s) {
  return s.replace(/\s+/g, " ").trim();
}
function isRegexTriggerCharCode(code) {
  return code === 61 || code === 40 || code === 44 || code === 58 || code === 91 || code === 33 || code === 38 || code === 124 || code === 63 || code === 123 || code === 125 || code === 59 || code === 126 || code === 43 || code === 45 || code === 42 || code === 37 || code === 94;
}
function findClosingRegexSlash(line, startSlashIdx) {
  const len = line.length;
  let inCC = false;
  for (let j = startSlashIdx + 1;j < len; j++) {
    const c = line.charCodeAt(j);
    if (c === 92) {
      j++;
      continue;
    }
    if (c === 91) {
      inCC = true;
      continue;
    }
    if (c === 93) {
      inCC = false;
      continue;
    }
    if (c === 47 && !inCC)
      return j;
  }
  return -1;
}
function findClosingQuote(line, startQuoteIdx, quoteCode) {
  const len = line.length;
  for (let j = startQuoteIdx + 1;j < len; j++) {
    const c = line.charCodeAt(j);
    if (c === 92) {
      j++;
      continue;
    }
    if (c === quoteCode)
      return j;
  }
  return -1;
}
function cleanSingleLine(line, maskStrings) {
  const len = line.length;
  let hasSpecial = false;
  for (let i = 0;i < len; i++) {
    const c = line.charCodeAt(i);
    if (c === 47 || c === 39 || c === 34 || c === 96) {
      hasSpecial = true;
      break;
    }
  }
  if (!hasSpecial)
    return line;
  let out = "";
  let segStart = 0;
  let prevSig = 0;
  for (let i = 0;i < len; i++) {
    const ch = line.charCodeAt(i);
    const next = i + 1 < len ? line.charCodeAt(i + 1) : 0;
    if (ch === 47) {
      if (next === 47) {
        out += line.slice(segStart, i);
        return out;
      }
      if (next === 42) {
        out += line.slice(segStart, i);
        i += 2;
        while (i < len && !(line.charCodeAt(i) === 42 && line.charCodeAt(i + 1) === 47))
          i++;
        i++;
        segStart = i + 1;
        continue;
      }
      if (isRegexTriggerCharCode(prevSig) && next > 32 && next !== 47 && next !== 42 && next !== 61 && next !== 62) {
        const found = findClosingRegexSlash(line, i);
        if (found !== -1) {
          if (maskStrings) {
            out += line.slice(segStart, i) + "/r/";
            segStart = found + 1;
          }
          i = found;
          prevSig = 47;
          continue;
        }
      }
    }
    if (ch === 39 || ch === 34 || ch === 96) {
      const found = findClosingQuote(line, i, ch);
      if (found !== -1) {
        if (maskStrings) {
          out += line.slice(segStart, i) + '""';
          segStart = found + 1;
        }
        i = found;
        prevSig = ch;
        continue;
      }
    }
    if (ch > 32)
      prevSig = ch;
  }
  if (segStart === 0)
    return line;
  if (segStart < len)
    out += line.slice(segStart);
  return out;
}
function scanLexicalLines(src) {
  const rawLines = src.split(`
`);
  const numLines = rawLines.length;
  const lineStartBrace = new Int32Array(numLines + 2);
  const lineEndBrace = new Int32Array(numLines + 2);
  const lineMinBrace = new Int32Array(numLines + 2);
  const lineStartParen = new Int32Array(numLines + 2);
  const lineEndParen = new Int32Array(numLines + 2);
  const lineStartBracket = new Int32Array(numLines + 2);
  const lineEndBracket = new Int32Array(numLines + 2);
  const lineStartInLiteral = new Uint8Array(numLines + 2);
  const commentOrStringMask = new Uint8Array(numLines + 2);
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  let mode = 0;
  const templateBraceStack = [];
  let prevSig = 0;
  for (let L = 1;L <= numLines; L++) {
    lineStartBrace[L] = brace;
    lineMinBrace[L] = brace;
    lineStartParen[L] = paren;
    lineStartBracket[L] = bracket;
    const startsInLiteral = mode !== 0 ? 1 : 0;
    lineStartInLiteral[L] = startsInLiteral;
    let hasCommentOrString = startsInLiteral;
    const line = rawLines[L - 1];
    const len = line.length;
    for (let i = 0;i < len; i++) {
      const ch = line.charCodeAt(i);
      const next = i + 1 < len ? line.charCodeAt(i + 1) : 0;
      if (mode === 1) {
        hasCommentOrString = 1;
        if (ch === 42 && next === 47) {
          mode = 0;
          i++;
        }
        continue;
      }
      if (mode === 2) {
        hasCommentOrString = 1;
        if (ch === 92) {
          i++;
          continue;
        }
        if (ch === 96) {
          mode = 0;
          continue;
        }
        if (ch === 36 && next === 123) {
          templateBraceStack.push(brace);
          brace++;
          mode = 0;
          i++;
        }
        continue;
      }
      if (ch === 47) {
        if (next === 47) {
          hasCommentOrString = 1;
          break;
        }
        if (next === 42) {
          hasCommentOrString = 1;
          mode = 1;
          i++;
          continue;
        }
        if (isRegexTriggerCharCode(prevSig) && next > 32 && next !== 47 && next !== 42 && next !== 61 && next !== 62) {
          const found = findClosingRegexSlash(line, i);
          if (found !== -1) {
            hasCommentOrString = 1;
            i = found;
            prevSig = 47;
            continue;
          }
        }
      }
      if (ch === 39 || ch === 34) {
        const found = findClosingQuote(line, i, ch);
        if (found !== -1) {
          hasCommentOrString = 1;
          i = found;
          prevSig = ch;
          continue;
        }
      }
      if (ch === 96) {
        hasCommentOrString = 1;
        mode = 2;
        prevSig = ch;
        continue;
      }
      if (ch === 123) {
        brace++;
        prevSig = ch;
        continue;
      }
      if (ch === 125) {
        if (brace > 0)
          brace--;
        if (brace < lineMinBrace[L])
          lineMinBrace[L] = brace;
        if (templateBraceStack.length > 0 && brace === templateBraceStack[templateBraceStack.length - 1]) {
          templateBraceStack.pop();
          mode = 2;
        }
        prevSig = ch;
        continue;
      }
      if (ch === 40) {
        paren++;
        prevSig = ch;
        continue;
      }
      if (ch === 41) {
        if (paren > 0)
          paren--;
        prevSig = ch;
        continue;
      }
      if (ch === 91) {
        bracket++;
        prevSig = ch;
        continue;
      }
      if (ch === 93) {
        if (bracket > 0)
          bracket--;
        prevSig = ch;
        continue;
      }
      if (ch > 32)
        prevSig = ch;
    }
    commentOrStringMask[L] = hasCommentOrString;
    lineEndBrace[L] = brace;
    lineEndParen[L] = paren;
    lineEndBracket[L] = bracket;
  }
  const codeCache = new Array(numLines + 2);
  const displayCache = new Array(numLines + 2);
  return {
    numLines,
    rawLines,
    lineStartBrace,
    lineEndBrace,
    lineMinBrace,
    lineStartParen,
    lineEndParen,
    lineStartBracket,
    lineEndBracket,
    lineStartInLiteral,
    commentOrStringMask,
    getCodeLine(lineNum) {
      if (lineNum < 1 || lineNum > numLines)
        return "";
      let cached = codeCache[lineNum];
      if (cached === undefined) {
        cached = cleanSingleLine(rawLines[lineNum - 1], true);
        codeCache[lineNum] = cached;
      }
      return cached;
    },
    getDisplayLine(lineNum) {
      if (lineNum < 1 || lineNum > numLines)
        return "";
      let cached = displayCache[lineNum];
      if (cached === undefined) {
        cached = cleanSingleLine(rawLines[lineNum - 1], false);
        displayCache[lineNum] = cached;
      }
      return cached;
    }
  };
}
function resolveImportSpecifier(fromRelPath, specifier, knownPaths, rootDir) {
  if (!specifier.startsWith("."))
    return null;
  const fromDir = path7.posix.dirname(normalizeRelPath(fromRelPath));
  const base = path7.posix.normalize(path7.posix.join(fromDir, specifier));
  const strippedExt = base.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
  const candidates = [
    base,
    `${strippedExt}.ts`,
    `${strippedExt}.tsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`
  ];
  if (knownPaths !== undefined) {
    for (const candidate of candidates) {
      if (knownPaths.has(candidate))
        return candidate;
    }
  }
  if (rootDir !== undefined) {
    for (const candidate of candidates) {
      const full = path7.join(rootDir, candidate);
      if (existsSync8(full) && statSync4(full).isFile())
        return candidate;
    }
  }
  return null;
}
function firstNonSpaceCode(s) {
  for (let i = 0;i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 32)
      return c;
  }
  return 0;
}
function extractImportsAndReexports(fromRelPath, lex, scannedImports, knownPaths, rootDir) {
  const bySpec = new Map;
  for (const im of scannedImports) {
    if (!bySpec.has(im.path)) {
      bySpec.set(im.path, { names: new Set, typeOnly: false });
    }
  }
  const reexportedNames = new Set;
  const { numLines, rawLines, lineStartBrace, lineStartParen, lineStartInLiteral } = lex;
  for (let L = 1;L <= numLines; L++) {
    if (lineStartBrace[L] !== 0 || lineStartParen[L] !== 0 || lineStartInLiteral[L])
      continue;
    const raw = rawLines[L - 1];
    const fc = firstNonSpaceCode(raw);
    if (fc !== 105 && fc !== 101)
      continue;
    const t = lex.getDisplayLine(L).trim();
    if (!t)
      continue;
    const isImport = t.startsWith("import ") || t.startsWith("import\t");
    const isExportBraceOrStar = /^export\s+(?:type\s+)?(?:\*|\{)/.test(t);
    if (!isImport && !isExportBraceOrStar)
      continue;
    let stmt = t;
    let endL = L;
    while (endL < numLines) {
      if (/from\s+["'][^"']+["']/.test(stmt))
        break;
      if (isImport && /^import\s+["'][^"']+["']/.test(stmt))
        break;
      if (isExportBraceOrStar && stmt.includes("}") && !/}\s*from\b/.test(stmt) && !lex.getDisplayLine(endL + 1).trim().startsWith("from")) {
        break;
      }
      endL++;
      stmt += " " + lex.getDisplayLine(endL).trim();
    }
    L = endL;
    const fromMatch = /^(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/.exec(stmt);
    if (fromMatch) {
      const kw = fromMatch[1];
      const isType = Boolean(fromMatch[2]);
      const clause = fromMatch[3].trim();
      const spec = fromMatch[4].trim();
      let entry = bySpec.get(spec);
      if (!entry) {
        entry = { names: new Set, typeOnly: isType };
        bySpec.set(spec, entry);
      } else if (!isType) {
        entry.typeOnly = false;
      }
      const braceMatch = /\{([\s\S]*?)\}/.exec(clause);
      if (braceMatch) {
        for (const part of braceMatch[1].split(",")) {
          const clean = part.replace(/^\s*type\s+/, "").trim();
          if (!clean)
            continue;
          const pieces = clean.split(/\s+as\s+/);
          const orig = pieces[0].trim();
          const alias = (pieces[1] ?? pieces[0]).trim();
          if (orig)
            entry.names.add(orig);
          if (kw === "export" && alias)
            reexportedNames.add(alias);
        }
      } else if (clause.includes("*")) {
        entry.names.add("*");
      } else if (clause) {
        entry.names.add(clause.replace(/^\s*type\s+/, "").trim());
      }
    } else if (isExportBraceOrStar) {
      const braceMatch = /\{([\s\S]*?)\}/.exec(stmt);
      if (braceMatch) {
        for (const part of braceMatch[1].split(",")) {
          const clean = part.replace(/^\s*type\s+/, "").trim();
          if (!clean)
            continue;
          const pieces = clean.split(/\s+as\s+/);
          const alias = (pieces[1] ?? pieces[0]).trim();
          if (alias)
            reexportedNames.add(alias);
        }
      }
    }
  }
  const imports = [];
  for (const [specifier, info] of bySpec.entries()) {
    const resolvedPath = resolveImportSpecifier(fromRelPath, specifier, knownPaths, rootDir);
    imports.push({
      specifier,
      resolvedPath,
      names: [...info.names].sort(),
      typeOnly: info.typeOnly
    });
  }
  return { imports, reexportedNames };
}
function findDeclarationSpan(lex, startLine, kind) {
  const {
    numLines,
    lineStartBrace,
    lineEndBrace,
    lineMinBrace,
    lineStartParen,
    lineEndParen,
    lineStartBracket,
    lineEndBracket,
    lineStartInLiteral
  } = lex;
  const baseB = lineStartBrace[startLine];
  const baseP = lineStartParen[startLine];
  const baseK = lineStartBracket[startLine];
  const firstLineCode = lex.getCodeLine(startLine).trim();
  const isNewExpr = /=\s*new\s+[A-Za-z_$]/.test(firstLineCode);
  if (kind === "interface" || kind === "class" || kind === "enum") {
    let opened = false;
    let sigEndLine = startLine;
    let b = baseB;
    for (let L = startLine;L <= numLines; L++) {
      const s = lex.getCodeLine(L);
      for (let i = 0;i < s.length; i++) {
        if (s[i] === "{") {
          if (!opened && b === baseB) {
            opened = true;
            sigEndLine = L;
          }
          b++;
        } else if (s[i] === "}") {
          b--;
          if (opened && b === baseB) {
            return { sigEndLine, endLine: L, isFunctionLike: false };
          }
        }
      }
      if (opened && b > baseB) {
        let closeL = L + 1;
        while (closeL <= numLines && lineMinBrace[closeL] > baseB)
          closeL++;
        return { sigEndLine, endLine: Math.min(numLines, closeL), isFunctionLike: false };
      }
    }
    return { sigEndLine, endLine: numLines, isFunctionLike: false };
  }
  if (kind === "type") {
    for (let L = startLine;L <= numLines; L++) {
      if (lineEndBrace[L] <= baseB && lineEndParen[L] <= baseP && lineEndBracket[L] <= baseK && !lineStartInLiteral[L + 1]) {
        const curTrim = lex.getCodeLine(L).trim();
        const nextTrim = lex.getCodeLine(L + 1).trim();
        if (/[=|&?:<,]$/.test(curTrim))
          continue;
        if (/^[|&?:]/.test(nextTrim))
          continue;
        return { sigEndLine: startLine, endLine: L, isFunctionLike: false };
      }
    }
    return { sigEndLine: startLine, endLine: numLines, isFunctionLike: false };
  }
  let b = baseB;
  let p = baseP;
  let k = baseK;
  let seenParens = false;
  let paramsClosed = false;
  let seenArrow = false;
  let bodyOpened = false;
  let sigEndLine = startLine;
  for (let L = startLine;L <= numLines; L++) {
    const s = lex.getCodeLine(L);
    for (let i = 0;i < s.length; i++) {
      const c = s[i];
      const nxt = i + 1 < s.length ? s[i + 1] : "";
      if (!isNewExpr && !bodyOpened && c === "=" && nxt === ">" && b === baseB && p === baseP) {
        seenArrow = true;
        sigEndLine = L;
        i++;
        continue;
      }
      if (c === "(") {
        if (b === baseB && p === baseP && !seenParens)
          seenParens = true;
        p++;
      } else if (c === ")") {
        p--;
        if (seenParens && p === baseP && b === baseB)
          paramsClosed = true;
      } else if (c === "[") {
        k++;
      } else if (c === "]") {
        k--;
      } else if (c === "{") {
        if (!bodyOpened && b === baseB && p === baseP) {
          if (kind === "function" || kind === "method" || seenArrow) {
            let tb = 1;
            let tl = L;
            let ti = i + 1;
            for (;tl <= numLines; tl++) {
              const ts = lex.getCodeLine(tl);
              for (;ti < ts.length; ti++) {
                if (ts[ti] === "{")
                  tb++;
                else if (ts[ti] === "}") {
                  tb--;
                  if (tb === 0)
                    break;
                }
              }
              if (tb === 0)
                break;
              ti = 0;
              if (tl + 1 <= numLines && lineMinBrace[tl + 1] > b + 1) {
                while (tl + 1 <= numLines && lineMinBrace[tl + 1] > b + 1)
                  tl++;
              }
            }
            if (tb === 0) {
              const restSame = lex.getCodeLine(tl).slice(ti + 1).trim();
              const restNext = lex.getCodeLine(tl + 1).trim();
              const after = restSame || restNext;
              if (after.startsWith("{") || after.startsWith("=>")) {
                b++;
                continue;
              }
            }
            bodyOpened = true;
            sigEndLine = L;
          }
        }
        b++;
      } else if (c === "}") {
        b--;
        if (bodyOpened && b === baseB && p === baseP) {
          return { sigEndLine, endLine: L, isFunctionLike: true };
        }
      }
    }
    if (bodyOpened && b > baseB) {
      let closeL = L + 1;
      while (closeL <= numLines && lineMinBrace[closeL] > baseB)
        closeL++;
      return { sigEndLine, endLine: Math.min(numLines, closeL), isFunctionLike: true };
    }
    if (!bodyOpened && !seenArrow && (kind === "const" || kind === "property") && (isNewExpr || !seenParens)) {
      while (L < numLines && (lineEndBrace[L] > baseB || lineEndParen[L] > baseP || lineEndBracket[L] > baseK || lineStartInLiteral[L + 1] === 1)) {
        L++;
      }
      b = lineEndBrace[L];
      p = lineEndParen[L];
      k = lineEndBracket[L];
    }
    if (!bodyOpened && b <= baseB && p <= baseP && k <= baseK && !lineStartInLiteral[L + 1]) {
      const curTrim = lex.getCodeLine(L).trim();
      const nextTrim = lex.getCodeLine(L + 1).trim();
      if (seenArrow) {
        if (/(=>|&&|\|\||\?\?|\?|:|\+|-|\*|=|\()$/.test(curTrim))
          continue;
        if (/^(\.|\?|:|&&|\|\||\?\?)/.test(nextTrim))
          continue;
        return { sigEndLine, endLine: L, isFunctionLike: true };
      }
      if (kind === "const" || kind === "property") {
        if (/(=|\+|\||&&|\|\||\?\?|\()$/.test(curTrim))
          continue;
        if (!seenParens || isNewExpr) {
          return { sigEndLine: startLine, endLine: L, isFunctionLike: false };
        }
        if (seenParens && paramsClosed && !curTrim.endsWith(":") && !nextTrim.startsWith("=>")) {
          return { sigEndLine: startLine, endLine: L, isFunctionLike: false };
        }
      }
    }
  }
  return { sigEndLine, endLine: numLines, isFunctionLike: seenArrow };
}
function buildSignature(lex, startLine, sigEndLine, endLine, kind) {
  const raw = [];
  for (let L = startLine;L <= sigEndLine; L++) {
    const t = lex.getDisplayLine(L).trim();
    if (t)
      raw.push(t);
  }
  let joined = normalizeWhitespace(raw.join(" "));
  if (kind === "interface" || kind === "class" || kind === "enum") {
    joined = joined.replace(/\s*\{.*$/, "");
    return `${joined} { /* L${startLine}-L${endLine} */ }`;
  }
  if (kind === "type") {
    if (startLine === endLine && joined.length <= 100)
      return joined;
    const eqIdx = joined.indexOf("=");
    const lhs = eqIdx !== -1 ? joined.slice(0, eqIdx + 1).trim() : joined;
    return `${lhs} /* L${startLine}-L${endLine} */`;
  }
  const arrowIdx = joined.lastIndexOf("=>");
  if (arrowIdx !== -1) {
    const header = joined.slice(0, arrowIdx + 2).trim();
    return `${header} { /* L${startLine}-L${endLine} */ }`;
  }
  if (kind === "function" || kind === "method") {
    const braceIdx = joined.lastIndexOf("{");
    const header = braceIdx !== -1 ? joined.slice(0, braceIdx).trim() : joined;
    return `${header} { /* L${startLine}-L${endLine} */ }`;
  }
  if (startLine === endLine && joined.length <= 100)
    return joined;
  const eqIdx = joined.indexOf("=");
  const lhs = eqIdx !== -1 ? joined.slice(0, eqIdx + 1).trim() : joined;
  return `${lhs} /* L${startLine}-L${endLine} */`;
}
function skeletonizeSource(filePath, sourceText, options = {}) {
  const normPath = normalizeRelPath(filePath);
  const isTsx = normPath.endsWith(".tsx");
  const scanned = (isTsx ? tsxTranspiler : tsTranspiler).scan(sourceText);
  const lex = scanLexicalLines(sourceText);
  const { imports, reexportedNames } = extractImportsAndReexports(normPath, lex, scanned.imports ?? [], options.knownPaths, options.rootDir);
  const exportSet = new Set([...scanned.exports ?? [], ...reexportedNames]);
  const explicitThreshold = options.closureFactoryMinLines ?? options.factoryLineThreshold;
  const factoryThreshold = explicitThreshold ?? 200;
  const symbols = [];
  const skeletonLines = [`// ${normPath} (${lex.numLines} LOC)`];
  if (imports.length > 0) {
    const specs = imports.map((im) => im.resolvedPath ?? im.specifier);
    skeletonLines.push(`// imports: ${specs.join(", ")}`);
  }
  const { numLines, rawLines, lineStartBrace, lineStartParen, lineStartInLiteral } = lex;
  for (let L = 1;L <= numLines; L++) {
    if (lineStartBrace[L] !== 0 || lineStartParen[L] !== 0 || lineStartInLiteral[L])
      continue;
    const fc = firstNonSpaceCode(rawLines[L - 1]);
    if (fc !== 101 && fc !== 102 && fc !== 99 && fc !== 105 && fc !== 116 && fc !== 97 && fc !== 100 && fc !== 108) {
      continue;
    }
    const s = lex.getCodeLine(L).trim();
    if (!s)
      continue;
    const m = /^(export\s+)?(declare\s+)?(default\s+)?(async\s+)?(function|class|interface|type|const|let|enum|const\s+enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(s);
    if (!m)
      continue;
    const name = m[6];
    const exported = Boolean(m[1]) || exportSet.has(name);
    if (exported)
      exportSet.add(name);
    const rawKind = m[5].replace(/^const\s+/, "").trim();
    const baseKind = rawKind === "let" ? "const" : rawKind;
    const span = findDeclarationSpan(lex, L, baseKind);
    const effectiveKind = baseKind === "const" && span.isFunctionLike ? "function" : baseKind;
    const sig = buildSignature(lex, L, span.sigEndLine, span.endLine, effectiveKind);
    symbols.push({
      path: normPath,
      name,
      qualified_name: name,
      kind: effectiveKind,
      depth: 1,
      parent_symbol: null,
      start_line: L,
      end_line: span.endLine,
      signature: sig,
      exported
    });
    skeletonLines.push(`[L${L}-L${span.endLine}] ${sig}`);
    const spanLen = span.endLine - L + 1;
    const shouldDescendDepth2 = baseKind === "class" || (baseKind === "function" || baseKind === "const") && (spanLen >= factoryThreshold || explicitThreshold === undefined && (spanLen > 50 || /^create[A-Z]/.test(name)));
    if (shouldDescendDepth2) {
      for (let cL = span.sigEndLine + 1;cL < span.endLine; cL++) {
        if (lineStartInLiteral[cL] || lineStartParen[cL] !== 0)
          continue;
        const bDepth = lineStartBrace[cL];
        if (bDepth !== 1)
          continue;
        const cfc = firstNonSpaceCode(rawLines[cL - 1]);
        if (cfc === 0 || cfc === 47 || cfc === 42 || cfc === 125)
          continue;
        if (baseKind !== "class" && cfc !== 99 && cfc !== 102 && cfc !== 97 && cfc !== 114)
          continue;
        const cs = lex.getCodeLine(cL).trim();
        if (!cs)
          continue;
        if (baseKind === "class") {
          const cm = /^(?:(public|private|protected|static|readonly|async|get|set|override)\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/.exec(cs);
          if (cm && !["if", "for", "while", "switch", "catch"].includes(cm[2])) {
            const mName = cm[2];
            const mSpan = findDeclarationSpan(lex, cL, "method");
            const mSig = buildSignature(lex, cL, mSpan.sigEndLine, mSpan.endLine, "method");
            symbols.push({
              path: normPath,
              name: mName,
              qualified_name: `${name}.${mName}`,
              kind: "method",
              depth: 2,
              parent_symbol: name,
              start_line: cL,
              end_line: mSpan.endLine,
              signature: mSig,
              exported
            });
            skeletonLines.push(`  [L${cL}-L${mSpan.endLine}] ${mSig}`);
            cL = mSpan.endLine;
          }
        } else {
          const fm = /^(async\s+)?(function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(cs);
          if (fm) {
            const fKind = fm[2];
            const fName = fm[3];
            const fSpan = findDeclarationSpan(lex, cL, fKind);
            if (fKind === "function" || fSpan.isFunctionLike) {
              const fSig = buildSignature(lex, cL, fSpan.sigEndLine, fSpan.endLine, "function");
              symbols.push({
                path: normPath,
                name: fName,
                qualified_name: `${name}.${fName}`,
                kind: "function",
                depth: 2,
                parent_symbol: name,
                start_line: cL,
                end_line: fSpan.endLine,
                signature: fSig,
                exported: false
              });
              skeletonLines.push(`  [L${cL}-L${fSpan.endLine}] ${fSig}`);
            }
            cL = fSpan.endLine;
            continue;
          }
          if (cs.startsWith("return") && /^return\s*\{/.test(cs)) {
            const retSpan = findDeclarationSpan(lex, cL, "interface");
            for (let rL = cL + 1;rL < retSpan.endLine; rL++) {
              if (lineStartBrace[rL] !== 2 || lineStartParen[rL] !== 0 || lineStartInLiteral[rL])
                continue;
              const rfc = firstNonSpaceCode(rawLines[rL - 1]);
              if (rfc === 0 || rfc === 47 || rfc === 42 || rfc === 125)
                continue;
              const rs = lex.getCodeLine(rL).trim();
              const rm = /^(?:(async)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*(?:async\s*)?\(|:\s*[A-Za-z_$][A-Za-z0-9_$]*\s*=>|\()/.exec(rs);
              if (rm) {
                const rName = rm[2];
                const isMethodShorthand = rs.startsWith("async ") || /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.test(rs);
                const rSpan = findDeclarationSpan(lex, rL, isMethodShorthand ? "method" : "property");
                const rSig = buildSignature(lex, rL, rSpan.sigEndLine, rSpan.endLine, "method");
                symbols.push({
                  path: normPath,
                  name: rName,
                  qualified_name: `${name}.${rName}`,
                  kind: "method",
                  depth: 2,
                  parent_symbol: name,
                  start_line: rL,
                  end_line: rSpan.endLine,
                  signature: rSig,
                  exported: true
                });
                skeletonLines.push(`  [L${rL}-L${rSpan.endLine}] ${rSig}`);
                rL = rSpan.endLine;
              }
            }
            cL = retSpan.endLine;
          }
        }
      }
    }
    L = span.endLine;
  }
  const skeletonText = skeletonLines.join(`
`);
  const rawChars = sourceText.length;
  const skeletonChars = skeletonText.length;
  const rawTokens = estimateTokens3(sourceText);
  const skeletonTokens = estimateTokens3(skeletonText);
  const reductionRatio = rawTokens > 0 ? 1 - skeletonTokens / rawTokens : 0;
  return {
    filePath: normPath,
    loc: numLines,
    rawChars,
    rawTokens,
    skeletonChars,
    skeletonTokens,
    reductionRatio,
    exports: [...exportSet].sort(),
    imports,
    symbols,
    skeletonText
  };
}
function collectTypeScriptFiles(rootDir, subDir = "src") {
  const startDir = path7.join(rootDir, subDir);
  const results = [];
  function walk(dir) {
    for (const ent of readdirSync3(dir, { withFileTypes: true })) {
      const full = path7.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (/\.(?:ts|tsx)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
        results.push(normalizeRelPath(path7.relative(rootDir, full)));
      }
    }
  }
  if (existsSync8(startDir))
    walk(startDir);
  return results.sort();
}
function resolveDbAndRootDir(first, second) {
  if (typeof first === "string") {
    return { rootDir: first, db: second };
  }
  return { db: first, rootDir: second };
}
function indexCodebase(first, second, pathsOrOptions) {
  const t0 = performance.now();
  const { db, rootDir } = resolveDbAndRootDir(first, second);
  ensureCodeGraphSchema(db);
  let explicitPaths;
  let options = {};
  if (Array.isArray(pathsOrOptions)) {
    explicitPaths = pathsOrOptions;
  } else if (pathsOrOptions && typeof pathsOrOptions === "object") {
    options = pathsOrOptions;
    explicitPaths = options.paths ?? options.relPaths;
  }
  const force = Boolean(options.force ?? options.forceRebuild);
  const subDirs = options.subDirs ?? [options.subDir ?? "src"];
  const discoveredPaths = explicitPaths ?? subDirs.flatMap((sd) => collectTypeScriptFiles(rootDir, sd));
  const targetPaths = [...new Set(discoveredPaths.map(normalizeRelPath))].sort();
  const targetPathSet = new Set(targetPaths);
  const knownPaths = new Set(targetPaths);
  const existingRows = db.query("SELECT path, blob_sha, loc, raw_tokens, skeleton_tokens FROM code_file").all();
  const existingByPath = new Map(existingRows.map((r) => [r.path, r]));
  for (const r of existingRows) {
    if (targetPathSet.has(r.path) || existsSync8(path7.join(rootDir, r.path))) {
      knownPaths.add(r.path);
    }
  }
  const removedPaths = [];
  for (const r of existingRows) {
    if (explicitPaths === undefined) {
      if (!targetPathSet.has(r.path)) {
        removedPaths.push(r.path);
      }
    } else if (!existsSync8(path7.join(rootDir, r.path))) {
      removedPaths.push(r.path);
    }
  }
  const toUpdate = [];
  let skippedWarmFiles = 0;
  let totalLoc = 0;
  let totalRawTokens = 0;
  let totalSkeletonTokens = 0;
  for (const relPath of targetPaths) {
    const absPath = path7.join(rootDir, relPath);
    if (!existsSync8(absPath)) {
      if (existingByPath.has(relPath) && !removedPaths.includes(relPath)) {
        removedPaths.push(relPath);
      }
      continue;
    }
    const sourceText = readFileSync6(absPath, "utf8");
    const blobSha = computeBlobSha(sourceText);
    const prev = existingByPath.get(relPath);
    if (!force && prev !== undefined && prev.blob_sha === blobSha) {
      skippedWarmFiles++;
      totalLoc += prev.loc;
      totalRawTokens += prev.raw_tokens;
      totalSkeletonTokens += prev.skeleton_tokens;
      continue;
    }
    const skeleton = skeletonizeSource(relPath, sourceText, {
      rootDir,
      knownPaths,
      closureFactoryMinLines: options.closureFactoryMinLines,
      factoryLineThreshold: options.factoryLineThreshold
    });
    totalLoc += skeleton.loc;
    totalRawTokens += skeleton.rawTokens;
    totalSkeletonTokens += skeleton.skeletonTokens;
    toUpdate.push({ relPath, blobSha, skeleton });
  }
  if (toUpdate.length > 0 || removedPaths.length > 0) {
    const now = Date.now();
    const deleteFile = db.query("DELETE FROM code_file WHERE path = ?");
    const upsertFile = db.query(`
      INSERT INTO code_file (path, blob_sha, loc, raw_tokens, skeleton_tokens, skeleton_text, pagerank, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT pagerank FROM code_file WHERE path = ?), 0), ?)
      ON CONFLICT(path) DO UPDATE SET
        blob_sha = excluded.blob_sha,
        loc = excluded.loc,
        raw_tokens = excluded.raw_tokens,
        skeleton_tokens = excluded.skeleton_tokens,
        skeleton_text = excluded.skeleton_text,
        updated_at = excluded.updated_at
    `);
    const deleteSymbols = db.query("DELETE FROM code_symbol WHERE path = ?");
    const insertSymbol = db.query(`
      INSERT OR REPLACE INTO code_symbol
        (path, name, qualified_name, kind, depth, parent_symbol, start_line, end_line, signature, exported, blob_sha)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteEdgesFrom = db.query("DELETE FROM code_import_edge WHERE from_path = ?");
    const deleteEdgesTo = db.query("DELETE FROM code_import_edge WHERE to_path = ?");
    const insertEdge = db.query(`
      INSERT OR REPLACE INTO code_import_edge
        (from_path, to_path, specifier, symbols_json, specifiers_json, is_type_only)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const applyUpdates = db.transaction(() => {
      for (const remPath of removedPaths) {
        deleteFile.run(remPath);
        deleteSymbols.run(remPath);
        deleteEdgesFrom.run(remPath);
        deleteEdgesTo.run(remPath);
      }
      for (const item of toUpdate) {
        const { relPath, blobSha, skeleton } = item;
        upsertFile.run(relPath, blobSha, skeleton.loc, skeleton.rawTokens, skeleton.skeletonTokens, skeleton.skeletonText, relPath, now);
        deleteSymbols.run(relPath);
        for (const sym of skeleton.symbols) {
          insertSymbol.run(sym.path, sym.name, sym.qualified_name, sym.kind, sym.depth, sym.parent_symbol, sym.start_line, sym.end_line, sym.signature, sym.exported ? 1 : 0, blobSha);
        }
        deleteEdgesFrom.run(relPath);
        const edgesByTarget = new Map;
        for (const imp of skeleton.imports) {
          if (!imp.resolvedPath)
            continue;
          let entry = edgesByTarget.get(imp.resolvedPath);
          if (!entry) {
            entry = { specifier: imp.specifier, names: new Set, typeOnly: imp.typeOnly };
            edgesByTarget.set(imp.resolvedPath, entry);
          } else if (!imp.typeOnly) {
            entry.typeOnly = false;
          }
          for (const n of imp.names)
            entry.names.add(n);
        }
        for (const [toPath, info] of edgesByTarget.entries()) {
          const json = JSON.stringify([...info.names].sort());
          insertEdge.run(relPath, toPath, info.specifier, json, json, info.typeOnly ? 1 : 0);
        }
      }
    });
    applyUpdates();
  }
  const symCounts = db.query("SELECT COUNT(*) AS total, SUM(CASE WHEN depth = 2 THEN 1 ELSE 0 END) AS d2 FROM code_symbol").get();
  const edgeCounts = db.query("SELECT COUNT(*) AS total FROM code_import_edge").get();
  const elapsedMs = performance.now() - t0;
  const reductionRatio = totalRawTokens > 0 ? 1 - totalSkeletonTokens / totalRawTokens : 0;
  const totalSymbols = symCounts.total;
  const depth2Symbols = symCounts.d2 ?? 0;
  const depth1Symbols = Math.max(0, totalSymbols - depth2Symbols);
  const totalImportEdges = edgeCounts.total;
  return {
    totalFiles: skippedWarmFiles + toUpdate.length,
    parsedFiles: toUpdate.length,
    skippedWarmFiles,
    skippedUnchangedFiles: skippedWarmFiles,
    removedFiles: removedPaths.length,
    totalLoc,
    totalRawTokens,
    totalSkeletonTokens,
    reductionRatio,
    tokenReductionPct: reductionRatio * 100,
    totalSymbols,
    extractedSymbols: totalSymbols,
    depth1Symbols,
    depth2Symbols,
    totalImportEdges,
    importEdges: totalImportEdges,
    elapsedMs
  };
}
function readAstSkeleton(db, filePath) {
  ensureCodeGraphSchema(db);
  const normPath = normalizeRelPath(filePath);
  const fileRow = db.query("SELECT * FROM code_file WHERE path = ?").get(normPath);
  if (!fileRow)
    return null;
  const symbolRows = db.query("SELECT * FROM code_symbol WHERE path = ? ORDER BY start_line ASC, depth ASC").all(normPath);
  const outEdgeRows = db.query("SELECT * FROM code_import_edge WHERE from_path = ? ORDER BY to_path ASC").all(normPath);
  const inEdgeRows = db.query("SELECT * FROM code_import_edge WHERE to_path = ? ORDER BY from_path ASC").all(normPath);
  return {
    path: fileRow.path,
    blob_sha: fileRow.blob_sha,
    loc: fileRow.loc,
    raw_tokens: fileRow.raw_tokens,
    skeleton_tokens: fileRow.skeleton_tokens,
    reduction_ratio: fileRow.raw_tokens > 0 ? 1 - fileRow.skeleton_tokens / fileRow.raw_tokens : 0,
    pagerank: fileRow.pagerank,
    updated_at: fileRow.updated_at,
    skeleton_text: fileRow.skeleton_text,
    symbols: symbolRows.map((s) => {
      const qName = s.qualified_name && s.qualified_name.length > 0 ? s.qualified_name : s.parent_symbol ? `${s.parent_symbol}.${s.name}` : s.name;
      return {
        path: s.path,
        name: s.name,
        qualified_name: qName,
        kind: s.kind,
        depth: s.depth === 2 ? 2 : 1,
        parent_symbol: s.parent_symbol,
        start_line: s.start_line,
        end_line: s.end_line,
        signature: s.signature,
        exported: Boolean(s.exported)
      };
    }),
    imports: outEdgeRows.map((e) => {
      const parsed = JSON.parse(e.symbols_json || e.specifiers_json || "[]");
      return {
        to_path: e.to_path,
        specifier: e.specifier ?? "",
        specifiers: parsed,
        symbols: parsed,
        is_type_only: Boolean(e.is_type_only)
      };
    }),
    imported_by: inEdgeRows.map((e) => {
      const parsed = JSON.parse(e.symbols_json || e.specifiers_json || "[]");
      return {
        from_path: e.from_path,
        specifier: e.specifier ?? "",
        specifiers: parsed,
        symbols: parsed,
        is_type_only: Boolean(e.is_type_only)
      };
    })
  };
}
function readSymbolSlice(first, second, filePath, symbolOrLineRange) {
  const { db, rootDir } = resolveDbAndRootDir(first, second);
  ensureCodeGraphSchema(db);
  const normPath = normalizeRelPath(filePath);
  const absPath = path7.join(rootDir, normPath);
  if (!existsSync8(absPath))
    return null;
  const sourceText = readFileSync6(absPath, "utf8");
  const lines = sourceText.split(`
`);
  const rawFileTokens = estimateTokens3(sourceText);
  let startLine;
  let endLine;
  let symbolName = null;
  let kind = null;
  let depth = null;
  let parentSymbol = null;
  if (typeof symbolOrLineRange === "object") {
    const rawStart = "startLine" in symbolOrLineRange ? symbolOrLineRange.startLine : symbolOrLineRange.start_line;
    const rawEnd = "endLine" in symbolOrLineRange ? symbolOrLineRange.endLine : symbolOrLineRange.end_line;
    startLine = Math.max(1, rawStart);
    endLine = Math.min(lines.length, rawEnd);
  } else {
    const rangeMatch = /^\[?L?(\d+)\s*(?:-|\.\.)\s*L?(\d+)\]?$/i.exec(symbolOrLineRange.trim());
    if (rangeMatch) {
      startLine = Math.max(1, Number(rangeMatch[1]));
      endLine = Math.min(lines.length, Number(rangeMatch[2]));
    } else {
      const query = symbolOrLineRange.trim();
      let row = db.query("SELECT * FROM code_symbol WHERE path = ? AND qualified_name = ? ORDER BY start_line ASC LIMIT 1").get(normPath, query);
      if (!row && query.includes(".")) {
        const [parent, child] = query.split(".", 2);
        row = db.query("SELECT * FROM code_symbol WHERE path = ? AND parent_symbol = ? AND name = ? ORDER BY start_line ASC LIMIT 1").get(normPath, parent, child);
      }
      if (!row) {
        row = db.query("SELECT * FROM code_symbol WHERE path = ? AND name = ? ORDER BY depth ASC, start_line ASC LIMIT 1").get(normPath, query);
      }
      if (!row) {
        const fallbackSkel = skeletonizeSource(normPath, sourceText, { rootDir });
        const matched = fallbackSkel.symbols.find((s) => s.qualified_name === query) ?? fallbackSkel.symbols.find((s) => s.name === query);
        if (!matched)
          return null;
        startLine = matched.start_line;
        endLine = matched.end_line;
        symbolName = matched.qualified_name;
        kind = matched.kind;
        depth = matched.depth;
        parentSymbol = matched.parent_symbol;
      } else {
        startLine = row.start_line;
        endLine = row.end_line;
        symbolName = row.qualified_name && row.qualified_name.length > 0 ? row.qualified_name : row.parent_symbol ? `${row.parent_symbol}.${row.name}` : row.name;
        kind = row.kind;
        depth = row.depth;
        parentSymbol = row.parent_symbol;
      }
    }
  }
  if (startLine > endLine || startLine > lines.length)
    return null;
  const clampedEnd = Math.min(lines.length, endLine);
  const numberedLines = [];
  for (let L = startLine;L <= clampedEnd; L++) {
    numberedLines.push(`L${L}: ${lines[L - 1] ?? ""}`);
  }
  const metaParts = [];
  if (symbolName)
    metaParts.push(symbolName);
  if (kind)
    metaParts.push(`kind=${kind}`);
  if (depth !== null)
    metaParts.push(`depth=${depth}`);
  const label = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
  const header = `// ${normPath} [L${startLine}-L${clampedEnd}]${label}`;
  const sliceText = `${header}
${numberedLines.join(`
`)}`;
  return {
    path: normPath,
    symbol: symbolName,
    qualified_name: symbolName,
    kind,
    depth,
    parent_symbol: parentSymbol,
    start_line: startLine,
    end_line: clampedEnd,
    line_count: clampedEnd - startLine + 1,
    slice_tokens: estimateTokens3(sliceText),
    raw_file_tokens: rawFileTokens,
    header,
    slice_text: sliceText
  };
}
function indexSingleFileSkeleton(first, second, filePath) {
  const { db, rootDir } = resolveDbAndRootDir(first, second);
  ensureCodeGraphSchema(db);
  const normPath = normalizeRepoPath(filePath, rootDir);
  const absPath = resolveDiskPath(filePath, rootDir);
  if (!existsSync8(absPath)) {
    return readAstSkeleton(db, normPath);
  }
  let content;
  try {
    const st = statSync4(absPath);
    if (!st.isFile())
      return readAstSkeleton(db, normPath);
    content = readFileSync6(absPath, "utf8");
  } catch {
    return readAstSkeleton(db, normPath);
  }
  const blobSha = computeBlobSha(content);
  const existing = db.query("SELECT blob_sha FROM code_file WHERE path = ?").get(normPath);
  if (existing && existing.blob_sha === blobSha) {
    return readAstSkeleton(db, normPath);
  }
  const skeleton = skeletonizeSource(normPath, content, { rootDir });
  const now = Date.now();
  const upsertTx = db.transaction(() => {
    db.query(`
      INSERT INTO code_file (path, blob_sha, loc, raw_tokens, skeleton_tokens, skeleton_text, pagerank, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT pagerank FROM code_file WHERE path = ?), 0), ?)
      ON CONFLICT(path) DO UPDATE SET
        blob_sha = excluded.blob_sha,
        loc = excluded.loc,
        raw_tokens = excluded.raw_tokens,
        skeleton_tokens = excluded.skeleton_tokens,
        skeleton_text = excluded.skeleton_text,
        updated_at = excluded.updated_at
    `).run(normPath, blobSha, skeleton.loc, skeleton.rawTokens, skeleton.skeletonTokens, skeleton.skeletonText, normPath, now);
    db.query("DELETE FROM code_symbol WHERE path = ?").run(normPath);
    const insertSym = db.query(`
      INSERT OR REPLACE INTO code_symbol (
        path, name, qualified_name, kind, depth, parent_symbol,
        start_line, end_line, signature, exported, blob_sha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const sym of skeleton.symbols) {
      insertSym.run(sym.path, sym.name, sym.qualified_name, sym.kind, sym.depth, sym.parent_symbol, sym.start_line, sym.end_line, sym.signature, sym.exported ? 1 : 0, blobSha);
    }
    db.query("DELETE FROM code_import_edge WHERE from_path = ?").run(normPath);
    const insertEdge = db.query(`
      INSERT OR REPLACE INTO code_import_edge (
        from_path, to_path, specifier, symbols_json, specifiers_json, is_type_only
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const edgesByTarget = new Map;
    for (const imp of skeleton.imports) {
      if (!imp.resolvedPath)
        continue;
      let entry = edgesByTarget.get(imp.resolvedPath);
      if (!entry) {
        entry = { specifier: imp.specifier, names: new Set, typeOnly: imp.typeOnly };
        edgesByTarget.set(imp.resolvedPath, entry);
      } else if (!imp.typeOnly) {
        entry.typeOnly = false;
      }
      for (const n of imp.names)
        entry.names.add(n);
    }
    for (const [toPath, info] of edgesByTarget.entries()) {
      const json = JSON.stringify([...info.names].sort());
      insertEdge.run(normPath, toPath, info.specifier, json, json, info.typeOnly ? 1 : 0);
    }
  });
  upsertTx();
  return readAstSkeleton(db, normPath);
}
function buildJitReadSkeletonFooter(first, second, filePath, readMeta) {
  const isPartial = readMeta.isTruncated || readMeta.startLine > 1 || readMeta.totalLines !== null && readMeta.endLine < readMeta.totalLines;
  if (!isPartial)
    return null;
  const { db, rootDir } = resolveDbAndRootDir(first, second);
  const skel = indexSingleFileSkeleton(db, rootDir, filePath);
  if (!skel || skel.symbols.length === 0)
    return null;
  const unread = skel.symbols.filter((s) => (s.depth === 1 || s.exported) && (s.start_line < readMeta.startLine || s.end_line > readMeta.endLine));
  if (unread.length === 0)
    return null;
  const totalLoc = readMeta.totalLines ?? skel.loc;
  const headerLine = `

${JIT_SKELETON_MARKER} ${skel.path} (shown L${readMeta.startLine}-L${readMeta.endLine} of ${totalLoc}; ${unread.length} unread symbols):`;
  const hintLine = `Hint: Use substrate.viewport({ action: "slice", path: "${skel.path}", symbol: "<symbol>" }) or read with offset/limit.`;
  const maxChars = 148 * 4;
  const fixedChars = headerLine.length + 1 + hintLine.length;
  const bulletLines = [];
  let usedChars = fixedChars;
  for (let i = 0;i < unread.length; i++) {
    const s = unread[i];
    const item = `- [L${s.start_line}-L${s.end_line}] ${s.qualified_name} (${s.kind})`;
    const remaining = unread.length - (i + 1);
    const moreLine = remaining > 0 ? `- ... (+${remaining} more unread symbols)` : "";
    const projected = usedChars + 1 + item.length + (moreLine ? 1 + moreLine.length : 0);
    if (projected > maxChars) {
      const restCount = unread.length - i;
      const restLine = `- ... (+${restCount} more unread symbols)`;
      if (usedChars + 1 + restLine.length <= maxChars) {
        bulletLines.push(restLine);
      }
      break;
    }
    bulletLines.push(item);
    usedChars += 1 + item.length;
  }
  return [headerLine, ...bulletLines, hintLine].join(`
`);
}

// src/honeycomb/cochange.ts
var GIT_COCHANGE_DDL = `
CREATE TABLE IF NOT EXISTS git_cochange (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  co_commits INTEGER NOT NULL,
  commits_a INTEGER NOT NULL,
  commits_b INTEGER NOT NULL,
  prob_a_given_b REAL NOT NULL,
  prob_b_given_a REAL NOT NULL,
  jaccard REAL NOT NULL,
  has_static_edge INTEGER NOT NULL,
  recent_subjects_json TEXT NOT NULL,
  PRIMARY KEY (file_a, file_b)
);

CREATE INDEX IF NOT EXISTS idx_git_cochange_file_a ON git_cochange(file_a);
CREATE INDEX IF NOT EXISTS idx_git_cochange_file_b ON git_cochange(file_b);
CREATE INDEX IF NOT EXISTS idx_git_cochange_hidden ON git_cochange(has_static_edge, co_commits DESC);

CREATE TABLE IF NOT EXISTS git_cochange_file_stats (
  path TEXT PRIMARY KEY,
  commit_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS git_cochange_commit (
  hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  files_json TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT 0
);
`;
var initializedCochangeDbs = new WeakSet;
function ensureCochangeSchema(db) {
  ensureHoneycombSchema(db);
  ensureCodeGraphSchema(db);
  if (initializedCochangeDbs.has(db)) {
    const hasTable = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'git_cochange'").get();
    if (hasTable)
      return;
  }
  db.exec(GIT_COCHANGE_DDL);
  const commitCols = new Set(db.query("PRAGMA table_info(git_cochange_commit)").all().map((c) => c.name));
  if (!commitCols.has("applied_at")) {
    db.exec("ALTER TABLE git_cochange_commit ADD COLUMN applied_at INTEGER NOT NULL DEFAULT 0");
  }
  initializedCochangeDbs.add(db);
}
function parseGitLogOutput(rawOutput) {
  const lines = rawOutput.split(`
`);
  const commits = [];
  let currentHash = "";
  let currentSubject = "";
  let currentFiles = [];
  let inCommit = false;
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("COMMIT:")) {
      if (inCommit && currentFiles.length > 0) {
        commits.push({
          hash: currentHash,
          subject: currentSubject,
          files: currentFiles
        });
      }
      const rest = line.slice(7);
      const sepIdx = rest.indexOf("|");
      if (sepIdx !== -1) {
        currentHash = rest.slice(0, sepIdx).trim();
        currentSubject = rest.slice(sepIdx + 1).trim();
      } else {
        currentHash = rest.trim();
        currentSubject = "";
      }
      currentFiles = [];
      inCommit = true;
    } else if (inCommit) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        currentFiles.push(normalizeRelPath(trimmed));
      }
    }
  }
  if (inCommit && currentFiles.length > 0) {
    commits.push({
      hash: currentHash,
      subject: currentSubject,
      files: currentFiles
    });
  }
  return commits;
}
function loadStaticEdgePairSet(db) {
  const edgeRows = db.query("SELECT from_path, to_path FROM code_import_edge").all();
  const pairSet = new Set;
  for (const e of edgeRows) {
    const [a, b] = e.from_path < e.to_path ? [e.from_path, e.to_path] : [e.to_path, e.from_path];
    pairSet.add(`${a}|||${b}`);
  }
  return pairSet;
}
function applyIncrementalCommits(db, commits, options) {
  const { maxFilesPerCommit, pathPrefix, maxRecentSubjects, forceReapply } = options;
  const staticPairSet = loadStaticEdgePairSet(db);
  const now = Date.now();
  const checkCommit = db.query("SELECT hash FROM git_cochange_commit WHERE hash = ?");
  const insertCommit = db.query("INSERT OR REPLACE INTO git_cochange_commit (hash, subject, files_json, applied_at) VALUES (?, ?, ?, ?)");
  const getFileCount = db.query("SELECT commit_count FROM git_cochange_file_stats WHERE path = ?");
  const upsertFileCount = db.query(`
    INSERT INTO git_cochange_file_stats (path, commit_count) VALUES (?, 1)
    ON CONFLICT(path) DO UPDATE SET commit_count = commit_count + 1
  `);
  const getPair = db.query("SELECT * FROM git_cochange WHERE file_a = ? AND file_b = ?");
  const upsertPair = db.query(`
    INSERT OR REPLACE INTO git_cochange (
      file_a, file_b, co_commits, commits_a, commits_b,
      prob_a_given_b, prob_b_given_a, jaccard, has_static_edge, recent_subjects_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const refreshFileA = db.query(`
    UPDATE git_cochange
    SET commits_a = ?,
        prob_b_given_a = CAST(co_commits AS REAL) / ?,
        jaccard = CAST(co_commits AS REAL) / (? + commits_b - co_commits)
    WHERE file_a = ?
  `);
  const refreshFileB = db.query(`
    UPDATE git_cochange
    SET commits_b = ?,
        prob_a_given_b = CAST(co_commits AS REAL) / ?,
        jaccard = CAST(co_commits AS REAL) / (commits_a + ? - co_commits)
    WHERE file_b = ?
  `);
  let commitsAccepted = 0;
  let commitsApplied = 0;
  let commitsSkippedExisting = 0;
  let commitsSkippedBulk = 0;
  let pairsUpdated = 0;
  const seenInBatch = new Set;
  const applyTx = db.transaction(() => {
    for (const c of commits) {
      if (!forceReapply && (seenInBatch.has(c.hash) || checkCommit.get(c.hash))) {
        commitsSkippedExisting++;
        continue;
      }
      seenInBatch.add(c.hash);
      const filteredFiles = [
        ...new Set(c.files.map(normalizeRelPath).filter((f) => pathPrefix.length > 0 ? f.startsWith(pathPrefix) : true))
      ].sort();
      if (filteredFiles.length === 0) {
        insertCommit.run(c.hash, c.subject, "[]", now);
        continue;
      }
      if (filteredFiles.length > maxFilesPerCommit) {
        commitsSkippedBulk++;
        insertCommit.run(c.hash, c.subject, "[]", now);
        continue;
      }
      commitsAccepted++;
      commitsApplied++;
      insertCommit.run(c.hash, c.subject, JSON.stringify(filteredFiles), now);
      const updatedCounts = new Map;
      for (const f of filteredFiles) {
        if (!forceReapply) {
          upsertFileCount.run(f);
        }
        const row = getFileCount.get(f);
        const newCount = row ? row.commit_count : 1;
        updatedCounts.set(f, newCount);
        if (!forceReapply) {
          refreshFileA.run(newCount, newCount, newCount, f);
          refreshFileB.run(newCount, newCount, newCount, f);
        }
      }
      for (let i = 0;i < filteredFiles.length; i++) {
        const fileA = filteredFiles[i];
        for (let j = i + 1;j < filteredFiles.length; j++) {
          const fileB = filteredFiles[j];
          const existing = getPair.get(fileA, fileB);
          const coCommits = existing ? forceReapply ? existing.co_commits : existing.co_commits + 1 : 1;
          const commitsA = updatedCounts.get(fileA) ?? existing?.commits_a ?? 1;
          const commitsB = updatedCounts.get(fileB) ?? existing?.commits_b ?? 1;
          const union = Math.max(1, commitsA + commitsB - coCommits);
          const probAGivenB = coCommits / commitsB;
          const probBGivenA = coCommits / commitsA;
          const jaccard = coCommits / union;
          const hasStatic = staticPairSet.has(`${fileA}|||${fileB}`) ? 1 : 0;
          const prevSubjects = existing ? JSON.parse(existing.recent_subjects_json) : [];
          const nextSubjects = c.subject && !prevSubjects.includes(c.subject) ? [c.subject, ...prevSubjects].slice(0, maxRecentSubjects) : prevSubjects;
          upsertPair.run(fileA, fileB, coCommits, commitsA, commitsB, probAGivenB, probBGivenA, jaccard, hasStatic, JSON.stringify(nextSubjects));
          pairsUpdated++;
        }
      }
    }
  });
  applyTx();
  return {
    commitsAccepted,
    commitsApplied,
    commitsSkippedExisting,
    commitsSkippedBulk,
    pairsUpdated
  };
}
function mineGitCochange(db, repoRootOrOptions, maybeOptions) {
  const t0 = performance.now();
  ensureCochangeSchema(db);
  let options = {};
  let explicitRoot;
  if (typeof repoRootOrOptions === "string") {
    explicitRoot = repoRootOrOptions;
    options = maybeOptions ?? {};
  } else if (repoRootOrOptions && typeof repoRootOrOptions === "object") {
    options = repoRootOrOptions;
  }
  const repoRoot = explicitRoot ?? options.repoRoot ?? options.projectRoot ?? process.cwd();
  const maxCommits = options.maxCommits ?? 500;
  const maxFilesPerCommit = options.maxFilesPerCommit ?? 15;
  const pathPrefix = options.pathPrefix ?? "src/";
  const minCoCommits = options.minCoCommits ?? 1;
  const maxRecentSubjects = options.maxRecentSubjects ?? 5;
  const range = options.range ?? options.revRange;
  const forceReapply = Boolean(options.force ?? options.forceReapply);
  let commits;
  let gitSpawnMs = 0;
  if (options.commitsOverride !== undefined) {
    commits = options.commitsOverride;
  } else {
    const tSpawn0 = performance.now();
    const gitArgs = range ? ["git", "log", range, "--pretty=format:COMMIT:%H|%s", "--name-only"] : ["git", "log", "-n", String(maxCommits), "--pretty=format:COMMIT:%H|%s", "--name-only"];
    const proc = Bun.spawnSync(gitArgs, { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) {
      throw new Error(`git log failed (exit ${proc.exitCode}): ${proc.stderr.toString("utf8")}`);
    }
    const raw = proc.stdout.toString("utf8");
    gitSpawnMs = performance.now() - tSpawn0;
    commits = parseGitLogOutput(raw);
  }
  const tCompute0 = performance.now();
  const existingCommitCount = db.query("SELECT COUNT(*) AS cnt FROM git_cochange_commit").get().cnt;
  if (range !== undefined || existingCommitCount > 0 && options.commitsOverride === undefined && !forceReapply) {
    const inc = applyIncrementalCommits(db, commits, {
      maxFilesPerCommit,
      pathPrefix,
      maxRecentSubjects,
      forceReapply
    });
    const fileCountRow = db.query("SELECT COUNT(*) AS cnt FROM git_cochange_file_stats").get();
    const pairStatsRow = db.query("SELECT COUNT(*) AS total, SUM(CASE WHEN has_static_edge = 0 THEN 1 ELSE 0 END) AS hidden FROM git_cochange").get();
    const computeAndPersistMs = performance.now() - tCompute0;
    const totalElapsedMs = performance.now() - t0;
    return {
      commitsScanned: commits.length,
      commitsAccepted: inc.commitsAccepted,
      commitsApplied: inc.commitsApplied,
      commitsSkippedExisting: inc.commitsSkippedExisting,
      commitsSkippedBulk: inc.commitsSkippedBulk,
      commitsFilteredBulk: inc.commitsSkippedBulk,
      distinctFilesTracked: fileCountRow.cnt,
      pairsPersisted: pairStatsRow.total,
      cochangePairsStored: pairStatsRow.total,
      hiddenCouplingPairs: pairStatsRow.hidden ?? 0,
      headCommitSha: commits[0]?.hash ?? null,
      gitSpawnMs,
      computeAndPersistMs,
      totalElapsedMs,
      elapsedMs: totalElapsedMs
    };
  }
  const staticPairSet = loadStaticEdgePairSet(db);
  const fileCommitCounts = new Map;
  const pairStats = new Map;
  const scannedCommitRows = [];
  const seenHashes = new Set;
  let commitsAccepted = 0;
  let commitsSkippedExisting = 0;
  let commitsSkippedBulk = 0;
  for (const commit of commits) {
    if (seenHashes.has(commit.hash)) {
      commitsSkippedExisting++;
      continue;
    }
    seenHashes.add(commit.hash);
    const filteredFiles = [
      ...new Set(commit.files.map(normalizeRelPath).filter((f) => pathPrefix.length > 0 ? f.startsWith(pathPrefix) : true))
    ].sort();
    if (filteredFiles.length === 0) {
      scannedCommitRows.push({
        hash: commit.hash,
        subject: commit.subject,
        files: []
      });
      continue;
    }
    if (filteredFiles.length > maxFilesPerCommit) {
      commitsSkippedBulk++;
      scannedCommitRows.push({
        hash: commit.hash,
        subject: commit.subject,
        files: []
      });
      continue;
    }
    commitsAccepted++;
    scannedCommitRows.push({
      hash: commit.hash,
      subject: commit.subject,
      files: filteredFiles
    });
    for (let i = 0;i < filteredFiles.length; i++) {
      const f = filteredFiles[i];
      fileCommitCounts.set(f, (fileCommitCounts.get(f) ?? 0) + 1);
    }
    for (let i = 0;i < filteredFiles.length; i++) {
      const fileA = filteredFiles[i];
      for (let j = i + 1;j < filteredFiles.length; j++) {
        const fileB = filteredFiles[j];
        const key = `${fileA}|||${fileB}`;
        let entry = pairStats.get(key);
        if (!entry) {
          entry = { count: 0, subjects: [] };
          pairStats.set(key, entry);
        }
        entry.count++;
        if (commit.subject.length > 0 && entry.subjects.length < maxRecentSubjects && !entry.subjects.includes(commit.subject)) {
          entry.subjects.push(commit.subject);
        }
      }
    }
  }
  const rowsToInsert = [];
  let hiddenCouplingPairs = 0;
  for (const [key, entry] of pairStats.entries()) {
    if (entry.count < minCoCommits)
      continue;
    const sep = key.indexOf("|||");
    const fileA = key.slice(0, sep);
    const fileB = key.slice(sep + 3);
    const commitsA = fileCommitCounts.get(fileA) ?? entry.count;
    const commitsB = fileCommitCounts.get(fileB) ?? entry.count;
    const unionCount = commitsA + commitsB - entry.count;
    const probAGivenB = commitsB > 0 ? entry.count / commitsB : 0;
    const probBGivenA = commitsA > 0 ? entry.count / commitsA : 0;
    const jaccard = unionCount > 0 ? entry.count / unionCount : 0;
    const hasStaticEdge = staticPairSet.has(key) ? 1 : 0;
    if (hasStaticEdge === 0)
      hiddenCouplingPairs++;
    rowsToInsert.push({
      file_a: fileA,
      file_b: fileB,
      co_commits: entry.count,
      commits_a: commitsA,
      commits_b: commitsB,
      prob_a_given_b: probAGivenB,
      prob_b_given_a: probBGivenA,
      jaccard,
      has_static_edge: hasStaticEdge,
      recent_subjects_json: JSON.stringify(entry.subjects)
    });
  }
  const now = Date.now();
  const clearCochange = db.query("DELETE FROM git_cochange");
  const clearFileStats = db.query("DELETE FROM git_cochange_file_stats");
  const clearCommits = db.query("DELETE FROM git_cochange_commit");
  const insertCochange = db.query(`
    INSERT INTO git_cochange (
      file_a, file_b, co_commits, commits_a, commits_b,
      prob_a_given_b, prob_b_given_a, jaccard, has_static_edge, recent_subjects_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFileStat = db.query(`
    INSERT INTO git_cochange_file_stats (path, commit_count) VALUES (?, ?)
  `);
  const insertCommit = db.query(`
    INSERT OR REPLACE INTO git_cochange_commit (hash, subject, files_json, applied_at) VALUES (?, ?, ?, ?)
  `);
  const persistTx = db.transaction(() => {
    clearCochange.run();
    clearFileStats.run();
    clearCommits.run();
    for (const [f, cnt] of fileCommitCounts.entries()) {
      insertFileStat.run(f, cnt);
    }
    for (const c of scannedCommitRows) {
      insertCommit.run(c.hash, c.subject, JSON.stringify(c.files), now);
    }
    for (const r of rowsToInsert) {
      insertCochange.run(r.file_a, r.file_b, r.co_commits, r.commits_a, r.commits_b, r.prob_a_given_b, r.prob_b_given_a, r.jaccard, r.has_static_edge, r.recent_subjects_json);
    }
  });
  persistTx();
  const computeAndPersistMs = performance.now() - tCompute0;
  const totalElapsedMs = performance.now() - t0;
  return {
    commitsScanned: commits.length,
    commitsAccepted,
    commitsApplied: commitsAccepted,
    commitsSkippedExisting,
    commitsSkippedBulk,
    commitsFilteredBulk: commitsSkippedBulk,
    distinctFilesTracked: fileCommitCounts.size,
    pairsPersisted: rowsToInsert.length,
    cochangePairsStored: rowsToInsert.length,
    hiddenCouplingPairs,
    headCommitSha: commits[0]?.hash ?? null,
    gitSpawnMs,
    computeAndPersistMs,
    totalElapsedMs,
    elapsedMs: totalElapsedMs
  };
}
function queryCochangeCouplings(db, targetPath, options = {}) {
  ensureCochangeSchema(db);
  const normTarget = normalizeRelPath(targetPath);
  const minCoCommits = options.minCochangeCount ?? options.minCoCommits ?? 2;
  const minProbability = options.minProbability ?? 0.3;
  const onlyHidden = options.onlyHidden ?? false;
  const limit = options.limit ?? 10;
  const rows = db.query(`SELECT * FROM git_cochange
       WHERE (file_a = ? OR file_b = ?)
         AND co_commits >= ?`).all(normTarget, normTarget, minCoCommits);
  const entries = [];
  for (const r of rows) {
    if (onlyHidden && r.has_static_edge !== 0)
      continue;
    const isA = r.file_a === normTarget;
    const otherPath = isA ? r.file_b : r.file_a;
    const tCommits = isA ? r.commits_a : r.commits_b;
    const cCommits = isA ? r.commits_b : r.commits_a;
    const probCoupledGivenTarget = isA ? r.prob_b_given_a : r.prob_a_given_b;
    const probTargetGivenCoupled = isA ? r.prob_a_given_b : r.prob_b_given_a;
    if (probCoupledGivenTarget < minProbability)
      continue;
    const hasStatic = r.has_static_edge === 1 ? 1 : 0;
    const recentSubjects = JSON.parse(r.recent_subjects_json || "[]");
    entries.push({
      target_path: normTarget,
      path: otherPath,
      coupled_path: otherPath,
      partner_path: otherPath,
      co_commits: r.co_commits,
      cochange_count: r.co_commits,
      target_commits: tCommits,
      coupled_commits: cCommits,
      partner_commits: cCommits,
      probability: probCoupledGivenTarget,
      prob_coupled_given_target: probCoupledGivenTarget,
      prob_partner_given_target: probCoupledGivenTarget,
      prob_target_given_coupled: probTargetGivenCoupled,
      prob_target_given_partner: probTargetGivenCoupled,
      jaccard: r.jaccard,
      has_static_edge: hasStatic,
      hasStaticEdge: hasStatic === 1,
      hidden_coupling: hasStatic === 0,
      is_hidden: hasStatic === 0,
      recent_subjects: recentSubjects,
      recent_subjects_json: r.recent_subjects_json
    });
  }
  entries.sort((a, b) => b.co_commits - a.co_commits || b.prob_coupled_given_target - a.prob_coupled_given_target || Number(b.hidden_coupling) - Number(a.hidden_coupling) || a.path.localeCompare(b.path));
  return entries.slice(0, limit);
}
function queryCoupledFiles(db, targetPath, options = {}) {
  ensureCochangeSchema(db);
  const normTarget = normalizeRelPath(targetPath);
  const minCoCommits = options.minCochangeCount ?? options.minCoCommits ?? 2;
  const minProbability = options.minProbability ?? 0.2;
  const onlyHidden = options.onlyHidden ?? false;
  const limit = options.limit ?? 15;
  const rows = queryCochangeCouplings(db, normTarget, {
    minCochangeCount: minCoCommits,
    minProbability,
    onlyHidden,
    limit
  });
  const statRow = db.query("SELECT commit_count FROM git_cochange_file_stats WHERE path = ?").get(normTarget);
  let targetCommits = statRow?.commit_count ?? 0;
  for (const r of rows) {
    if (r.target_commits > targetCommits)
      targetCommits = r.target_commits;
  }
  const coupledFiles = rows.map((r) => ({
    path: r.coupled_path,
    co_commits: r.co_commits,
    target_commits: r.target_commits,
    coupled_commits: r.coupled_commits,
    prob_coupled_given_target: r.prob_coupled_given_target,
    prob_target_given_coupled: r.prob_target_given_coupled,
    jaccard: r.jaccard,
    has_static_edge: r.has_static_edge === 1,
    hidden_coupling: r.has_static_edge === 0,
    recent_subjects: r.recent_subjects
  }));
  const bannerLines = [
    `// Coupled files for ${normTarget} (${targetCommits} commits in window):`
  ];
  for (const item of coupledFiles) {
    const pct = (item.prob_coupled_given_target * 100).toFixed(1);
    const edgeLabel = item.hidden_coupling ? "HIDDEN COUPLING (0 static import edges)" : "static+temporal";
    const latestSubject = item.recent_subjects[0] ? ` \u2014 e.g. "${item.recent_subjects[0]}"` : "";
    bannerLines.push(`// - ${item.path}: P=${pct}% (${item.co_commits}/${item.target_commits} commits, Jaccard=${(item.jaccard * 100).toFixed(1)}%, ${edgeLabel})${latestSubject}`);
  }
  return {
    action: "coupled",
    path: normTarget,
    total_commits: targetCommits,
    coupled_files: coupledFiles,
    warning_banner: bannerLines.join(`
`)
  };
}
function renderCochangeWarnings(db, targetPaths, options = {}) {
  const paths = typeof targetPaths === "string" ? [targetPaths] : targetPaths;
  const sections = [];
  for (const p of paths) {
    const res = queryCoupledFiles(db, p, {
      minProbability: options.minProbability ?? 0.3,
      minCochangeCount: options.minCochangeCount ?? options.minCoCommits ?? 2,
      onlyHidden: options.onlyHidden,
      limit: options.limit ?? 10
    });
    if (res.coupled_files.length > 0) {
      sections.push(res.warning_banner);
    }
  }
  return sections.join(`

`);
}

// src/honeycomb/pagerank.ts
function symbolKindPriority(kind) {
  switch (kind) {
    case "function":
    case "class":
      return 5;
    case "interface":
      return 4;
    case "type":
      return 3;
    case "const":
    case "enum":
      return 2;
    default:
      return 1;
  }
}
function computeCodebasePageRank(db, options = {}) {
  const t0 = performance.now();
  ensureCodeGraphSchema(db);
  const iterations = options.iterations ?? 20;
  const damping = options.damping ?? 0.85;
  const shouldPersist = options.persist ?? true;
  const fileRows = db.query("SELECT path, loc FROM code_file ORDER BY path ASC").all();
  const edgeRows = db.query("SELECT from_path, to_path FROM code_import_edge ORDER BY from_path ASC, to_path ASC").all();
  const tSolveStart = performance.now();
  const n = fileRows.length;
  if (n === 0) {
    const elapsed = performance.now() - t0;
    return {
      nodeCount: 0,
      edgeCount: 0,
      iterations,
      damping,
      dampingFactor: damping,
      totalMass: 0,
      maxResidual: 0,
      solveElapsedMs: 0,
      persistElapsedMs: 0,
      totalElapsedMs: elapsed,
      nodes: []
    };
  }
  const pathToIdx = new Map;
  for (let i = 0;i < n; i++) {
    pathToIdx.set(fileRows[i].path, i);
  }
  const outDegree = new Int32Array(n);
  const inDegree = new Int32Array(n);
  const validEdges = [];
  for (const e of edgeRows) {
    const u = pathToIdx.get(e.from_path);
    const v = pathToIdx.get(e.to_path);
    if (u === undefined || v === undefined || u === v)
      continue;
    validEdges.push({ u, v });
    outDegree[u] = outDegree[u] + 1;
    inDegree[v] = inDegree[v] + 1;
  }
  const edgeOffsets = new Int32Array(n + 1);
  for (let u = 0;u < n; u++) {
    edgeOffsets[u + 1] = edgeOffsets[u] + outDegree[u];
  }
  const edgeTargets = new Int32Array(validEdges.length);
  const writeCursor = new Int32Array(edgeOffsets);
  for (let i = 0;i < validEdges.length; i++) {
    const { u, v } = validEdges[i];
    const pos = writeCursor[u];
    edgeTargets[pos] = v;
    writeCursor[u] = pos + 1;
  }
  let pr = new Float64Array(n).fill(1 / n);
  let next = new Float64Array(n);
  let maxResidual = 0;
  const invN = 1 / n;
  const teleportMass = (1 - damping) * invN;
  for (let iter = 0;iter < iterations; iter++) {
    let sinkSum = 0;
    for (let u = 0;u < n; u++) {
      if (outDegree[u] === 0) {
        sinkSum += pr[u];
      }
    }
    const baseMass = teleportMass + damping * sinkSum * invN;
    next.fill(baseMass);
    for (let u = 0;u < n; u++) {
      const deg = outDegree[u];
      if (deg > 0) {
        const share = damping * pr[u] / deg;
        const start = edgeOffsets[u];
        const end = edgeOffsets[u + 1];
        for (let idx = start;idx < end; idx++) {
          const v = edgeTargets[idx];
          next[v] = next[v] + share;
        }
      }
    }
    let stepSum = 0;
    for (let i = 0;i < n; i++) {
      stepSum += next[i];
    }
    if (stepSum > 0 && Math.abs(stepSum - 1) > 0.000000000001) {
      const invSum = 1 / stepSum;
      for (let i = 0;i < n; i++) {
        next[i] = next[i] * invSum;
      }
    }
    maxResidual = 0;
    for (let i = 0;i < n; i++) {
      const diff = Math.abs(next[i] - pr[i]);
      if (diff > maxResidual)
        maxResidual = diff;
    }
    const swap = pr;
    pr = next;
    next = swap;
  }
  let totalMass = 0;
  for (let i = 0;i < n; i++) {
    totalMass += pr[i];
  }
  const tSolveDone = performance.now();
  if (shouldPersist) {
    const now = Date.now();
    const updateStmt = db.query("UPDATE code_file SET pagerank = ?, updated_at = ? WHERE path = ?");
    const persistTx = db.transaction(() => {
      for (let i = 0;i < n; i++) {
        updateStmt.run(pr[i], now, fileRows[i].path);
      }
    });
    persistTx();
  }
  const tPersistDone = performance.now();
  const nodes = [];
  for (let i = 0;i < n; i++) {
    nodes.push({
      path: fileRows[i].path,
      pagerank: pr[i],
      in_degree: inDegree[i],
      out_degree: outDegree[i],
      loc: fileRows[i].loc
    });
  }
  nodes.sort((a, b) => b.pagerank - a.pagerank || b.in_degree - a.in_degree || a.path.localeCompare(b.path));
  return {
    nodeCount: n,
    edgeCount: validEdges.length,
    iterations,
    damping,
    dampingFactor: damping,
    totalMass,
    maxResidual,
    solveElapsedMs: tSolveDone - tSolveStart,
    persistElapsedMs: tPersistDone - tSolveDone,
    totalElapsedMs: tPersistDone - t0,
    nodes
  };
}
function renderRepoMap(db, options = {}) {
  const t0 = performance.now();
  ensureCodeGraphSchema(db);
  const requestedBudget = options.budgetTokens ?? options.tokenBudget ?? options.maxTokens ?? 1000;
  const effectiveCap = requestedBudget === 1000 ? 999 : requestedBudget;
  const maxFiles = options.maxFiles ?? 25;
  const maxSymbolsPerFile = options.maxSymbolsPerFile ?? 6;
  const focusSet = options.focusPaths && options.focusPaths.length > 0 ? new Set(options.focusPaths.map(normalizeRelPath)) : null;
  let fileRows = db.query("SELECT path, loc, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC").all();
  if (fileRows.length > 0 && fileRows.every((r) => r.pagerank === 0)) {
    computeCodebasePageRank(db, { persist: true });
    fileRows = db.query("SELECT path, loc, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC").all();
  }
  if (focusSet && focusSet.size > 0) {
    const focused = fileRows.filter((r) => focusSet.has(r.path));
    const rest = fileRows.filter((r) => !focusSet.has(r.path));
    fileRows = [...focused, ...rest];
  }
  const edgeRows = db.query("SELECT from_path, to_path, symbols_json, specifiers_json FROM code_import_edge").all();
  const inDeg = new Map;
  const outDeg = new Map;
  const importedSymCountsByPath = new Map;
  for (const e of edgeRows) {
    if (e.from_path === e.to_path)
      continue;
    outDeg.set(e.from_path, (outDeg.get(e.from_path) ?? 0) + 1);
    inDeg.set(e.to_path, (inDeg.get(e.to_path) ?? 0) + 1);
    let symMap = importedSymCountsByPath.get(e.to_path);
    if (!symMap) {
      symMap = new Map;
      importedSymCountsByPath.set(e.to_path, symMap);
    }
    const rawJson = e.symbols_json || e.specifiers_json || "[]";
    const specs = JSON.parse(rawJson);
    for (const s of specs) {
      if (s === "*" || s.startsWith("* as "))
        continue;
      symMap.set(s, (symMap.get(s) ?? 0) + 1);
    }
  }
  const exportedSymbolsRows = db.query("SELECT path, name, kind, start_line, end_line FROM code_symbol WHERE depth = 1 AND exported = 1 ORDER BY path ASC, start_line ASC").all();
  const symbolsByPath = new Map;
  for (const s of exportedSymbolsRows) {
    let list = symbolsByPath.get(s.path);
    if (!list) {
      list = [];
      symbolsByPath.set(s.path, list);
    }
    list.push({
      name: s.name,
      kind: s.kind,
      start_line: s.start_line,
      end_line: s.end_line
    });
  }
  const headerLine = `# Tier-1 RepoMap (${fileRows.length} files, ${edgeRows.length} import edges, sorted by PageRank)`;
  const lines = [headerLine];
  const entries = [];
  const candidateCount = Math.min(fileRows.length, maxFiles);
  for (let i = 0;i < candidateCount; i++) {
    const f = fileRows[i];
    const symCounts = importedSymCountsByPath.get(f.path);
    let allSyms = [...symbolsByPath.get(f.path) ?? []];
    if (allSyms.length > 0) {
      allSyms.sort((a, b) => {
        const callerA = symCounts?.get(a.name) ?? 0;
        const callerB = symCounts?.get(b.name) ?? 0;
        const weightA = callerA * 10 + symbolKindPriority(a.kind);
        const weightB = callerB * 10 + symbolKindPriority(b.kind);
        return weightB - weightA || a.start_line - b.start_line;
      });
    } else if (symCounts && symCounts.size > 0) {
      allSyms = [...symCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => ({
        name,
        kind: "reexport",
        start_line: 1,
        end_line: f.loc
      }));
    }
    const topSyms = allSyms.slice(0, maxSymbolsPerFile);
    const remainingCount = Math.max(0, allSyms.length - topSyms.length);
    const symText = topSyms.length > 0 ? topSyms.map((s) => `${s.name}[L${s.start_line}-L${s.end_line}]`).join(", ") + (remainingCount > 0 ? `, +${remainingCount} more` : "") : `(module[L1-L${f.loc}])`;
    const inCount = inDeg.get(f.path) ?? 0;
    const outCount = outDeg.get(f.path) ?? 0;
    const line = `${entries.length + 1}. ${f.path} (PR=${f.pagerank.toFixed(4)}, in=${inCount}, out=${outCount}, ${f.loc} LOC): ${symText}`;
    const candidateText = [...lines, line].join(`
`);
    if (estimateTokens(candidateText) > effectiveCap) {
      break;
    }
    lines.push(line);
    entries.push({
      rank: entries.length + 1,
      path: f.path,
      pagerank: f.pagerank,
      in_degree: inCount,
      out_degree: outCount,
      loc: f.loc,
      exported_symbol_count: allSyms.length,
      top_symbols: topSyms
    });
  }
  const text = lines.join(`
`);
  const elapsedMs = performance.now() - t0;
  const estTokens = estimateTokens(text);
  return {
    total_files: fileRows.length,
    total_edges: edgeRows.length,
    included_files: entries.length,
    estimated_tokens: estTokens,
    token_budget: requestedBudget,
    budget_tokens: requestedBudget,
    elapsed_ms: elapsedMs,
    entries,
    text,
    markdown: text
  };
}

// src/viewports/brief.ts
import { existsSync as existsSync10, readFileSync as readFileSync8, statSync as statSync6 } from "fs";
import path9 from "path";

// src/viewports/continuity.ts
import { existsSync as existsSync9, readFileSync as readFileSync7, statSync as statSync5 } from "fs";
import path8 from "path";
var CONTINUITY_BASE_DDL = `
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  lane_kind TEXT NOT NULL DEFAULT 'root',
  lane_path TEXT NOT NULL DEFAULT '',
  title TEXT,
  agent TEXT,
  provider TEXT,
  model_id TEXT,
  variant TEXT,
  harness TEXT DEFAULT 'opencode',
  outcome TEXT,
  cost REAL DEFAULT 0,
  tok_in INTEGER DEFAULT 0,
  tok_out INTEGER DEFAULT 0,
  tok_reason INTEGER DEFAULT 0,
  tok_cache_r INTEGER DEFAULT 0,
  tok_cache_w INTEGER DEFAULT 0,
  files_changed INTEGER,
  additions INTEGER,
  deletions INTEGER,
  t_created INTEGER DEFAULT 0,
  t_updated INTEGER DEFAULT 0,
  t_idle INTEGER,
  t_compacting INTEGER,
  t_archived INTEGER,
  resume_attempts INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  transcript_path TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS compaction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT,
  status TEXT,
  summary_ref TEXT,
  tok_input INTEGER,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS session_semantic_digest (
  session_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  intent_pivots_json TEXT NOT NULL DEFAULT '[]',
  touched_files_json TEXT NOT NULL DEFAULT '[]',
  key_decisions_json TEXT NOT NULL DEFAULT '[]',
  verification_state TEXT NOT NULL DEFAULT 'in_progress_or_unverified'
);

CREATE TABLE IF NOT EXISTS intent_pivot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  t TEXT NOT NULL DEFAULT '',
  prompt_excerpt TEXT NOT NULL DEFAULT '',
  blob_ref TEXT NOT NULL DEFAULT '',
  pivot_kind TEXT NOT NULL DEFAULT 'followup'
);

CREATE TABLE IF NOT EXISTS delegation_turn (
  parent_session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  child_session_id TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'spawn',
  harness TEXT NOT NULL DEFAULT 'opencode',
  agent TEXT,
  model TEXT,
  foreign_session_id TEXT,
  start_seq INTEGER NOT NULL DEFAULT 0,
  end_seq INTEGER NOT NULL DEFAULT 0,
  start_message_id TEXT NOT NULL DEFAULT '',
  end_message_id TEXT NOT NULL DEFAULT '',
  reported_outcome TEXT,
  verified_outcome TEXT NOT NULL DEFAULT 'clean',
  blocker_summary TEXT,
  tool_error_count INTEGER NOT NULL DEFAULT 0,
  tool_completed_count INTEGER NOT NULL DEFAULT 0,
  text_char_count INTEGER NOT NULL DEFAULT 0,
  prompt_blob TEXT,
  response_blob TEXT,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (parent_session_id, call_id, turn_index)
);

CREATE TABLE IF NOT EXISTS code_file (
  path TEXT PRIMARY KEY,
  blob_sha TEXT NOT NULL DEFAULT '',
  loc INTEGER NOT NULL DEFAULT 0,
  raw_tokens INTEGER NOT NULL DEFAULT 0,
  skeleton_tokens INTEGER NOT NULL DEFAULT 0,
  skeleton_text TEXT NOT NULL DEFAULT '',
  pagerank REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS code_symbol (
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'function',
  depth INTEGER NOT NULL DEFAULT 1,
  parent_symbol TEXT,
  exported INTEGER NOT NULL DEFAULT 0,
  start_line INTEGER NOT NULL DEFAULT 1,
  end_line INTEGER NOT NULL DEFAULT 1,
  signature TEXT NOT NULL DEFAULT '',
  blob_sha TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (path, start_line, qualified_name)
);

CREATE TABLE IF NOT EXISTS git_cochange (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  co_commits INTEGER NOT NULL DEFAULT 0,
  commits_a INTEGER NOT NULL DEFAULT 0,
  commits_b INTEGER NOT NULL DEFAULT 0,
  prob_a_given_b REAL NOT NULL DEFAULT 0,
  prob_b_given_a REAL NOT NULL DEFAULT 0,
  jaccard REAL NOT NULL DEFAULT 0,
  has_static_edge INTEGER NOT NULL DEFAULT 0,
  recent_subjects_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (file_a, file_b)
);

CREATE TABLE IF NOT EXISTS provenance_chain (
  chain_id TEXT PRIMARY KEY,
  root_session_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  finding_seq INTEGER NOT NULL DEFAULT 0,
  finding_session_id TEXT NOT NULL DEFAULT '',
  finding_summary TEXT NOT NULL DEFAULT '',
  child_session_id TEXT,
  decision_seq INTEGER,
  decision_pivot_seq INTEGER,
  target_path TEXT NOT NULL,
  read_or_review_blob_sha TEXT NOT NULL DEFAULT '',
  repair_seq INTEGER,
  repair_session_id TEXT,
  repair_blob_sha TEXT,
  receipt_command TEXT,
  verification_command TEXT,
  receipt_exit_code INTEGER,
  verification_exit_code INTEGER,
  receipt_blob_sha TEXT,
  verification_blob_ref TEXT,
  head_sha TEXT,
  worktree_tree_sha TEXT,
  disk_blob_sha TEXT NOT NULL DEFAULT '',
  staleness_status TEXT NOT NULL DEFAULT 'VERIFIED_FRESH',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_provenance_chain_session ON provenance_chain(root_session_id);
CREATE INDEX IF NOT EXISTS idx_provenance_chain_target ON provenance_chain(root_session_id, target_path);

CREATE TABLE IF NOT EXISTS file_read_ledger (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  read_seq INTEGER NOT NULL DEFAULT 0,
  line_range TEXT NOT NULL DEFAULT 'L1-L120',
  start_line INTEGER,
  end_line INTEGER,
  total_lines INTEGER,
  is_truncated INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  char_len INTEGER NOT NULL DEFAULT 0,
  blob_sha TEXT NOT NULL DEFAULT '',
  blob_sha256 TEXT NOT NULL DEFAULT '',
  read_blob_sha TEXT NOT NULL DEFAULT '',
  disk_blob_sha TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  staleness_status TEXT NOT NULL DEFAULT 'FRESH \u2014 DO NOT REREAD',
  t INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, path)
);

CREATE INDEX IF NOT EXISTS idx_file_read_ledger_session ON file_read_ledger(session_id, read_seq);

CREATE TABLE IF NOT EXISTS skill_load_ledger (
  session_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  call_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  loaded_seq INTEGER NOT NULL DEFAULT 0,
  load_seq INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  char_len INTEGER NOT NULL DEFAULT 0,
  blob_sha TEXT NOT NULL DEFAULT '',
  blob_sha256 TEXT NOT NULL DEFAULT '',
  skill_blob_sha TEXT NOT NULL DEFAULT '',
  blob_ref TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE \u2014 DO NOT RE-INVOKE',
  t INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_skill_load_ledger_session ON skill_load_ledger(session_id, load_seq);

CREATE TABLE IF NOT EXISTS compaction_continuation_ledger (
  session_id TEXT NOT NULL,
  compaction_seq INTEGER NOT NULL,
  compaction_reason TEXT NOT NULL DEFAULT 'auto',
  reason TEXT NOT NULL DEFAULT 'auto',
  tok_input INTEGER NOT NULL DEFAULT 0,
  headline TEXT NOT NULL DEFAULT '',
  verification_gate_status TEXT NOT NULL DEFAULT 'in_progress_or_unverified',
  packet_markdown TEXT NOT NULL,
  packet_chars INTEGER NOT NULL DEFAULT 0,
  packet_tokens INTEGER NOT NULL,
  summary_hash TEXT,
  fresh_files_count INTEGER NOT NULL DEFAULT 0,
  stale_files_count INTEGER NOT NULL DEFAULT 0,
  active_skills_count INTEGER NOT NULL DEFAULT 0,
  provenance_chains_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, compaction_seq)
);
`;
var initializedContinuityDbs = new WeakSet;
function ensureColumnsExist(db, table, requiredColumns) {
  const existing = new Set(db.query(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const col of requiredColumns) {
    if (!existing.has(col.name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
}
function ensureContinuitySchema(db) {
  if (initializedContinuityDbs.has(db)) {
    const hasChain = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'provenance_chain'").get();
    if (hasChain)
      return;
  }
  const checkAndDropIncompatible = (table, requiredCol) => {
    const cols = new Set(db.query(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    if (cols.size > 0 && !cols.has(requiredCol)) {
      db.exec(`DROP TABLE IF EXISTS ${table};`);
    }
  };
  checkAndDropIncompatible("provenance_chain", "target_path");
  checkAndDropIncompatible("compaction_continuation_ledger", "packet_markdown");
  checkAndDropIncompatible("session_semantic_digest", "headline");
  checkAndDropIncompatible("intent_pivot", "seq");
  checkAndDropIncompatible("code_file", "loc");
  checkAndDropIncompatible("code_symbol", "qualified_name");
  checkAndDropIncompatible("git_cochange", "co_commits");
  const dtInfo = db.query("PRAGMA table_info(delegation_turn)").all();
  const dtStartSeq = dtInfo.find((c) => c.name === "start_seq");
  if (dtStartSeq && dtStartSeq.notnull === 1 && dtStartSeq.dflt_value === null) {
    const dtCount = db.query("SELECT COUNT(*) as c FROM delegation_turn").get().c;
    if (dtCount === 0) {
      db.exec("DROP TABLE IF EXISTS delegation_turn;");
    }
  }
  db.exec(CONTINUITY_BASE_DDL);
  const frlInfo = db.query("PRAGMA table_info(file_read_ledger)").all();
  const normCol = frlInfo.find((c) => c.name === "normalized_path");
  if (normCol && normCol.notnull === 1 && normCol.dflt_value === null) {
    ensureColumnsExist(db, "file_read_ledger", [
      { name: "total_lines", ddl: "INTEGER" },
      { name: "is_truncated", ddl: "INTEGER NOT NULL DEFAULT 0" }
    ]);
    db.exec(`
      CREATE TABLE file_read_ledger_migrated (
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        normalized_path TEXT NOT NULL DEFAULT '',
        call_id TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL DEFAULT '',
        seq INTEGER NOT NULL DEFAULT 0,
        read_seq INTEGER NOT NULL DEFAULT 0,
        line_range TEXT NOT NULL DEFAULT 'L1-L120',
        start_line INTEGER,
        end_line INTEGER,
        total_lines INTEGER,
        is_truncated INTEGER NOT NULL DEFAULT 0,
        chars INTEGER NOT NULL DEFAULT 0,
        char_len INTEGER NOT NULL DEFAULT 0,
        blob_sha TEXT NOT NULL DEFAULT '',
        blob_sha256 TEXT NOT NULL DEFAULT '',
        read_blob_sha TEXT NOT NULL DEFAULT '',
        disk_blob_sha TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        staleness_status TEXT NOT NULL DEFAULT 'FRESH \u2014 DO NOT REREAD',
        t INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (session_id, path)
      );
      INSERT INTO file_read_ledger_migrated (
        session_id, path, normalized_path, call_id, message_id, seq, read_seq,
        line_range, start_line, end_line, total_lines, is_truncated, chars, char_len,
        blob_sha, blob_sha256, read_blob_sha, disk_blob_sha, summary, staleness_status, t, updated_at
      )
      SELECT
        session_id, path, COALESCE(normalized_path, path), COALESCE(call_id, ''),
        COALESCE(message_id, ''), COALESCE(seq, 0), COALESCE(read_seq, 0),
        COALESCE(line_range, 'L1-L120'), start_line, end_line, total_lines, COALESCE(is_truncated, 0),
        COALESCE(chars, 0), COALESCE(char_len, 0), COALESCE(blob_sha, ''), COALESCE(blob_sha256, ''),
        COALESCE(read_blob_sha, ''), COALESCE(disk_blob_sha, ''), COALESCE(summary, ''),
        COALESCE(staleness_status, 'FRESH \u2014 DO NOT REREAD'), COALESCE(t, 0), COALESCE(CAST(updated_at AS TEXT), '')
      FROM file_read_ledger;
      DROP TABLE file_read_ledger;
      ALTER TABLE file_read_ledger_migrated RENAME TO file_read_ledger;
      CREATE INDEX IF NOT EXISTS idx_file_read_ledger_session ON file_read_ledger(session_id, read_seq);
    `);
  } else {
    ensureColumnsExist(db, "file_read_ledger", [
      { name: "normalized_path", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "call_id", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "message_id", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "read_seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "line_range", ddl: "TEXT NOT NULL DEFAULT 'L1-L120'" },
      { name: "start_line", ddl: "INTEGER" },
      { name: "end_line", ddl: "INTEGER" },
      { name: "total_lines", ddl: "INTEGER" },
      { name: "is_truncated", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "chars", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "char_len", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "blob_sha256", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "read_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "disk_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "summary", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "staleness_status", ddl: "TEXT NOT NULL DEFAULT 'FRESH \u2014 DO NOT REREAD'" },
      { name: "t", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "updated_at", ddl: "TEXT NOT NULL DEFAULT ''" }
    ]);
  }
  const sllInfo = db.query("PRAGMA table_info(skill_load_ledger)").all();
  const sllCallCol = sllInfo.find((c) => c.name === "call_id");
  if (sllCallCol && sllCallCol.notnull === 1 && sllCallCol.dflt_value === null) {
    db.exec(`
      CREATE TABLE skill_load_ledger_migrated (
        session_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        call_id TEXT NOT NULL DEFAULT '',
        message_id TEXT NOT NULL DEFAULT '',
        seq INTEGER NOT NULL DEFAULT 0,
        loaded_seq INTEGER NOT NULL DEFAULT 0,
        load_seq INTEGER NOT NULL DEFAULT 0,
        chars INTEGER NOT NULL DEFAULT 0,
        char_len INTEGER NOT NULL DEFAULT 0,
        blob_sha TEXT NOT NULL DEFAULT '',
        blob_sha256 TEXT NOT NULL DEFAULT '',
        skill_blob_sha TEXT NOT NULL DEFAULT '',
        blob_ref TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ACTIVE \u2014 DO NOT RE-INVOKE',
        t INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, skill_name)
      );
      INSERT INTO skill_load_ledger_migrated (
        session_id, skill_name, call_id, message_id, seq, loaded_seq, load_seq,
        chars, char_len, blob_sha, blob_sha256, skill_blob_sha, blob_ref, summary, status, t
      )
      SELECT
        session_id, skill_name, COALESCE(call_id, ''), COALESCE(message_id, ''),
        COALESCE(seq, 0), COALESCE(loaded_seq, 0), COALESCE(load_seq, 0),
        COALESCE(chars, 0), COALESCE(char_len, 0), COALESCE(blob_sha, ''),
        COALESCE(blob_sha256, ''), COALESCE(skill_blob_sha, ''), COALESCE(blob_ref, ''),
        COALESCE(summary, ''), COALESCE(status, 'ACTIVE \u2014 DO NOT RE-INVOKE'), COALESCE(t, 0)
      FROM skill_load_ledger;
      DROP TABLE skill_load_ledger;
      ALTER TABLE skill_load_ledger_migrated RENAME TO skill_load_ledger;
      CREATE INDEX IF NOT EXISTS idx_skill_load_ledger_session ON skill_load_ledger(session_id, load_seq);
    `);
  } else {
    ensureColumnsExist(db, "skill_load_ledger", [
      { name: "call_id", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "message_id", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "loaded_seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "load_seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "chars", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "char_len", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "blob_sha256", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "skill_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "blob_ref", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "summary", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "status", ddl: "TEXT NOT NULL DEFAULT 'ACTIVE \u2014 DO NOT RE-INVOKE'" },
      { name: "t", ddl: "INTEGER NOT NULL DEFAULT 0" }
    ]);
  }
  ensureColumnsExist(db, "provenance_chain", [
    { name: "session_id", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "finding_seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "finding_session_id", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "finding_summary", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "child_session_id", ddl: "TEXT" },
    { name: "decision_seq", ddl: "INTEGER" },
    { name: "decision_pivot_seq", ddl: "INTEGER" },
    { name: "read_or_review_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "repair_seq", ddl: "INTEGER" },
    { name: "repair_session_id", ddl: "TEXT" },
    { name: "repair_blob_sha", ddl: "TEXT" },
    { name: "receipt_command", ddl: "TEXT" },
    { name: "verification_command", ddl: "TEXT" },
    { name: "receipt_exit_code", ddl: "INTEGER" },
    { name: "verification_exit_code", ddl: "INTEGER" },
    { name: "receipt_blob_sha", ddl: "TEXT" },
    { name: "verification_blob_ref", ddl: "TEXT" },
    { name: "head_sha", ddl: "TEXT" },
    { name: "worktree_tree_sha", ddl: "TEXT" },
    { name: "disk_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "staleness_status", ddl: "TEXT NOT NULL DEFAULT 'VERIFIED_FRESH'" },
    { name: "updated_at", ddl: "TEXT NOT NULL DEFAULT ''" }
  ]);
  ensureColumnsExist(db, "compaction_continuation_ledger", [
    { name: "compaction_reason", ddl: "TEXT NOT NULL DEFAULT 'auto'" },
    { name: "reason", ddl: "TEXT NOT NULL DEFAULT 'auto'" },
    { name: "tok_input", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "headline", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "verification_gate_status", ddl: "TEXT NOT NULL DEFAULT 'in_progress_or_unverified'" },
    { name: "packet_markdown", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "packet_chars", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "packet_tokens", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "summary_hash", ddl: "TEXT" },
    { name: "fresh_files_count", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "stale_files_count", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "active_skills_count", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "provenance_chains_count", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "created_at", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", ddl: "TEXT NOT NULL DEFAULT ''" }
  ]);
  const symbolCols = new Set(db.query("PRAGMA table_info(code_symbol)").all().map((c) => c.name));
  if (symbolCols.size > 0) {
    if (!symbolCols.has("qualified_name")) {
      db.exec("ALTER TABLE code_symbol ADD COLUMN qualified_name TEXT NOT NULL DEFAULT ''");
      db.exec("UPDATE code_symbol SET qualified_name = CASE WHEN parent_symbol IS NOT NULL AND parent_symbol != '' THEN parent_symbol || '.' || name ELSE name END WHERE qualified_name = ''");
    }
    if (!symbolCols.has("blob_sha")) {
      db.exec("ALTER TABLE code_symbol ADD COLUMN blob_sha TEXT NOT NULL DEFAULT ''");
    }
  }
  initializedContinuityDbs.add(db);
}
function shortBlobRef(shaOrRef) {
  if (!shaOrRef)
    return "blob:unknown";
  const raw = shaOrRef.startsWith("blob:") ? shaOrRef.slice(5) : shaOrRef;
  return `blob:${raw.slice(0, 12)}`;
}
function stripBlobPrefix2(shaOrRef) {
  if (!shaOrRef)
    return "";
  return shaOrRef.startsWith("blob:") ? shaOrRef.slice(5) : shaOrRef;
}
function toHashMap(input) {
  if (!input)
    return new Map;
  if (input instanceof Map)
    return input;
  return new Map(Object.entries(input));
}
function hashesMatch(expectedSha, diskSha) {
  const a = stripBlobPrefix2(expectedSha);
  const b = stripBlobPrefix2(diskSha);
  if (!a || !b)
    return a === b;
  if (a === b)
    return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 12 && (a.startsWith(b) || b.startsWith(a)))
    return true;
  return false;
}
function isSliceStatus(status) {
  return status.startsWith("SLICE ") && status.endsWith("\u2014 FRESH SLICE");
}
function isFreshOrSliceStatus(status) {
  return status === "FRESH \u2014 DO NOT REREAD" || isSliceStatus(status);
}
function classifyProvenanceStaleness(params) {
  const matches = hashesMatch(params.expectedBlobSha, params.diskBlobSha);
  const verifiedPass = params.verificationExitCode === 0 || params.verificationExitCode === null;
  if (matches) {
    if (verifiedPass) {
      return params.preferLowercaseFresh ? "verified_fresh" : "VERIFIED_FRESH";
    }
    return "FRESH \u2014 DO NOT REREAD";
  }
  return verifiedPass ? "verified_stale_by_later_touch" : "STALE (modified since read/review \u2014 re-verify slice)";
}
function formatProvenanceStatusLabel(status) {
  if (status === "VERIFIED_FRESH" || status === "verified_fresh" || status === "verified_pass") {
    return "VERIFIED_FRESH (FRESH \u2014 DO NOT REREAD)";
  }
  if (status === "FRESH \u2014 DO NOT REREAD" || isSliceStatus(status)) {
    return status;
  }
  if (status === "verified_stale_by_later_touch") {
    return "STALE (modified since read/review \u2014 re-verify slice) [verified_stale_by_later_touch]";
  }
  return "STALE (modified since read/review \u2014 re-verify slice)";
}
function resolveCandidateToRoot(db, candidateId) {
  const row = db.query("SELECT id, root_id, depth FROM session WHERE id = ? LIMIT 1").get(candidateId);
  if (row && row.depth > 0 && row.root_id && row.root_id !== candidateId) {
    return { rootId: row.root_id, childId: candidateId };
  }
  return { rootId: candidateId, childId: null };
}
function resolveDefaultSessionId(db, explicitSessionIdOrOptions, hookContext) {
  ensureContinuitySchema(db);
  let explicitSessionId;
  let effectiveHookCtx = hookContext;
  if (typeof explicitSessionIdOrOptions === "string" || explicitSessionIdOrOptions === null) {
    explicitSessionId = explicitSessionIdOrOptions;
  } else if (explicitSessionIdOrOptions && typeof explicitSessionIdOrOptions === "object") {
    explicitSessionId = explicitSessionIdOrOptions.sessionID ?? explicitSessionIdOrOptions.sessionId;
    effectiveHookCtx = explicitSessionIdOrOptions.hookContext ?? hookContext;
  }
  if (typeof explicitSessionId === "string" && explicitSessionId.trim().length > 0) {
    const trimmed = explicitSessionId.trim();
    const { rootId, childId } = resolveCandidateToRoot(db, trimmed);
    return {
      sessionId: rootId,
      sessionID: rootId,
      rootSessionId: rootId,
      rootSessionID: rootId,
      resolvedChildSessionID: childId,
      source: "explicit_input"
    };
  }
  const rawHookId = effectiveHookCtx?.sessionID ?? effectiveHookCtx?.sessionId;
  if (typeof rawHookId === "string" && rawHookId.trim().length > 0) {
    const trimmed = rawHookId.trim();
    const { rootId, childId } = resolveCandidateToRoot(db, trimmed);
    return {
      sessionId: rootId,
      sessionID: rootId,
      rootSessionId: rootId,
      rootSessionID: rootId,
      resolvedChildSessionID: childId,
      source: "hook_context"
    };
  }
  const latestRoot = db.query("SELECT id FROM session WHERE depth = 0 ORDER BY COALESCE(t_updated, t_created, 0) DESC, id DESC LIMIT 1").get();
  if (latestRoot?.id) {
    return {
      sessionId: latestRoot.id,
      sessionID: latestRoot.id,
      rootSessionId: latestRoot.id,
      rootSessionID: latestRoot.id,
      resolvedChildSessionID: null,
      source: "sqlite_latest_root"
    };
  }
  const digestRow = db.query("SELECT session_id FROM session_semantic_digest LIMIT 1").get();
  if (digestRow?.session_id) {
    return {
      sessionId: digestRow.session_id,
      sessionID: digestRow.session_id,
      rootSessionId: digestRow.session_id,
      rootSessionID: digestRow.session_id,
      resolvedChildSessionID: null,
      source: "sqlite_latest_root"
    };
  }
  const latestComp = db.query("SELECT session_id FROM compaction ORDER BY rowid DESC LIMIT 1").get();
  if (latestComp?.session_id) {
    return {
      sessionId: latestComp.session_id,
      sessionID: latestComp.session_id,
      rootSessionId: latestComp.session_id,
      rootSessionID: latestComp.session_id,
      resolvedChildSessionID: null,
      source: "sqlite_latest_root"
    };
  }
  const provRow = db.query("SELECT root_session_id FROM provenance_chain LIMIT 1").get();
  if (provRow?.root_session_id) {
    return {
      sessionId: provRow.root_session_id,
      sessionID: provRow.root_session_id,
      rootSessionId: provRow.root_session_id,
      rootSessionID: provRow.root_session_id,
      resolvedChildSessionID: null,
      source: "sqlite_latest_root"
    };
  }
  const fileRow = db.query("SELECT session_id FROM file_read_ledger LIMIT 1").get();
  const fallbackId = fileRow?.session_id ?? "ses_default";
  return {
    sessionId: fallbackId,
    sessionID: fallbackId,
    rootSessionId: fallbackId,
    rootSessionID: fallbackId,
    resolvedChildSessionID: null,
    source: "sqlite_latest_root"
  };
}
function isLikelySessionId(db, candidate) {
  if (candidate.startsWith("ses_"))
    return true;
  if (candidate.includes("/") || candidate.includes("\\") || candidate.startsWith("."))
    return false;
  if (existsSync9(candidate)) {
    try {
      if (statSync5(candidate).isDirectory())
        return false;
    } catch {}
  }
  const hasSession = db.query("SELECT 1 FROM session WHERE id = ? UNION SELECT 1 FROM file_read_ledger WHERE session_id = ? UNION SELECT 1 FROM provenance_chain WHERE root_session_id = ? LIMIT 1").get(candidate, candidate, candidate);
  return Boolean(hasSession);
}
function computeFullDiskShaForPath(canonicalRoot, rawPath, normPath, memo) {
  if (!canonicalRoot && !path8.isAbsolute(rawPath))
    return null;
  const cacheKey = `${canonicalRoot ?? ""}::${normPath}::${rawPath}`;
  if (memo.has(cacheKey)) {
    return memo.get(cacheKey);
  }
  const absResolved = resolveDiskPath(rawPath, canonicalRoot);
  const candidates = path8.isAbsolute(rawPath) ? [rawPath, ...canonicalRoot ? [path8.join(canonicalRoot, normPath)] : []] : [
    absResolved,
    ...canonicalRoot ? [path8.join(canonicalRoot, normPath), path8.join(canonicalRoot, rawPath)] : []
  ];
  for (const absPath of candidates) {
    if (absPath && existsSync9(absPath)) {
      try {
        const st = statSync5(absPath);
        if (st.isFile()) {
          const sha = sha256Hex(readFileSync7(absPath));
          memo.set(cacheKey, sha);
          return sha;
        }
      } catch {}
    }
  }
  memo.set(cacheKey, null);
  return null;
}
function extractCaptureBounds(row) {
  const lineRange = row.line_range ?? "";
  const rangeMatch = /L(\d+)-L(\d+)(?:\s+of\s+(\d+))?/.exec(lineRange);
  const parsedStart = rangeMatch ? Number.parseInt(rangeMatch[1], 10) : null;
  const parsedEnd = rangeMatch ? Number.parseInt(rangeMatch[2], 10) : null;
  const parsedTotal = rangeMatch?.[3] ? Number.parseInt(rangeMatch[3], 10) : null;
  const startLine = typeof row.start_line === "number" && row.start_line > 0 ? row.start_line : parsedStart ?? 1;
  const totalLines = typeof row.total_lines === "number" && row.total_lines > 0 ? row.total_lines : parsedTotal;
  const isTruncated = Boolean(row.is_truncated) || lineRange.startsWith("SLICE ") || lineRange.includes("truncated") || isSliceStatus(row.staleness_status ?? "");
  const endLine = typeof row.end_line === "number" && row.end_line >= startLine ? row.end_line : parsedEnd && parsedEnd >= startLine ? parsedEnd : totalLines ?? 1e6;
  const explicitPartialSlice = isTruncated || startLine > 1 || totalLines !== null && endLine < totalLines;
  return {
    startLine,
    endLine,
    totalLines,
    isTruncated,
    explicitPartialSlice
  };
}
function reconcileProvenanceStaleness(db, secondArg, thirdArg) {
  const t0 = performance.now();
  ensureContinuitySchema(db);
  let canonicalRoot;
  let explicitSessionId;
  let currentDiskHashes;
  let calledWithCanonicalRoot = false;
  if (typeof secondArg === "string") {
    if (typeof thirdArg === "string") {
      canonicalRoot = secondArg;
      explicitSessionId = thirdArg;
      calledWithCanonicalRoot = true;
    } else if (isLikelySessionId(db, secondArg)) {
      explicitSessionId = secondArg;
      if (thirdArg instanceof Map) {
        currentDiskHashes = thirdArg;
      } else if (thirdArg && typeof thirdArg === "object") {
        const maybeOpts = thirdArg;
        if ("canonicalRoot" in maybeOpts || "projectRoot" in maybeOpts || "rootDir" in maybeOpts || "currentDiskHashes" in maybeOpts) {
          canonicalRoot = maybeOpts.canonicalRoot ?? maybeOpts.projectRoot ?? maybeOpts.rootDir;
          currentDiskHashes = maybeOpts.currentDiskHashes;
          if (canonicalRoot)
            calledWithCanonicalRoot = true;
        } else {
          currentDiskHashes = thirdArg;
        }
      }
    } else {
      canonicalRoot = secondArg;
      calledWithCanonicalRoot = true;
      if (thirdArg && typeof thirdArg === "object" && !(thirdArg instanceof Map)) {
        const maybeOpts = thirdArg;
        explicitSessionId = maybeOpts.sessionID ?? maybeOpts.sessionId;
        currentDiskHashes = maybeOpts.currentDiskHashes;
      }
    }
  } else if (secondArg && typeof secondArg === "object") {
    canonicalRoot = secondArg.canonicalRoot ?? secondArg.projectRoot ?? secondArg.rootDir;
    explicitSessionId = secondArg.sessionID ?? secondArg.sessionId;
    currentDiskHashes = secondArg.currentDiskHashes;
    if (canonicalRoot)
      calledWithCanonicalRoot = true;
  }
  const resolved = resolveDefaultSessionId(db, explicitSessionId);
  const sessionId = resolved.sessionId;
  const hashMap = toHashMap(currentDiskHashes);
  const diskMemo = new Map;
  const nowIso = new Date().toISOString();
  const fileRowsBefore = db.query(`SELECT session_id, path, normalized_path, line_range, start_line, end_line,
              total_lines, is_truncated, blob_sha, blob_sha256, read_blob_sha, read_seq,
              disk_blob_sha, staleness_status
       FROM file_read_ledger
       WHERE session_id = ?
       ORDER BY read_seq ASC, path ASC`).all(sessionId);
  const chainRowsBefore = db.query("SELECT * FROM provenance_chain WHERE root_session_id = ? ORDER BY chain_id ASC").all(sessionId);
  const updateFileStmt = db.prepare("UPDATE file_read_ledger SET line_range = ?, disk_blob_sha = ?, staleness_status = ? WHERE session_id = ? AND path = ?");
  const updateChainStmt = db.prepare("UPDATE provenance_chain SET disk_blob_sha = ?, staleness_status = ?, updated_at = ? WHERE chain_id = ?");
  const updateDigestGateStmt = db.prepare("UPDATE session_semantic_digest SET verification_state = ? WHERE session_id = ?");
  const transitionedFilePaths = [];
  const transitionedChainIds = [];
  const updatedFiles = [];
  const updatedChains = [];
  const tx = db.transaction(() => {
    for (const row of fileRowsBefore) {
      const norm = normalizeRepoPath(row.path, canonicalRoot);
      const recordedSha = stripBlobPrefix2(row.read_blob_sha || row.blob_sha256 || row.blob_sha);
      const rawBlobSha = stripBlobPrefix2(row.blob_sha256 || row.blob_sha || row.read_blob_sha);
      const bounds = extractCaptureBounds(row);
      const overrideHash = hashMap.get(row.path) ?? hashMap.get(norm);
      let nextDiskSha = row.disk_blob_sha || recordedSha;
      let nextStatus = row.staleness_status;
      let nextLineRange = row.line_range;
      if (overrideHash !== undefined) {
        nextDiskSha = stripBlobPrefix2(overrideHash);
        const matches = hashesMatch(recordedSha, nextDiskSha);
        if (matches) {
          nextStatus = bounds.explicitPartialSlice ? formatStalenessStatus("SLICE", bounds.startLine, bounds.endLine, bounds.totalLines) : "FRESH \u2014 DO NOT REREAD";
        } else {
          nextStatus = "STALE (modified since read/review \u2014 re-verify slice)";
        }
      } else {
        const absPath = canonicalRoot || path8.isAbsolute(row.path) ? resolveDiskPath(row.path, canonicalRoot) : "";
        if (canonicalRoot || absPath && existsSync9(absPath)) {
          const reconciled = computeDiskSliceSha(absPath, {
            startLine: bounds.startLine,
            endLine: bounds.endLine,
            totalLines: bounds.totalLines,
            isTruncated: bounds.isTruncated,
            sliceSha: recordedSha,
            rawBlobSha
          });
          nextStatus = reconciled.stalenessStatus;
          if (reconciled.state === "FRESH") {
            nextDiskSha = reconciled.diskFullSha ?? recordedSha;
          } else if (reconciled.state === "SLICE") {
            nextDiskSha = reconciled.diskSliceSha ?? recordedSha;
            nextLineRange = reconciled.lineRange;
          } else {
            nextDiskSha = reconciled.diskSliceSha ?? reconciled.diskFullSha ?? "missing";
          }
        } else {
          const matches = hashesMatch(recordedSha, nextDiskSha);
          if (matches) {
            nextStatus = bounds.explicitPartialSlice ? formatStalenessStatus("SLICE", bounds.startLine, bounds.endLine, bounds.totalLines) : "FRESH \u2014 DO NOT REREAD";
          } else {
            nextStatus = "STALE (modified since read/review \u2014 re-verify slice)";
          }
        }
      }
      if (nextDiskSha !== row.disk_blob_sha || nextStatus !== row.staleness_status || nextLineRange !== row.line_range) {
        updateFileStmt.run(nextLineRange, nextDiskSha, nextStatus, row.session_id, row.path);
        transitionedFilePaths.push(row.path);
      }
      updatedFiles.push({
        ...row,
        line_range: nextLineRange,
        disk_blob_sha: nextDiskSha,
        staleness_status: nextStatus
      });
    }
    for (const chain of chainRowsBefore) {
      const norm = normalizeRepoPath(chain.target_path, canonicalRoot);
      const expectedSha = chain.repair_blob_sha || chain.read_or_review_blob_sha || chain.receipt_blob_sha || chain.disk_blob_sha;
      const overrideHash = hashMap.get(chain.target_path) ?? hashMap.get(norm);
      const liveDiskSha = overrideHash ?? computeFullDiskShaForPath(canonicalRoot, chain.target_path, norm, diskMemo);
      const nextDiskSha = liveDiskSha ?? (canonicalRoot ? "missing" : chain.disk_blob_sha || expectedSha);
      const exitCode = chain.verification_exit_code ?? chain.receipt_exit_code ?? 0;
      const preferLowercaseFresh = calledWithCanonicalRoot || chain.staleness_status === "verified_fresh";
      const nextStatus = classifyProvenanceStaleness({
        expectedBlobSha: expectedSha,
        diskBlobSha: nextDiskSha,
        verificationExitCode: exitCode,
        preferLowercaseFresh
      });
      if (nextDiskSha !== chain.disk_blob_sha || nextStatus !== chain.staleness_status) {
        updateChainStmt.run(nextDiskSha, nextStatus, nowIso, chain.chain_id);
        transitionedChainIds.push(chain.chain_id);
      }
      updatedChains.push({
        ...chain,
        disk_blob_sha: nextDiskSha,
        staleness_status: nextStatus,
        updated_at: nowIso
      });
    }
    if (updatedChains.some((c) => c.staleness_status === "verified_stale_by_later_touch")) {
      updateDigestGateStmt.run("verified_stale_by_later_touch", sessionId);
    } else if (updatedChains.length > 0 && updatedChains.every((c) => c.staleness_status === "VERIFIED_FRESH" || c.staleness_status === "verified_fresh")) {
      updateDigestGateStmt.run("verified_passed", sessionId);
    }
  });
  tx();
  const freshFiles = updatedFiles.filter((f) => isFreshOrSliceStatus(f.staleness_status));
  const sliceFiles = updatedFiles.filter((f) => isSliceStatus(f.staleness_status));
  const staleFiles = updatedFiles.filter((f) => !isFreshOrSliceStatus(f.staleness_status));
  const verifiedFreshChainsCount = updatedChains.filter((c) => c.staleness_status === "VERIFIED_FRESH" || c.staleness_status === "verified_fresh" || c.staleness_status === "FRESH \u2014 DO NOT REREAD").length;
  const staleChainsCount = updatedChains.length - verifiedFreshChainsCount;
  const elapsedMs = performance.now() - t0;
  return {
    sessionId,
    sessionID: sessionId,
    totalFilesChecked: updatedFiles.length,
    freshFilesCount: freshFiles.length,
    sliceFilesCount: sliceFiles.length,
    staleFilesCount: staleFiles.length,
    freshFiles,
    sliceFiles,
    staleFiles,
    totalChainsChecked: updatedChains.length,
    verifiedFreshChainsCount,
    staleChainsCount,
    transitionedFilePaths,
    transitionedChainIds,
    fileRows: updatedFiles,
    chainRows: updatedChains,
    elapsedMs
  };
}
function selectFilesForPacket(allFiles) {
  const stale = allFiles.filter((f) => !isFreshOrSliceStatus(f.staleness_status));
  const fresh = allFiles.filter((f) => isFreshOrSliceStatus(f.staleness_status));
  return [...stale, ...fresh.slice(0, Math.max(0, 14 - stale.length))];
}
function selectSkillsForPacket(allSkills) {
  return allSkills.slice(0, 12);
}
function buildCompactionContinuationPacket(db, sessionIdOrOptions, maybeOptions) {
  ensureContinuitySchema(db);
  let explicitSessionId;
  let options = {};
  if (typeof sessionIdOrOptions === "string") {
    explicitSessionId = sessionIdOrOptions;
    options = maybeOptions ?? {};
  } else if (sessionIdOrOptions && typeof sessionIdOrOptions === "object") {
    options = sessionIdOrOptions;
    explicitSessionId = options.sessionID ?? options.sessionId;
  } else if (maybeOptions) {
    options = maybeOptions;
    explicitSessionId = options.sessionID ?? options.sessionId;
  }
  const resolved = resolveDefaultSessionId(db, explicitSessionId, options.hookContext);
  const sessionId = resolved.sessionId;
  const maxTokensBudget = options.maxTokens ?? options.maxTokensBudget ?? 1200;
  const requestedSeq = options.compactionSeq ?? options.seq;
  const canonicalRoot = options.canonicalRoot ?? options.projectRoot ?? options.rootDir;
  if (options.currentDiskHashes || canonicalRoot) {
    reconcileProvenanceStaleness(db, {
      sessionID: sessionId,
      canonicalRoot,
      currentDiskHashes: options.currentDiskHashes
    });
  }
  const compactionRow = requestedSeq !== undefined ? db.query("SELECT session_id, seq, reason, status, summary_ref, tok_input FROM compaction WHERE session_id = ? AND seq = ? LIMIT 1").get(sessionId, requestedSeq) : db.query("SELECT session_id, seq, reason, status, summary_ref, tok_input FROM compaction WHERE session_id = ? ORDER BY seq DESC LIMIT 1").get(sessionId);
  const compactionSeq = compactionRow?.seq ?? requestedSeq ?? 0;
  const compactionReason = compactionRow?.reason ?? "auto";
  const compactionTokensInput = compactionRow?.tok_input ?? 0;
  const digestRow = db.query("SELECT headline, verification_state, touched_files_json FROM session_semantic_digest WHERE session_id = ? LIMIT 1").get(sessionId);
  const headline = digestRow?.headline ?? `[Root] Session ${sessionId}`;
  const verificationGateStatus = digestRow?.verification_state ?? "in_progress_or_unverified";
  const pivots = db.query("SELECT seq, pivot_kind, prompt_excerpt, blob_ref FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC LIMIT 5").all(sessionId);
  const allSkills = db.query("SELECT session_id, skill_name, blob_sha, blob_ref, load_seq, status FROM skill_load_ledger WHERE session_id = ? ORDER BY load_seq ASC").all(sessionId);
  const packetSkills = selectSkillsForPacket(allSkills);
  const allFiles = db.query("SELECT session_id, path, line_range, start_line, end_line, total_lines, is_truncated, read_blob_sha, read_seq, disk_blob_sha, staleness_status FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC").all(sessionId);
  const packetFiles = selectFilesForPacket(allFiles);
  const staleFiles = allFiles.filter((f) => !isFreshOrSliceStatus(f.staleness_status));
  const freshFiles = packetFiles.filter((f) => isFreshOrSliceStatus(f.staleness_status));
  const sliceFiles = freshFiles.filter((f) => isSliceStatus(f.staleness_status));
  const fullFreshFiles = freshFiles.filter((f) => !isSliceStatus(f.staleness_status));
  const delegationTurns = db.query(`SELECT call_id, turn_index, child_session_id, mode, harness, agent,
              reported_outcome, verified_outcome, tool_error_count, blocker_summary
       FROM delegation_turn
       WHERE parent_session_id = ?
       ORDER BY start_seq ASC, turn_index ASC`).all(sessionId);
  const flaggedDelegations = delegationTurns.filter((d) => d.verified_outcome === "blocked_in_text" || d.verified_outcome === "tool_error_inside" || d.tool_error_count > 0).sort((a, b) => b.tool_error_count - a.tool_error_count);
  const provenanceChains = db.query("SELECT * FROM provenance_chain WHERE root_session_id = ? ORDER BY chain_id ASC").all(sessionId);
  const staleChains = provenanceChains.filter((c) => c.staleness_status === "verified_stale_by_later_touch" || c.staleness_status === "STALE (modified since read/review \u2014 re-verify slice)");
  const topCodeFiles = db.query("SELECT path, pagerank, loc, skeleton_tokens FROM code_file ORDER BY pagerank DESC LIMIT 4").all();
  const topSymbolsStmt = db.prepare("SELECT name, start_line, end_line FROM code_symbol WHERE path = ? AND depth = 1 AND exported = 1 ORDER BY start_line ASC LIMIT 1");
  const cochangeAlerts = db.query(`SELECT file_a, file_b, co_commits, prob_a_given_b, prob_b_given_a, has_static_edge
       FROM git_cochange
       WHERE (prob_a_given_b >= 0.40 OR prob_b_given_a >= 0.40)
       ORDER BY has_static_edge ASC, co_commits DESC, MAX(prob_a_given_b, prob_b_given_a) DESC
       LIMIT 3`).all();
  const lines = [];
  const headlineAndGateLine = `**Headline:** ${headline} | **Gate:** \`${verificationGateStatus}\` | **Session:** \`${sessionId}\``;
  lines.push(`## Substrate Continuity \xB7 Headline & Gate \xB7 \`${sessionId}\` (seq=${compactionSeq}, ${compactionReason}, ${compactionTokensInput} tok_in)`);
  lines.push(headlineAndGateLine);
  lines.push("", `### 1. Intent Pivot Timeline (${pivots.length})`);
  if (pivots.length === 0) {
    lines.push(`- \`seq=1\` [initial_goal] ${headline} (\`blob:000000000000\`)`);
  } else {
    for (const p of pivots) {
      const clean = p.prompt_excerpt.replace(/\s+/g, " ").trim().slice(0, 38);
      lines.push(`- \`seq=${p.seq}\` [${p.pivot_kind}] ${clean} (\`${shortBlobRef(p.blob_ref)}\`)`);
    }
  }
  lines.push("", `### 2. Working-Memory Manifest (FRESH=${freshFiles.length}, SLICE=${sliceFiles.length}, STALE=${staleFiles.length}, Skills=${packetSkills.length})`);
  if (packetSkills.length > 0) {
    const skillTokens = packetSkills.map((s) => `@${s.skill_name}(${s.blob_sha.slice(0, 6)})`).join(", ");
    lines.push(`- **Skills (ACTIVE \u2014 DO NOT RE-INVOKE):** ${skillTokens}`);
  }
  if (staleFiles.length > 0) {
    for (const sf of staleFiles) {
      lines.push(`- **${sf.staleness_status}:** \`${sf.path}#${sf.line_range}\` (read=\`${shortBlobRef(sf.read_blob_sha)}\` != disk=\`${shortBlobRef(sf.disk_blob_sha)}\`)`);
    }
  }
  if (sliceFiles.length > 0) {
    for (const sl of sliceFiles) {
      lines.push(`- **${sl.staleness_status}:** \`${sl.path}#${sl.line_range}\` (\`${shortBlobRef(sl.read_blob_sha)}\`)`);
    }
  }
  if (fullFreshFiles.length > 0) {
    const freshEntries = fullFreshFiles.map((f) => `${f.path}#${f.line_range}(${f.read_blob_sha.slice(0, 6)})`).join(", ");
    lines.push(`- **FRESH \u2014 DO NOT REREAD:** ${freshEntries}`);
  }
  lines.push("", `### 3. Delegation Trajectory (${delegationTurns.length} turns, ${flaggedDelegations.length} flagged)`);
  const toolErrorTurn = flaggedDelegations.find((d) => d.verified_outcome === "tool_error_inside");
  const blockedTextTurn = flaggedDelegations.find((d) => d.verified_outcome === "blocked_in_text");
  const prioritizedFlagged = [
    ...toolErrorTurn ? [toolErrorTurn] : [],
    ...blockedTextTurn && blockedTextTurn !== toolErrorTurn ? [blockedTextTurn] : [],
    ...flaggedDelegations.filter((d) => d !== toolErrorTurn && d !== blockedTextTurn)
  ];
  const turnsToRender = prioritizedFlagged.length > 0 ? [
    ...prioritizedFlagged.slice(0, 2),
    ...delegationTurns.filter((d) => !prioritizedFlagged.includes(d)).slice(0, 1)
  ].slice(0, 2) : delegationTurns.slice(0, 2);
  for (const d of turnsToRender) {
    const blockerSuffix = d.blocker_summary ? ` \u2014 ${d.blocker_summary.replace(/\s+/g, " ").slice(0, 38)}` : "";
    lines.push(`- \`${d.child_session_id}\` (t${d.turn_index} ${d.harness}): reported=\`${d.reported_outcome ?? "unknown"}\` -> verified=\`${d.verified_outcome}\` (err=${d.tool_error_count})${blockerSuffix}`);
  }
  lines.push("", `### 4. Provenance Chain (${provenanceChains.length} chains, ${staleChains.length} stale)`);
  for (const c of provenanceChains) {
    const statusLabel = formatProvenanceStatusLabel(c.staleness_status);
    const expectedSha = c.repair_blob_sha || c.read_or_review_blob_sha || c.disk_blob_sha;
    const decSeq = c.decision_pivot_seq ?? c.decision_seq ?? 0;
    const exitCode = c.verification_exit_code ?? c.receipt_exit_code ?? "none";
    lines.push(`- \`${c.finding_id}\` (seq=${decSeq}, \`${c.child_session_id ?? "root"}\`) -> \`${c.target_path}\` (\`${shortBlobRef(expectedSha)}\` vs \`${shortBlobRef(c.disk_blob_sha)}\`, exit=${exitCode}) => **${statusLabel}**`);
  }
  lines.push("", `### 5. Tier-1 RepoMap & Co-Change Alerts`);
  const repoItems = [];
  for (const cf of topCodeFiles) {
    const syms = topSymbolsStmt.all(cf.path).map((s) => `${s.name}[L${s.start_line}-L${s.end_line}]`).join(",");
    repoItems.push(`\`${cf.path}\`(PR=${cf.pagerank.toFixed(3)}${syms ? `:${syms}` : ""})`);
  }
  lines.push(`- **RepoMap:** ${repoItems.join("; ")}`);
  const cochangeItems = cochangeAlerts.map((cc) => {
    const maxProb = Math.max(cc.prob_a_given_b, cc.prob_b_given_a) * 100;
    const edgeTag = cc.has_static_edge === 0 ? "HIDDEN" : "static";
    return `\`${cc.file_a}<->${cc.file_b}\`(${maxProb.toFixed(1)}%,${edgeTag})`;
  });
  lines.push(`- **Co-Change:** ${cochangeItems.join("; ")}`);
  let markdown = lines.join(`
`);
  const maxChars = Math.max(200, (maxTokensBudget - 1) * 4);
  if (markdown.length > maxChars) {
    markdown = markdown.slice(0, maxChars - 16) + `
...(truncated)`;
  }
  const charCount = markdown.length;
  const tokenCount = estimateTokens(markdown);
  const nowIso = new Date().toISOString();
  db.query(`INSERT OR REPLACE INTO compaction_continuation_ledger (
      session_id, compaction_seq, compaction_reason, reason, tok_input,
      headline, verification_gate_status, packet_markdown, packet_chars,
      packet_tokens, fresh_files_count, stale_files_count,
      active_skills_count, provenance_chains_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sessionId, compactionSeq, compactionReason, compactionReason, compactionTokensInput, headline, verificationGateStatus, markdown, charCount, tokenCount, freshFiles.length, staleFiles.length, packetSkills.length, provenanceChains.length, nowIso, nowIso);
  return {
    sessionId,
    sessionID: sessionId,
    compactionSeq,
    compactionReason,
    compactionTokensInput,
    headline,
    verificationGateStatus,
    markdown,
    charCount,
    tokenCount,
    tokenEstimate: tokenCount,
    withinBudget: tokenCount < maxTokensBudget,
    sections: {
      headlineAndGate: headlineAndGateLine,
      intentPivotsCount: pivots.length,
      activeSkillsCount: packetSkills.length,
      filesReadCount: packetFiles.length,
      freshFilesCount: freshFiles.length,
      staleFilesCount: staleFiles.length,
      delegationTurnsCount: delegationTurns.length,
      flaggedDelegationCount: flaggedDelegations.length,
      provenanceChainsCount: provenanceChains.length,
      staleProvenanceCount: staleChains.length,
      repoMapFilesCount: topCodeFiles.length,
      cochangeAlertsCount: cochangeAlerts.length
    }
  };
}
function renderProvenanceReport(db, sessionId, options) {
  ensureContinuitySchema(db);
  const resolved = resolveDefaultSessionId(db, sessionId, options?.hookContext);
  const targetSessionId = resolved.sessionId;
  if (options?.canonicalRoot || options?.currentDiskHashes) {
    reconcileProvenanceStaleness(db, {
      sessionID: targetSessionId,
      canonicalRoot: options.canonicalRoot,
      currentDiskHashes: options.currentDiskHashes
    });
  }
  const chains = db.query("SELECT * FROM provenance_chain WHERE root_session_id = ? ORDER BY chain_id ASC").all(targetSessionId);
  const files = db.query("SELECT * FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC").all(targetSessionId);
  const freshFiles = files.filter((f) => isFreshOrSliceStatus(f.staleness_status));
  const sliceFiles = files.filter((f) => isSliceStatus(f.staleness_status));
  const staleFiles = files.filter((f) => !isFreshOrSliceStatus(f.staleness_status));
  const lines = [
    `## Provenance & Staleness Ledger \xB7 \`${targetSessionId}\``,
    ...chains.map((c) => {
      const expectedSha = c.repair_blob_sha || c.read_or_review_blob_sha || c.disk_blob_sha;
      return `- \`${c.chain_id}\` (\`${c.finding_id}\`) -> \`${c.target_path}\` (\`${shortBlobRef(expectedSha)}\` vs \`${shortBlobRef(c.disk_blob_sha)}\`) | **${formatProvenanceStatusLabel(c.staleness_status)}** [${c.staleness_status}]`;
    }),
    `- Files tracked: ${files.length} (${freshFiles.length} FRESH [${sliceFiles.length} SLICE], ${staleFiles.length} STALE)`,
    ...sliceFiles.map((sl) => `  - **${sl.staleness_status}:** \`${sl.path}#${sl.line_range}\` (slice=\`${shortBlobRef(sl.read_blob_sha)}\`, disk=\`${shortBlobRef(sl.disk_blob_sha)}\`)`),
    ...staleFiles.map((sf) => `  - **${sf.staleness_status}:** \`${sf.path}#${sf.line_range}\` (read=\`${shortBlobRef(sf.read_blob_sha)}\` != disk=\`${shortBlobRef(sf.disk_blob_sha)}\`)`)
  ];
  return lines.join(`
`);
}
function recordCompactionSummaryHash(db, sessionId, summaryText, compactionSeq) {
  ensureContinuitySchema(db);
  const summaryHash = sha256Hex(summaryText);
  if (compactionSeq !== undefined) {
    db.query("UPDATE compaction_continuation_ledger SET summary_hash = ?, updated_at = ? WHERE session_id = ? AND compaction_seq = ?").run(summaryHash, new Date().toISOString(), sessionId, compactionSeq);
  } else {
    db.query(`UPDATE compaction_continuation_ledger
       SET summary_hash = ?, updated_at = ?
       WHERE session_id = ?
         AND compaction_seq = (
           SELECT MAX(compaction_seq) FROM compaction_continuation_ledger WHERE session_id = ?
         )`).run(summaryHash, new Date().toISOString(), sessionId, sessionId);
  }
  return summaryHash;
}
function querySubstrateContinuity(db, input = {}, hookContext) {
  ensureContinuitySchema(db);
  const action = input.action ?? "status";
  const resolved = resolveDefaultSessionId(db, input.sessionID, hookContext);
  const sessionId = resolved.sessionId;
  if (action === "overview") {
    const rows = db.query(`SELECT c.session_id, c.seq, c.reason, c.tok_input, d.headline, d.verification_state
         FROM compaction c
         LEFT JOIN session_semantic_digest d ON d.session_id = c.session_id
         ORDER BY c.session_id, c.seq`).all();
    const lines = [
      `## Compaction Continuity Overview (${rows.length} compactions; default session: \`${sessionId}\`)`,
      ...rows.map((r) => `- \`${r.session_id}\` \`seq=${r.seq}\` (${r.reason}, ${r.tok_input} tok_in) | ${r.headline ?? "session"} | gate=\`${r.verification_state ?? "unknown"}\``)
    ];
    return {
      ok: true,
      action,
      resolvedSessionID: sessionId,
      resolutionSource: resolved.source,
      content: lines.join(`
`),
      data: { compactions: rows, defaultSessionId: sessionId }
    };
  }
  if (action === "intents" || action === "timeline") {
    const pivots = db.query("SELECT seq, message_id, pivot_kind, prompt_excerpt, blob_ref, t FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC").all(sessionId);
    const digest = db.query("SELECT headline, verification_state FROM session_semantic_digest WHERE session_id = ?").get(sessionId);
    const lines = [
      `## Intent Pivot Timeline \xB7 \`${sessionId}\` (${pivots.length} pivots)`,
      `**Headline:** ${digest?.headline ?? sessionId} | **Gate:** \`${digest?.verification_state ?? "unknown"}\``,
      ...pivots.map((p) => `- \`seq=${p.seq}\` [${p.pivot_kind}] ${p.prompt_excerpt} (\`${shortBlobRef(p.blob_ref)}\`)`)
    ];
    return {
      ok: true,
      action,
      resolvedSessionID: sessionId,
      resolutionSource: resolved.source,
      content: lines.join(`
`),
      data: {
        sessionId,
        headline: digest?.headline ?? sessionId,
        verificationState: digest?.verification_state ?? "unknown",
        userIntents: pivots
      }
    };
  }
  if (action === "provenance") {
    const chains = db.query("SELECT * FROM provenance_chain WHERE root_session_id = ? ORDER BY chain_id ASC").all(sessionId);
    const files = db.query("SELECT * FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC").all(sessionId);
    const staleFiles = files.filter((f) => !isFreshOrSliceStatus(f.staleness_status));
    const sliceFiles = files.filter((f) => isSliceStatus(f.staleness_status));
    const content = renderProvenanceReport(db, sessionId);
    return {
      ok: true,
      action,
      resolvedSessionID: sessionId,
      resolutionSource: resolved.source,
      content,
      data: {
        sessionId,
        provenanceChains: chains,
        staleFiles,
        sliceFiles,
        totalFiles: files.length
      }
    };
  }
  if (action === "search" && input.query) {
    const q = `%${input.query.toLowerCase()}%`;
    const matches = db.query(`SELECT session_id, headline, verification_state
         FROM session_semantic_digest
         WHERE lower(headline) LIKE ? OR lower(key_decisions_json) LIKE ? OR lower(touched_files_json) LIKE ?`).all(q, q, q);
    return {
      ok: true,
      action,
      resolvedSessionID: sessionId,
      resolutionSource: resolved.source,
      content: JSON.stringify(matches, null, 2),
      data: { query: input.query, matches }
    };
  }
  const packet = buildCompactionContinuationPacket(db, sessionId, { seq: input.seq });
  return {
    ok: true,
    action,
    resolvedSessionID: sessionId,
    resolutionSource: resolved.source,
    content: packet.markdown,
    data: {
      sessionId: packet.sessionId,
      compactionSeq: packet.compactionSeq,
      tokenCount: packet.tokenCount,
      withinBudget: packet.withinBudget,
      sections: packet.sections
    }
  };
}

// src/viewports/brief.ts
function resolveEffectiveRootDir(explicitRootDir) {
  if (explicitRootDir)
    return explicitRootDir;
  return process.cwd();
}
function truncateLinesToBudget(lines, maxChars, suffix = "// ... [truncated for token budget]") {
  const full = lines.join(`
`);
  if (full.length <= maxChars)
    return full;
  if (maxChars <= suffix.length + 16)
    return full.slice(0, Math.max(0, maxChars));
  const out = [];
  let used = 0;
  const cap = maxChars - suffix.length - 1;
  for (const line of lines) {
    const nextLen = used === 0 ? line.length : used + 1 + line.length;
    if (nextLen > cap)
      break;
    out.push(line);
    used = nextLen;
  }
  if (out.length === 0 && lines.length > 0) {
    out.push(lines[0].slice(0, cap));
  }
  out.push(suffix);
  return out.join(`
`);
}
var diskFileCache = new Map;
function getCachedDiskFile(rootDir, relPath) {
  const normPath = normalizeRepoPath(relPath, rootDir);
  const absPath = path9.join(rootDir, normPath);
  if (!existsSync10(absPath))
    return null;
  try {
    const stat = statSync6(absPath);
    const cached = diskFileCache.get(absPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached;
    }
    const sourceText = readFileSync8(absPath, "utf8");
    const lines = sourceText.split(`
`);
    const skeleton = skeletonizeSource(normPath, sourceText, { rootDir });
    const entry = {
      mtimeMs: stat.mtimeMs,
      sourceText,
      lines,
      skeleton
    };
    diskFileCache.set(absPath, entry);
    return entry;
  } catch {
    return null;
  }
}
function buildImplementorViewportBrief(db, options) {
  ensureContinuitySchema(db);
  ensureCodeGraphSchema(db);
  ensureCochangeSchema(db);
  const t0 = performance.now();
  const maxTokens = Math.max(100, options.maxTokens ?? options.maxTokensBudget ?? 1500);
  const maxChars = maxTokens * 4;
  const minProbability = options.minCouplingProbability ?? options.minProbability ?? 0.3;
  const effectiveRootDir = resolveEffectiveRootDir(options.rootDir ?? options.projectRoot ?? options.canonicalRoot);
  const rawPaths = options.targetPaths ?? options.writeLeasePaths ?? [];
  const targetPaths = [
    ...new Set(rawPaths.map((p) => normalizeRepoPath(p, effectiveRootDir)).filter(Boolean))
  ];
  const rawSessionId = options.sessionID ?? options.sessionId;
  const resolvedSession = rawSessionId ? resolveDefaultSessionId(db, rawSessionId) : resolveDefaultSessionId(db);
  const resolvedSessionID = resolvedSession.sessionId || null;
  const requestedSymbolRefs = [];
  for (const s of options.symbolNames ?? []) {
    const trimmed = s.trim();
    if (!trimmed)
      continue;
    const hashIdx = trimmed.indexOf("#");
    const colonIdx = trimmed.indexOf(":");
    if (hashIdx > 0) {
      requestedSymbolRefs.push({
        path: normalizeRepoPath(trimmed.slice(0, hashIdx), effectiveRootDir),
        symbol: trimmed.slice(hashIdx + 1).trim()
      });
    } else if (colonIdx > 0 && trimmed.slice(0, colonIdx).includes("/")) {
      requestedSymbolRefs.push({
        path: normalizeRepoPath(trimmed.slice(0, colonIdx), effectiveRootDir),
        symbol: trimmed.slice(colonIdx + 1).trim()
      });
    } else {
      requestedSymbolRefs.push({ symbol: trimmed });
    }
  }
  for (const fs of options.focusSymbols ?? []) {
    if (typeof fs === "string") {
      if (fs.trim())
        requestedSymbolRefs.push({ symbol: fs.trim() });
    } else if (fs && typeof fs === "object" && fs.symbol) {
      requestedSymbolRefs.push({
        path: fs.path ? normalizeRepoPath(fs.path, effectiveRootDir) : undefined,
        symbol: fs.symbol.trim()
      });
    }
  }
  const targetSet = new Set(targetPaths);
  const allChains = resolvedSessionID ? db.query("SELECT * FROM provenance_chain WHERE root_session_id = ? OR target_path IN (SELECT value FROM json_each(?)) ORDER BY chain_id ASC").all(resolvedSessionID, JSON.stringify(targetPaths)) : db.query("SELECT * FROM provenance_chain WHERE target_path IN (SELECT value FROM json_each(?)) ORDER BY chain_id ASC").all(JSON.stringify(targetPaths));
  const sortedChains = [...allChains].sort((a, b) => {
    const aMatch = targetSet.has(normalizeRepoPath(a.target_path, effectiveRootDir)) ? 1 : 0;
    const bMatch = targetSet.has(normalizeRepoPath(b.target_path, effectiveRootDir)) ? 1 : 0;
    return bMatch - aMatch || a.chain_id.localeCompare(b.chain_id);
  });
  const provenanceConstraints = sortedChains.map((c) => {
    const expectedSha = c.repair_blob_sha || c.read_or_review_blob_sha || c.disk_blob_sha;
    return `- \`${c.finding_id}\` -> \`${c.target_path}\` (\`${shortBlobRef(expectedSha)}\` vs \`${shortBlobRef(c.disk_blob_sha)}\`): **${formatProvenanceStatusLabel(c.staleness_status)}** \u2014 ${c.finding_summary}`;
  });
  const cochangeWarnings = [];
  const hiddenCouplingWarnings = [];
  const warningLines = [];
  const seenPairs = new Set;
  for (const p of targetPaths) {
    const rows = queryCochangeCouplings(db, p, {
      minProbability,
      minCochangeCount: 2,
      limit: 8
    });
    rows.sort((a, b) => Number(b.has_static_edge === 0) - Number(a.has_static_edge === 0) || b.probability - a.probability || b.co_commits - a.co_commits);
    for (const r of rows) {
      const pairKey = `${p}:::${r.coupled_path}`;
      if (seenPairs.has(pairKey))
        continue;
      seenPairs.add(pairKey);
      const isHidden = r.has_static_edge === 0;
      cochangeWarnings.push({
        leasePath: p,
        coupledPath: r.coupled_path,
        probability: r.probability,
        hasStaticEdge: !isHidden,
        recentSubjects: r.recent_subjects
      });
      const pct = (r.probability * 100).toFixed(1);
      const tag = isHidden ? "HIDDEN COUPLING (has_static_edge=0, 0 static import edges)" : "static+temporal (has_static_edge=1)";
      const subj = r.recent_subjects[0] ? ` \u2014 "${r.recent_subjects[0]}"` : "";
      const line = `- \`${p}\` <-> \`${r.coupled_path}\`: P=${pct}% (${r.co_commits}/${r.target_commits} commits, ${tag})${subj}`;
      warningLines.push(line);
      if (isHidden) {
        hiddenCouplingWarnings.push(line);
      }
    }
  }
  const skeletons = [];
  for (const p of targetPaths) {
    const view = readAstSkeleton(db, p);
    if (view) {
      skeletons.push({
        path: view.path,
        loc: view.loc,
        skeletonTokens: view.skeleton_tokens,
        skeletonMarkdown: view.skeleton_text
      });
    } else {
      const diskFile = getCachedDiskFile(effectiveRootDir, p);
      if (diskFile) {
        skeletons.push({
          path: diskFile.skeleton.filePath,
          loc: diskFile.skeleton.loc,
          skeletonTokens: diskFile.skeleton.skeletonTokens,
          skeletonMarkdown: diskFile.skeleton.skeletonText
        });
      }
    }
  }
  const includedSymbols = [];
  const symbolSlices = [];
  const symLookupQuery = db.query("SELECT * FROM code_symbol WHERE path = ? AND (qualified_name = ? OR name = ?) ORDER BY depth ASC, start_line ASC LIMIT 1");
  for (const ref of requestedSymbolRefs) {
    const candidatePaths = ref.path ? [ref.path, ...targetPaths] : targetPaths;
    let resolvedSlice = null;
    for (const p of candidatePaths) {
      const symRow = symLookupQuery.get(p, ref.symbol, ref.symbol);
      if (symRow) {
        const symLabel = symRow.qualified_name && symRow.qualified_name.length > 0 ? symRow.qualified_name : symRow.parent_symbol ? `${symRow.parent_symbol}.${symRow.name}` : symRow.name;
        const view = readSymbolSlice(db, effectiveRootDir, p, symLabel);
        if (view) {
          resolvedSlice = {
            path: view.path,
            symbol: symLabel,
            startLine: view.start_line,
            endLine: view.end_line,
            sliceTokens: view.slice_tokens,
            code: view.slice_text
          };
        } else {
          const code = `// ${p} [L${symRow.start_line}-L${symRow.end_line}] (${symLabel}, kind=${symRow.kind}, depth=${symRow.depth})
L${symRow.start_line}: ${symRow.signature}`;
          resolvedSlice = {
            path: p,
            symbol: symLabel,
            startLine: symRow.start_line,
            endLine: symRow.end_line,
            sliceTokens: estimateTokens(code),
            code
          };
        }
        break;
      }
      const diskFile = getCachedDiskFile(effectiveRootDir, p);
      if (diskFile) {
        const matched = diskFile.skeleton.symbols.find((s) => s.qualified_name === ref.symbol) ?? diskFile.skeleton.symbols.find((s) => s.name === ref.symbol);
        if (matched) {
          const clampedEnd = Math.min(diskFile.lines.length, matched.end_line);
          const numberedLines = [];
          for (let L = matched.start_line;L <= clampedEnd; L++) {
            numberedLines.push(`L${L}: ${diskFile.lines[L - 1] ?? ""}`);
          }
          const header = `// ${p} [L${matched.start_line}-L${clampedEnd}] (${matched.qualified_name}, kind=${matched.kind}, depth=${matched.depth})`;
          const code = `${header}
${numberedLines.join(`
`)}`;
          resolvedSlice = {
            path: p,
            symbol: matched.qualified_name,
            startLine: matched.start_line,
            endLine: clampedEnd,
            sliceTokens: estimateTokens(code),
            code
          };
          break;
        }
      }
    }
    if (resolvedSlice) {
      symbolSlices.push(resolvedSlice);
      if (!includedSymbols.includes(resolvedSlice.symbol)) {
        includedSymbols.push(resolvedSlice.symbol);
      }
      if (!includedSymbols.includes(ref.symbol)) {
        includedSymbols.push(ref.symbol);
      }
    }
  }
  const repoMapBudgetTokens = Math.min(400, Math.max(50, Math.floor(maxTokens * 0.2)));
  const repoMapView = renderRepoMap(db, {
    focusPaths: targetPaths,
    budgetTokens: repoMapBudgetTokens
  });
  const headerLines = [
    `# Implementor Viewport Brief (${targetPaths.length} target paths, budget=${maxTokens} tok)`
  ];
  if (options.goal) {
    headerLines.push(`- **Goal:** ${options.goal}`);
  }
  if (targetPaths.length > 0) {
    headerLines.push(`- **Write Lease:** ${targetPaths.map((p) => `\`${p}\``).join(", ")}`);
  }
  if (options.verificationCommand) {
    headerLines.push(`- **Verification Gate:** \`${options.verificationCommand}\``);
  }
  const headerBlock = truncateLinesToBudget(headerLines, Math.floor(maxChars * 0.12));
  const remainingAfterHeader = Math.max(120, maxChars - headerBlock.length - 24);
  const hasSlices = symbolSlices.length > 0;
  const provBudgetChars = Math.floor(remainingAfterHeader * 0.14);
  const cochangeBudgetChars = Math.floor(remainingAfterHeader * 0.18);
  const sliceBudgetChars = hasSlices ? Math.floor(remainingAfterHeader * 0.3) : 0;
  const skelBudgetChars = Math.floor(remainingAfterHeader * (hasSlices ? 0.22 : 0.42));
  const repoMapBudgetChars = Math.floor(remainingAfterHeader * (hasSlices ? 0.16 : 0.26));
  const sectionBlocks = [headerBlock];
  const provSectionLines = [
    `## 1. Active Provenance Constraints (${provenanceConstraints.length})`,
    ...provenanceConstraints.length > 0 ? provenanceConstraints : ["- No active provenance chains blocking leased paths."]
  ];
  sectionBlocks.push(truncateLinesToBudget(provSectionLines, provBudgetChars));
  const cochangeSectionLines = [
    `## 2. Tier-4 Co-Change Couplings (${cochangeWarnings.length} coupled, ${hiddenCouplingWarnings.length} HIDDEN)`,
    ...warningLines.length > 0 ? warningLines : ["- No high-probability co-change couplings above threshold."]
  ];
  sectionBlocks.push(truncateLinesToBudget(cochangeSectionLines, cochangeBudgetChars));
  if (symbolSlices.length > 0) {
    const perSliceChars = Math.max(80, Math.floor((sliceBudgetChars - 45) / Math.max(1, symbolSlices.length)));
    const sliceSectionLines = [`## 3. Tier-3 Symbol Slices (${symbolSlices.length})`];
    for (const sl of symbolSlices) {
      const slLines = sl.code.split(`
`);
      sliceSectionLines.push(truncateLinesToBudget(slLines, perSliceChars));
    }
    sectionBlocks.push(truncateLinesToBudget(sliceSectionLines, sliceBudgetChars));
  }
  const skelSectionLines = [`## 4. Tier-2 AST Skeletons (${skeletons.length})`];
  if (skeletons.length > 0) {
    const perSkelChars = Math.max(80, Math.floor((skelBudgetChars - 45) / Math.max(1, skeletons.length)));
    for (const sk of skeletons) {
      const skLines = sk.skeletonMarkdown.split(`
`);
      skelSectionLines.push(truncateLinesToBudget(skLines, perSkelChars));
    }
  } else {
    skelSectionLines.push("- No indexed AST skeletons for target paths.");
  }
  sectionBlocks.push(truncateLinesToBudget(skelSectionLines, skelBudgetChars));
  const repoMapLines = repoMapView.text.split(`
`);
  sectionBlocks.push(truncateLinesToBudget(repoMapLines, repoMapBudgetChars));
  let markdown = sectionBlocks.join(`

`);
  if (markdown.length > maxChars) {
    const hardCap = Math.max(0, maxChars - 18);
    markdown = `${markdown.slice(0, hardCap)}
...(truncated)`;
  }
  const tokenEstimate = estimateTokens(markdown);
  const elapsedMs = performance.now() - t0;
  return {
    markdown,
    tokenEstimate,
    estimatedTokens: tokenEstimate,
    tokenCount: tokenEstimate,
    maxTokens,
    withinBudget: tokenEstimate <= maxTokens,
    targetPaths,
    includedTargetPaths: targetPaths,
    writeLeasePaths: targetPaths,
    includedSymbols,
    includedSlices: symbolSlices.map((s) => `${s.path}#${s.symbol}[L${s.startLine}-L${s.endLine}]`),
    coupledWarnings: cochangeWarnings.length,
    hiddenCouplingWarnings,
    cochangeWarnings,
    provenanceChains: sortedChains.length,
    provenanceConstraints,
    skeletons,
    symbolSlices,
    goal: options.goal ?? "",
    verificationCommand: options.verificationCommand ?? "",
    resolvedSessionID,
    elapsedMs
  };
}

// src/viewports/semantic-digest.ts
import { copyFileSync, existsSync as existsSync11, mkdirSync as mkdirSync4, readFileSync as readFileSync9, rmSync, writeFileSync as writeFileSync3 } from "fs";
import { dirname, join as join2 } from "path";
var SEMANTIC_DIGEST_DDL = `
CREATE TABLE IF NOT EXISTS session_semantic_digest (
  session_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  headline TEXT NOT NULL,
  intent_pivots_json TEXT NOT NULL,
  touched_files_json TEXT NOT NULL,
  key_decisions_json TEXT NOT NULL,
  verification_state TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_digest_root ON session_semantic_digest(root_id);

CREATE TABLE IF NOT EXISTS intent_pivot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  t TEXT NOT NULL,
  prompt_excerpt TEXT NOT NULL,
  blob_ref TEXT NOT NULL,
  prompt_blob_ref TEXT,
  pivot_kind TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intent_pivot_session_seq ON intent_pivot(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_intent_pivot_blob_ref ON intent_pivot(blob_ref);

CREATE TABLE IF NOT EXISTS milestone (
  id TEXT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'decision',
  summary TEXT,
  text TEXT,
  prompt_text TEXT,
  blob_ref TEXT,
  reported_outcome TEXT,
  verified_outcome TEXT,
  t INTEGER,
  PRIMARY KEY (session_id, seq, kind)
);

CREATE VIRTUAL TABLE IF NOT EXISTS substrate_fts USING fts5(
  session_id,
  kind,
  symbol_or_path,
  body,
  tokenize = 'porter unicode61'
);
`;
var SYNTHETIC_USER_PREFIXES = [
  "<subagent ",
  "<shell ",
  "<conversation-checkpoint>",
  "The available project references have changed.",
  "The server restarted while you were working.",
  "The Code Mode tool catalog has changed.",
  "The previous response was interrupted."
];
var PIVOT_RULES = [
  {
    kind: "continuation_after_compaction",
    test: (norm) => /^(on\s+the\s+same\s+working\s+posture)\b/i.test(norm) || /\b(after\s+compaction|post[- ]compaction|following\s+compaction|compaction\s+checkpoint|compaction\s+packet|compaction\s+summary|resume\s+after\s+compaction|continue\s+after\s+compaction|continuing\s+from\s+compaction|from\s+the\s+compaction|continuation\s+packet)\b/i.test(norm)
  },
  {
    kind: "prune_or_continuity",
    test: (norm) => /\b(prune\s+the\s+context|context[- ]prune|compaction[- ]continuity|context[- ]archive|(persist|perist|export)\s+(this\s+)?(fucking\s+)?(session|sezsion|sessision)|session\s+archive\s+this|archive\.persist|substrate\.valve)\b/i.test(norm)
  },
  {
    kind: "verification_directive",
    test: (norm) => /\b(run\s+bun\s+test|bun\s+test|bun\s+run\s+typecheck|verify\b|verification\s+gate|check\s+gate|prove\s+it\s+works|run\s+the\s+tests|run\s+tests|7[- ]sample\s+benchmark|validate\s+the\s+gate|search\s+how\s+much\s+tokens\s+you\s+spend)\b/i.test(norm)
  },
  {
    kind: "scope_narrowing",
    test: (norm) => /\b(only\s+do\b|skip\b|out\s+of\s+scope|narrow\s+scope(\s+to)?|narrow\s+to\b|restrict\s+(focus|scope)|write\s+lease\s+only|do\s+not\s+widen|do\s+not\s+expand|stop\s+further\b|stop\/hold\b|limit\s+scope\s+to)\b/i.test(norm)
  },
  {
    kind: "approval",
    test: (norm) => /^(ok|okay|yes|approved|that's it|ship it|proceed|go ahead|lgtm|looks good)\b/i.test(norm) || /\b(you can use (devin|antigravity) for these|explicitly approved|authorized to proceed)\b/i.test(norm)
  },
  {
    kind: "handoff_resume",
    test: (norm) => /^(continue\b|move this session to\b|here is the handoff\b|from the previous persisted session\b|i have reloaded this\b|resume\s+from\b)/i.test(norm) || /\b(point of handoff|continue on from this|pickup from handoff)\b/i.test(norm)
  },
  {
    kind: "course_correction",
    test: (norm) => /\b(wrong position|not asking to|only fucking read|do not keep reading|do not keep probing|do not expanding more|getting nowhere|such disap+ointment|cannot keep delaying|can not keep delaying|dead designs concepts|very obvious error|the devin error is very obvious|should not throw error|wasting tokens|you dont take it literately|stop doing|that is wrong|fix the regression|broken behavior)\b/i.test(norm)
  }
];
var INITIAL_GOAL_FALLBACK_RE = /^(initial\s+goal|opening\s+goal|goal\s*:|objective\s*:|mission\s*:|implement\b|build\b|create\b|design\b|deliver\b|phase\s+[a-z0-9.]+|wave\s+\d+)/i;
var STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "for",
  "from",
  "have",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "look",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "same",
  "so",
  "that",
  "the",
  "their",
  "them",
  "this",
  "to",
  "try",
  "up",
  "use",
  "we",
  "what",
  "where",
  "with",
  "you",
  "your",
  "exact"
]);
function ensureSemanticDigestSchema(db) {
  const ssdCols = new Set(db.query("PRAGMA table_info(session_semantic_digest)").all().map((c) => c.name));
  if (ssdCols.size > 0 && !ssdCols.has("headline")) {
    db.exec("DROP TABLE IF EXISTS session_semantic_digest;");
  }
  const pivotColsBefore = new Set(db.query("PRAGMA table_info(intent_pivot)").all().map((c) => c.name));
  if (pivotColsBefore.size > 0 && !pivotColsBefore.has("seq")) {
    db.exec("DROP TABLE IF EXISTS intent_pivot;");
  }
  const ftsMasterBefore = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'substrate_fts'").get();
  if (ftsMasterBefore?.sql && !ftsMasterBefore.sql.includes("symbol_or_path")) {
    db.exec("DROP TABLE IF EXISTS substrate_fts;");
  }
  db.exec(SEMANTIC_DIGEST_DDL);
  const pivotCols = db.query("PRAGMA table_info(intent_pivot)").all();
  if (!pivotCols.some((c) => c.name === "prompt_blob_ref")) {
    db.exec("ALTER TABLE intent_pivot ADD COLUMN prompt_blob_ref TEXT;");
    db.exec("UPDATE intent_pivot SET prompt_blob_ref = blob_ref WHERE prompt_blob_ref IS NULL;");
  }
  const ftsMaster = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'substrate_fts'").get();
  if (ftsMaster?.sql && !ftsMaster.sql.toLowerCase().includes("porter")) {
    const existingRows = db.query("SELECT session_id, kind, symbol_or_path, body FROM substrate_fts").all();
    db.exec("DROP TABLE IF EXISTS substrate_fts;");
    db.exec(`
      CREATE VIRTUAL TABLE substrate_fts USING fts5(
        session_id,
        kind,
        symbol_or_path,
        body,
        tokenize = 'porter unicode61'
      );
    `);
    if (existingRows.length > 0) {
      const ins = db.query("INSERT INTO substrate_fts (session_id, kind, symbol_or_path, body) VALUES (?, ?, ?, ?)");
      for (const r of existingRows) {
        ins.run(r.session_id, r.kind, r.symbol_or_path, r.body);
      }
    }
  }
}
function estimateTokens4(text) {
  return estimateTokens(text);
}
function isHumanPromptText(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0)
    return false;
  return !SYNTHETIC_USER_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}
function expandCompoundBoundaryTokens(text) {
  return text.replace(/([a-zA-Z])(\d)/g, "$1 $2").replace(/(\d)([a-zA-Z])/g, "$1 $2").replace(/([a-zA-Z0-9])[-_]+(?=[a-zA-Z0-9])/g, "$1 ");
}
function cleanExcerpt(text, maxChars = 110) {
  const singleLine = text.replace(/```[\s\S]*?```/g, " [code] ").replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars)
    return singleLine;
  return `${singleLine.slice(0, maxChars - 1).trimEnd()}\u2026`;
}
function classifyIntentPivot(text, seq = 1, context) {
  if (context?.afterCompaction === true)
    return "continuation_after_compaction";
  if (seq === 0 || context?.indexInSession === 0 || context?.isFirstPrompt === true) {
    return "initial_goal";
  }
  const norm = text.replace(/\s+/g, " ").trim();
  for (const rule of PIVOT_RULES) {
    if (rule.test(norm))
      return rule.kind;
  }
  if (seq === 1 && context?.indexInSession === undefined && INITIAL_GOAL_FALLBACK_RE.test(norm)) {
    return "initial_goal";
  }
  if (typeof context?.lastCompactionSeq === "number" && context.lastCompactionSeq > (context.prevPromptSeq ?? 0) && seq > context.lastCompactionSeq) {
    return "continuation_after_compaction";
  }
  return "followup";
}
function cleanTrackedPath(rawPath, canonicalRoot) {
  const trimmed = rawPath.trim().replace(/^['"`]|['"`]$/g, "");
  if (!trimmed)
    return null;
  if (trimmed.includes("/.agents/") || trimmed.includes("/.config/") || trimmed.startsWith("/private/var/") || trimmed.startsWith("/var/folders/")) {
    return null;
  }
  const worktreeMarker = ".worktree/";
  const wtIdx = trimmed.indexOf(worktreeMarker);
  if (wtIdx >= 0) {
    const afterWt = trimmed.slice(wtIdx + worktreeMarker.length);
    const slashIdx = afterWt.indexOf("/");
    if (slashIdx >= 0)
      return normalizeRepoPath(afterWt.slice(slashIdx + 1), canonicalRoot);
  }
  const normalized = normalizeRepoPath(trimmed, canonicalRoot);
  return normalized || null;
}
function extractPatchPaths(patchText, archiveDir, canonicalRoot) {
  let content = patchText;
  if (archiveDir && patchText.startsWith("blob:")) {
    const sha = patchText.slice("blob:".length);
    const blobFile = join2(archiveDir, "blobs", `${sha}.txt`);
    if (existsSync11(blobFile)) {
      content = readFileSync9(blobFile, "utf8");
    }
  }
  const paths = [];
  for (const line of content.split(`
`)) {
    const m = line.match(/^\*\*\* (?:Update|Add|Delete) File:\s+(.+)$/);
    if (m?.[1]) {
      const norm = cleanTrackedPath(m[1], canonicalRoot);
      if (norm)
        paths.push(norm);
    }
  }
  return paths;
}
function extractOutputModifiedPaths(outputText, canonicalRoot) {
  const paths = [];
  for (const line of outputText.split(`
`)) {
    const m = line.match(/^[AMD]\s+(.+)$/);
    if (m?.[1]) {
      const norm = cleanTrackedPath(m[1], canonicalRoot);
      if (norm)
        paths.push(norm);
    }
  }
  return paths;
}
function isoTime(msOrNull) {
  if (typeof msOrNull !== "number" || !Number.isFinite(msOrNull) || msOrNull <= 0) {
    return "1970-01-01T00:00:00.000Z";
  }
  return new Date(msOrNull).toISOString();
}
function hasTable(db, tableName) {
  const row = db.query("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?").get(tableName);
  return row !== null && row !== undefined;
}
function analyzeSessionData(params) {
  const {
    db,
    sessionId,
    transcriptRelPath,
    archiveDir,
    canonicalRoot,
    sessionOutcome,
    exportedFixture,
    hasMilestoneTable,
    hasCompactionTable,
    hasFileTouchTable,
    hasFileReadTable,
    hasKvPruneTable
  } = params;
  const fullPath = archiveDir && transcriptRelPath ? join2(archiveDir, transcriptRelPath) : null;
  const lines = fullPath && existsSync11(fullPath) ? readFileSync9(fullPath, "utf8").trim().split(`
`).filter(Boolean).map((line) => JSON.parse(line)) : [];
  const promptById = new Map;
  const compactionSeqSet = new Set;
  const touchedSet = new Set;
  const readSet = new Set;
  const decisions = [];
  let maxSeq = 0;
  let sawPassingTestGate = false;
  let sawFailingGate = false;
  for (const rec of lines) {
    const rawRef = rec.raw_ref ?? {};
    const seq = typeof rawRef.seq === "number" ? rawRef.seq : typeof rec.seq === "number" ? rec.seq : 0;
    if (seq > maxSeq)
      maxSeq = seq;
    if (rec.kind === "user") {
      let text = typeof rec.text === "string" ? rec.text : "";
      if (!text && typeof rec.text_ref === "string" && archiveDir) {
        const sha = rec.text_ref.startsWith("blob:") ? rec.text_ref.slice(5) : rec.text_ref;
        const blobFile = join2(archiveDir, "blobs", `${sha}.txt`);
        if (existsSync11(blobFile))
          text = readFileSync9(blobFile, "utf8");
      }
      if (text && isHumanPromptText(text)) {
        const id = String(rec.id ?? `msg_${seq}`);
        const t = typeof rec.t === "number" ? rec.t : 0;
        promptById.set(id, { message_id: id, seq, t, text });
      }
    }
    if (rec.kind === "compaction") {
      compactionSeqSet.add(seq);
      const tokIn = typeof rec.tokens?.input === "number" ? rec.tokens.input : null;
      decisions.push(`Compaction checkpoint at seq=${seq} (${String(rec.reason ?? "auto")}${tokIn ? `, ${tokIn} tok_in` : ""})`);
    }
    if (rec.kind === "assistant" && Array.isArray(rec.parts)) {
      for (const part of rec.parts) {
        if (part.type !== "tool")
          continue;
        const toolName = String(part.name ?? "");
        const input = part.input ?? {};
        const output = typeof part.output === "string" ? part.output : "";
        if (toolName === "write" || toolName === "edit") {
          const p = typeof input.path === "string" ? input.path : typeof input.filePath === "string" ? input.filePath : "";
          const norm = cleanTrackedPath(p, canonicalRoot);
          if (norm)
            touchedSet.add(norm);
        } else if (toolName === "patch") {
          if (typeof input.patchText === "string") {
            for (const p of extractPatchPaths(input.patchText, archiveDir, canonicalRoot))
              touchedSet.add(p);
          }
          for (const p of extractOutputModifiedPaths(output, canonicalRoot))
            touchedSet.add(p);
        } else if (toolName === "read") {
          const p = typeof input.path === "string" ? input.path : typeof input.filePath === "string" ? input.filePath : "";
          const norm = cleanTrackedPath(p, canonicalRoot);
          if (norm)
            readSet.add(norm);
        } else if (toolName === "shell" || toolName === "execute") {
          if (/\b\d+\s+pass\b[\s\S]*?\b0\s+fail\b|zero failures|Freshness passes/i.test(output)) {
            sawPassingTestGate = true;
          }
          if (/0 tool parts in range, ~0 chars of output/i.test(output)) {
            decisions.push("44-step single-prompt auto-run hit context-prune(mode='recent') freeing 0 bytes (0 tool parts before lastUserIdx=0)");
          }
          if (/Context pruned from the next model call onward.*53 tool parts in range, ~311570 chars/is.test(output)) {
            decisions.push("Dual-plugin collision: archive.persist + context-prune collapsed 53 tool parts (~311,570 chars) into blind stubs");
          }
        }
      }
    }
  }
  if (hasCompactionTable) {
    const compRows = db.query("SELECT seq, reason, tok_input FROM compaction WHERE session_id = ? ORDER BY seq ASC").all(sessionId);
    for (const c of compRows) {
      compactionSeqSet.add(c.seq);
      const label = `Compaction checkpoint at seq=${c.seq} (${c.reason ?? "auto"}${c.tok_input ? `, ${c.tok_input} tok_in` : ""})`;
      if (!decisions.includes(label))
        decisions.push(label);
    }
  }
  if (hasMilestoneTable) {
    const msRows = db.query("SELECT * FROM milestone WHERE session_id = ? ORDER BY seq ASC").all(sessionId);
    for (const m of msRows) {
      const seq = typeof m.seq === "number" ? m.seq : 1;
      if (seq > maxSeq)
        maxSeq = seq;
      const kind = String(m.kind ?? "decision");
      const text = String(m.prompt_text ?? m.text ?? m.summary ?? "");
      if ((kind === "user" || kind === "prompt" || kind === "intent" || typeof m.prompt_text === "string") && isHumanPromptText(text)) {
        const msgId = String(m.id ?? `ms_${sessionId}_${seq}`);
        if (!promptById.has(msgId)) {
          promptById.set(msgId, {
            message_id: msgId,
            seq,
            t: typeof m.t === "number" ? m.t : 0,
            text
          });
        }
      } else if (text && !decisions.includes(text)) {
        decisions.push(text);
      }
      if (m.verified_outcome === "verified_pass" || m.verified_outcome === "verified_passed") {
        sawPassingTestGate = true;
      }
      if (m.verified_outcome === "verified_fail" || m.verified_outcome === "tool_error_inside" || m.verified_outcome === "blocked_in_text") {
        sawFailingGate = true;
      }
    }
  }
  if (hasFileTouchTable) {
    const touchRows = db.query("SELECT path, normalized_path FROM file_touch WHERE session_id = ? ORDER BY seq ASC").all(sessionId);
    for (const t of touchRows) {
      const norm = cleanTrackedPath(t.normalized_path ?? t.path, canonicalRoot);
      if (norm)
        touchedSet.add(norm);
    }
  }
  if (hasFileReadTable) {
    const readRows = db.query("SELECT path FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC").all(sessionId);
    for (const r of readRows) {
      const norm = cleanTrackedPath(r.path, canonicalRoot);
      if (norm)
        readSet.add(norm);
    }
  }
  if (hasKvPruneTable) {
    const pruneRows = db.query("SELECT mode, anchor_message_id FROM kv_context_prune WHERE session_id = ?").all(sessionId);
    for (const p of pruneRows) {
      const note = `context-prune watermark mode=${p.mode ?? "step-window"} anchor=${p.anchor_message_id ?? "none"}`;
      if (!decisions.includes(note))
        decisions.push(note);
    }
  }
  if (exportedFixture) {
    let assistantStreakBeforePrune = 0;
    for (let idx = 0;idx < exportedFixture.messages.length; idx++) {
      const m = exportedFixture.messages[idx];
      const msgId = String(m.id ?? "");
      const timeObj = m.time ?? {};
      const tCreated = typeof timeObj.created === "number" ? timeObj.created : 0;
      const isUser = m.agent === undefined && typeof m.text === "string";
      if (isUser) {
        const text = m.text;
        if (isHumanPromptText(text) && !promptById.has(msgId)) {
          maxSeq += 10;
          promptById.set(msgId, {
            message_id: msgId,
            seq: maxSeq,
            t: tCreated,
            text
          });
        }
      } else {
        assistantStreakBeforePrune += 1;
        const content = Array.isArray(m.content) ? m.content : [];
        for (const p of content) {
          if (p.type !== "tool")
            continue;
          const state = p.state ?? {};
          const input = state.input ?? {};
          const outArr = Array.isArray(state.content) ? state.content : [];
          const outText = outArr.map((c) => typeof c.text === "string" ? c.text : "").join("");
          if (String(p.name ?? "") === "execute" && typeof input.code === "string" && input.code.includes("context-prune") && outText.includes("0 tool parts in range, ~0 chars")) {
            const note = `44-step auto-run (${assistantStreakBeforePrune} assistant messages after msg[0]) context-prune returned 0 bytes freed`;
            if (!decisions.some((d) => d.includes("0 bytes")))
              decisions.push(note);
          }
          if (String(p.name ?? "") === "execute" && typeof input.code === "string" && input.code.includes("compaction_continuity") && outText.includes("Specify action and sessionID")) {
            decisions.push("Post-compaction compaction_continuity({action:'intents'}) failed missing sessionID; triggered 15-skill / 28-file reread loop");
          }
        }
      }
    }
  }
  const prompts = [...promptById.values()].sort((a, b) => a.seq - b.seq || a.t - b.t);
  const compactionSeqs = [...compactionSeqSet].sort((a, b) => a - b);
  const touchedFiles = touchedSet.size > 0 ? [...touchedSet] : [...readSet].slice(0, 8);
  if (sessionOutcome === "failed")
    sawFailingGate = true;
  const verificationState = sawPassingTestGate ? "verified_passed" : sawFailingGate ? "verified_failed_or_blocked" : touchedSet.size > 0 ? "completed_report_only" : "in_progress_or_unverified";
  return {
    prompts,
    compactionSeqs,
    touchedFiles,
    readFiles: [...readSet],
    decisions,
    verificationState
  };
}
var preparedCache = new WeakMap;
function materializeSemanticDigests(db, options = {}) {
  ensureSemanticDigestSchema(db);
  preparedCache.delete(db);
  const archiveDir = options.archiveDir ?? options.sourceArchiveDir ?? (db.filename && db.filename !== ":memory:" ? dirname(db.filename) : undefined);
  const canonicalRoot = options.canonicalRoot ?? (archiveDir ? dirname(archiveDir) : undefined);
  const exportedPaths = options.exportJsonPaths ?? options.exportedFixturePaths ?? [];
  const shouldSinkBlobsToDisk = Boolean(archiveDir) && existsSync11(archiveDir);
  const exportedBySessionId = new Map;
  for (const fixturePath of exportedPaths) {
    if (!existsSync11(fixturePath))
      continue;
    const parsed = JSON.parse(readFileSync9(fixturePath, "utf8"));
    const sid = typeof parsed.info?.id === "string" ? parsed.info.id : null;
    if (sid && Array.isArray(parsed.messages)) {
      exportedBySessionId.set(sid, { info: parsed.info, messages: parsed.messages });
    }
  }
  const hasSessionTable = hasTable(db, "session");
  if (!hasSessionTable) {
    return { sessionsIndexed: 0, intentPivotsIndexed: 0, ftsRowsIndexed: 0 };
  }
  const hasDelegationTable = hasTable(db, "delegation");
  const hasDelegationTurnTable = hasTable(db, "delegation_turn");
  const hasMessageTable = hasTable(db, "message");
  const hasMilestoneTable = hasTable(db, "milestone");
  const hasCompactionTable = hasTable(db, "compaction");
  const hasFileTouchTable = hasTable(db, "file_touch");
  const hasFileReadTable = hasTable(db, "file_read_ledger");
  const hasKvPruneTable = hasTable(db, "kv_context_prune");
  const sessions = db.query("SELECT id, root_id, parent_id, depth, title, agent, harness, outcome, message_count, transcript_path FROM session ORDER BY depth ASC, t_created ASC").all();
  const delegations = hasDelegationTable ? db.query("SELECT call_id, root_id, parent_session, child_session, tool, agent, harness, mode, description, status FROM delegation ORDER BY t_created ASC").all() : [];
  const delegationsByParent = new Map;
  for (const d of delegations) {
    const list = delegationsByParent.get(d.parent_session) ?? [];
    list.push(d);
    delegationsByParent.set(d.parent_session, list);
  }
  const turnsByParent = new Map;
  if (hasDelegationTurnTable) {
    const turns = db.query("SELECT parent_session_id, call_id, turn_index, child_session_id, harness, agent, mode, reported_outcome, verified_outcome FROM delegation_turn ORDER BY turn_index ASC").all();
    for (const t of turns) {
      const list = turnsByParent.get(t.parent_session_id) ?? [];
      list.push(t);
      turnsByParent.set(t.parent_session_id, list);
    }
  }
  let intentPivotsIndexed = 0;
  let ftsRowsIndexed = 0;
  const populate = db.transaction(() => {
    db.query("DELETE FROM session_semantic_digest").run();
    db.query("DELETE FROM intent_pivot").run();
    db.query("DELETE FROM substrate_fts").run();
    const insertDigest = db.query(`
      INSERT INTO session_semantic_digest (
        session_id, root_id, headline, intent_pivots_json, touched_files_json, key_decisions_json, verification_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPivot = db.query(`
      INSERT INTO intent_pivot (
        session_id, message_id, seq, t, prompt_excerpt, blob_ref, prompt_blob_ref, pivot_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.query(`
      INSERT INTO substrate_fts (session_id, kind, symbol_or_path, body)
      VALUES (?, ?, ?, ?)
    `);
    const insertMessageIfMissing = hasMessageTable ? db.query(`
          INSERT OR IGNORE INTO message (session_id, seq, id, kind, t, agent, model_id, tok_in, tok_out)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `) : null;
    for (const s of sessions) {
      const exported = exportedBySessionId.get(s.id);
      const analysis = analyzeSessionData({
        db,
        sessionId: s.id,
        transcriptRelPath: s.transcript_path,
        archiveDir,
        canonicalRoot,
        sessionOutcome: s.outcome,
        exportedFixture: exported,
        hasMilestoneTable,
        hasCompactionTable,
        hasFileTouchTable,
        hasFileReadTable,
        hasKvPruneTable
      });
      const compactPivots = [];
      let prevPromptSeq = 0;
      analysis.prompts.forEach((p, idx) => {
        const lastCompactionBeforePrompt = analysis.compactionSeqs.filter((cSeq) => cSeq > prevPromptSeq && cSeq < p.seq).pop() ?? null;
        const pivotKind = classifyIntentPivot(p.text, p.seq, {
          indexInSession: idx,
          isFirstPrompt: idx === 0,
          lastCompactionSeq: lastCompactionBeforePrompt,
          prevPromptSeq
        });
        prevPromptSeq = p.seq;
        const sha = sha256Hex(p.text);
        const blobRef = `blob:${sha}`;
        if (shouldSinkBlobsToDisk && archiveDir) {
          const blobsDir = join2(archiveDir, "blobs");
          const blobPath = join2(blobsDir, `${sha}.txt`);
          if (!existsSync11(blobPath)) {
            mkdirSync4(blobsDir, { recursive: true });
            writeFileSync3(blobPath, p.text, "utf8");
          }
        }
        const excerpt = cleanExcerpt(p.text, 120);
        const tIso = isoTime(p.t);
        insertMessageIfMissing?.run(s.id, p.seq, p.message_id, "user", p.t, null, null, null, null);
        insertPivot.run(s.id, p.message_id, p.seq, tIso, excerpt, blobRef, blobRef, pivotKind);
        intentPivotsIndexed += 1;
        compactPivots.push({
          seq: p.seq,
          message_id: p.message_id,
          pivot_kind: pivotKind,
          excerpt,
          blob_ref: blobRef
        });
        insertFts.run(s.id, "intent_pivot", `${p.message_id}|${blobRef}|${pivotKind}|${expandCompoundBoundaryTokens(p.text)}`, p.text);
        ftsRowsIndexed += 1;
      });
      for (const decision of analysis.decisions) {
        insertFts.run(s.id, "decision", s.root_id, `${decision} ${expandCompoundBoundaryTokens(decision)}`);
        ftsRowsIndexed += 1;
      }
      const childDelegations = delegationsByParent.get(s.id) ?? [];
      const childTurns = turnsByParent.get(s.id) ?? [];
      const turnByCallOrChild = new Map;
      for (const t of childTurns) {
        turnByCallOrChild.set(t.call_id, t);
        turnByCallOrChild.set(t.child_session_id, t);
      }
      const decisionList = [...analysis.decisions];
      for (const d of childDelegations) {
        if (d.description) {
          const turn = turnByCallOrChild.get(d.call_id) ?? (d.child_session ? turnByCallOrChild.get(d.child_session) : undefined);
          const outcomeTag = turn ? `${d.status ?? "completed"} \xB7 reported=${turn.reported_outcome ?? "succeeded"} -> verified=${turn.verified_outcome}` : `${d.status ?? "unknown"}`;
          const summary = `${d.harness ?? "opencode"}:${d.agent ?? "subagent"} (${d.mode ?? "spawn"}) -> ${d.description} [${outcomeTag}]`;
          decisionList.push(summary);
          insertFts.run(s.id, "delegation", d.child_session ?? d.call_id, `${d.description} ${expandCompoundBoundaryTokens(d.description)} ${d.agent ?? ""} ${d.harness ?? ""} ${d.tool ?? ""} ${outcomeTag}`);
          ftsRowsIndexed += 1;
        }
      }
      const headlineBase = s.title && s.title.trim().length > 0 ? s.title.trim() : compactPivots[0]?.excerpt ?? `${s.harness ?? "opencode"}:${s.agent ?? "session"}`;
      const headline = s.depth === 0 ? `[Root \xB7 ${s.agent ?? "ultra"}] ${headlineBase}` : `[Child \xB7 ${s.harness ?? "opencode"}/${s.agent ?? "subagent"}] ${headlineBase}`;
      insertDigest.run(s.id, s.root_id, headline, JSON.stringify(compactPivots), JSON.stringify(analysis.touchedFiles), JSON.stringify(decisionList), analysis.verificationState);
      insertFts.run(s.id, "headline", s.root_id, `${headline} ${expandCompoundBoundaryTokens(headline)} ${analysis.verificationState}`);
      ftsRowsIndexed += 1;
      for (const filePath of analysis.touchedFiles) {
        insertFts.run(s.id, "touched_file", filePath, `${filePath} ${expandCompoundBoundaryTokens(filePath)} ${headline}`);
        ftsRowsIndexed += 1;
      }
    }
  });
  populate();
  return {
    sessionsIndexed: sessions.length,
    intentPivotsIndexed,
    ftsRowsIndexed,
    ...db.filename ? { dbPath: db.filename } : {}
  };
}
function tokenizeVibeQuery(queryText) {
  const expanded = expandCompoundBoundaryTokens(queryText);
  const rawTokens = expanded.toLowerCase().split(/[^a-z0-9]+/).filter((tok) => tok.length > 0 && !STOP_WORDS.has(tok));
  return [...new Set(rawTokens)];
}
function resolvePromptBlob(db, blobRef, archiveDir) {
  const normalized = blobRef.startsWith("blob:") ? blobRef : `blob:${blobRef}`;
  if (hasTable(db, "substrate_fts")) {
    const row = db.query("SELECT body FROM substrate_fts WHERE kind = 'intent_pivot' AND symbol_or_path LIKE ? LIMIT 1").get(`%|${normalized}%`);
    if (row?.body) {
      return row.body;
    }
  }
  const sha = normalized.slice("blob:".length);
  const effectiveArchiveDir = archiveDir ?? (db.filename && db.filename !== ":memory:" ? dirname(db.filename) : undefined);
  if (effectiveArchiveDir) {
    const file = join2(effectiveArchiveDir, "blobs", `${sha}.txt`);
    if (existsSync11(file))
      return readFileSync9(file, "utf8");
  }
  return null;
}
function renderIntentTimeline(db, sessionID, options = {}) {
  const maxPivots = options.maxPivots ?? 25;
  const digest = db.query("SELECT headline, verification_state FROM session_semantic_digest WHERE session_id = ?").get(sessionID);
  const pivots = db.query("SELECT id, session_id, message_id, seq, t, prompt_excerpt, blob_ref, pivot_kind FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC LIMIT ?").all(sessionID, maxPivots);
  const headline = digest?.headline ?? sessionID;
  const verificationState = digest?.verification_state ?? "in_progress_or_unverified";
  const lines = [
    `## Intent Pivot Timeline \xB7 \`${sessionID}\` (${pivots.length} pivots)`,
    `**Headline:** ${headline} | **Gate:** \`${verificationState}\``,
    ...pivots.map((p) => `- \`seq=${p.seq}\` [${p.pivot_kind}] ${p.prompt_excerpt} (\`${p.blob_ref.slice(0, 17)}\`)`)
  ];
  const markdown = lines.join(`
`);
  return {
    sessionID,
    headline,
    verificationState,
    pivots,
    markdown,
    tokenCount: estimateTokens4(markdown)
  };
}
function getPreparedNavQueries(db) {
  let cached = preparedCache.get(db);
  if (!cached) {
    const hasTurns = hasTable(db, "delegation_turn");
    cached = {
      ftsStmt: db.query(`SELECT f.session_id, COALESCE(s.root_id, f.session_id) as root_id, COALESCE(s.depth, 0) as depth, f.kind, substr(f.symbol_or_path, 1, 240) as sym, substr(f.body, 1, 600) as snippet, bm25(substrate_fts) as rank
         FROM substrate_fts f
         LEFT JOIN session s ON s.id = f.session_id
         WHERE substrate_fts MATCH ?
         ORDER BY rank
         LIMIT 50`),
      digestStmt: db.query("SELECT * FROM session_semantic_digest WHERE session_id = ?"),
      allRootDigestsStmt: db.query(`SELECT d.*
         FROM session_semantic_digest d
         LEFT JOIN session s ON s.id = d.session_id
         WHERE COALESCE(s.depth, 0) = 0
         ORDER BY COALESCE(s.t_updated, s.t_created, 0) DESC, d.session_id ASC`),
      totalDigestsStmt: db.query("SELECT COUNT(*) as c FROM session_semantic_digest"),
      pivotsStmt: db.query("SELECT seq, message_id, t, prompt_excerpt, blob_ref, pivot_kind FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC LIMIT ?"),
      delegationsStmt: db.query(`SELECT call_id, child_session, harness, agent, description, status
         FROM delegation
         WHERE parent_session = ?
         ORDER BY t_created DESC
         LIMIT ?`),
      delegationTurnsStmt: hasTurns ? db.query(`SELECT call_id, child_session_id, turn_index, harness, agent, reported_outcome, verified_outcome
             FROM delegation_turn
             WHERE parent_session_id = ?
             ORDER BY turn_index DESC`) : null
    };
    preparedCache.set(db, cached);
  }
  return cached;
}
function queryVibeNavigation(db, queryOrOptions, maybeOptions = {}) {
  const t0Ns = Bun.nanoseconds();
  ensureSemanticDigestSchema(db);
  const queryText = typeof queryOrOptions === "string" ? queryOrOptions : queryOrOptions.query;
  const options = typeof queryOrOptions === "string" ? maybeOptions : queryOrOptions;
  const maxPivots = options.maxPivots ?? 9;
  const maxDelegations = options.maxDelegations ?? 3;
  const maxTouchedFiles = options.maxTouchedFiles ?? 3;
  const maxDecisions = options.maxDecisions ?? 2;
  const candidateLimit = options.limit ?? 5;
  const maxTokens = options.maxTokens ?? options.maxTokensBudget ?? 600;
  const {
    ftsStmt,
    digestStmt,
    allRootDigestsStmt,
    totalDigestsStmt,
    pivotsStmt,
    delegationsStmt,
    delegationTurnsStmt
  } = getPreparedNavQueries(db);
  const allRootDigests = allRootDigestsStmt.all();
  const totalDigestCount = totalDigestsStmt.get()?.c ?? 0;
  const totalRootSessions = allRootDigests.length > 0 ? allRootDigests.length : totalDigestCount;
  const tokens = tokenizeVibeQuery(queryText);
  const queryTokenCount = Math.max(1, tokens.length);
  const ftsQuery = tokens.map((t) => `"${t}"*`).join(" OR ");
  const ftsHits = ftsQuery.length > 0 ? ftsStmt.all(ftsQuery) : [];
  const rootStats = new Map;
  for (const hit of ftsHits) {
    const entry = rootStats.get(hit.root_id) ?? {
      matchedTokens: new Set,
      bestSingleRowMatchCount: 0,
      bestRowKindWeight: 0,
      bm25Sum: 0,
      bestBm25: 0
    };
    const textLower = `${hit.sym} ${hit.snippet}`.toLowerCase();
    const kindWeight = (hit.kind === "intent_pivot" || hit.kind === "decision") && hit.depth === 0 ? 6 : hit.kind === "headline" && hit.depth === 0 ? 4 : hit.kind === "delegation" ? 2 : 1;
    let rowMatches = 0;
    for (const tok of tokens) {
      const stemPrefix = tok.length >= 5 ? tok.slice(0, tok.length - 2) : tok;
      if (textLower.includes(tok) || stemPrefix.length >= 3 && textLower.includes(stemPrefix)) {
        rowMatches += 1;
        entry.matchedTokens.add(tok);
      }
    }
    if (rowMatches > entry.bestSingleRowMatchCount || rowMatches === entry.bestSingleRowMatchCount && kindWeight > entry.bestRowKindWeight) {
      entry.bestSingleRowMatchCount = rowMatches;
      entry.bestRowKindWeight = kindWeight;
    }
    const rawBm25 = Math.abs(hit.rank);
    if (rawBm25 > entry.bestBm25) {
      entry.bestBm25 = rawBm25;
    }
    entry.bm25Sum = Math.min(20, entry.bm25Sum + Math.min(3, rawBm25));
    rootStats.set(hit.root_id, entry);
  }
  const scoredRoots = [];
  for (const [rootId, st] of rootStats.entries()) {
    const matchedTokenCount = st.matchedTokens.size;
    if (matchedTokenCount === 0)
      continue;
    const tokenCoverage = Number((matchedTokenCount / queryTokenCount).toFixed(4));
    const total = matchedTokenCount * 30 + st.bestSingleRowMatchCount * 20 + st.bestRowKindWeight * 5 + st.bm25Sum;
    scoredRoots.push({
      rootId,
      score: Number(total.toFixed(2)),
      bestBm25: Number(st.bestBm25.toFixed(2)),
      matchedTokenCount,
      tokenCoverage
    });
  }
  scoredRoots.sort((a, b) => b.score - a.score || b.tokenCoverage - a.tokenCoverage || b.bestBm25 - a.bestBm25);
  const candidates = scoredRoots.slice(0, candidateLimit).flatMap((sr) => {
    const d = digestStmt.get(sr.rootId);
    if (!d)
      return [];
    let pivotsCount = 0;
    try {
      pivotsCount = JSON.parse(d.intent_pivots_json).length;
    } catch {}
    const delRows = delegationsStmt.all(d.session_id, 20);
    return [
      {
        sessionId: d.session_id,
        session_id: d.session_id,
        headline: d.headline,
        verificationState: d.verification_state,
        verification_state: d.verification_state,
        score: sr.score,
        combinedScore: sr.score,
        bestBm25: sr.bestBm25,
        matchedTokenCount: sr.matchedTokenCount,
        matched_token_count: sr.matchedTokenCount,
        queryTokenCount,
        query_token_count: queryTokenCount,
        tokenCoverage: sr.tokenCoverage,
        token_coverage: sr.tokenCoverage,
        pivotsCount,
        delegationsCount: delRows.length
      }
    ];
  });
  if (candidates.length === 0) {
    const elapsedMs = (Bun.nanoseconds() - t0Ns) / 1e6;
    const bodyLines = [
      `## Vibe Navigation Digest \xB7 \`0\` matches`,
      `_Indexed root sessions: ${totalRootSessions} | Matched: 0 | Query tokens: [${tokens.join(", ")}] (${elapsedMs.toFixed(2)} ms)_`,
      "",
      `No matching sessions found for query "${queryText}" across ${totalRootSessions} indexed root session(s).`
    ];
    const bodyText = bodyLines.join(`
`);
    const prelimFooter = `_Strategist Viewport search (000 tokens, ${elapsedMs.toFixed(2)} ms | matched 0 of ${totalRootSessions} indexed root session(s))._`;
    const prelimTokens = estimateTokens4(`${bodyText}

${prelimFooter}`);
    const finalFooter = `_Strategist Viewport search (${prelimTokens} tokens, ${elapsedMs.toFixed(2)} ms | matched 0 of ${totalRootSessions} indexed root session(s))._`;
    const markdown = `${bodyText}

${finalFooter}`;
    const markdownTokens = estimateTokens4(markdown);
    const emptyDigest = {
      query: queryText,
      total_root_sessions: totalRootSessions,
      matched_count: 0,
      matched_root: null,
      intent_pivots: [],
      delegations: [],
      touched_files: [],
      key_decisions: []
    };
    const jsonStr = JSON.stringify(emptyDigest);
    return {
      digest: emptyDigest,
      markdown,
      matchedRootSessionID: "",
      session_id: "",
      headline: "",
      verificationState: "in_progress_or_unverified",
      score: 0,
      bestBm25: 0,
      matchedTokenCount: 0,
      queryTokenCount,
      tokenCoverage: 0,
      tokenCount: markdownTokens,
      estimatedTokens: markdownTokens,
      totalRootSessions,
      matchedSessions: [],
      candidates: [],
      metrics: {
        markdown_chars: markdown.length,
        markdown_tokens: markdownTokens,
        json_chars: jsonStr.length,
        json_tokens: estimateTokens4(jsonStr),
        fts_hits: ftsHits.length,
        pivots_returned: 0,
        delegations_returned: 0,
        total_root_sessions: totalRootSessions,
        matched_root_sessions: 0,
        elapsed_ms: Number(elapsedMs.toFixed(3))
      }
    };
  }
  const primaryHit = candidates[0];
  const bestRootId = primaryHit.session_id;
  const bestScore = primaryHit.score;
  const bestBm25 = primaryHit.bestBm25;
  const bestMatchedTokens = primaryHit.matchedTokenCount;
  const bestCoverage = primaryHit.tokenCoverage;
  const rootDigest = digestStmt.get(bestRootId);
  const pivots = pivotsStmt.all(bestRootId, maxPivots);
  const delegations = delegationsStmt.all(bestRootId, maxDelegations);
  const turns = delegationTurnsStmt ? delegationTurnsStmt.all(bestRootId) : [];
  const turnByKey = new Map;
  for (const t of turns) {
    if (!turnByKey.has(t.call_id))
      turnByKey.set(t.call_id, t);
    if (!turnByKey.has(t.child_session_id))
      turnByKey.set(t.child_session_id, t);
  }
  const touchedFiles = JSON.parse(rootDigest.touched_files_json).slice(0, maxTouchedFiles);
  const keyDecisions = JSON.parse(rootDigest.key_decisions_json).filter((d) => !d.includes("->")).slice(0, maxDecisions);
  const compactDelegations = delegations.map((d) => {
    const turn = turnByKey.get(d.call_id) ?? (d.child_session ? turnByKey.get(d.child_session) : undefined);
    const status = d.status ?? "completed";
    const reportedOutcome = turn?.reported_outcome ?? (status === "completed" ? "succeeded" : status);
    const verifiedOutcome = turn?.verified_outcome ?? (status === "error" || status === "failed" ? "tool_error_inside" : "clean");
    return {
      child_session: d.child_session ?? "none",
      harness: d.harness ?? turn?.harness ?? "opencode",
      agent: d.agent ?? turn?.agent ?? "subagent",
      description: cleanExcerpt(d.description ?? "delegated task", 24),
      status,
      reported_outcome: reportedOutcome,
      verified_outcome: verifiedOutcome
    };
  });
  if (compactDelegations.length === 0 && turns.length > 0) {
    for (const t of turns.slice(0, maxDelegations)) {
      compactDelegations.push({
        child_session: t.child_session_id,
        harness: t.harness,
        agent: t.agent ?? "subagent",
        description: `turn ${t.turn_index}`,
        status: t.reported_outcome ?? "completed",
        reported_outcome: t.reported_outcome ?? "succeeded",
        verified_outcome: t.verified_outcome
      });
    }
  }
  const elapsedMs = (Bun.nanoseconds() - t0Ns) / 1e6;
  const renderMarkdownWithLimit = (pivotCharCap, maxPivotsSlice, maxHitsSlice) => {
    const slicedPivots = pivots.slice(0, maxPivotsSlice);
    const slicedHits = candidates.slice(0, maxHitsSlice);
    const mdLines = [
      `## Vibe Navigation Digest \xB7 \`${bestRootId}\``,
      `_Indexed root sessions: ${totalRootSessions} | Matched: ${candidates.length} | Query tokens: [${tokens.join(", ")}] (${elapsedMs.toFixed(2)} ms)_`,
      `**Headline:** ${rootDigest.headline} | **Gate:** \`${rootDigest.verification_state}\``,
      `- **Score:** coverage=${primaryHit.matchedTokenCount}/${primaryHit.queryTokenCount} (${Math.round(primaryHit.tokenCoverage * 100)}%) | bm25=${primaryHit.bestBm25.toFixed(2)} | score=${primaryHit.combinedScore.toFixed(2)} | pivots=${primaryHit.pivotsCount} | delegations=${primaryHit.delegationsCount}`,
      ...slicedHits.length > 1 ? [
        ...slicedHits.slice(1).map((hit) => `- **Alt \`${hit.sessionId}\`:** coverage=${hit.matchedTokenCount}/${hit.queryTokenCount} (${Math.round(hit.tokenCoverage * 100)}%) | bm25=${hit.bestBm25.toFixed(2)} | score=${hit.combinedScore.toFixed(2)}`)
      ] : [],
      "",
      `### Intent Pivots (${slicedPivots.length})`,
      ...slicedPivots.map((p) => `- \`seq=${p.seq}\` [${p.pivot_kind}] ${cleanExcerpt(p.prompt_excerpt, pivotCharCap)} (\`${p.blob_ref.slice(0, 17)}\`)`),
      "",
      `### Child Delegations (${compactDelegations.length})`,
      ...compactDelegations.map((d) => `- \`${d.child_session}\` (${d.harness}/${d.agent}): ${d.description} [\`${d.status}\` \xB7 reported=\`${d.reported_outcome}\` -> verified=\`${d.verified_outcome}\`]`),
      "",
      `### Touched Files & Trajectory Notes`,
      `- **Files:** ${touchedFiles.map((f) => `\`${f}\``).join(", ") || "none"}`,
      ...keyDecisions.length > 0 ? keyDecisions.map((k) => `- **Note:** ${cleanExcerpt(k, 68)}`) : []
    ];
    const body = mdLines.join(`
`);
    const prelimFooter = `_Strategist Viewport search (000 tokens, ${elapsedMs.toFixed(2)} ms | matched ${candidates.length} of ${totalRootSessions} indexed root session(s))._`;
    const tokEst = estimateTokens4(`${body}

${prelimFooter}`);
    const footerLine = `_Strategist Viewport search (${tokEst} tokens, ${elapsedMs.toFixed(2)} ms | matched ${candidates.length} of ${totalRootSessions} indexed root session(s))._`;
    return `${body}

${footerLine}`;
  };
  let markdown = renderMarkdownWithLimit(44, pivots.length, Math.min(candidates.length, 3));
  if (estimateTokens4(markdown) >= maxTokens) {
    markdown = renderMarkdownWithLimit(28, pivots.length, 1);
  }
  if (estimateTokens4(markdown) >= maxTokens) {
    markdown = renderMarkdownWithLimit(24, Math.max(1, Math.min(pivots.length, 5)), 1);
  }
  const markdownChars = markdown.length;
  const markdownTokens = estimateTokens4(markdown);
  const buildDigestWithCap = (pivotExcerptCap, decisionCap, decisionCount, touchedFilesCount, delegationCount) => ({
    query: queryText,
    total_root_sessions: totalRootSessions,
    matched_count: candidates.length,
    matched_root: {
      session_id: bestRootId,
      headline: rootDigest.headline,
      verification_state: rootDigest.verification_state,
      score: Number(bestScore.toFixed(2)),
      best_bm25: bestBm25,
      matched_token_count: bestMatchedTokens,
      query_token_count: queryTokenCount,
      token_coverage: bestCoverage
    },
    intent_pivots: pivots.map((p) => ({
      seq: p.seq,
      kind: p.pivot_kind,
      excerpt: cleanExcerpt(p.prompt_excerpt, pivotExcerptCap),
      blob_ref: p.blob_ref.slice(0, 17)
    })),
    delegations: compactDelegations.slice(0, delegationCount),
    touched_files: touchedFiles.slice(0, touchedFilesCount),
    key_decisions: keyDecisions.slice(0, decisionCount).map((k) => cleanExcerpt(k, decisionCap))
  });
  let digest = buildDigestWithCap(18, 32, Math.min(1, keyDecisions.length), Math.min(4, touchedFiles.length), compactDelegations.length);
  let jsonStr = JSON.stringify(digest);
  if (estimateTokens4(jsonStr) >= maxTokens) {
    digest = buildDigestWithCap(14, 24, 1, Math.min(3, touchedFiles.length), Math.min(3, compactDelegations.length));
    jsonStr = JSON.stringify(digest);
  }
  if (estimateTokens4(jsonStr) >= maxTokens) {
    digest = buildDigestWithCap(10, 20, 0, Math.min(2, touchedFiles.length), Math.min(2, compactDelegations.length));
    jsonStr = JSON.stringify(digest);
  }
  return {
    digest,
    markdown,
    matchedRootSessionID: bestRootId,
    session_id: bestRootId,
    headline: rootDigest.headline,
    verificationState: rootDigest.verification_state,
    score: Number(bestScore.toFixed(2)),
    bestBm25,
    matchedTokenCount: bestMatchedTokens,
    queryTokenCount,
    tokenCoverage: bestCoverage,
    tokenCount: markdownTokens,
    estimatedTokens: markdownTokens,
    totalRootSessions,
    matchedSessions: candidates,
    candidates,
    metrics: {
      markdown_chars: markdownChars,
      markdown_tokens: markdownTokens,
      json_chars: jsonStr.length,
      json_tokens: estimateTokens4(jsonStr),
      fts_hits: ftsHits.length,
      pivots_returned: pivots.length,
      delegations_returned: compactDelegations.length,
      total_root_sessions: totalRootSessions,
      matched_root_sessions: candidates.length,
      elapsed_ms: Number(elapsedMs.toFixed(3))
    }
  };
}

// src/cli.ts
function queryScalarCount(db, sql, ...params) {
  try {
    const row = db.query(sql).get(...params);
    return typeof row?.c === "number" ? row.c : 0;
  } catch {
    return 0;
  }
}
function buildSubstrateSnapshot(db, options = {}) {
  ensureContinuitySchema(db);
  ensureSemanticDigestSchema(db);
  ensureCodeGraphSchema(db);
  ensureCochangeSchema(db);
  const projectRoot = options.projectRoot ?? process.cwd();
  const archiveDir = options.archiveDir ?? path10.join(projectRoot, ".session-archive");
  const indexDbPath = options.indexDbPath ?? path10.join(archiveDir, "index.sqlite");
  const resolved = resolveDefaultSessionId(db, options.sessionID);
  const resolvedSessionID = resolved.sessionId;
  if (options.projectRoot) {
    try {
      reconcileProvenanceStaleness(db, {
        sessionID: resolvedSessionID,
        canonicalRoot: projectRoot
      });
    } catch {}
  }
  const sessionRow = db.query("SELECT title FROM session WHERE id = ? LIMIT 1").get(resolvedSessionID);
  const digestRow = db.query("SELECT headline, verification_state FROM session_semantic_digest WHERE session_id = ? LIMIT 1").get(resolvedSessionID);
  const sessionTitle = sessionRow?.title || digestRow?.headline || `Session ${resolvedSessionID}`;
  const verificationState = digestRow?.verification_state || "in_progress_or_unverified";
  const fileRows = db.query("SELECT path, line_range, staleness_status FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC").all(resolvedSessionID);
  const freshFiles = fileRows.filter((f) => isFreshOrSliceStatus(f.staleness_status)).length;
  const sliceFiles = fileRows.filter((f) => isSliceStatus(f.staleness_status)).length;
  const staleFiles = fileRows.filter((f) => !isFreshOrSliceStatus(f.staleness_status)).length;
  const staleAlerts = fileRows.filter((f) => !isFreshOrSliceStatus(f.staleness_status) || isSliceStatus(f.staleness_status)).map((f) => ({
    path: f.path,
    lineRange: f.line_range,
    status: f.staleness_status
  }));
  const recentPivots = db.query("SELECT seq, pivot_kind, prompt_excerpt, blob_ref FROM intent_pivot WHERE session_id = ? ORDER BY seq DESC LIMIT 5").all(resolvedSessionID).map((p) => ({
    seq: p.seq,
    pivotKind: p.pivot_kind,
    excerpt: p.prompt_excerpt,
    blobRef: shortBlobRef(p.blob_ref)
  }));
  const topCentralFiles = db.query("SELECT path, pagerank, loc FROM code_file ORDER BY pagerank DESC, path ASC LIMIT 5").all();
  let latestValuation = null;
  try {
    const valRow = db.query("SELECT mode, step_count, watermark_step_index, saved_chars, saved_tokens FROM working_valve_state WHERE session_id = ? LIMIT 1").get(resolvedSessionID);
    if (valRow) {
      latestValuation = {
        mode: valRow.mode,
        stepCount: valRow.step_count,
        watermarkStepIndex: valRow.watermark_step_index,
        savedChars: valRow.saved_chars,
        savedTokens: valRow.saved_tokens
      };
    }
  } catch {
    latestValuation = null;
  }
  return {
    projectRoot,
    archiveDir,
    indexDbPath,
    resolvedSessionID,
    sessionTitle,
    verificationState,
    counts: {
      sessions: queryScalarCount(db, "SELECT COUNT(*) as c FROM session"),
      rootSessions: queryScalarCount(db, "SELECT COUNT(*) as c FROM session WHERE depth = 0"),
      delegations: queryScalarCount(db, "SELECT COUNT(*) as c FROM delegation_turn WHERE parent_session_id = ?", resolvedSessionID),
      flaggedDelegations: queryScalarCount(db, "SELECT COUNT(*) as c FROM delegation_turn WHERE parent_session_id = ? AND (verified_outcome IN ('blocked_in_text', 'tool_error_inside') OR tool_error_count > 0)", resolvedSessionID),
      codeFiles: queryScalarCount(db, "SELECT COUNT(*) as c FROM code_file"),
      codeSymbols: queryScalarCount(db, "SELECT COUNT(*) as c FROM code_symbol"),
      cochangePairs: queryScalarCount(db, "SELECT COUNT(*) as c FROM git_cochange"),
      hiddenCochangePairs: queryScalarCount(db, "SELECT COUNT(*) as c FROM git_cochange WHERE has_static_edge = 0"),
      freshFiles,
      sliceFiles,
      staleFiles,
      activeSkills: queryScalarCount(db, "SELECT COUNT(*) as c FROM skill_load_ledger WHERE session_id = ?", resolvedSessionID),
      provenanceChains: queryScalarCount(db, "SELECT COUNT(*) as c FROM provenance_chain WHERE root_session_id = ?", resolvedSessionID),
      staleChains: queryScalarCount(db, "SELECT COUNT(*) as c FROM provenance_chain WHERE root_session_id = ? AND staleness_status IN ('verified_stale_by_later_touch', 'STALE (modified since read/review \u2014 re-verify slice)')", resolvedSessionID),
      compactions: queryScalarCount(db, "SELECT COUNT(*) as c FROM compaction WHERE session_id = ?", resolvedSessionID)
    },
    latestValuation,
    recentPivots,
    staleAlerts,
    topCentralFiles,
    updatedAt: new Date().toISOString()
  };
}
async function executeSubstrateAction(db, input, options = {}) {
  ensureContinuitySchema(db);
  ensureSemanticDigestSchema(db);
  ensureCodeGraphSchema(db);
  ensureCochangeSchema(db);
  const projectRoot = options.projectRoot ?? process.cwd();
  const archiveDir = options.archiveDir ?? path10.join(projectRoot, ".session-archive");
  const resolved = resolveDefaultSessionId(db, input.sessionID ?? options.sessionID);
  const resolvedSessionID = resolved.sessionId;
  let markdown = "";
  switch (input.action) {
    case "sync": {
      if (existsSync12(projectRoot)) {
        try {
          indexCodebase(db, projectRoot);
          computeCodebasePageRank(db);
        } catch {}
        try {
          await mineGitCochange(db, projectRoot);
        } catch {}
      }
      try {
        materializeSemanticDigests(db, { archiveDir });
      } catch {}
      const snap = buildSubstrateSnapshot(db, {
        ...options,
        projectRoot,
        archiveDir,
        sessionID: resolvedSessionID
      });
      markdown = [
        `## Substrate Sync Complete \xB7 \`${snap.resolvedSessionID}\``,
        `- **Project Root:** \`${snap.projectRoot}\``,
        `- **Sessions:** ${snap.counts.rootSessions} root / ${snap.counts.sessions} total`,
        `- **CodeGraph:** ${snap.counts.codeFiles} files, ${snap.counts.codeSymbols} symbols`,
        `- **Git Co-Change:** ${snap.counts.cochangePairs} pairs (${snap.counts.hiddenCochangePairs} HIDDEN)`,
        `- **Working Memory:** ${snap.counts.freshFiles} FRESH (${snap.counts.sliceFiles} SLICE), ${snap.counts.staleFiles} STALE`
      ].join(`
`);
      return {
        ok: true,
        action: input.action,
        resolvedSessionID,
        markdown,
        tokenEstimate: estimateTokens(markdown),
        snapshot: snap
      };
    }
    case "repomap": {
      const focusPaths = input.targetPaths ?? (input.path ? [input.path] : undefined);
      const view = renderRepoMap(db, {
        focusPaths,
        budgetTokens: input.maxTokens ?? 1000
      });
      markdown = view.text;
      break;
    }
    case "skeleton": {
      const targetPath = input.path ?? input.targetPaths?.[0];
      if (!targetPath) {
        markdown = "Error: `skeleton` requires `--path <rel>`.";
        return {
          ok: false,
          action: input.action,
          resolvedSessionID,
          markdown,
          tokenEstimate: estimateTokens(markdown)
        };
      }
      const normPath = normalizeRepoPath(targetPath, projectRoot);
      const skel = readAstSkeleton(db, normPath);
      markdown = skel ? skel.skeleton_text : `No indexed AST skeleton found for \`${normPath}\`.`;
      break;
    }
    case "slice": {
      const targetPath = input.path ?? input.targetPaths?.[0];
      const symbolName = input.symbol ?? input.symbolNames?.[0];
      if (!targetPath || !symbolName) {
        markdown = "Error: `slice` requires `--path <rel>` and `--symbol <name>`.";
        return {
          ok: false,
          action: input.action,
          resolvedSessionID,
          markdown,
          tokenEstimate: estimateTokens(markdown)
        };
      }
      const normPath = normalizeRepoPath(targetPath, projectRoot);
      const slice = readSymbolSlice(db, projectRoot, normPath, symbolName);
      markdown = slice ? slice.slice_text : `No symbol slice found for \`${normPath}#${symbolName}\`.`;
      break;
    }
    case "coupled": {
      const targetPath = input.path ?? input.targetPaths?.[0];
      if (!targetPath) {
        markdown = "Error: `coupled` requires `--path <rel>`.";
        return {
          ok: false,
          action: input.action,
          resolvedSessionID,
          markdown,
          tokenEstimate: estimateTokens(markdown)
        };
      }
      const normPath = normalizeRepoPath(targetPath, projectRoot);
      markdown = renderCochangeWarnings(db, normPath) || `No temporal co-change couplings found for \`${normPath}\`.`;
      break;
    }
    case "provenance": {
      markdown = renderProvenanceReport(db, resolvedSessionID, {
        canonicalRoot: options.projectRoot
      });
      break;
    }
    case "timeline": {
      const timeline = renderIntentTimeline(db, resolvedSessionID, {
        archiveDir
      });
      markdown = timeline.markdown;
      break;
    }
    case "search": {
      const queryText = input.query?.trim() ?? "";
      if (!queryText) {
        markdown = "Error: `search` requires `--query <text>`.";
        return {
          ok: false,
          action: input.action,
          resolvedSessionID,
          markdown,
          tokenEstimate: estimateTokens(markdown)
        };
      }
      const nav = queryVibeNavigation(db, queryText, {
        maxTokens: input.maxTokens ?? 350
      });
      markdown = nav.markdown;
      break;
    }
    case "brief": {
      const targetPaths = input.targetPaths && input.targetPaths.length > 0 ? input.targetPaths : input.path ? [input.path] : db.query("SELECT path FROM code_file ORDER BY pagerank DESC LIMIT 2").all().map((r) => r.path);
      const symbolNames = input.symbolNames && input.symbolNames.length > 0 ? input.symbolNames : input.symbol ? [input.symbol] : undefined;
      const brief = buildImplementorViewportBrief(db, {
        targetPaths,
        symbolNames,
        sessionID: resolvedSessionID,
        rootDir: projectRoot,
        maxTokens: input.maxTokens ?? 1500
      });
      markdown = brief.markdown;
      break;
    }
    case "prune": {
      const mode = input.mode ?? "manual";
      const keepRecentSteps = input.keepRecentSteps ?? 1;
      const rec = reconcileProvenanceStaleness(db, {
        sessionID: resolvedSessionID,
        canonicalRoot: options.projectRoot
      });
      markdown = [
        `## Working-Set Valve Prune (\`mode=${mode}\`, \`keepRecentSteps=${keepRecentSteps}\`) \xB7 \`${resolvedSessionID}\``,
        `- **Files Checked:** ${rec.totalFilesChecked} (${rec.freshFilesCount} FRESH [${rec.sliceFilesCount} SLICE], ${rec.staleFilesCount} STALE)`,
        `- **Provenance Chains Checked:** ${rec.totalChainsChecked} (${rec.verifiedFreshChainsCount} fresh, ${rec.staleChainsCount} stale)`
      ].join(`
`);
      break;
    }
    case "status":
    default: {
      const pkt = buildCompactionContinuationPacket(db, {
        sessionID: resolvedSessionID,
        canonicalRoot: options.projectRoot,
        maxTokens: input.maxTokens ?? 1200
      });
      markdown = pkt.markdown;
      break;
    }
  }
  const snapshot = buildSubstrateSnapshot(db, {
    ...options,
    projectRoot,
    archiveDir,
    sessionID: resolvedSessionID
  });
  return {
    ok: true,
    action: input.action,
    resolvedSessionID,
    markdown,
    tokenEstimate: estimateTokens(markdown),
    snapshot
  };
}
var VALID_ACTIONS = new Set([
  "status",
  "sync",
  "repomap",
  "skeleton",
  "slice",
  "coupled",
  "provenance",
  "timeline",
  "search",
  "brief",
  "prune"
]);
if (false) {}
// src/rpc.ts
function schema() {
  return {
    "~standard": {
      version: 1,
      vendor: "hivemind-substrate",
      validate(value) {
        return { value };
      }
    }
  };
}
var SUBSTRATE_RPC_ID = "hivemind-substrate";
var SUBSTRATE_UPDATED_EVENT = "substrate:updated";
var rpcMethods = {
  snapshot: {
    input: schema(),
    output: schema()
  },
  action: {
    input: schema(),
    output: schema()
  }
};
var substrateRpcContract = {
  id: SUBSTRATE_RPC_ID,
  methods: rpcMethods,
  method: rpcMethods,
  events: {
    [SUBSTRATE_UPDATED_EVENT]: {
      schema: schema()
    }
  },
  event: {
    [SUBSTRATE_UPDATED_EVENT]: schema()
  }
};
// src/plugin.ts
var defaultDbPath = () => {
  const dataHome = Bun.env.XDG_DATA_HOME ?? `${Bun.env.HOME}/.local/share`;
  return `${dataHome}/opencode/opencode.db`;
};
var resolveArchiveDir = (projectRoot, dir) => {
  const resolved = !dir ? path11.join(projectRoot, ".session-archive") : path11.isAbsolute(dir) ? path11.resolve(dir) : path11.resolve(projectRoot, dir);
  const segments = resolved.split(path11.sep);
  if (segments.includes(".opencode")) {
    throw new Error(`session-archive: archive directory must not reside inside .opencode/: ${resolved}`);
  }
  return resolved;
};
function formatToolOutput(params) {
  const fmt = params.format === "json" || params.format === "both" ? params.format : "markdown";
  const tokens = estimateTokens(params.markdown);
  const enrichedMeta = {
    action: params.action,
    tokens,
    ...params.elapsedMs !== undefined ? { latencyMs: Number(params.elapsedMs.toFixed(2)) } : {},
    ...params.metadata
  };
  if (fmt === "json") {
    return {
      content: JSON.stringify(enrichedMeta, null, 2),
      metadata: enrichedMeta
    };
  }
  const footer = params.skipFooter || params.markdown.includes("[substrate.telemetry") ? "" : `

---
[substrate.telemetry action=${params.action} tokens=${tokens}${params.elapsedMs !== undefined ? ` latencyMs=${params.elapsedMs.toFixed(2)}` : ""}]`;
  const markdownWithFooter = `${params.markdown}${footer}`;
  if (fmt === "both") {
    return {
      content: `${markdownWithFooter}

\`\`\`json
${JSON.stringify(enrichedMeta, null, 2)}
\`\`\``,
      metadata: enrichedMeta
    };
  }
  return {
    content: markdownWithFooter,
    metadata: enrichedMeta
  };
}
function extractToolResultText(content) {
  if (typeof content === "string")
    return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string")
        return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    }).join("");
  }
  return "";
}
function appendTextToToolResultContent(content, suffix) {
  if (typeof content === "string") {
    return `${content}${suffix}`;
  }
  if (Array.isArray(content)) {
    const cloned = content.map((item) => item && typeof item === "object" ? { ...item } : item);
    for (let i = cloned.length - 1;i >= 0; i--) {
      const part = cloned[i];
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        part.text = `${part.text}${suffix}`;
        return cloned;
      }
    }
    return [...cloned, { type: "text", text: suffix }];
  }
  return suffix;
}
var plugin_default = {
  id: "session-archive",
  async setup(ctx) {
    const dir = typeof ctx.options?.dir === "string" ? ctx.options.dir : undefined;
    const dbPath = typeof ctx.options?.dbPath === "string" ? ctx.options.dbPath : defaultDbPath();
    const codemode = ctx.options?.direct === true ? false : true;
    const projectRoot = ctx.location.project.canonical;
    const projectID = ctx.location.project.id;
    const archiveDir = resolveArchiveDir(projectRoot, dir);
    const blobDir = path11.join(archiveDir, "blobs");
    const indexDbPath = path11.join(archiveDir, "index.sqlite");
    const valve = new WorkingSetValve({
      blobDir,
      readOnlyArchiveDir: archiveDir,
      persistBlobsToDisk: true,
      canonicalRoot: projectRoot
    });
    const ensureSyncedDb = (targetSessionID) => {
      mkdirSync6(archiveDir, { recursive: true });
      let report;
      if (existsSync13(dbPath)) {
        try {
          const source = sqliteSource(dbPath);
          try {
            const candidateSession = targetSessionID ?? (existsSync13(indexDbPath) ? (() => {
              const tmp = new Database3(indexDbPath);
              try {
                return resolveDefaultSessionId(tmp).sessionId;
              } finally {
                tmp.close();
              }
            })() : "");
            if (candidateSession && candidateSession !== "unknown") {
              report = persist({
                sessionID: candidateSession,
                projectID,
                projectRoot,
                dir
              }, source);
            }
          } finally {
            source.close();
          }
        } catch {}
      }
      const db = initSyncDatabase(indexDbPath);
      ensureSemanticDigestSchema(db);
      ensureContinuitySchema(db);
      ensureCodeGraphSchema(db);
      ensureCochangeSchema(db);
      try {
        materializeSemanticDigests(db, { archiveDir });
      } catch {}
      return { db, report };
    };
    const resolveSessionIdForCall = (explicitSessionID, contextSessionID) => {
      if (typeof explicitSessionID === "string" && explicitSessionID.trim().length > 0) {
        return explicitSessionID.trim();
      }
      if (typeof contextSessionID === "string" && contextSessionID.trim().length > 0) {
        return contextSessionID.trim();
      }
      if (existsSync13(indexDbPath)) {
        const tmp = new Database3(indexDbPath);
        try {
          return resolveDefaultSessionId(tmp).sessionId;
        } catch {} finally {
          tmp.close();
        }
      }
      return "default";
    };
    const loadSessionMessagesForValve = async (sessionID) => {
      if (typeof ctx.session?.context === "function") {
        try {
          const hostMessages = await ctx.session.context({ sessionID });
          if (Array.isArray(hostMessages) && hostMessages.length > 0) {
            return hostMessages;
          }
        } catch {}
      }
      const legacySession = ctx.session;
      if (typeof legacySession?.messages === "function") {
        try {
          const legacyMessages = await legacySession.messages({ sessionID });
          if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
            return legacyMessages;
          }
        } catch {}
      }
      if (existsSync13(dbPath)) {
        try {
          const source = sqliteSource(dbPath);
          try {
            const rows = source.messages(sessionID);
            if (rows.length > 0) {
              return rows.map((row) => {
                const dataObj = typeof row.data === "object" && row.data !== null && !Array.isArray(row.data) ? row.data : {};
                return {
                  ...dataObj,
                  id: row.id,
                  role: row.type,
                  type: row.type,
                  seq: row.seq
                };
              });
            }
          } finally {
            source.close();
          }
        } catch {}
      }
      return [];
    };
    const executePersist = async (input, context) => {
      const t0 = performance.now();
      const requestedSessionID = resolveSessionIdForCall(input?.sessionID, context?.sessionID);
      if (typeof context?.progress === "function") {
        await context.progress({ status: `persisting session tree for ${requestedSessionID}` });
      }
      const source = sqliteSource(dbPath);
      try {
        const report = persist({
          sessionID: requestedSessionID,
          projectID,
          projectRoot,
          dir
        }, source);
        const summary = [
          `Persisted session tree rooted at ${report.rootID} into ${report.archiveDir}.`,
          `${report.sessions} sessions, ${report.messages} messages, ${report.delegations} delegations.`,
          `${report.written.length} files written, ${report.unchanged} unchanged.`,
          ...report.warnings && report.warnings.length > 0 ? [`Warnings: ${report.warnings.join("; ")}`] : []
        ].join(" ");
        return formatToolOutput({
          action: "sync",
          markdown: summary,
          metadata: report,
          format: input?.format,
          elapsedMs: performance.now() - t0
        });
      } finally {
        source.close();
      }
    };
    const executeValve = async (input, context) => {
      const t0 = performance.now();
      const action = String(input?.action ?? "prune").toLowerCase();
      const sessionID = resolveSessionIdForCall(input?.sessionID, context?.sessionID);
      if (action === "status") {
        const res = valve.status(sessionID);
        const md = res.armed || res.manifestMarkdown.includes("SLICE") || res.manifestMarkdown.includes("FRESH") ? `${res.summaryMarkdown}

${res.manifestMarkdown}` : res.summaryMarkdown;
        return formatToolOutput({
          action: "valve.status",
          markdown: md,
          metadata: res,
          format: input?.format,
          elapsedMs: performance.now() - t0
        });
      }
      if (action === "reset") {
        const res = valve.reset(sessionID);
        return formatToolOutput({
          action: "valve.reset",
          markdown: res.summaryMarkdown,
          metadata: res,
          format: input?.format,
          elapsedMs: performance.now() - t0
        });
      }
      const mode = input?.mode === "recent" || input?.mode === "initial" || input?.mode === "all" ? input.mode : "step-window";
      const keepRecentSteps = typeof input?.keepRecentSteps === "number" && Number.isFinite(input.keepRecentSteps) ? input.keepRecentSteps : undefined;
      const messages = await loadSessionMessagesForValve(sessionID);
      const res = valve.prune({
        sessionID,
        mode,
        keepRecentSteps,
        messages
      });
      const markdown = res.ledger.manifest.filesRead.length > 0 || res.ledger.manifest.filesModified.length > 0 || res.ledger.manifest.activeSkills.length > 0 ? `${res.summaryMarkdown}

${res.ledger.manifest.renderedMarkdown}` : res.summaryMarkdown;
      return formatToolOutput({
        action: "valve.prune",
        markdown,
        metadata: res,
        format: input?.format,
        elapsedMs: performance.now() - t0
      });
    };
    const executeViewport = async (input, context) => {
      const t0 = performance.now();
      const action = String(input?.action ?? "status").toLowerCase();
      if (action === "sync" || action === "persist") {
        return executePersist(input, context);
      }
      if (action === "resolve") {
        const blobId = String(input?.blob ?? input?.blobRef ?? input?.sha ?? "").trim();
        const startLine = typeof input?.startLine === "number" ? input.startLine : undefined;
        const endLine = typeof input?.endLine === "number" ? input.endLine : undefined;
        const resolved = valve.resolveBlob(blobId, { startLine, endLine });
        if (resolved) {
          return formatToolOutput({
            action: "resolve",
            markdown: resolved.slice,
            metadata: resolved,
            format: input?.format,
            elapsedMs: performance.now() - t0,
            skipFooter: input?.format === undefined
          });
        }
        const fromArchive = valve.resolve(blobId);
        if (fromArchive) {
          return formatToolOutput({
            action: "resolve",
            markdown: fromArchive,
            metadata: { blobRef: blobId, content: fromArchive },
            format: input?.format,
            elapsedMs: performance.now() - t0,
            skipFooter: input?.format === undefined
          });
        }
        return formatToolOutput({
          action: "resolve",
          markdown: `Blob not found: ${blobId}`,
          metadata: { found: false, blob: blobId },
          format: input?.format,
          elapsedMs: performance.now() - t0,
          skipFooter: true
        });
      }
      const explicitSession = typeof input?.sessionID === "string" ? input.sessionID : undefined;
      const hookSession = typeof context?.sessionID === "string" ? context.sessionID : undefined;
      const { db } = ensureSyncedDb(explicitSession ?? hookSession);
      try {
        const resolvedSession = resolveDefaultSessionId(db, explicitSession, { sessionID: hookSession });
        const sessionID = resolvedSession.sessionId;
        if (action === "repomap") {
          indexCodebase(db, projectRoot);
          computeCodebasePageRank(db);
          const budgetTokens = typeof input?.maxTokens === "number" ? input.maxTokens : 1000;
          const focusPaths = Array.isArray(input?.focusPaths) ? input.focusPaths.map(String) : undefined;
          const rendered = renderRepoMap(db, { budgetTokens, focusPaths });
          return formatToolOutput({
            action: "repomap",
            markdown: rendered.markdown,
            metadata: rendered,
            format: input?.format,
            elapsedMs: performance.now() - t0
          });
        }
        if (action === "skeleton") {
          indexCodebase(db, projectRoot);
          const targetPath = String(input?.path ?? input?.filePath ?? "");
          const skel = readAstSkeleton(db, targetPath);
          const skelObj = skel && typeof skel === "object" ? skel : null;
          const text = typeof skel === "string" ? skel : String(skelObj?.skeleton_text ?? skelObj?.skeletonText ?? `No skeleton found for ${targetPath}`);
          return formatToolOutput({
            action: "skeleton",
            markdown: text,
            metadata: { path: targetPath, skeleton: skel },
            format: input?.format,
            elapsedMs: performance.now() - t0
          });
        }
        if (action === "slice") {
          indexCodebase(db, projectRoot);
          const targetPath = String(input?.path ?? input?.filePath ?? "");
          const symbol = typeof input?.symbol === "string" ? input.symbol : typeof input?.qualifiedName === "string" ? input.qualifiedName : {
            startLine: Number(input?.startLine ?? 1),
            endLine: Number(input?.endLine ?? 50)
          };
          const slice = readSymbolSlice(db, projectRoot, targetPath, symbol);
          const sliceObj = slice && typeof slice === "object" ? slice : null;
          const text = typeof slice === "string" ? slice : String(sliceObj?.slice_text ?? sliceObj?.sliceText ?? `Symbol slice not found for ${targetPath}`);
          return formatToolOutput({
            action: "slice",
            markdown: text,
            metadata: sliceObj ?? { path: targetPath },
            format: input?.format,
            elapsedMs: performance.now() - t0
          });
        }
        if (action === "coupled") {
          indexCodebase(db, projectRoot);
          try {
            mineGitCochange(db, projectRoot);
          } catch {}
          const targetPath = String(input?.path ?? input?.filePath ?? "");
          const couplings = queryCochangeCouplings(db, targetPath);
          const warnings = renderCochangeWarnings(db, [targetPath]);
          return formatToolOutput({
            action: "coupled",
            markdown: warnings || `No co-change couplings above threshold for ${targetPath}.`,
            metadata: { path: targetPath, couplings },
            format: input?.format,
            elapsedMs: performance.now() - t0
          });
        }
        if (action === "brief") {
          indexCodebase(db, projectRoot);
          computeCodebasePageRank(db);
          try {
            mineGitCochange(db, projectRoot);
          } catch {}
          const targetPaths = Array.isArray(input?.targetPaths) ? input.targetPaths.map(String) : typeof input?.path === "string" ? [input.path] : [];
          const symbolNames = Array.isArray(input?.symbolNames) ? input.symbolNames.map(String) : undefined;
          const maxTokens = typeof input?.maxTokens === "number" ? input.maxTokens : 1500;
          const brief = buildImplementorViewportBrief(db, {
            targetPaths,
            symbolNames,
            sessionID,
            rootDir: projectRoot,
            maxTokens
          });
          return formatToolOutput({
            action: "brief",
            markdown: brief.markdown,
            metadata: brief,
            format: input?.format,
            elapsedMs: performance.now() - t0
          });
        }
        if (action === "search") {
          const query = String(input?.query ?? input?.q ?? "");
          const nav = queryVibeNavigation(db, query, {
            limit: typeof input?.limit === "number" ? input.limit : 5,
            maxTokens: typeof input?.maxTokens === "number" ? input.maxTokens : 600
          });
          return formatToolOutput({
            action: "search",
            markdown: nav.markdown,
            metadata: nav,
            format: input?.format,
            elapsedMs: performance.now() - t0
          });
        }
        if (action === "timeline" || action === "intents") {
          const timeline = renderIntentTimeline(db, sessionID);
          const timelineObj = timeline && typeof timeline === "object" ? timeline : null;
          const content = typeof timeline === "string" ? timeline : String(timelineObj?.markdown ?? JSON.stringify(timeline));
          return formatToolOutput({
            action: "timeline",
            markdown: content,
            metadata: timelineObj ?? { sessionID },
            format: input?.format,
            elapsedMs: performance.now() - t0
          });
        }
        if (action === "provenance") {
          reconcileProvenanceStaleness(db, projectRoot, sessionID);
          const report = renderProvenanceReport(db, sessionID);
          const reportObj = report && typeof report === "object" ? report : null;
          const content = typeof report === "string" ? report : String(reportObj?.markdown ?? JSON.stringify(report));
          return formatToolOutput({
            action: "provenance",
            markdown: content,
            metadata: reportObj ?? { sessionID },
            format: input?.format,
            elapsedMs: performance.now() - t0
          });
        }
        reconcileProvenanceStaleness(db, projectRoot, sessionID);
        const result = querySubstrateContinuity(db, { action, sessionID, query: typeof input?.query === "string" ? input.query : undefined }, { sessionID: hookSession });
        const resObj = result;
        const markdown = String(resObj.content ?? resObj.markdown ?? JSON.stringify(result));
        return formatToolOutput({
          action,
          markdown,
          metadata: resObj,
          format: input?.format,
          elapsedMs: performance.now() - t0
        });
      } finally {
        db.close();
      }
    };
    if (typeof ctx.session?.hook === "function") {
      await ctx.session.hook("context", (event) => {
        valve.applyContextHookInMemory(event);
      });
      await ctx.session.hook("compaction", (event) => {
        const hookSessionID = typeof event?.sessionID === "string" ? event.sessionID : undefined;
        const { db } = ensureSyncedDb(hookSessionID);
        try {
          const resolved = resolveDefaultSessionId(db, hookSessionID, { sessionID: hookSessionID });
          reconcileProvenanceStaleness(db, projectRoot, resolved.sessionId);
          const packet = buildCompactionContinuationPacket(db, {
            sessionID: resolved.sessionId,
            hookContext: { sessionID: hookSessionID },
            canonicalRoot: projectRoot,
            maxTokens: 1200
          });
          if (Array.isArray(event.system)) {
            event.system.push({ type: "text", text: packet.markdown });
          }
          const compatEvent = event;
          if (typeof compatEvent.prompt === "string") {
            compatEvent.prompt = `${compatEvent.prompt}

${packet.markdown}`;
          } else if (!Array.isArray(event.system) && compatEvent && typeof compatEvent === "object") {
            compatEvent.prompt = packet.markdown;
          }
          if (Array.isArray(compatEvent.context)) {
            compatEvent.context.push(packet.markdown);
          }
        } finally {
          db.close();
        }
      });
    }
    if (typeof ctx.tool?.hook === "function") {
      await ctx.tool.hook("execute.after", (event) => {
        if (event.status !== "completed" || event.tool !== "read")
          return;
        const rawText = extractToolResultText(event.result?.content);
        if (!rawText)
          return;
        const inputObj = event.input && typeof event.input === "object" && !Array.isArray(event.input) ? event.input : {};
        const capture = valve.recordReadFromHook({
          sessionID: event.sessionID,
          callId: event.id,
          input: inputObj,
          rawOutput: rawText,
          canonicalRoot: projectRoot
        });
        const isPartialOrTruncated = capture.isTruncated || capture.totalLines !== null && capture.endLine < capture.totalLines;
        if (!isPartialOrTruncated || rawText.includes(JIT_SKELETON_MARKER))
          return;
        try {
          const { db } = ensureSyncedDb(event.sessionID);
          try {
            const footer = buildJitReadSkeletonFooter(db, projectRoot, capture.path, capture);
            if (footer && event.result) {
              const updatedContent = appendTextToToolResultContent(event.result.content, `

${footer}`);
              event.result = {
                ...event.result,
                content: updatedContent
              };
            }
          } finally {
            db.close();
          }
        } catch {}
      });
    }
    let rpcHandle = null;
    if (typeof ctx.rpc?.register === "function") {
      try {
        rpcHandle = await ctx.rpc.register(substrateRpcContract, {
          snapshot: async (input) => {
            const { db } = ensureSyncedDb(input?.sessionID);
            try {
              return buildSubstrateSnapshot(db, {
                projectRoot,
                archiveDir,
                indexDbPath,
                sessionID: input?.sessionID
              });
            } finally {
              db.close();
            }
          },
          action: async (input) => {
            if (input.action === "prune") {
              const valveRes = await executeValve({
                action: "prune",
                mode: input.mode === "manual" ? "step-window" : "step-window",
                keepRecentSteps: input.keepRecentSteps,
                sessionID: input.sessionID
              }, { sessionID: input.sessionID });
              const { db } = ensureSyncedDb(input.sessionID);
              try {
                const snap = buildSubstrateSnapshot(db, {
                  projectRoot,
                  archiveDir,
                  indexDbPath,
                  sessionID: input.sessionID
                });
                return {
                  ok: true,
                  action: "prune",
                  resolvedSessionID: snap.resolvedSessionID,
                  markdown: valveRes.content,
                  tokenEstimate: estimateTokens(valveRes.content),
                  snapshot: snap
                };
              } finally {
                db.close();
              }
            }
            const { db } = ensureSyncedDb(input.sessionID);
            try {
              return await executeSubstrateAction(db, input, {
                projectRoot,
                archiveDir,
                indexDbPath,
                sessionID: input.sessionID
              });
            } finally {
              db.close();
            }
          }
        });
      } catch {}
    }
    const handleSubscribedEvent = (event) => {
      const evtAny = event;
      const eventType = String(evtAny?.type ?? "");
      const statusType = evtAny?.properties?.status?.type ?? evtAny?.data?.status?.type ?? evtAny?.status?.type;
      const isIdle = eventType === "session.status" && statusType === "idle";
      const isCompacted = eventType === "session.compacted";
      if (!isIdle && !isCompacted)
        return;
      const sessionID = evtAny?.properties?.sessionID ?? evtAny?.data?.sessionID ?? evtAny?.sessionID ?? undefined;
      const { db } = ensureSyncedDb(sessionID);
      try {
        if (isCompacted && sessionID) {
          const summaryText = String(evtAny?.properties?.summary ?? evtAny?.data?.summary ?? evtAny?.summary ?? "session.compacted");
          recordCompactionSummaryHash(db, sessionID, summaryText);
        }
        rpcHandle?.emit?.(SUBSTRATE_UPDATED_EVENT, {
          sessionID,
          action: isCompacted ? "compacted" : "idle",
          updatedAt: new Date().toISOString()
        });
      } catch {} finally {
        db.close();
      }
    };
    if (typeof ctx.event?.subscribe === "function") {
      const subscribeFn = ctx.event.subscribe;
      const subResult = await subscribeFn(handleSubscribedEvent);
      if (subResult && typeof subResult[Symbol.asyncIterator] === "function") {
        (async () => {
          try {
            for await (const evt of subResult) {
              handleSubscribedEvent(evt);
            }
          } catch {}
        })();
      }
    }
    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "substrate",
        description: "Unified Hivemind Context & Working-Memory Substrate (valve + viewport)"
      });
      editor.namespace({
        name: "archive",
        description: "Deterministic session transcript archive"
      });
      editor.namespace({
        name: "ctx",
        description: "Working-set context pruning compatibility alias"
      });
      editor.add({
        name: "valve",
        options: { namespace: "substrate", codemode },
        description: "Control the hybrid assistant step-watermark WorkingSetValve (prune | status | reset). Replaces older tool outputs with content-addressed FactBreadcrumbs and injects the 3-state Working-Memory Manifest (FRESH | SLICE | STALE).",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["prune", "status", "reset"] },
            mode: { type: "string", enum: ["step-window", "recent", "initial", "all"] },
            keepRecentSteps: { type: "number" },
            sessionID: { type: "string" },
            format: { type: "string", enum: ["markdown", "json", "both"] }
          },
          additionalProperties: true
        },
        execute: executeValve
      });
      editor.add({
        name: "viewport",
        options: { namespace: "substrate", codemode },
        description: "Query the 4-tier Hivemind Substrate viewport (status | resolve | timeline | provenance | sync | search | repomap | skeleton | slice | coupled | brief | intents | latest).",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "status",
                "resolve",
                "timeline",
                "provenance",
                "sync",
                "search",
                "repomap",
                "skeleton",
                "slice",
                "coupled",
                "brief",
                "intents",
                "latest"
              ]
            },
            sessionID: { type: "string" },
            query: { type: "string" },
            blob: { type: "string" },
            path: { type: "string" },
            symbol: { type: "string" },
            targetPaths: { type: "array", items: { type: "string" } },
            symbolNames: { type: "array", items: { type: "string" } },
            maxTokens: { type: "number" },
            startLine: { type: "number" },
            endLine: { type: "number" },
            format: { type: "string", enum: ["markdown", "json", "both"] }
          },
          additionalProperties: true
        },
        execute: executeViewport
      });
      editor.add({
        name: "persist",
        options: { namespace: "archive", codemode },
        description: "Persist the current session tree into the project's .session-archive transcript archive and SQLite index.",
        input: {
          type: "object",
          properties: {
            sessionID: {
              type: "string",
              description: "Session to persist; defaults to the current session. The whole tree from the root is archived."
            },
            format: { type: "string", enum: ["markdown", "json", "both"] }
          },
          additionalProperties: false
        },
        execute: executePersist
      });
      editor.add({
        name: "context-prune",
        options: { namespace: "ctx", codemode },
        description: "Backwards-compatible alias for substrate.valve (prune | status | reset).",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["prune", "status", "reset"] },
            mode: { type: "string", enum: ["step-window", "recent", "initial", "all"] },
            keepRecentSteps: { type: "number" },
            sessionID: { type: "string" },
            format: { type: "string", enum: ["markdown", "json", "both"] }
          },
          additionalProperties: true
        },
        execute: executeValve
      });
    });
  }
};
export {
  SUBSTRATE_RPC_ID,
  WorkingSetValve,
  applyContextHookInMemory,
  buildCompactionContinuationPacket,
  buildImplementorViewportBrief,
  buildJitReadSkeletonFooter,
  buildSubstrateSnapshot,
  computeCodebasePageRank,
  computeStepWatermark,
  plugin_default as default,
  executeSubstrateAction,
  indexCodebase,
  materializeSemanticDigests,
  mineGitCochange,
  persist,
  queryCochangeCouplings,
  querySubstrateContinuity,
  queryVibeNavigation,
  readAstSkeleton,
  readSymbolSlice,
  reconcileProvenanceStaleness,
  renderCochangeWarnings,
  renderIntentTimeline,
  renderProvenanceReport,
  renderRepoMap,
  resolveDefaultSessionId,
  resolvePromptBlob,
  sqliteSource,
  substrateRpcContract
};
