# @rmdes/indiekit-endpoint-posts

Post management endpoint for Indiekit. View, create, edit, and delete posts published through your Micropub endpoint.

## Fork Notice

This is a **fork** of `@indiekit/endpoint-posts` with three critical bug fixes:

### 1. Syndication Form Bug Fix (CRITICAL)

The syndicate button was using `data.url` for the `source_url` value, but `data` is never defined in the template context. The controller passes `properties`, not `data`. This caused syndication to fail or syndicate the wrong post.

**Fixed:** Changed `value: data.url` to `value: properties.url` in `includes/@indiekit-endpoint-posts-syndicate.njk`

**PR submitted upstream:** https://github.com/getindiekit/indiekit/pull/828

### 2. MongoDB Query Performance Fix

The original `getPostProperties()` function queried the Micropub endpoint without any filter (`q=source`), fetching only the first 40 posts and searching through them client-side. **This made posts older than 40 items completely inaccessible**, causing 404 errors when trying to view or edit them.

**Fixed:** Now queries the MongoDB database directly by `_id`, which is efficient and works regardless of how many posts exist.

### 3. BSON Version Conflict Fix

Using `ObjectId` from the MongoDB driver caused BSON version conflicts between Indiekit's MongoDB version and plugin dependencies, resulting in runtime errors.

**Fixed:** Use aggregation pipeline with `$toString` to compare `_id` as string, avoiding the need to import `ObjectId`.

## Installation

```bash
npm install @rmdes/indiekit-endpoint-posts
```

### Using npm Overrides (Recommended)

Add to your `package.json`:

```json
{
  "overrides": {
    "@indiekit/endpoint-posts": "npm:@rmdes/indiekit-endpoint-posts@^1.0.0-beta.25"
  }
}
```

This replaces the upstream package with this fork automatically, without changing your plugin configuration.

## Usage

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

## Features

- **List posts** with cursor-based pagination
- **View post details** with status badges and syndication info
- **Create posts** with dynamic forms based on post type
- **Edit posts** with all properties and advanced options
- **Delete/undelete posts** with confirmation
- **Syndicate posts** to configured targets via button
- **Multi-language support** (14 languages)
- **Draft mode** for unpublished posts
- **Media uploads** (audio, photo, video)
- **Scheduled publishing** with timezone support
- **Multi-channel publishing** (if configured)
- **Geographic coordinates** (ISO 6709 format)

## Options

| Option      | Type     | Description                                                     |
| :---------- | :------- | :-------------------------------------------------------------- |
| `mountPath` | `string` | Path to management interface. _Optional_, defaults to `/posts`. |

## Differences from Upstream

1. **Syndicate form uses correct variable** (`properties.url` instead of `data.url`)
2. **Posts are queried directly from MongoDB** (not via Micropub endpoint)
3. **No BSON version dependency** (uses aggregation with string comparison)

## Related Plugins

- **`@rmdes/indiekit-endpoint-micropub`**: Posts are created/updated/deleted via Micropub
- **`@rmdes/indiekit-endpoint-syndicate`**: Receives syndicate button POSTs
- **Post type plugins**: Define fields and validation for each post type (note, article, etc.)

## Documentation

See [CLAUDE.md](./CLAUDE.md) for comprehensive technical reference, including:
- Complete architecture overview
- File-by-file documentation
- Data flow diagrams
- Configuration examples
- Inter-plugin relationships
- Known gotchas and workarounds

## License

MIT - Original work by Paul Robert Lloyd, bug fixes by Ricardo Mendes.
