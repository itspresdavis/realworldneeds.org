import {
  clientFor,
  json,
  readBody,
  requestOrigin,
  requireUser,
  sameOrigin,
} from "../server/supabase.js";
import { validateEdit, validateLocationEdit } from "../server/catalog-validation.js";

export default async function handler(req, res) {
  try {
    const client = clientFor(req, res);
    const user = await requireUser(client, res);
    if (!user) return;
    const url = new URL(req.url, requestOrigin(req));
    if (
      req.method === "PATCH" ||
      (req.method === "GET" && url.searchParams.has("id"))
    ) {
      const { data: membership, error: memberError } = await client
        .from("rwn_members")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (memberError)
        return json(res, 503, {
          error: "Editor permissions could not be verified.",
        });
      const isEditor = ["editor", "admin"].includes(membership?.role);
      if (req.method === "PATCH") {
        if (!sameOrigin(req) || !isEditor)
          return json(res, 403, {
            error: "Editor access is required to change a listing.",
          });
        const body = await readBody(req);
        const invalid = validateEdit(body);
        if (invalid) return json(res, 400, { error: invalid });
        const { data: current, error: readError } = await client
          .from("rwn_locations")
          .select("record,updated_at")
          .eq("id", body.id)
          .maybeSingle();
        if (readError)
          return json(res, 503, { error: "The record could not be loaded." });
        if (!current) return json(res, 404, { error: "Listing not found." });
        if (current.updated_at !== body.updatedAt)
          return json(res, 409, {
            error:
              "Another editor changed this listing. Reopen it before saving.",
          });
        const invalidLocation = validateLocationEdit(current.record, body.changes);
        if (invalidLocation) return json(res, 400, { error: invalidLocation });
        const { data: saved, error } = await client
          .from("rwn_locations")
          .update({
            record: { ...current.record, ...body.changes },
            published: body.published,
            editorial_note: body.reason.trim(),
          })
          .eq("id", body.id)
          .eq("updated_at", body.updatedAt)
          .select("id,record,published,updated_at")
          .maybeSingle();
        if (error)
          return json(res, 400, {
            error:
              "The database rejected this change. Check the listing fields.",
          });
        if (!saved)
          return json(res, 409, {
            error:
              "Another editor changed this listing. Reopen it before saving.",
          });
        return json(res, 200, { location: saved });
      }
      const id = url.searchParams.get("id").slice(0, 160);
      const { data: location, error } = await client
        .from("rwn_locations")
        .select("id,record,published,updated_at")
        .eq("id", id)
        .maybeSingle();
      if (error)
        return json(res, 503, { error: "The record could not be loaded." });
      if (!location) return json(res, 404, { error: "Listing not found." });
      const history = isEditor
        ? await client
            .from("rwn_location_history")
            .select("operation,changed_at,actor_id,before_record,after_record")
            .eq("location_id", id)
            .order("changed_at", { ascending: false })
            .limit(25)
        : { data: [] };
      if (history.error)
        return json(res, 503, { error: "Change history could not be loaded." });
      return json(res, 200, {
        location,
        isEditor,
        history: history.data,
        databaseUrl:
          "https://supabase.com/dashboard/project/cytfrxldixdapjaxcqzf/editor/25704",
      });
    }
    if (req.method === "POST") {
      if (!sameOrigin(req))
        return json(res, 403, { error: "Request origin was not accepted." });
      const { locationId, note } = await readBody(req);
      if (
        typeof locationId !== "string" ||
        locationId.length > 160 ||
        typeof note !== "string" ||
        note.trim().length < 10 ||
        note.length > 2000
      )
        return json(res, 400, {
          error:
            "Choose a listing and write a review note between 10 and 2,000 characters.",
        });
      const { error } = await client.from("rwn_reviews").insert({
        location_id: locationId,
        author_id: user.id,
        note: note.trim(),
      });
      if (error)
        return json(res, 503, {
          error: "Your note was not saved. Please try again.",
        });
      return json(res, 201, { ok: true });
    }
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET, POST, PATCH");
      return json(res, 405, { error: "Method not allowed." });
    }
    const page = Math.max(
      0,
      Math.min(100000, Number.parseInt(url.searchParams.get("page"), 10) || 0),
    );
    const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
    let query = client
      .from("rwn_locations")
      .select(
        "id,name,country,kind,last_checked,source_url,latitude,longitude,updated_at,published",
        { count: "exact" },
      )
      .order("name")
      .order("id")
      .range(page * 40, page * 40 + 39);
    if (q)
      query = query.ilike("search_text", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
    const [catalog, reviews] = await Promise.all([
      query,
      client
        .from("rwn_reviews")
        .select("id,location_id,note,created_at")
        .eq("author_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (catalog.error || reviews.error)
      return json(res, 503, {
        error: "The catalog is temporarily unavailable. Please try again.",
      });
    return json(res, 200, {
      locations: catalog.data,
      total: catalog.count,
      page,
      reviews: reviews.data,
    });
  } catch {
    return json(res, 503, {
      error: "The catalog is temporarily unavailable. Please try again.",
    });
  }
}
