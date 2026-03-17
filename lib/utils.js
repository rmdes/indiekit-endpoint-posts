import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";

import { sanitise, ISO_6709_RE } from "@indiekit/util";
import { mf2tojf2 } from "@paulrobertlloyd/mf2tojf2";
import formatcoords from "formatcoords";

import { endpoint } from "./endpoint.js";
import { statusTypes } from "./status-types.js";

/**
 * Get layout `items` for select component
 * @param {object} publication - Publication configuration
 * @returns {Array} Items for select component, or empty array if no layouts configured
 */
export const getLayoutItems = (publication) => {
  if (!publication.layouts || !Array.isArray(publication.layouts)) {
    return [];
  }

  return [
    { text: "Default", value: "", selected: true },
    ...publication.layouts.map((layout) => ({
      text: layout.name,
      value: layout.path,
    })),
  ];
};

/**
 * Get geographic coordinates property
 * @param {string} geo - Latitude and longitude, comma separated
 * @returns {object} JF2 geo location property
 */
export const getGeoProperty = (geo) => {
  const { latitude, longitude } = geo.match(ISO_6709_RE).groups;

  return {
    type: "geo",
    name: formatcoords(geo).format({
      decimalPlaces: 2,
    }),
    latitude: Number(latitude),
    longitude: Number(longitude),
  };
};

/**
 * Get comma separated geographic coordinates
 * @param {object} location - JF2 location property
 * @returns {string|undefined} Latitude and longitude, comma separated
 */
export const getGeoValue = (location) => {
  if (location && location.geo) {
    return [location.geo.latitude, location.geo.longitude].toString();
  } else if (location && location.type === "geo") {
    return [location.latitude, location.longitude].toString();
  }
};

/**
 * Get location property
 * @param {object} values - Latitude and longitude, comma separated
 * @returns {object} JF2 location property
 */
export const getLocationProperty = (values) => {
  const { geo, location } = values;

  const hasGeo = geo && geo.length > 0;
  const hasLocation = location && Object.entries(sanitise(location)).length > 0;

  // Determine Microformat type
  if (hasLocation && location.name) {
    location.type = "card";
  } else if (hasLocation && !hasGeo) {
    location.type = "adr";
  }

  // Add (or use) any provided geo location properties
  if (hasLocation && hasGeo) {
    location.geo = getGeoProperty(geo);
  } else if (hasGeo) {
    return getGeoProperty(geo);
  }

  return sanitise(location);
};

/**
 * Get photo URL
 * @param {object} publication - Publication configuration
 * @param {object} properties - JF2 properties
 * @returns {object|boolean} Photo object, with URL
 */
export const getPhotoUrl = (publication, properties) => {
  const photo = Array.isArray(properties.photo)
    ? properties.photo[0]
    : properties.photo;

  if (!photo) {
    return false;
  } else if (URL.canParse(photo.url)) {
    return photo;
  } else {
    return {
      url: new URL(photo.url, publication.me).href,
    };
  }
};

/**
 * Get post status badges
 * @param {object} post - Post
 * @param {import("express").Response} response - Response
 * @returns {Array} Badges
 */
export const getPostStatusBadges = (post, response) => {
  const badges = [];

  if (post["post-status"]) {
    const statusType = post["post-status"];
    badges.push({
      color: statusTypes[statusType].color,
      size: "small",
      text: response.locals.__(statusTypes[statusType].text),
    });
  }

  if (post.deleted) {
    badges.push({
      color: statusTypes.deleted.color,
      size: "small",
      text: response.locals.__(statusTypes.deleted.text),
    });
  }

  return badges;
};

/**
 * Get post name, falling back to post type name
 * @param {object} publication - Publication configuration
 * @param {object} properties - JF2 properties
 * @returns {string} Post name or post type name
 */
export const getPostName = (publication, properties) => {
  if (properties.name) {
    return properties.name;
  }

  const type = properties["post-type"];
  const { name } = publication.postTypes[type];

  return name;
};

/**
 * Query database for post data by MongoDB _id
 * @param {string} uid - MongoDB ObjectId string
 * @param {object} application - Application object with collections
 * @returns {Promise<object|false>} JF2 properties or false if not found
 */
