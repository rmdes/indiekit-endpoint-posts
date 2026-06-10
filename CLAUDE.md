# CLAUDE.md - @rmdes/indiekit-endpoint-posts

## Package Overview

**Package:** `@rmdes/indiekit-endpoint-posts`
**Version:** see package.json
**Type:** Indiekit endpoint plugin (fork of `@indiekit/endpoint-posts`)
**Purpose:** Post management admin interface for viewing, creating, editing, and deleting posts published by Micropub

This is a **fork** of the upstream `@indiekit/endpoint-posts` package with critical bug fixes. It provides the posts management UI at `/posts` in the Indiekit admin dashboard.

## Upstream Differences

This fork contains **four custom fixes** not present in upstream Indiekit:

### 1. Syndicate Form Bug Fix (CRITICAL)

**File:** `includes/@indiekit-endpoint-posts-syndicate.njk`
**Problem:** The syndicate button was using `data.url` for the `source_url` value, but `data` is never defined in the template context. The controller passes `properties`, not `data`.
**Effect:** When clicking "Syndicate", the wrong (or no) post URL was sent to the syndication endpoint.
**Fix:** Changed `value: data.url` to `value: properties.url`
**Status:** PR submitted upstream (https://github.com/getindiekit/indiekit/pull/828)

**Note:** The upstream fork at `/home/rick/code/indiekit-dev/indiekit/` already has this fix (commit 524e7714), so this fork matches that fix.

### 2. MongoDB Query Performance Fix

**File:** `lib/utils.js` - `getPostProperties()`
**Problem:** The function was querying the Micropub endpoint without any filter (`q=source`), getting only the first 40 posts, then searching through them client-side. Posts older than 40 items couldn't be found → 404 errors when trying to view/edit them.
**Effect:** Any post past the first page (>40 posts) was inaccessible in the admin UI.
**Fix:** Changed to query the MongoDB database directly by `_id`, which is efficient and works regardless of post count.
**Commit:** 05f42d5

**Before:**
```javascript
// Query Micropub endpoint (inefficient, limited to first 40 posts)
const micropubUrl = new URL(micropubEndpoint);
micropubUrl.searchParams.append("q", "source");
const micropubResponse = await endpoint.get(micropubUrl.href, accessToken);
const items = jf2.children || [jf2];
return items.find((item) => item.uid === uid);
```

**After:**
```javascript
// Query database directly by _id (fast, works for any post)
const postsCollection = application?.collections?.get("posts");
const results = await postsCollection.aggregate([
  { $match: { $expr: { $eq: [{ $toString: "$_id" }, uid] } } },
  { $limit: 1 },
]).toArray();
return { ...postData.properties, uid: postData._id.toString() };
```

### 3. BSON Version Conflict Fix

**File:** `lib/utils.js` - `getPostProperties()`
**Problem:** Using `ObjectId` from MongoDB driver caused BSON version conflicts between Indiekit's MongoDB version and the plugin's dependencies.
**Effect:** Runtime errors when trying to convert uid strings to ObjectId instances.
**Fix:** Use aggregation pipeline with `$toString` to compare `_id` as string, avoiding the need to import `ObjectId` at all.
**Commit:** df3a472

```javascript
// No need to import ObjectId or handle BSON versions
const results = await postsCollection.aggregate([
  {
    $match: {
      $expr: { $eq: [{ $toString: "$_id" }, uid] }  // Compare as strings
    }
  },
  { $limit: 1 }
]).toArray();
```

### 4. Syndicator Error Hardening (June 2026)

**File:** `lib/utils.js` - `getSyndicateToItems()`
**Problem:** The syndicate target list was reading each syndicator's `info` getter directly without error handling. A misconfigured syndicator (e.g., Mastodon with an empty instance URL doing `new URL("")`) throws `TypeError: Invalid URL`, which propagates out of the create/edit form middleware and returns a 500 on `/posts/create` and `/posts/:uid/update` for every post type.
**Effect:** Single misconfigured syndicator breaks the entire posts editor for all users.
**Fix:** Wrap each syndicator's `info` getter in a try-catch. On failure, render the target as a disabled item with a hint instead of crashing. No unconfigured plugin should crash core features.
**Commit:** 41eb8f4

```javascript
// Before: Direct info access (crashes on misconfigured syndicator)
const items = syndication.map((target) => {
  const info = target.info;  // Throws if target is broken
  return { name: info.name, ... }
})

// After: Safe error handling
const items = syndication.map((target) => {
  let info;
  try {
    info = target.info;
  } catch (error) {
    // Render as disabled with hint
    return {
      name: target.uid,
      disabled: true,
      hint: "Syndicator is misconfigured"
    }
  }
  return { name: info.name, ... }
})
```

## Architecture

### Plugin Structure

```
indiekit-endpoint-posts/
├── index.js                    # Plugin entry point, route definitions
├── lib/
│   ├── endpoint.js             # Micropub API wrapper (GET/POST)
│   ├── status-types.js         # Post status badges (published, draft, deleted)
│   ├── utils.js                # Helper functions (post name, photo URL, location, DB queries)
│   ├── controllers/
│   │   ├── posts.js            # List posts (paginated)
│   │   ├── post.js             # View single post
│   │   ├── new.js              # Select post type to create
│   │   ├── form.js             # Create/update post form
│   │   └── delete.js           # Delete/undelete post
│   └── middleware/
│       ├── post-data.js        # Fetch post data and populate response.locals
│       └── validation.js       # Express-validator schemas
├── views/                      # Nunjucks templates
│   ├── posts.njk               # Post list (card grid)
│   ├── post.njk                # Single post view
│   ├── new.njk                 # Post type selector
│   ├── post-form.njk           # Create/edit form
│   └── post-delete.njk         # Delete confirmation
├── includes/
│   └── @indiekit-endpoint-posts-syndicate.njk  # Syndicate button form
├── locales/                    # i18n translations (14 languages)
└── assets/                     # Icons and static assets
```

### Data Flow

```
User clicks post in /posts
        ↓
postData.read middleware
        ↓
getPostProperties(uid, application) — queries MongoDB by _id
        ↓
Populates response.locals with JF2 properties
        ↓
postController renders post.njk
        ↓
Template includes @indiekit-endpoint-posts-syndicate.njk (if syndication targets exist)
```

### Key Middleware Pattern

**`postData.read`** (used for viewing/editing/deleting posts):
- Extracts `uid` from URL params (MongoDB `_id` as string)
- Queries database for post properties
- Populates `response.locals` with:
  - `properties` (JF2 post data)
  - `postName`, `postType`, `postStatus`
  - `fields` (form fields from post type config)
  - `syndicationTargetItems` (available targets)
  - `channelItems` (publication channels)
  - `accessToken`, `scope`

**`postData.create`** (used for new posts):
- Gets `postType` from query string (`?type=note`)
- Creates empty `properties` object
- Populates same `response.locals` structure

## Key Files

### `index.js` - Plugin Entry Point

Exports `PostsEndpoint` class:
- **`name`**: "Post management endpoint"
- **`mountPath`**: `/posts` (configurable)
- **`navigationItems`**: Adds "Posts" to main navigation (requires database)
- **`shortcutItems`**: Adds "Create post" web app shortcut
- **`routes`**: Defines all post management routes
- **`validationSchemas`**: Form validation rules for content, media, geo, etc.
- **`init(Indiekit)`**: Registers endpoint and sets `application.postsEndpoint`

**Route Map:**
```
GET  /posts               → postsController (list posts)
GET  /posts/new           → newController.get (select post type)
POST /posts/new           → newController.post (redirect to create form)
GET  /posts/create?type=X → formController.get (create form)
POST /posts/create        → formController.post (submit to Micropub)
GET  /posts/:uid          → postController (view post)
GET  /posts/:uid/update   → formController.get (edit form)
POST /posts/:uid/update   → formController.post (submit update)
GET  /posts/:uid/delete   → deleteController.get (confirm delete)
POST /posts/:uid/delete   → deleteController.post (submit delete)
GET  /posts/:uid/undelete → deleteController.get (confirm undelete)
POST /posts/:uid/undelete → deleteController.post (submit undelete)
```

### `lib/utils.js` - Helper Functions

**`getPostProperties(uid, application)`** (CUSTOM FIX)
- Queries MongoDB posts collection directly by `_id`
- Uses aggregation with `$toString` to avoid BSON version issues
- Returns JF2 properties with `uid` added
- Returns `false` if not found (404 handling)

**`getPostName(publication, properties)`**
- Returns `properties.name` if exists
- Falls back to post type name (e.g., "Note", "Article")

**`getPhotoUrl(publication, properties)`**
- Extracts first photo from `properties.photo` array
- Resolves relative URLs against `publication.me`

**`getLocationProperty(values)`**
- Combines `location` and `geo` form values into JF2 location property
- Handles card, adr, and geo Microformat types

**`getGeoValue(location)`**
- Extracts comma-separated coordinates from JF2 location property
- Returns `"lat,lng"` string for form population

**`getSyndicateToItems(publication, checkTargets)`**
- Converts `publication.syndicationTargets` to checkbox items
- Marks targets as disabled if they have errors
- Optionally pre-checks targets marked as `checked: true` in config

**`getChannelItems(publication)`**
- Converts `publication.channels` to checkbox items for multi-channel publishing

**`getPostStatusBadges(post, response)`**
- Returns array of badge objects for post status (published, draft, deleted, visibility)

### `lib/controllers/posts.js` - Post Listing

**Features:**
- Cursor-based pagination (after/before params)
- Queries Micropub endpoint `?q=source&limit=12`
- Converts MF2 to JF2 with `mf2tojf2()`
- Maps each post to card grid item with:
  - `title` (post name or post type name)
  - `description` (summary or excerpt)
  - `photo` (first photo or featured image)
  - `badges` (status indicators)
  - `url` (link to `/posts/:uid`)
- Displays "Create Post" action button (if scope permits)

### `lib/controllers/form.js` - Create/Update Forms

**Features:**
- Handles both `create` and `update` actions
- Form validation with `express-validator`
- Date handling:
  - "Now" option: Deletes local `published` value, lets server set date
  - "Scheduled" option: Converts local datetime to zoned datetime with `formatLocalToZonedDate()`
- Media handling: Converts media objects to arrays
- Location handling: Derives location from `location` and/or `geo` values
- Converts JF2 to MF2 with `jf2ToMf2()` before POSTing to Micropub
- For updates: Wraps in `{ action: "update", url: ..., replace: { ... } }` JSON

**Non-MF2 properties deleted before submission:**
- `all-day` (UI flag for event dates)
- `geo` (converted to location property)
- `postType` (UI metadata)
- `publication-date` (UI flag for now/scheduled)
- `image` (EasyMDE artifact)

### `lib/controllers/delete.js` - Delete/Undelete

**Features:**
- Sends `action=delete` or `action=undelete` to Micropub endpoint as query params
- Uses POST request (no JSON body)
- Redirects back to post list with success message

### `lib/middleware/post-data.js` - Request Context

**`postData.create(request, response, next)`**
- Used for `/posts/create?type=X`
- Gets post type config from `publication.postTypes[postType]`
- Creates empty `properties` object
- Determines `checkTargets` flag (auto-check targets on first view only)
- Populates `response.locals`

**`postData.read(request, response, next)`**
- Used for `/posts/:uid`, `/posts/:uid/update`, `/posts/:uid/delete`
- Calls `getPostProperties(uid, application)` to fetch post from database
- Extracts `allDay` flag (event dates without time)
- Extracts `geo` value from location property (for form population)
- Populates `response.locals` with all post data and metadata

### `views/post.njk` - Single Post View

**Features:**
- Displays status badges (deleted, draft, visibility, syndicated)
- Includes syndicate form button (if `properties["mp-syndicate-to"]` exists and status is published)
- Renders post properties with type-specific templates (e.g., `post-types/name.njk`, `post-types/content.njk`)
- Collapsible "Post properties" details section with all raw JF2 properties

### `views/post-form.njk` - Create/Edit Form

**Features:**
- Hidden inputs: `type` (h-entry, h-event, etc.), `postType` (note, article, etc.)
- Dynamic fields based on post type config (`{% include "post-types/" + name + "-field.njk" %}`)
- Syndication targets checkboxes (with disabled state for errors)
- Advanced options (collapsible):
  - Publication date (now vs. scheduled)
  - Channels (multi-checkbox)
  - Visibility (public, private, unlisted)
  - URL slug (editable)
- Submit buttons:
  - "Publish" / "Update" (for `post-status=published`)
  - "Publish Draft" / "Update Draft" (for `post-status=draft`)
  - Cancel link

### `includes/@indiekit-endpoint-posts-syndicate.njk` - Syndicate Button

**THE FIX:**
```nunjucks
<form action="{{ application._syndicationEndpointPath }}" method="post">
  {{ input({ name: "access_token", type: "hidden", value: token }) }}
  {{ input({ name: "syndication[redirect_uri]", type: "hidden", value: redirectUri }) }}
  {{ button({
    name: "syndication[source_url]",
    value: properties.url,  ← FIXED: was `data.url`
    icon: "syndicate",
    text: __("posts.post.syndicate")
  }) }}
</form>
```

**How it works:**
- Posts to `@rmdes/indiekit-endpoint-syndicate`
- Sends `access_token`, `source_url`, and `redirect_uri`
- Syndication endpoint fetches the post, sends to configured syndicators
- Redirects back to `redirectUri` (the post view page)

## Configuration

### Basic Usage

```javascript
import PostsEndpoint from "@rmdes/indiekit-endpoint-posts";

export default {
  plugins: [
    new PostsEndpoint({
      mountPath: "/posts",  // Optional, default: "/posts"
    }),
  ],
};
```

### Using npm Overrides (Recommended)

To replace the upstream package system-wide:

```json
{
  "overrides": {
    "@indiekit/endpoint-posts": "npm:@rmdes/indiekit-endpoint-posts@^1.0.0-beta.25"
  }
}
```

This allows other plugins that depend on `@indiekit/endpoint-posts` to use this fork automatically.

## Inter-Plugin Relationships

### Required Dependencies
- **`@indiekit/endpoint-micropub`**: Posts are queried/created/updated/deleted via Micropub. The posts endpoint acts as an admin UI wrapper around Micropub.
- **MongoDB database**: Post data is stored in the `posts` collection. The endpoint queries it directly (custom fix).
- **Authentication**: Requires `access_token` and `scope` from session (IndieAuth).

### Works With
- **`@rmdes/indiekit-endpoint-syndicate`**: The syndicate button POSTs to this endpoint.
- **`@rmdes/indiekit-syndicator-*`**: Syndicators are displayed as checkboxes in the create/edit form (`mp-syndicate-to`).
- **Post type plugins**: The form dynamically loads fields from post type configs (e.g., `@indiekit/post-type-note`, `@rmdes/indiekit-post-type-page`).
- **Preset plugins**: Post types are defined by presets (e.g., `@rmdes/indiekit-preset-eleventy`).

### Provides
- **`application.postsEndpoint`**: Path to posts endpoint (used by other plugins for linking)
- **Navigation item**: "Posts" in main navigation (requires database)
- **Shortcut item**: "Create post" web app shortcut
- **Homepage widget**: Recent posts widget (requires database)

## Gotchas

### 1. Post UIDs are MongoDB ObjectIds, Not URLs

The `uid` in `/posts/:uid` is a MongoDB `_id` string (e.g., `"65f8a3b2c1d4e5f6a7b8c9d0"`), NOT a base64url-encoded post URL like in some Indiekit contexts.

**Why:** Posts are queried directly from the database (custom fix), so the `_id` is the natural identifier.

### 2. Post Listing is Limited to 12 per Page

The `postsController` queries Micropub with `limit=12`. For large sites, posts beyond the first page are only accessible via cursor pagination (after/before params).

**Why:** Cursor-based pagination is more efficient than offset pagination for large datasets.

### 3. Draft Mode Restrictions

If the user's scope includes `draft` (but not `create` or `update`), they can only edit posts with `post-status=draft`. Published posts become read-only.

**Where:** `lib/controllers/post.js` - `postEditable = draftMode ? postStatus === "draft" : true`

### 4. Syndicate Button Only Shows for Published Posts

The syndicate form is conditionally included:
```nunjucks
{% if postStatus === "published" and properties["mp-syndicate-to"] %}
  {% include "@indiekit-endpoint-posts-syndicate.njk" %}
{% endif %}
```

**Why:** Syndication only makes sense for published posts. The `mp-syndicate-to` property is set when the post is created with syndication targets checked.

### 5. Media Values are Objects in Forms, Arrays in MF2

The form uses indexed objects (`photo[0][url]`, `photo[0][alt]`), but MF2 expects arrays. The `formController` converts:
```javascript
for (const key of ["audio", "photo", "video"]) {
  if (values[key]) {
    values[key] = Object.values(values[key]);
  }
}
```

### 6. Slug is Only Editable for New Posts

The `mp-slug` field is shown in advanced options, but only for new posts. Editing a post's slug after creation is not supported (would break permalinks).

**Where:** `views/post-form.njk` - always shows `mp-slug` input, but Micropub ignores it on updates

### 7. Geo Coordinates Must Match ISO 6709 Format

The `geo` input is validated with `ISO_6709_RE` from `@indiekit/util`:
```javascript
geo: {
  errorMessage: (value, { req }) => req.__(`posts.error.geo.invalid`),
  exists: { if: (value, { req }) => req.body?.geo },
  custom: {
    options: (value) => value.match(ISO_6709_RE),
  },
}
```

**Example valid format:** `+52.5200-013.4050/` or `52.52,-13.405`

### 8. Date Handling Requires Timezone

When scheduling posts, the local datetime-local input is converted to a zoned datetime string using `application.timeZone`:
```javascript
values.published = formatLocalToZonedDate(values.published, timeZone);
```

**Why:** Micropub expects ISO 8601 dates with timezone designators (e.g., `2025-02-06T14:30:00+01:00`).

### 9. Validation Schemas are Registered Globally

The `validationSchemas` from this plugin (and post type plugins) are registered on `application.validationSchemas` and merged at runtime. The `validate.form` middleware uses `checkSchema()` on the merged schemas.

**Where:** `index.js` - `validationSchemas` getter, `lib/middleware/validation.js` - `validate.form`

### 10. Post Deletion is Logical, Not Physical

Deleting a post sets `deleted: true` in MongoDB, but doesn't remove the document. The Micropub endpoint handles this.

**Why:** Allows undelete functionality. Posts with `deleted: true` are hidden from listing but accessible via direct URL.

## Commands

### Development

```bash
# Install dependencies
npm install

# Link for local testing
npm link

# In Indiekit project
npm link @rmdes/indiekit-endpoint-posts
```

### Publishing

```bash
# Bump version
npm version patch  # or minor, major

# Publish to npm (requires OTP)
npm publish
```

**Note:** Publishing requires 2FA. The user must run `npm publish` manually.

## Related Plugins

- **`@rmdes/indiekit-endpoint-micropub`**: Fork with custom type-based post discovery (posts endpoint depends on this)
- **`@rmdes/indiekit-endpoint-syndicate`**: Receives syndicate button POSTs
- **`@indiekit/endpoint-auth`**: Provides IndieAuth authentication (access token, scope)
- **Post type plugins**: Define fields, validation, and rendering for each post type
- **Preset plugins**: Define post types and URL templates

## License

MIT - Original work by Paul Robert Lloyd, bug fixes by Ricardo Mendes.
