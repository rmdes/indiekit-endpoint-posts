import { checkScope } from "@indiekit/endpoint-micropub/lib/scope.js";

import { purgePost } from "../utils.js";

export const purgeController = {
  /**
   * Confirm permanent deletion
   * @type {import("express").RequestHandler}
   */
  async get(request, response) {
    const { postName, postsPath, properties, scope } = response.locals;

    if (scope && checkScope(scope, "delete") && properties.deleted) {
      return response.render("post-purge", {
        title: response.locals.__("posts.purge.title"),
        parent: { text: postName },
      });
    }

    response.redirect(postsPath);
  },

  /**
   * Permanently delete post from database
   * @type {import("express").RequestHandler}
   */
  async post(request, response) {
    const { application } = request.app.locals;
    const { properties, postsPath } = response.locals;
    const uid = request.params.uid;

    try {
      // Only allow purging already soft-deleted posts
      if (!properties.deleted) {
        response.redirect(postsPath);
        return;
      }

      await purgePost(uid, application);

      const message = encodeURIComponent(
        response.locals.__("posts.purge.success"),
      );
      response.redirect(`${request.baseUrl}?success=${message}`);
    } catch (error) {
      response.status(error.status || 500);
      response.render("post-purge", {
        title: response.locals.__("posts.purge.title"),
        parent: { text: postName },
        error,
      });
    }
  },
};