export const getPostProperties = async (uid, application) => {
  try {
    const postsCollection = application?.collections?.get("posts");
    if (!postsCollection) {
      return false;
    }

    // Query using aggregation to match _id as string (avoids BSON version issues)
    const results = await postsCollection
      .aggregate([
        {
          $match: {
            $expr: { $eq: [{ $toString: "$_id" }, uid] },
          },
        },
        { $limit: 1 },
      ])
      .toArray();

    const postData = results[0];

    if (!postData?.properties) {
      return false;
    }

    // Convert to JF2 format (properties already stored as JF2)
    return {
      ...postData.properties,
      uid: postData._id.toString(),
    };
  } catch (error) {
    // Invalid ObjectId or database error
    console.error("getPostProperties error:", error.message);
    return false;
  }
};

/**
 * Query posts collection with filters, search, sort, and pagination
 * @param {object} application - Application config (has collections Map)
 * @param {object} options - Query options
 * @param {string} [options.postType] - Filter by post-type (e.g. "note", "article")
 * @param {string} [options.status] - Filter by post-status ("published", "draft", "deleted")
 * @param {string} [options.search] - Text search (regex on name/content.text)
 * @param {string} [options.sort] - Sort direction ("newest" or "oldest")
 * @param {number} [options.page] - Page number (0-indexed)
 * @param {number} [options.limit] - Items per page
 * @returns {Promise<{items: Array, total: number}>}
 */
export const getPosts = async (application, options = {}) => {
  const { postType, status, search, sort = "newest", page = 0, limit = 20 } =
    options;

  const postsCollection = application?.collections?.get("posts");
  if (!postsCollection) {
    return { items: [], total: 0 };
  }

  // Build MongoDB filter
  const filter = {};

  if (postType) {
    filter["properties.post-type"] = postType;
  }

  if (status === "draft") {
    filter["properties.post-status"] = "draft";
  } else if (status === "deleted") {
    // deleted is stored as an ISO date string, not boolean
    filter["properties.deleted"] = { $exists: true };
  } else if (status === "all") {
    // No status filter — show everything
  } else {
    // Default: "published" — exclude drafts and deleted
    filter["properties.post-status"] = { $ne: "draft" };
    filter["properties.deleted"] = { $exists: false };
  }

  if (search) {
    // Escape regex special characters in search term
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { "properties.name": { $regex: escaped, $options: "i" } },
      { "properties.content.text": { $regex: escaped, $options: "i" } },
    ];
  }

  const sortDirection = sort === "oldest" ? 1 : -1;

  const [items, total] = await Promise.all([
    postsCollection
      .find(filter)
      .sort({ "properties.published": sortDirection })
      .skip(page * limit)
      .limit(limit)
      .toArray(),
    postsCollection.countDocuments(filter),
  ]);

  return { items, total };
};

/**
 * Get post counts grouped by post-type
 * @param {object} application - Application config
 * @returns {Promise<Array<{_id: string, count: number}>>}
 */
