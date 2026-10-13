const mongoose = require("mongoose");

const payoutOptionSchema = new mongoose.Schema({
	code: { type: String, enum: ["bank_transfer", "mobile_money"], required: true, unique: true },
	label: { type: String, required: true, trim: true, maxlength: 80 },
	eta: { type: String, required: true, trim: true, maxlength: 80 },
	active: { type: Boolean, default: true, required: true }
}, { timestamps: true });

module.exports = mongoose.model("PayoutOption", payoutOptionSchema);