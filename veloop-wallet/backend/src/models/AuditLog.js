const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
	actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
	targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
	action: {
		type: String,
		enum: [
			"withdrawal.created",
			"withdrawal.approved",
			"withdrawal.rejected",
			"wallet.credited",
			"wallet.debited",
			"wallet.balance_corrected",
			"payout.configuration_changed"
		],
		required: true
	},
	targetType: { type: String, maxlength: 80 },
	referenceId: { type: String, maxlength: 120 },
	amountCents: { type: Number, min: 1, validate: Number.isSafeInteger },
	reference: { type: String, required: true, maxlength: 120 },
	idempotencyKey: { type: String, maxlength: 100 },
	description: { type: String, required: true, maxlength: 120 },
	ipAddress: { type: String, maxlength: 64 },
	userAgent: { type: String, maxlength: 500 },
	metadata: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetUserId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ referenceId: 1 });

auditLogSchema.pre("save", function rejectAuditSave() {
	if (!this.isNew) throw new Error("Audit log entries are immutable.");
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
	auditLogSchema.pre(operation, function rejectAuditMutation() {
		throw new Error("Audit log entries are immutable.");
	});
}

module.exports = mongoose.model("AuditLog", auditLogSchema);