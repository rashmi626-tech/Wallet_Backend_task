const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
	walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true },
	type: { type: String, enum: ["collection", "withdrawal", "refund", "adjustment"], required: true },
	adjustmentDirection: { type: String, enum: ["credit", "debit"] },
	status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
	amountCents: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
	reference: { type: String, required: true, unique: true },
	description: { type: String, required: true, maxlength: 120 },
	idempotencyKey: { type: String, maxlength: 120 },
	providerEventId: { type: String, maxlength: 120 }
}, { timestamps: true });

walletTransactionSchema.index(
	{ userId: 1, idempotencyKey: 1 },
	{ unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ type: 1, status: 1, _id: -1 });

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
