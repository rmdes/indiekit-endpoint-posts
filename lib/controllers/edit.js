import { getPostPropertiesByUrl, importPostFromFile } from "../utils.js";

export const editController = {
  async get(request, response, next) {
    try {
      const { url } = request.query;
      const { application, publication } = request.app.locals;

      if (!url) {
        return response.redirect(request.baseUrl);
      }

      // Try MongoDB lookup first (works for posts created via Micropub)
      const properties = await getPostPropertiesByUrl(url, application);

      if (properties) {
        const target = `${request.baseUrl}/${properties.uid}/update`;
        return response.redirect(target);
      }

      // On-demand import: post not in MongoDB, try reading from disk
      const imported = await importPostFromFile(url, publication, application);

      if (imported) {
        const target = `${request.baseUrl}/${imported.uid}/update`;
        return response.redirect(target);
      }

      // Neither in DB nor on disk — redirect to posts list
      return response.redirect(request.baseUrl);
    } catch (error) {
      console.error("[edit] error:", error);
      next(error);
    }
  },
};
