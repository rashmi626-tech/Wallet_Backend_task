const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
	currency: { type: String, default: "USD", enum: ["USD"] },
	balanceCents: {
		type: Number,
		default: 0,
		min: 0,
		validate: Number.isSafeInteger
	},
	ves: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
	sves: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
	gems: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
	tokens: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
	spins: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
	dailyStreak: {
		currentDays: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
		bestDays: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
		lastClaimDate: { type: String, default: null }
	},
	demoBalanceCents: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
	demoIdempotencyKeys: { type: [String], default: [] },
	demoActivities: [{
		reference: { type: String, required: true },
		type: { type: String, enum: ["demo_payment", "demo_withdrawal", "demo_reward"], required: true },
		direction: { type: String, enum: ["credit", "debit", "reward"], required: true },
		amountCents: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
		vesSpent: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
		description: { type: String, required: true, maxlength: 120 },
		method: { type: String, enum: ["upi", "card", "bank_transfer", null], default: null },
		createdAt: { type: Date, default: Date.now }
	}]
}, { timestamps: true });

module.exports = mongoose.model("Wallet", walletSchema);
