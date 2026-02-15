import { getPostPropertiesByUrl } from "../utils.js";

export const editController = {
  async get(request, response, next) {
    try {
      const { url } = request.query;
      const { application } = request.app.locals;

      if (!url) {
        return response.redirect(request.baseUrl);
      }

      const properties = await getPostPropertiesByUrl(url, application);

      if (!properties) {
        return response.redirect(request.baseUrl);
      }

      response.redirect(`${request.baseUrl}/${properties.uid}/update`);
    } catch (error) {
      next(error);
    }
  },
};
