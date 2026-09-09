# Public atlas rendering

The public map uses the shared published catalog. Every resource receives its own GPU vertex at the original coordinate at every zoom. Screen-space grouping combines overlapping interaction controls only; it does not replace the stored points or randomly offset locations. Solid and ring markers distinguish service locations from coverage resources.

The render loop runs only while the camera moves, rotation is enabled, or a change invalidates the scene. Filters, pointer/keyboard gestures, programmatic focus, resized canvases, decoded imagery, loaded boundaries, context recovery, and visibility changes wake it. Static frames cost no repeated GPU draws. Drawing-buffer dimensions use the same flooring rule as Three.js, avoiding framebuffer allocation loops at fractional device pixel ratios.

Perspective horizon checks prevent controls on the hidden part of Earth from covering visible points. Cluster controls continue tracking the centroid of their visible members between grouping passes. GPU picking chooses the closest visible point in screen space. Coordinate readouts retain five decimal places without implying the underlying source has that accuracy.

The initial 2K NASA surface remains small enough for a fast first view. Existing 8K imagery and 1:10m Natural Earth boundaries load as visitors zoom closer, respecting Data Saver and GPU texture limits. Images that fit the texture budget upload directly, avoiding a redundant full-resolution canvas copy. Boundary loading no longer recreates the Earth texture. Stable atlas lighting keeps the geography readable irrespective of the current solar position.

The cream/green public interface and pale map surround share existing navigation and page structure. There is no custom page-scroll engine. Ordinary wheel scrolling and vertical mobile swipes belong to the document; explicit map gestures control the globe.

## Verification

Run `npm run check` and the existing `npm run test:browser:qa`. The render-policy tests cover fractional framebuffer sizes, idle/moving states, and perspective occlusion. Browser checks cover filtering, selection, gesture ownership, off-screen behavior, desktop/mobile layout, recovery, and source links.

An engineering browser probe confirmed all 2,019 vertices were preserved at zoom levels 1, 3, 8, and 12. Maximum float32 coordinate round-trip error was 0.00000235 degrees. This measures numerical fidelity to the catalog, not surveyed address accuracy. Supabase's `rwn_coordinate_review` worklist records the remaining evidence checks; see the editor guide.
