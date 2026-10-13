require("dotenv").config();

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const Wallet = require("../src/models/Wallet");
const WalletTransaction = require("../src/models/WalletTransaction");
const WalletLedger = require("../src/models/WalletLedger");
const Withdrawal = require("../src/models/Withdrawal");
const assertLocalMongoUri = require("./localMongoUri");

const DEMO_EMAIL = "demo@veloop.test";
const DEMO_NAME = "VELoop Demo User";
const demoActivity = [
	{ key: "ad-reward", label: "Ad Reward", amountCents: 1000, direction: "credit" },
	{ key: "daily-reward", label: "Daily Reward", amountCents: 500, direction: "credit" },
	{ key: "referral-reward", label: "Referral Reward", amountCents: 250, direction: "credit" },
	{ key: "bonus", label: "Demo Bonus", amountCents: 250, direction: "credit" },
	{ key: "withdrawal", label: "Demo Withdrawal", amountCents: 500, direction: "debit" }
];

const seedDemo = async () => {
	if (process.env.NODE_ENV === "production") {
		throw new Error("Demo data seeding is disabled in production.");
	}
	const mongoUri = assertLocalMongoUri(process.env.MONGO_URI);
	const password = process.env.DEMO_USER_PASSWORD || "";
	if (password.length < 12 || password.startsWith("replace-with-")) {
		throw new Error("Set DEMO_USER_PASSWORD to a value of at least 12 characters.");
	}

	await mongoose.connect(mongoUri);
	const topology = await mongoose.connection.db.admin().command({ hello: 1 });
	if (!topology.setName && topology.msg !== "isdbgrid") {
		throw new Error("Demo seeding requires a local MongoDB replica set for transactional consistency.");
	}
	const session = await mongoose.startSession();
	try {
		await session.withTransaction(async () => {
			const existingSeed = await WalletTransaction.findOne({ reference: "DEMO-AD-REWARD" }).session(session);
			if (existingSeed) return;

			let user = await User.findOne({ email: DEMO_EMAIL }).select("+passwordHash").session(session);
			if (user) {
				if (!(await bcrypt.compare(password, user.passwordHash))) {
					throw new Error("The existing demo account password does not match DEMO_USER_PASSWORD.");
				}
			} else {
				const passwordHash = await bcrypt.hash(password, 12);
				[user] = await User.create([{
					name: DEMO_NAME,
					email: DEMO_EMAIL,
					passwordHash,
					role: "user"
				}], { session });
			}

			let wallet = await Wallet.findOne({ userId: user._id }).session(session);
			if (!wallet) {
				[wallet] = await Wallet.create([{
					userId: user._id,
					balanceCents: 0,
					ves: 25000,
					sves: 5000,
					gems: 100,
					tokens: 500,
					spins: 3
				}], { session });
			} else if (
				wallet.balanceCents !== 0
				|| wallet.ves !== 0
				|| wallet.sves !== 0
				|| wallet.gems !== 0
				|| wallet.tokens !== 0
				|| wallet.spins !== 0
			) {
				throw new Error("Demo account wallet must be empty before initial seeding.");
			} else {
				wallet.ves = 25000;
				wallet.sves = 5000;
				wallet.gems = 100;
				wallet.tokens = 500;
				wallet.spins = 3;
			}

			let balanceCents = 0;
			for (const activity of demoActivity) {
				const reference = `DEMO-${activity.key.toUpperCase()}`;
				balanceCents += activity.direction === "credit" ? activity.amountCents : -activity.amountCents;
				const transactionType = activity.direction === "debit" ? "withdrawal" : "adjustment";
				const [transaction] = await WalletTransaction.create([{
					userId: user._id,
					walletId: wallet._id,
					type: transactionType,
					adjustmentDirection: activity.direction === "credit" ? "credit" : undefined,
					status: "completed",
					amountCents: activity.amountCents,
					reference,
					idempotencyKey: `demo:${activity.key}`,
					description: `${activity.label} (demo data)`
				}], { session });

				await WalletLedger.create([{
					userId: user._id,
					walletId: wallet._id,
					transactionId: transaction._id,
					type: activity.direction === "credit" ? "adjustment_credit" : "withdrawal_debit",
					direction: activity.direction,
					amountCents: activity.amountCents,
					balanceAfterCents: balanceCents,
					reference,
					idempotencyKey: `demo:ledger:${activity.key}`,
					description: `${activity.label} (demo data)`
				}], { session });

				if (activity.direction === "debit") {
					await Withdrawal.create([{
						userId: user._id,
						walletId: wallet._id,
						amountCents: activity.amountCents,
						method: "bank_transfer",
						status: "completed",
						reference
					}], { session });
				}
			}

			wallet.balanceCents = balanceCents;
			await wallet.save({ session });
		});
		console.log(`Local demo data is ready for ${DEMO_EMAIL}.`);
	} finally {
		await session.endSession();
	}
};

seedDemo()
	.catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	})
	.finally(() => mongoose.disconnect());
