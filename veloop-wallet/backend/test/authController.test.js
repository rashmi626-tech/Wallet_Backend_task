const test = require("node:test");
const assert = require("node:assert/strict");
const authController = require("../src/controllers/authController");

test("uses the local default admin credentials when environment variables are unset or placeholders", () => {
	const originalEmail = process.env.DEFAULT_EMAIL;
	const originalPassword = process.env.DEFAULT_PASSWORD;
	const originalName = process.env.DEFAULT_NAME;

	delete process.env.DEFAULT_EMAIL;
	process.env.DEFAULT_PASSWORD = "replace-with-a-password";
	process.env.DEFAULT_NAME = "  replace-with-a-name  ";

	try {
		assert.deepEqual(authController.getConfiguredDefaultAccount(), {
			email: "admin@veloopwallet.com",
			password: "Veloop@123",
			name: "Veloop Admin"
		});
	} finally {
		if (typeof originalEmail === "string") {
			process.env.DEFAULT_EMAIL = originalEmail;
		} else {
			delete process.env.DEFAULT_EMAIL;
		}

		if (typeof originalPassword === "string") {
			process.env.DEFAULT_PASSWORD = originalPassword;
		} else {
			delete process.env.DEFAULT_PASSWORD;
		}

		if (typeof originalName === "string") {
			process.env.DEFAULT_NAME = originalName;
		} else {
			delete process.env.DEFAULT_NAME;
		}
	}
});
