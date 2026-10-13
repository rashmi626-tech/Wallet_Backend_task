const mongoose = require("mongoose");

const walletLedgerSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
	walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true },
	transactionId: { type: mongoose.Schema.Types.ObjectId, ref: "WalletTransaction", required: true },
	type: {
		type: String,
		enum: ["collection_credit", "withdrawal_debit", "withdrawal_refund", "adjustment_credit", "adjustment_debit"],
		required: true
	},
	direction: { type: String, enum: ["credit", "debit"], required: true },
	amountCents: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
	balanceAfterCents: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
	reference: { type: String, required: true },
	idempotencyKey: { type: String, required: true, unique: true, maxlength: 160 },
	description: { type: String, required: true, maxlength: 120 },
	metadata: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, { timestamps: { createdAt: true, updatedAt: false } });

walletLedgerSchema.index({ walletId: 1, createdAt: -1, _id: -1 });
walletLedgerSchema.index({ userId: 1, _id: -1 });
walletLedgerSchema.index({ transactionId: 1, createdAt: 1 });

walletLedgerSchema.pre("save", function rejectLedgerSave() {
	if (!this.isNew) throw new Error("Wallet ledger entries are immutable.");
});

for (const operation of [
	"updateOne",
	"updateMany",
	"findOneAndUpdate",
	"findOneAndReplace",
	"replaceOne",
	"deleteOne",
	"deleteMany",
	"findOneAndDelete"
]) {
	walletLedgerSchema.pre(operation, function rejectLedgerMutation() {
		throw new Error("Wallet ledger entries are immutable.");
	});
}

module.exports = mongoose.model("WalletLedger", walletLedgerSchema);