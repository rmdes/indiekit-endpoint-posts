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
        return response.redirect(
          `${request.baseUrl}/${properties.uid}/update`,
        );
      }

      // On-demand import: post not in MongoDB, try reading from disk
      const imported = await importPostFromFile(url, publication, application);

      if (imported) {
        return response.redirect(
          `${request.baseUrl}/${imported.uid}/update`,
        );
      }

      // Neither in DB nor on disk — redirect to posts list
      return response.redirect(request.baseUrl);
    } catch (error) {
      next(error);
    }
  },
};
