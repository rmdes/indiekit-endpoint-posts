import { Buffer } from "node:buffer";

import { sanitise, ISO_6709_RE } from "@indiekit/util";
import { mf2tojf2 } from "@paulrobertlloyd/mf2tojf2";
import formatcoords from "formatcoords";

import { endpoint } from "./endpoint.js";
import { statusTypes } from "./status-types.js";

/**
 * Get channel `items` for checkboxes component
 * @param {object} publication - Publication configuration
 * @returns {object} Items for checkboxes component
 */
export const getChannelItems = (publication) => {
  return Object.entries(publication.channels).map(([uid, channel]) => ({
    label: channel.name,
    value: uid,
  }));
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
