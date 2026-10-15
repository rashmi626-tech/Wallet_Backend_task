const crypto = require("crypto");
const Wallet = require("../models/Wallet");
const {
	MAX_WALLET_BALANCE_CENTS,
	MAX_WITHDRAWAL_AMOUNT_CENTS,
	isValidAmountCents,
	isValidIdempotencyKey
} = require("../validators/walletValidator");

const DEMO_MAX_OPERATION_CENTS = 50_000;
const DEMO_REWARDS = [
	{ id: "coin-boost", title: "Bonus coins", category: "Coins", description: "Exchange one spin for 250 bonus VEs.", costVes: 0, costSpins: 1, rewardVes: 250, valueLabel: "+250 VEs" },
	{ id: "wallet-credit", title: "Wallet credit", category: "Wallet", description: "Add $5 simulated demo funds to your demo balance.", costVes: 1500, creditCents: 500, valueLabel: "$5 demo balance" }
];

class DemoWalletError extends Error {
	constructor(message, statusCode = 400) {
		super(message);
		this.statusCode = statusCode;
		this.expose = true;
	}
}

const requireValidRequest = (amountCents, idempotencyKey) => {
	if (!isValidAmountCents(amountCents) || amountCents > DEMO_MAX_OPERATION_CENTS) {
		throw new DemoWalletError("Demo payment amounts must be from $0.01 to $500.00.", 400);
	}
	if (!isValidIdempotencyKey(idempotencyKey)) {
		throw new DemoWalletError("Provide a valid Idempotency-Key.", 400);
	}
};

const createDemoActivity = ({ type, direction, amountCents = 0, vesSpent = 0, description, method }) => ({
	reference: `DEMO-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
	type,
	direction,
	amountCents,
	vesSpent,
	description,
	method,
	createdAt: new Date()
});

const applyDemoActivity = async ({ userId, idempotencyKey, activity, filter = {}, increment = {} }) => {
	const wallet = await Wallet.findOneAndUpdate(
		{
			userId,
			demoIdempotencyKeys: { $ne: idempotencyKey },
			...filter
		},
		{
			$inc: { demoBalanceCents: 0, ves: 0, ...increment },
			$addToSet: { demoIdempotencyKeys: idempotencyKey },
			$push: { demoActivities: { $each: [activity], $slice: -50 } }
		},
		{ new: true, runValidators: true }
	);

	if (!wallet) {
		const existing = await Wallet.findOne({ userId, demoIdempotencyKeys: idempotencyKey }).select("_id");
		if (existing) throw new DemoWalletError("This demo request has already been processed.", 409);
		throw new DemoWalletError("Wallet balance is insufficient or the demo wallet limit would be exceeded.", 409);
	}
	return wallet;
};

const addDemoFunds = async ({ userId, amountCents, method, idempotencyKey }) => {
	requireValidRequest(amountCents, idempotencyKey);
	if (!["upi", "card", "razorpay"].includes(method)) throw new DemoWalletError("Choose UPI, card, or Razorpay for this demo payment.", 400);
	const activity = createDemoActivity({
		type: "demo_payment",
		direction: "credit",
		amountCents,
		description: `Demo funds added with ${method === "razorpay" ? "Razorpay" : method === "upi" ? "UPI" : "card"} (simulated)`,
		method
	});
	return applyDemoActivity({
		userId,
		idempotencyKey,
		activity,
		filter: {
			$or: [
				{ demoBalanceCents: { $lte: MAX_WALLET_BALANCE_CENTS - amountCents } },
				{ demoBalanceCents: { $exists: false } }
			]
		},
		increment: { demoBalanceCents: amountCents }
	});
};

const withdrawDemoFunds = async ({ userId, amountCents, method, idempotencyKey }) => {
	requireValidRequest(amountCents, idempotencyKey);
	if (amountCents > MAX_WITHDRAWAL_AMOUNT_CENTS) {
		throw new DemoWalletError("Demo withdrawals are limited to $2,500.00 per request.", 400);
	}
	if (!["upi", "bank_transfer", "razorpay"].includes(method)) {
		throw new DemoWalletError("Choose UPI, Razorpay, or bank transfer for this demo withdrawal.", 400);
	}
	const activity = createDemoActivity({
		type: "demo_withdrawal",
		direction: "debit",
		amountCents,
		description: `Demo withdrawal requested by ${method === "razorpay" ? "Razorpay (simulated)" : method === "upi" ? "UPI" : "bank transfer"}`,
		method
	});
	return applyDemoActivity({
		userId,
		idempotencyKey,
		activity,
		filter: { demoBalanceCents: { $gte: amountCents } },
		increment: { demoBalanceCents: -amountCents }
	});
};

const getRewards = () => DEMO_REWARDS.map(({ id, title, category, description, costVes, costSpins, rewardVes, creditCents, valueLabel }) => ({
	id,
	title,
	category,
	description,
	costVes,
	...(costSpins ? { costSpins } : {}),
	...(rewardVes ? { rewardVes } : {}),
	...(creditCents ? { creditCents } : {}),
	valueLabel,
	demoOnly: true
}));

const redeemReward = async ({ userId, rewardId, idempotencyKey }) => {
	if (!isValidIdempotencyKey(idempotencyKey)) throw new DemoWalletError("Provide a valid Idempotency-Key.", 400);
	const reward = DEMO_REWARDS.find((item) => item.id === rewardId);
	if (!reward) throw new DemoWalletError("Reward not found.", 404);
	const activity = createDemoActivity({
		type: "demo_reward",
		direction: "reward",
		amountCents: reward.creditCents || 0,
		vesSpent: reward.costVes,
		description: `${reward.title} (demo redemption)`
	});
	const wallet = await applyDemoActivity({
		userId,
		idempotencyKey,
		activity,
		filter: {
			ves: { $gte: reward.costVes },
			...(reward.costSpins ? { spins: { $gte: reward.costSpins } } : {}),
			...(reward.creditCents ? {
				$or: [
					{ demoBalanceCents: { $lte: MAX_WALLET_BALANCE_CENTS - reward.creditCents } },
					{ demoBalanceCents: { $exists: false } }
				]
			} : {})
		},
		increment: {
			ves: reward.rewardVes ? reward.rewardVes - reward.costVes : -reward.costVes,
			...(reward.costSpins ? { spins: -reward.costSpins } : {}),
			demoBalanceCents: reward.creditCents || 0
		}
	});
	return { wallet, reward, activity };
};

module.exports = {
	DEMO_MAX_OPERATION_CENTS,
	DemoWalletError,
	addDemoFunds,
	getRewards,
	redeemReward,
	withdrawDemoFunds
};
