const test = require("node:test");
const assert = require("node:assert/strict");
const {
	MAX_AMOUNT_CENTS,
	isValidAmountCents,
	isValidIdempotencyKey
} = require("../src/validators/walletValidator");

test("accepts positive safe integer cents within the configured maximum", () => {
	assert.equal(isValidAmountCents(1), true);
	assert.equal(isValidAmountCents(MAX_AMOUNT_CENTS), true);
});

test("rejects invalid, fractional, unsafe, and oversized money amounts", () => {
	for (const amount of [0, -1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1, MAX_AMOUNT_CENTS + 1, NaN]) {
		assert.equal(isValidAmountCents(amount), false, `expected ${String(amount)} to be rejected`);
	}
});

test("accepts only bounded idempotency keys using the API character set", () => {
	assert.equal(isValidIdempotencyKey("request:1234-abc"), true);
	assert.equal(isValidIdempotencyKey("short"), false);
	assert.equal(isValidIdempotencyKey("request/1234"), false);
	assert.equal(isValidIdempotencyKey("x".repeat(101)), false);
	assert.equal(isValidIdempotencyKey(undefined), false);
});