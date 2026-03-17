import { checkScope } from "@indiekit/endpoint-micropub/lib/scope.js";

import { getPosts, purgeAllDeletedPosts } from "../utils.js";

export const purgeAllController = {
  /**
   * Confirm purge of all deleted posts
   * @type {import("express").RequestHandler}
   */
  async get(request, response) {
    const { application } = request.app.locals;
    const { scope } = request.session;

    if (!scope || !checkScope(scope, "delete")) {
      return response.redirect(request.baseUrl);
    }

    // Count deleted posts for the confirmation message
    const { total } = await getPosts(application, { status: "deleted" });

    if (total === 0) {
      const message = encodeURIComponent(
        response.locals.__("posts.purgeAll.none"),
      );
      return response.redirect(`${request.baseUrl}?success=${message}`);
    }

    response.render("post-purge-all", {
      title: response.locals.__("posts.purgeAll.title"),
      deletedCount: total,
      postsPath: request.baseUrl,
    });
  },

  /**
   * Permanently delete all soft-deleted posts
   * @type {import("express").RequestHandler}
   */
  async post(request, response) {
    const { application } = request.app.locals;
    const { scope } = request.session;

    if (!scope || !checkScope(scope, "delete")) {
      return response.redirect(request.baseUrl);
    }

    try {
      const deletedCount = await purgeAllDeletedPosts(application);

      const message = encodeURIComponent(
        response.locals.__("posts.purgeAll.success", deletedCount),
      );
      response.redirect(`${request.baseUrl}?success=${message}`);
    } catch (error) {
      const { total } = await getPosts(application, {
        status: "deleted",
      });

      response.status(error.status || 500);
      response.render("post-purge-all", {
        title: response.locals.__("posts.purgeAll.title"),
        deletedCount: total,
        postsPath: request.baseUrl,
        error,
      });
    }
  },
};
