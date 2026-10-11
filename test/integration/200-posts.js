import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";

import { testDatabase } from "@indiekit-test/database";
import { mockAgent } from "@indiekit-test/mock-agent";
import { testServer } from "@indiekit-test/server";
import { testToken } from "@indiekit-test/token";
import { JSDOM } from "jsdom";
import supertest from "supertest";

// Fork override of upstream's test. Upstream's postsController GETs
// `?q=source` from the Micropub endpoint over HTTP and converts mf2 to jf2, so
// its test mocks that endpoint and asserts against the mocked response. This
// fork queries the posts collection directly (lib/utils.js `getPosts`), which
// is what buys it filtering, search, sort and per-type counts — and it means
// the mocked Micropub response is never read, so upstream's version of this
// test finds an empty list and throws on a null `.card__title a`.
//
// Seeding through `POST /micropub` instead of mocking exercises the real read
// path end to end, so this asserts the fork's own behaviour rather than
// describing it.
await mockAgent("endpoint-micropub");
const { client, mongoServer, mongoUri } = await testDatabase();
const server = await testServer({
  application: { mongodbUrl: mongoUri },
});
const request = supertest.agent(server);

describe("endpoint-posts GET /posts", () => {
  before(async () => {
    await request
      .post("/micropub")
      .auth(testToken(), { type: "bearer" })
      .send({
        type: ["h-entry"],
        properties: { name: ["Foobar"] },
      });
  });

  it("Returns list of published posts", async () => {
    const response = await request.get("/posts");
    const dom = new JSDOM(response.text);
    const result =
      dom.window.document.querySelector(".card__title a").textContent;

    assert.equal(result.includes("Foobar"), true);
  });

  after(async () => {
    await client.close();
    await mongoServer.stop();
    server.close((error) => process.exit(error ? 1 : 0));
  });
});
