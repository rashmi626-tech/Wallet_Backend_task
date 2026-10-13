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
	spins: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger }
}, { timestamps: true });

module.exports = mongoose.model("Wallet", walletSchema);
