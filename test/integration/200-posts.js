import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";

import { mockAgent } from "@indiekit-test/mock-agent";
import { testServer } from "@indiekit-test/server";
import { testCookie } from "@indiekit-test/session";
import { JSDOM } from "jsdom";
import supertest from "supertest";

await mockAgent("endpoint-posts");
const server = await testServer({
  application: { micropubEndpoint: "https://micropub-endpoint.example" },
});
const request = supertest.agent(server);

describe("endpoint-posts GET /posts", () => {
  it("Returns list of published posts", async () => {
    const response = await request.get("/posts").set("cookie", testCookie());
    const dom = new JSDOM(response.text);
    const result =
      dom.window.document.querySelector(".card__title a").textContent;

    assert.equal(result.includes("Foobar"), true);
  });

  after(() => server.close());
});
