import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { projectUrl, publishableKey } from "./supabase.js";
import { resources } from "../src/data/resources.js";
import {
  CORRECTION_CATEGORIES,
  CORRECTION_STATUSES,
  MAX_CORRECTION_NOTE,
  MAX_CORRECTION_REASON,
} from "../public/correction-contract.js";

const categories = new Set(CORRECTION_CATEGORIES.map(({ value }) => value));
const listingIds = new Set(resources.map(({ id }) => id));
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain = (value) =>
  typeof value === "string" &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const exactKeys = (value, keys) =>
  Object.keys(value).every((key) => keys.includes(key));

export function correctionConfig() {
  const token = process.env.RWN_CORRECTIONS_INGEST_TOKEN;
  const approvalRef = process.env.RWN_CORRECTIONS_APPROVAL_REF;
  if (
    process.env.RWN_CORRECTIONS_ENABLED !== "true" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(token || "") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{7,159}$/.test(approvalRef || "")
  )
    return null;
  return { token, approvalRef };
}

export function validateCorrection(body) {
  if (
    !exactKeys(body, [
      "resourceId",
      "category",
      "note",
      "submissionId",
      "website",
    ]) ||
    typeof body.resourceId !== "string" ||
    !listingIds.has(body.resourceId)
  )
    return "Choose a published RWN listing.";
  if (body.website !== undefined && body.website !== "")
    return "Check the correction form and try again.";
  if (!categories.has(body.category))
    return "Choose one of the listed correction categories.";
  if (!uuid.test(body.submissionId || ""))
    return "Reload the correction form and try again.";
  if (
    body.note !== undefined &&
    (!plain(body.note) || body.note.length > MAX_CORRECTION_NOTE)
  )
    return "Keep the optional note within 1,000 characters and use plain text.";
  return null;
}

export function validateDecision(body) {
  if (
    !exactKeys(body, [
      "id",
      "revision",
      "status",
      "priority",
      "assignment",
      "reason",
      "evidenceUrl",
    ]) ||
    !uuid.test(body.id || "") ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 1
  )
    return "Reopen the report before saving.";
  if (
    !CORRECTION_STATUSES.includes(body.status) ||
    !["urgent", "normal", "low"].includes(body.priority) ||
    !["keep", "self", "unassigned"].includes(body.assignment)
  )
    return "Choose a valid review status, priority and assignment.";
  if (
    !plain(body.reason) ||
    body.reason.trim().length < 10 ||
    body.reason.length > MAX_CORRECTION_REASON
  )
    return "Explain the review decision in 10 to 1,000 characters.";
  const evidence = body.evidenceUrl || "";
  if (evidence) {
    try {
      const url = new URL(evidence);
      if (
        !plain(evidence) ||
        evidence.length > 2048 ||
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        evidence.trim() !== evidence
      )
        return "Use an HTTPS evidence reference without credentials.";
    } catch {
      return "Use an HTTPS evidence reference.";
    }
  } else if (["ready", "rejected", "duplicate"].includes(body.status))
    return "Add source evidence for this decision.";
  return null;
}

export function correctionActor(
  req,
  token,
  day = new Date().toISOString().slice(0, 10),
) {
  // Vercel overwrites its own forwarded header. Outside Vercel only the actual
  // socket address is trusted; ordinary X-Forwarded-For is never accepted.
  let address = process.env.VERCEL
    ? req.headers["x-vercel-forwarded-for"]
    : req.socket?.remoteAddress;
  if (typeof address !== "string" || !isIP(address)) return null;
  if (isIP(address) === 6) address = new URL(`http://[${address}]`).hostname;
  return createHmac("sha256", token)
    .update(`rwn-correction-actor\0${day}\0${address}`)
    .digest("hex");
}

export function correctionClient(config) {
  return createClient(projectUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "x-rwn-correction-key": config.token,
        "x-rwn-correction-approval": config.approvalRef,
      },
      fetch: (url, options) =>
        fetch(url, { ...options, signal: AbortSignal.timeout(8000) }),
    },
  });
}

export function correctionFailure(error) {
  const status =
    { PT429: 429, PT409: 409, PT404: 404, 42501: 403, 22023: 400 }[
      error?.code
    ] || 503;
  const message = {
    429: "Too many reports right now. Please wait before trying again.",
    409: "This report changed or this retry does not match. Reopen it before saving.",
    404: "This listing or report is not available.",
    403: "Correction review access is required.",
    400: "Check the correction fields and try again.",
    503: "We could not confirm your report was saved. Please retry safely.",
  }[status];
  return { status, message };
}
