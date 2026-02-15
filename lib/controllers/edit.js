import { getPostPropertiesByUrl, importPostFromFile } from "../utils.js";

export const editController = {
  async get(request, response, next) {
    try {
      const { url } = request.query;
      const { application, publication } = request.app.locals;

      console.log("[edit] url=%s", url);

      if (!url) {
        console.log("[edit] no url, redirecting to posts list");
        return response.redirect(request.baseUrl);
      }

      // Try MongoDB lookup first (works for posts created via Micropub)
      const properties = await getPostPropertiesByUrl(url, application);

      if (properties) {
        const target = `${request.baseUrl}/${properties.uid}/update`;
        console.log("[edit] found in DB, redirecting to %s", target);
        return response.redirect(target);
      }

      console.log("[edit] not in DB, trying on-demand import");
      console.log("[edit] publication.store=%o", !!publication.store);
      console.log(
        "[edit] store.options=%o",
        publication.store?.options,
      );

      // On-demand import: post not in MongoDB, try reading from disk
      const imported = await importPostFromFile(url, publication, application);

      if (imported) {
        const target = `${request.baseUrl}/${imported.uid}/update`;
        console.log("[edit] imported, redirecting to %s", target);
        return response.redirect(target);
      }

      // Neither in DB nor on disk — redirect to posts list
      console.log("[edit] import failed, redirecting to posts list");
      return response.redirect(request.baseUrl);
    } catch (error) {
      console.error("[edit] error:", error);
      next(error);
    }
  },
};
