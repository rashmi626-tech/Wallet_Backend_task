const mongoose = require("mongoose");

const webhookEventSchema = new mongoose.Schema({
	eventId: { type: String, required: true, unique: true, maxlength: 120 },
	type: {
		type: String,
		enum: ["collection.succeeded", "withdrawal.succeeded", "withdrawal.failed"],
		required: true
	},
	reference: { type: String, required: true },
	payloadHash: { type: String, required: true, maxlength: 64 }
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);