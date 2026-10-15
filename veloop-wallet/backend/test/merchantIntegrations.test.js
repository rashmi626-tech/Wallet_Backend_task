const test = require("node:test");
const assert = require("node:assert/strict");
const { createMerchantIntegrations } = require("../src/services/merchantIntegrations");

const withEnvironment = async (values, callback) => {
	const original = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) process.env[key] = value;
	try {
		await callback();
	} finally {
		for (const [key, value] of original) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
};

test("live merchant and payment providers are disabled by default without changing wallet state", async () => {
	const wallet = { balanceCents: 1250, demoBalanceCents: 900, ves: 500 };
	const integrations = createMerchantIntegrations();
	const status = integrations.getCapabilities();

	assert.equal(status.currency.inrEnabled, false);
	assert.equal(status.amazonGiftCards.enabled, false);
	assert.equal(status.merchantVouchers.enabled, false);
	assert.equal(status.razorpayCheckout.enabled, false);
	assert.equal(status.razorpayPayouts.enabled, false);
	await assert.rejects(integrations.issueAmazonGiftCard({ userId: "user-1" }), { statusCode: 503 });
	await assert.rejects(integrations.issueMerchantVoucher({ userId: "user-1" }), { statusCode: 503 });
	await assert.rejects(integrations.createRazorpayCheckout({ userId: "user-1" }), { statusCode: 503 });
	await assert.rejects(integrations.createRazorpayPayout({ userId: "user-1" }), { statusCode: 503 });
	assert.deepEqual(wallet, { balanceCents: 1250, demoBalanceCents: 900, ves: 500 });
});

test("Amazon issuance requires an explicit switch and uses the provider adapter boundary", async () => {
	await withEnvironment({ AMAZON_AGCOD_ENABLED: "true" }, async () => {
		const request = { userId: "user-1", amountCents: 500, idempotencyKey: "amazon-issue-001" };
		let received;
		const integrations = createMerchantIntegrations({
			amazonGiftCardIssuer: {
				issueGiftCard: async (payload) => {
					received = payload;
					return { providerReference: "provider-issued-reference" };
				}
			}
		});

		assert.equal(integrations.getCapabilities().amazonGiftCards.enabled, true);
		assert.deepEqual(await integrations.issueAmazonGiftCard(request), { providerReference: "provider-issued-reference" });
		assert.deepEqual(received, request);
	});
});

test("Razorpay remains disabled even with test adapters and flags while INR accounting is unimplemented", async () => {
	await withEnvironment({
		RAZORPAY_CHECKOUT_ENABLED: "true",
		RAZORPAYX_PAYOUTS_ENABLED: "true",
		INR_WALLET_ENABLED: "true"
	}, async () => {
		let providerCalls = 0;
		const adapter = {
			createOrder: async () => { providerCalls += 1; },
			createPayout: async () => { providerCalls += 1; }
		};
		const integrations = createMerchantIntegrations({
			razorpayCheckout: adapter,
			razorpayPayouts: adapter
		});

		assert.equal(integrations.getCapabilities().razorpayCheckout.enabled, false);
		assert.equal(integrations.getCapabilities().razorpayPayouts.enabled, false);
		await assert.rejects(integrations.createRazorpayCheckout({ userId: "user-1" }), { statusCode: 503 });
		await assert.rejects(integrations.createRazorpayPayout({ userId: "user-1" }), { statusCode: 503 });
		assert.equal(providerCalls, 0);
	});
});
