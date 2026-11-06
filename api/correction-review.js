import {
  clientFor,
  json,
  readBody,
  RequestBodyError,
  requestOrigin,
  requireUser,
  sameOrigin,
} from "../server/supabase.js";
import { correctionFailure, validateDecision } from "../server/corrections.js";
import { CORRECTION_STATUSES } from "../public/correction-contract.js";

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    if (!["GET", "PATCH"].includes(req.method)) {
      res.setHeader("Allow", "GET, PATCH");
      return json(res, 405, { error: "Method not allowed." });
    }
    if (req.method === "PATCH" && !sameOrigin(req))
      return json(res, 403, { error: "Request origin was not accepted." });
    const client = clientFor(req, res);
    if (!(await requireUser(client, res))) return;
    let result;
    if (req.method === "PATCH") {
      const body = await readBody(req);
      const invalid = validateDecision(body);
      if (invalid) return json(res, 400, { error: invalid });
      result = await client.rpc("rwn_decide_correction", {
        p_id: body.id,
        p_revision: body.revision,
        p_status: body.status,
        p_priority: body.priority,
        p_assignment: body.assignment,
        p_reason: body.reason.trim(),
        p_evidence_url: body.evidenceUrl || "",
      });
    } else {
      const url = new URL(req.url, requestOrigin(req));
      const id = url.searchParams.get("id");
      const pageText = url.searchParams.get("page") || "0";
      const status = url.searchParams.get("status") || "open";
      if (
        !/^\d{1,4}$/.test(pageText) ||
        (!CORRECTION_STATUSES.includes(status) && status !== "all") ||
        (id &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            id,
          ))
      )
        return json(res, 400, {
          error: "Choose a valid queue page or report.",
        });
      result = await client.rpc("rwn_correction_queue", {
        p_page: Number(pageText),
        p_status: status,
        p_id: id,
      });
    }
    if (result.error) {
      const failure = correctionFailure(result.error);
      return json(res, failure.status, {
        error:
          failure.status === 503
            ? "The correction review queue is temporarily unavailable. Please retry."
            : failure.message,
      });
    }
    if (!result.data || typeof result.data !== "object")
      return json(res, 503, {
        error: "The correction review queue is temporarily unavailable.",
      });
    return json(res, 200, result.data);
  } catch (error) {
    if (error instanceof RequestBodyError)
      return json(res, error.status, { error: error.message });
    return json(res, 503, {
      error:
        "The correction review queue is temporarily unavailable. Please retry.",
    });
  }
}
