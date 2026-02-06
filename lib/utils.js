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
