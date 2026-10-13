# Public atlas rendering

The public map uses the shared published catalog. Every resource receives its own GPU vertex at the original coordinate at every zoom. Screen-space grouping combines overlapping interaction controls only; it does not replace the stored points or randomly offset locations. Solid and ring markers distinguish service locations from coverage resources.

The render loop runs only while the camera moves, rotation is enabled, or a change invalidates the scene. Filters, pointer/keyboard gestures, programmatic focus, resized canvases, decoded imagery, loaded boundaries, context recovery, and visibility changes wake it. Static frames cost no repeated GPU draws. Drawing-buffer dimensions use the same flooring rule as Three.js, avoiding framebuffer allocation loops at fractional device pixel ratios.

Perspective horizon checks prevent controls on the hidden part of Earth from covering visible points. Cluster controls continue tracking the centroid of their visible members between grouping passes. GPU picking chooses the closest visible point in screen space. Coordinate readouts retain five decimal places without implying the underlying source has that accuracy.

The initial 2K NASA surface remains small enough for a fast first view. Existing 8K imagery and Natural Earth boundaries at 1:10 million scale load as visitors zoom closer, respecting Data Saver and GPU texture limits. Images that fit the texture budget upload directly, avoiding a redundant full-resolution canvas copy. Boundary loading no longer recreates the Earth texture. Stable atlas lighting keeps the geography readable irrespective of the current solar position. A coastline-derived land mask restricts the ocean palette to water; dark forests retain their original imagery. Polygon wrapping preserves the antimeridian.

The cream/green public interface and pale map surround share existing navigation and page structure. There is no custom page-scroll engine. Ordinary wheel scrolling and vertical mobile swipes belong to the document; explicit map gestures control the globe.

## Country lookup

Country picking and user-location routing test the original longitude/latitude edges of the bundled Natural Earth GeoJSON. These polygons are already cut at the antimeridian; Antarctica also includes its explicit pole closure. Only the query longitude is normalized. Wrapping individual vertices around a query would introduce artificial edges across the opposite hemisphere and could select a different country when detailed geometry changes feature order.

Containment retains the existing half-open ray convention, without a new boundary epsilon or geopolitical tie-break: for an axis-aligned rectangle, its west/south edges are included and east/north edges excluded. Hole membership uses the same convention and is subtracted. Exact shared borders or genuinely overlapping features may still depend on source feature order; this is an approximate country lookup, not surveyed border resolution. Coarse and detailed coastlines can legitimately differ. Tests cover unambiguous interiors with both complete datasets, synthetic holes/islands, reversed winding, seam/pole closures, equivalent longitudes and repeated location routing across the detail transition. Dataset checks guard the antimeridian-cut assumption.

The CI-only live-source verifier uses both complete, unchanged map responses with synthetic locations and provider responses. It holds detail delivery until the coarse U.S. result is checked, then observes the real detail-ready state before repeating the location action. A temporary read-only observer is appended to the generated app module for this verifier and removed by restoring the exact original bytes on success or failure; it is absent from ordinary source/build output. A U.K. control must cause no USDA request. This fixture does not request a device location or contact a live provider.

## Verification

Run `npm run check` and the existing `npm run test:browser:qa`. The render-policy tests cover fractional framebuffer sizes, idle/moving states, and perspective occlusion. Browser checks cover filtering, selection, gesture ownership, off-screen behavior, desktop/mobile layout, recovery, and source links.

An engineering browser probe confirmed all 2,019 vertices were preserved at zoom levels 1, 3, 8, and 12. Maximum float32 coordinate round-trip error was 0.00000235 degrees. This measures numerical fidelity to the catalog, not surveyed address accuracy. Supabase's `rwn_coordinate_review` worklist records the remaining evidence checks; see the editor guide.
