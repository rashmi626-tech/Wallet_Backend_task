const test = require("node:test");
const assert = require("node:assert/strict");
const assertLocalMongoUri = require("../scripts/localMongoUri");

test("accepts only local MongoDB connection URIs for maintenance scripts", () => {
	assert.equal(assertLocalMongoUri("mongodb://localhost:27017/veloop_dev"), "mongodb://localhost:27017/veloop_dev");
	assert.equal(assertLocalMongoUri("mongodb://127.0.0.1:27017/veloop_dev"), "mongodb://127.0.0.1:27017/veloop_dev");
	assert.throws(() => assertLocalMongoUri("mongodb+srv://example.mongodb.net/production"), /local machine/);
	assert.throws(() => assertLocalMongoUri("mongodb://192.0.2.1:27017/veloop_dev"), /local machine/);
});
