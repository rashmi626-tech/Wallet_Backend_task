const test = require("node:test");
const assert = require("node:assert/strict");
const Wallet = require("../src/models/Wallet");
const demoWalletService = require("../src/services/demoWalletService");

const replace = (object, key, value) => {
	const original = Object.getOwnPropertyDescriptor(object, key);
	Object.defineProperty(object, key, { configurable: true, writable: true, value });
	return () => {
		if (original) Object.defineProperty(object, key, original);
		else delete object[key];
	};
};

const mockDemoWallet = (initial = {}) => {
	const wallet = {
		_id: "wallet-1",
		userId: "user-1",
		ves: 3000,
		spins: 1,
		balanceCents: 0,
		demoBalanceCents: 0,
		demoIdempotencyKeys: [],
		demoActivities: [],
		...initial
	};
	const restoreUpdate = replace(Wallet, "findOneAndUpdate", async (filter, update) => {
		if (wallet.demoIdempotencyKeys.includes(filter.demoIdempotencyKeys.$ne)) return null;
		for (const [key, condition] of Object.entries(filter)) {
			if (key === "userId" || key === "demoIdempotencyKeys") continue;
			if (key === "$or") {
				const matchesAny = condition.some((alternative) => Object.entries(alternative).every(([field, expected]) => (
					expected.$exists === false
						? wallet[field] === undefined
						: (wallet[field] || 0) <= expected.$lte
				)));
				if (!matchesAny) return null;
				continue;
			}
			const value = wallet[key] || 0;
			if (condition.$gte !== undefined && value < condition.$gte) return null;
			if (condition.$lte !== undefined && value > condition.$lte) return null;
		}
		for (const [key, value] of Object.entries(update.$inc)) {
			wallet[key] = (wallet[key] || 0) + value;
		}
		wallet.demoIdempotencyKeys.push(...Object.keys(update.$addToSet).map(() => filter.demoIdempotencyKeys.$ne));
		wallet.demoActivities.push(...update.$push.demoActivities.$each);
		wallet.demoActivities = wallet.demoActivities.slice(-50);
		return wallet;
	});
	const restoreFind = replace(Wallet, "findOne", () => ({
		select: async () => wallet.demoIdempotencyKeys.length ? { _id: wallet._id } : null
	}));
	return { wallet, restore: () => { restoreFind(); restoreUpdate(); } };
};

test("lists only non-merchant demo rewards, never simulated merchant vouchers", () => {
	const rewards = demoWalletService.getRewards();
	assert.ok(rewards.length >= 2);
	assert.ok(rewards.every((reward) => reward.demoOnly));
	assert.ok(rewards.some((reward) => reward.id === "coin-boost"));
	assert.ok(rewards.some((reward) => reward.creditCents > 0));
	assert.ok(rewards.every((reward) => !/amazon|voucher|gift|food/i.test(`${reward.id} ${reward.title}`)));
});

test("Razorpay is available only as a simulated incoming and outgoing method", async (t) => {
	const db = mockDemoWallet({ demoBalanceCents: 600 });
	t.after(db.restore);

	const deposit = await demoWalletService.addDemoFunds({
		userId: "user-1",
		amountCents: 300,
		method: "razorpay",
		idempotencyKey: "demo-razorpay-in-001"
	});
	assert.equal(deposit.demoBalanceCents, 900);
	assert.match(deposit.demoActivities[0].description, /Razorpay \(simulated\)/);

	const payout = await demoWalletService.withdrawDemoFunds({
		userId: "user-1",
		amountCents: 300,
		method: "razorpay",
		idempotencyKey: "demo-razorpay-out-001"
	});
	assert.equal(payout.demoBalanceCents, 600);
	assert.equal(payout.balanceCents, 0);
	assert.match(payout.demoActivities[1].description, /Razorpay \(simulated\)/);
});

test("simulated UPI/card deposits update only the demo balance and are idempotent", async (t) => {
	const db = mockDemoWallet();
	t.after(db.restore);

	const wallet = await demoWalletService.addDemoFunds({
		userId: "user-1",
		amountCents: 2500,
		method: "upi",
		idempotencyKey: "demo-payment-0001"
	});

	assert.equal(wallet.demoBalanceCents, 2500);
	assert.equal(wallet.balanceCents, 0);
	assert.equal(wallet.demoActivities[0].method, "upi");
	await assert.rejects(
		demoWalletService.addDemoFunds({
			userId: "user-1",
			amountCents: 2500,
			method: "upi",
			idempotencyKey: "demo-payment-0001"
		}),
		{ statusCode: 409 }
	);
	assert.equal(db.wallet.demoBalanceCents, 2500);
});

test("simulated withdrawals reject insufficient balance and then debit demo funds", async (t) => {
	const db = mockDemoWallet({ demoBalanceCents: 1200 });
	t.after(db.restore);

	await assert.rejects(
		demoWalletService.withdrawDemoFunds({
			userId: "user-1",
			amountCents: 1500,
			method: "upi",
			idempotencyKey: "demo-payout-0001"
		}),
		{ statusCode: 409 }
	);
	const wallet = await demoWalletService.withdrawDemoFunds({
		userId: "user-1",
		amountCents: 500,
		method: "bank_transfer",
		idempotencyKey: "demo-payout-0002"
	});

	assert.equal(wallet.demoBalanceCents, 700);
	assert.equal(wallet.balanceCents, 0);
	assert.equal(wallet.demoActivities[0].type, "demo_withdrawal");
});

test("reward redemption atomically spends VEs/spins and credits only the demo wallet", async (t) => {
	const db = mockDemoWallet({ ves: 3000, spins: 1 });
	t.after(db.restore);

	const result = await demoWalletService.redeemReward({
		userId: "user-1",
		rewardId: "wallet-credit",
		idempotencyKey: "demo-reward-0001"
	});

	assert.equal(result.wallet.ves, 1500);
	assert.equal(result.wallet.demoBalanceCents, 500);
	assert.equal(result.wallet.balanceCents, 0);
	assert.equal(result.activity.vesSpent, 1500);

	const coinReward = await demoWalletService.redeemReward({
		userId: "user-1",
		rewardId: "coin-boost",
		idempotencyKey: "demo-reward-0002"
	});
	assert.equal(coinReward.wallet.ves, 1750);
	assert.equal(coinReward.wallet.spins, 0);
	assert.equal(coinReward.wallet.balanceCents, 0);
});

test("rejects invalid methods, amounts, keys, and unknown rewards", async () => {
	await assert.rejects(
		demoWalletService.addDemoFunds({ userId: "user-1", amountCents: 0, method: "upi", idempotencyKey: "demo-payment-0001" }),
		{ statusCode: 400 }
	);
	await assert.rejects(
		demoWalletService.addDemoFunds({ userId: "user-1", amountCents: 500, method: "cash", idempotencyKey: "demo-payment-0001" }),
		{ statusCode: 400 }
	);
	await assert.rejects(
		demoWalletService.redeemReward({ userId: "user-1", rewardId: "fake-voucher", idempotencyKey: "demo-reward-0001" }),
		{ statusCode: 404 }
	);
});
