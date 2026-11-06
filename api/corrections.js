import {
  json,
  readBody,
  RequestBodyError,
  sameOrigin,
} from "../server/supabase.js";
import {
  correctionConfig,
  correctionActor,
  correctionClient,
  validateCorrection,
  correctionFailure,
} from "../server/corrections.js";

export default async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  try {
    if (!["GET", "POST"].includes(req.method)) {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { error: "Method not allowed." });
    }
    if (req.method === "POST" && !sameOrigin(req))
      return json(res, 403, {
        error: "Open this form on the RWN website and try again.",
      });
    const config = correctionConfig();
    if (!config)
      return req.method === "GET"
        ? json(res, 200, { enabled: false })
        : json(res, 503, {
            error:
              "Correction reporting is not available yet. Nothing was submitted.",
          });
    const client = correctionClient(config);
    if (req.method === "GET") {
      const { data, error } = await client.rpc("rwn_correction_status");
      if (error)
        return json(res, 503, {
          enabled: false,
          error: "Correction reporting is temporarily unavailable.",
        });
      return json(res, 200, { enabled: data === true });
    }
    const body = await readBody(req);
    const invalid = validateCorrection(body);
    if (invalid) return json(res, 400, { error: invalid });
    const actor = correctionActor(req, config.token);
    if (!actor)
      return json(res, 503, {
        error:
          "Correction reporting could not accept this connection. Nothing was submitted.",
      });
    const { data, error } = await client.rpc("rwn_submit_correction", {
      p_resource_id: body.resourceId,
      p_category: body.category,
      p_note: (body.note || "").trim(),
      p_submission_id: body.submissionId,
      p_actor: actor,
    });
    if (error || data?.accepted !== true) {
      const failure = correctionFailure(error);
      if (failure.status === 429) res.setHeader("Retry-After", "3600");
      return json(res, failure.status, { error: failure.message });
    }
    return json(res, 201, {
      ok: true,
      message:
        "Your correction report was saved for review. It has not changed the public listing.",
    });
  } catch (error) {
    if (error instanceof RequestBodyError)
      return json(res, error.status, { error: error.message });
    return json(res, 503, {
      error: "We could not confirm your report was saved. Please retry safely.",
    });
  }
}