export const getPostTypeCounts = async (application) => {
  const postsCollection = application?.collections?.get("posts");
  if (!postsCollection) {
    return [];
  }

  return postsCollection
    .aggregate([
      {
        $group: {
          _id: "$properties.post-type",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray();
};

/**
 * Permanently delete a post from MongoDB
 * @param {string} uid - MongoDB ObjectId string
 * @param {object} application - Application object with collections
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export const purgePost = async (uid, application) => {
  const postsCollection = application?.collections?.get("posts");
  if (!postsCollection) {
    return false;
  }

  // Match _id as string to avoid BSON version issues
  const result = await postsCollection.deleteOne({
    $expr: { $eq: [{ $toString: "$_id" }, uid] },
  });

  return result.deletedCount > 0;
};

/**
 * Permanently delete all soft-deleted posts from MongoDB
 * @param {object} application - Application object with collections
 * @returns {Promise<number>} Number of posts deleted
 */
export const purgeAllDeletedPosts = async (application) => {
  const postsCollection = application?.collections?.get("posts");
  if (!postsCollection) {
    return 0;
  }

  const result = await postsCollection.deleteMany({
    "properties.deleted": { $exists: true },
  });

  return result.deletedCount;
};

/**
 * Query database for post data by Micropub URL
 * @param {string} url - Micropub URL (e.g. https://example.com/articles/2026/02/13/slug)
 * @param {object} application - Application object with collections
 * @returns {Promise<object|false>} JF2 properties with uid, or false if not found
 */
export const getPostPropertiesByUrl = async (url, application) => {
  try {
    const postsCollection = application?.collections?.get("posts");
    if (!postsCollection) {
      return false;
    }

    const postData = await postsCollection.findOne({ "properties.url": url });

    if (!postData?.properties) {
      return false;
    }

    return {
      ...postData.properties,
      uid: postData._id.toString(),
    };
  } catch {
    return false;
  }
};

/**
 * Get post URL from ID
 * @param {string} id - ID
 * @returns {string} Post URL
 */
export const getPostUrl = (id) => {
  const url = Buffer.from(id, "base64url").toString("utf8");
  return new URL(url).href;
};

/**
 * Get syndication target `items` for checkboxes component
 * @param {object} publication - Publication configuration
 * @param {boolean} [checkTargets] - Select ’checked’ targets
 * @returns {object} Items for checkboxes component
 */
export const getSyndicateToItems = (publication, checkTargets = false) => {
  return publication.syndicationTargets.map((target) => ({
    label: target.info.service.name,
    ...(target?.info?.error
      ? {
          disabled: true,
          hint: target?.info?.error || false,
        }
      : {
          hint: target?.info.uid,
          value: target?.info.uid,
          ...(checkTargets && { checked: target.options.checked }),
        }),
  }));
};

/** Directory name → post-type mapping */
const dirToPostType = {
  articles: "article",
  notes: "note",
  likes: "like",
  bookmarks: "bookmark",
  photos: "photo",
  replies: "reply",
  reposts: "repost",
  pages: "page",
  videos: "video",
  audio: "audio",
  jams: "jam",
  rsvps: "rsvp",
  events: "event",
};

/**
 * Derive file path from a post URL
 * Supports both Eleventy format (/content/TYPE/YYYY-MM-DD-slug/)
 * and clean Indiekit format (/TYPE/YYYY/MM/DD/slug)
 * @param {string} url - Full URL or pathname
 * @returns {string|false} Relative file path (e.g. "articles/2019-01-12-slug.md")
 */
export const deriveFilePathFromUrl = (url) => {
  try {
    let pathname = url;

    // Extract pathname from full URL
    if (url.startsWith("http://") || url.startsWith("https://")) {
      pathname = new URL(url).pathname;
    }

    // Strip trailing slash
    pathname = pathname.replace(/\/$/, "");

    // Format 1: /content/TYPE/YYYY-MM-DD-slug (Eleventy output URL)
    if (pathname.startsWith("/content/")) {
      const relative = pathname.replace(/^\/content\//, "");
      return `${relative}.md`;
    }

    // Format 2: /TYPE/YYYY/MM/DD/slug (clean Indiekit URL)
    const match = pathname.match(
      /^\/([a-z]+)\/(\d{4})\/(\d{2})\/(\d{2})\/(.+)$/,
    );
    if (match) {
      const [, type, year, month, day, slug] = match;
      return `${type}/${year}-${month}-${day}-${slug}.md`;
    }

    return false;
  } catch {
    return false;
  }
};

/**
 * Parse YAML frontmatter and content from a Markdown file string
 * @param {string} fileContent - Raw file content
 * @returns {{frontmatter: object, content: string}}
 */
const parseFrontmatterAndContent = (fileContent) => {
  const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, content: fileContent };
  }

  // Parse YAML manually (simple key-value and arrays)
  const yamlStr = fmMatch[1];
  const content = fmMatch[2] || "";
  const frontmatter = {};

  let currentKey = null;
  let inArray = false;

  for (const line of yamlStr.split("\n")) {
    // Array item
    if (inArray && line.startsWith("  - ")) {
      if (!Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey] = [];
      }
      frontmatter[currentKey].push(line.replace(/^\s+- /, "").trim());
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      inArray = false;

      if (value === "") {
        // Could be start of array or empty value
        inArray = true;
        frontmatter[currentKey] = [];
      } else {
        // Strip quotes
        frontmatter[currentKey] = value.replace(/^["']|["']$/g, "");
      }
    } else {
      inArray = false;
    }
  }

  return { frontmatter, content };
};

/**
 * Clean up migrated post content
 * Strips common cruft from old posts (date headers, webmention footers)
 * @param {string} content - Raw markdown content
 * @returns {string} Cleaned content
 */
const cleanMigratedContent = (content) => {
  let cleaned = content;

  // Strip leading date-link headers: [ January 12, 2019 ](https://...)
  cleaned = cleaned.replace(
    /^\s*\[\s*[A-Z][a-z]+ \d{1,2},? \d{4}\s*\]\s*\(https?:\/\/[^)]+\)\s*/,
    "",
  );

  // Strip leading H2 that duplicates the title with a link
  cleaned = cleaned.replace(/^\s*## \[[^\]]+\]\(https?:\/\/[^)]+\)\s*\n?/, "");

  // Strip "X min read" after title headers
  cleaned = cleaned.replace(/^\s*\d+ min read\s*\n?/, "");

  // Strip trailing webmention reaction sections
  // Common pattern: a horizontal rule followed by likes/reposts/mentions
  cleaned = cleaned.replace(
    /\n---+\s*\n[\s\S]*?(liked|reposted|replied|mentioned|bookmarked)\s+this\b[\s\S]*$/i,
    "",
  );

  return cleaned.trim();
};

/**
 * Import a migrated post from disk into MongoDB (on-demand)
 * Called when the edit controller can't find the post in the database.
 * @param {string} url - The post's mpUrl (used to derive file path)
 * @param {object} publication - Publication config (has store, me)
 * @param {object} application - Application config (has collections)
 * @returns {Promise<{uid: string}|false>} The new post's uid, or false on failure
 */
export const importPostFromFile = async (url, publication, application) => {
  try {
    const postsCollection = application?.collections?.get("posts");
    if (!postsCollection) {
      console.log("[import] FAIL: no posts collection");
      return false;
    }

    // Check if already imported (race condition guard)
    const existing = await postsCollection.findOne({ "properties.url": url });
    if (existing) {
      console.log("[import] already in DB by url, uid=%s", existing._id);
      return { uid: existing._id.toString() };
    }

    // Derive file path from URL
    const relativePath = deriveFilePathFromUrl(url);
    if (!relativePath) {
      console.log("[import] FAIL: could not derive path from url=%s", url);
      return false;
    }
    console.log("[import] relativePath=%s", relativePath);

    // Get content directory from the store
    const contentDir = publication.store?.options?.directory;
    if (!contentDir) {
      console.log(
        "[import] FAIL: no contentDir. store=%o, store.options=%o",
        typeof publication.store,
        publication.store?.options,
      );
      return false;
    }

    const absolutePath = path.join(contentDir, relativePath);
    console.log("[import] absolutePath=%s", absolutePath);

    // Check if also already imported by path
    const existingByPath = await postsCollection.findOne({
      path: relativePath,
    });
    if (existingByPath) {
      console.log("[import] already in DB by path, uid=%s", existingByPath._id);
      return { uid: existingByPath._id.toString() };
    }

    // Read the file
    let fileContent;
    try {
      fileContent = await fs.readFile(absolutePath, "utf-8");
    } catch (readError) {
      console.log(
        "[import] FAIL: could not read file %s: %s",
        absolutePath,
        readError.message,
      );
      return false;
    }
    console.log("[import] file read OK, length=%d", fileContent.length);

    // Parse frontmatter and content
    const { frontmatter, content } = parseFrontmatterAndContent(fileContent);
    console.log("[import] frontmatter keys=%s", Object.keys(frontmatter));

    // Derive post-type from directory name
    const dirName = relativePath.split("/")[0];
    const postType = dirToPostType[dirName] || "note";

    // Clean the content
    const cleanedContent = cleanMigratedContent(content);

    // Build JF2 properties
    const properties = {
      url,
      "post-type": postType,
      ...(frontmatter.date && { published: frontmatter.date }),
      ...(frontmatter.title && { name: frontmatter.title }),
      ...(cleanedContent && { content: { text: cleanedContent } }),
      ...(frontmatter.category && {
        category: Array.isArray(frontmatter.category)
          ? frontmatter.category
          : [frontmatter.category],
      }),
      ...(frontmatter.visibility && { visibility: frontmatter.visibility }),
    };

    // Insert into MongoDB
    const result = await postsCollection.insertOne({
      path: relativePath,
      properties,
    });

    console.log("[import] SUCCESS: inserted uid=%s", result.insertedId);
    return { uid: result.insertedId.toString() };
  } catch (error) {
    console.error("[import] ERROR:", error.message, error.stack);
    return false;
  }
};
