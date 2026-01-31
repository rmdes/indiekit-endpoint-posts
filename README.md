# @rmdes/indiekit-endpoint-posts

Post management endpoint for Indiekit. View posts published by your Micropub endpoint and publish new posts to it.

## Fork Notice

This is a fork of `@indiekit/endpoint-posts` with a critical bug fix for the syndication form.

### Bug Fixed

The syndicate form button was using `data.url` for the `source_url` value, but `data` is never defined in the template context (the controller sets `properties`, not `data`). This caused the wrong post to be syndicated when clicking the "Syndicate" button.

**PR submitted upstream:** https://github.com/getindiekit/indiekit/pull/828

## Installation

```bash
npm install @rmdes/indiekit-endpoint-posts
```

### Using npm overrides (recommended)

Add to your `package.json`:

```json
{
  "overrides": {
    "@indiekit/endpoint-posts": "npm:@rmdes/indiekit-endpoint-posts@^1.0.0-beta.25"
  }
}
```

This replaces the upstream package with this fork without changing your plugin configuration.

## Options

| Option      | Type     | Description                                                     |
| :---------- | :------- | :-------------------------------------------------------------- |
| `mountPath` | `string` | Path to management interface. _Optional_, defaults to `/posts`. |

## License

MIT - Original work by Paul Robert Lloyd, bug fix by Ricardo Mendes.
