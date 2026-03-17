import path from "node:path";

import { checkScope } from "@indiekit/endpoint-micropub/lib/scope.js";
import { excerpt } from "@indiekit/util";

import { statusTypes } from "../status-types.js";
import {
  getPosts,
  getPostTypeCounts,
  getPostStatusBadges,
  getPostName,
  getPhotoUrl,
} from "../utils.js";

/**
 * Build query string fragment for preserving filters in pagination/links
 * @param {object} params - Current filter state
 * @returns {string} Query string fragment (e.g. "&type=note&sort=oldest")
 */
function buildFilterQuery({ type, status, search, sort }) {
  const params = new URLSearchParams();
  if (type && type !== "all") params.set("type", type);
  if (status && status !== "published") params.set("status", status);
  if (search) params.set("search", search);
  if (sort && sort !== "newest") params.set("sort", sort);
  const str = params.toString();
  return str ? `&${str}` : "";
}

/**
 * List posts with filtering, search, sort, and pagination
 * @type {import("express").RequestHandler}
 */
export const postsController = async (request, response, next) => {
  try {
    const { application, publication } = request.app.locals;
    const { scope } = request.session;

    // Extract filter/search/sort/pagination from query string
    const postType = request.query.type || "all";
    const status = request.query.status || "published";
    const search = request.query.search || "";
    const sort = request.query.sort || "newest";
    const page = Number(request.query.page) || 0;
    const limit = Number(request.query.limit) || 20;
    const success = request.query.success;

    // Build query options (only include non-default values)
    const queryOptions = { page, limit, sort };
    if (postType !== "all") queryOptions.postType = postType;
    if (status !== "published") queryOptions.status = status;
    if (search) queryOptions.search = search;

    // Query MongoDB directly
    const { items, total } = await getPosts(application, queryOptions);
    const typeCounts = await getPostTypeCounts(application);

    // Map items to card format
    const posts = items.map((postData) => {
      const item = { ...postData.properties, uid: postData._id.toString() };
      item.id = item.uid;
      item.icon = item["post-type"];
      item.locale = application.locale;
      item.photo = getPhotoUrl(publication, item);
      item.description = {
        text:
          item.summary ||
          (item.content?.text &&
            excerpt(item.content.text, 30, publication.locale)),
      };
      item.title = getPostName(publication, item);
      item.url = path.join(request.baseUrl, request.path, item.uid);
      item.badges = getPostStatusBadges(item, response);
      return item;
    });

    // Build filter query string for pagination links
    const filterQuery = buildFilterQuery({
      type: postType,
      status,
      search,
      sort,
    });

    // Offset-based pagination
    const totalPages = Math.ceil(total / limit);
    const cursor = {};
    if (page < totalPages - 1) {
      cursor.next = { href: `?page=${page + 1}${filterQuery}` };
    }
    if (page > 0) {
      cursor.previous = { href: `?page=${page - 1}${filterQuery}` };
    }

    // Available post types from publication config with counts
    const postTypes = Object.entries(publication.postTypes).map(
      ([id, config]) => ({
        id,
        name: config.name,
        count: typeCounts.find((t) => t._id === id)?.count || 0,
      }),
    );

    response.render("posts", {
      title: response.locals.__("posts.posts.title"),
      actions: [
        scope && checkScope(scope, "create")
          ? {
              href: path.join(request.baseUrl + request.path, "/new"),
              icon: "createPost",
              text: response.locals.__("posts.create.action"),
            }
          : {},
        scope && checkScope(scope, "delete") && status === "deleted" && total > 0
          ? {
              classes: "actions__link--warning",
              href: path.join(request.baseUrl, "/purge-deleted"),
              icon: "delete",
              text: response.locals.__("posts.purgeAll.action"),
            }
          : {},
      ],
      cursor,
      posts,
      total,
      filters: { postType, status, search, sort },
      postTypes,
      parentUrl: request.baseUrl + request.path,
      statusTypes,
      success,
    });
  } catch (error) {
    next(error);
  }
};
