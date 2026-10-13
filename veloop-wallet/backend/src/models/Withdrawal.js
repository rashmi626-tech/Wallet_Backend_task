const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
	walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true },
	amountCents: { type: Number, required: true, min: 1, validate: Number.isInteger },
	method: { type: String, enum: ["bank_transfer", "mobile_money"], required: true },
	status: { type: String, enum: ["pending", "approved", "rejected", "completed", "failed"], default: "pending" },
	reference: { type: String, required: true, unique: true },
	providerEventId: { type: String, maxlength: 120 },
	reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
	reviewedAt: { type: Date },
	reviewReason: { type: String, maxlength: 120 }
}, { timestamps: true });

withdrawalSchema.index({ status: 1, _id: -1 });
withdrawalSchema.index({ userId: 1, _id: -1 });

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
