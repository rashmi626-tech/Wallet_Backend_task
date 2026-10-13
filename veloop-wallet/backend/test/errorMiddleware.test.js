const test = require("node:test");
const assert = require("node:assert/strict");
const errorMiddleware = require("../src/middleware/errorMiddleware");
const requireAdmin = require("../src/middleware/adminMiddleware");
const requireAdditionalVerification = require("../src/middleware/verificationMiddleware");
const User = require("../src/models/User");
const { validateBalance } = require("../src/services/walletService");

const invokeErrorMiddleware = (error) => {
	const response = {
		statusCode: null,
		body: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(body) {
			this.body = body;
			return this;
		}
	};
	errorMiddleware(error, {}, response, (nextError) => {
		throw nextError;
	});
	return response;
};

test("does not expose internal database errors", () => {
	const response = invokeErrorMiddleware(new Error("MongoServerError: secret connection details"));
	assert.equal(response.statusCode, 500);
	assert.deepEqual(response.body, { message: "An unexpected server error occurred." });
});

test("does not expose non-operational messages even when an error sets a client status", () => {
	const error = new Error("MongoServerError: private connection URI");
	error.statusCode = 400;
	const response = invokeErrorMiddleware(error);
	assert.equal(response.statusCode, 400);
	assert.deepEqual(response.body, { message: "An unexpected server error occurred." });
});

test("normalizes database validation errors without exposing database details", () => {
	const error = new Error("private model path and value");
	error.name = "ValidationError";
	const response = invokeErrorMiddleware(error);
	assert.equal(response.statusCode, 400);
	assert.deepEqual(response.body, { message: "Request contains invalid data." });
});

test("returns safe operational error messages", () => {
	const error = new Error("Insufficient balance.");
	error.statusCode = 409;
	error.expose = true;
	const response = invokeErrorMiddleware(error);
	assert.equal(response.statusCode, 409);
	assert.deepEqual(response.body, { message: "Insufficient balance." });
});

test("administrator middleware denies non-admin users and allows administrators", () => {
	const invoke = (user) => {
		const response = {
			statusCode: null,
			body: null,
			status(code) {
				this.statusCode = code;
				return this;
			},
			json(body) {
				this.body = body;
				return this;
			}
		};
		let nextCalled = false;
		requireAdmin({ user }, response, () => { nextCalled = true; });
		return { response, nextCalled };
	};

	const userResult = invoke({ role: "user" });
	assert.equal(userResult.response.statusCode, 403);
	assert.equal(userResult.nextCalled, false);

	const adminResult = invoke({ role: "admin" });
	assert.equal(adminResult.nextCalled, true);
});

test("additional verification blocks withdrawal requests flagged by trusted risk controls", () => {
	const response = {
		statusCode: null,
		body: null,
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(body) {
			this.body = body;
			return this;
		}
	};
	let nextCalled = false;
	requireAdditionalVerification(
		{ user: { requiresAdditionalVerification: true } },
		response,
		() => { nextCalled = true; }
	);
	assert.equal(response.statusCode, 403);
	assert.deepEqual(response.body, { message: "This request requires additional verification." });
	assert.equal(nextCalled, false);
});

test("new user accounts default to the non-privileged role", () => {
	const user = new User({ name: "Example User", email: "user@example.com", passwordHash: "hash" });
	assert.equal(user.role, "user");
	assert.equal(user.requiresAdditionalVerification, false);
});

test("uses a VEs-specific insufficient balance message when validating VEs debits", () => {
	assert.equal(
		validateBalance({ balanceCents: 1500, amountCents: 1000, direction: "debit" }),
		true
	);
	assert.throws(
		() => validateBalance({ balanceCents: 2, amountCents: 5, direction: "debit", balanceType: "ves" }),
		{ message: "Insufficient VEs balance.", statusCode: 409 }
	);
});
