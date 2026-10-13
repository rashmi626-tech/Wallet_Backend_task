const mongoose = require("mongoose");
const walletService = require("../services/walletService");
const {
	isValidCollectionAmountCents,
	isValidIdempotencyKey
} = require("../validators/walletValidator");
const { SUPPORTED_PAYOUT_METHODS } = require("../validators/withdrawalValidator");

const getIdempotencyKey = (req) => {
	const headerKey = req.get("idempotency-key");
	const bodyKey = req.body?.idempotencyKey;
	const key = typeof headerKey === "string" ? headerKey : bodyKey;
	return isValidIdempotencyKey(key) ? key : null;
};

const getPagination = (req, res) => {
	const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
	const cursor = req.query.cursor;
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		res.status(400).json({ message: "limit must be an integer from 1 to 100." });
		return null;
	}
	if (cursor !== undefined && !mongoose.Types.ObjectId.isValid(cursor)) {
		res.status(400).json({ message: "cursor must be a valid record ID." });
		return null;
	}
	return { limit, cursor };
};

const listWithdrawals = async (req, res) => {
	const pagination = getPagination(req, res);
	if (!pagination) return;
	const validStatuses = ["pending", "approved", "rejected", "completed", "failed"];
	const status = req.query.status;
	if (status !== undefined && !validStatuses.includes(status)) {
		return res.status(400).json({ message: "status is not a valid withdrawal status." });
	}
	return res.json(await walletService.getAdminWithdrawals({ ...pagination, status }));
};

const getWithdrawal = async (req, res) => {
	if (!mongoose.Types.ObjectId.isValid(req.params.withdrawalId)) {
		return res.status(400).json({ message: "withdrawalId must be a valid record ID." });
	}
	return res.json({ withdrawal: await walletService.getAdminWithdrawal({ withdrawalId: req.params.withdrawalId }) });
};

const reviewWithdrawal = (decision) => async (req, res) => {
	if (!mongoose.Types.ObjectId.isValid(req.params.withdrawalId)) {
		return res.status(400).json({ message: "withdrawalId must be a valid record ID." });
	}
	const body = req.body || {};
	const reason = typeof body.reason === "string" ? body.reason.trim() : "";
	if (reason.length > 120) return res.status(400).json({ message: "reason must not exceed 120 characters." });
	const result = await walletService.reviewWithdrawal({
		withdrawalId: req.params.withdrawalId,
		actorId: req.user._id,
		decision,
		reason,
		ipAddress: req.ip,
		userAgent: req.get("user-agent")
	});
	return res.json({
		success: true,
		message: decision === "approve" ? "Withdrawal approved." : "Withdrawal rejected and funds refunded.",
		...result
	});
};

const listTransactions = async (req, res) => {
	const pagination = getPagination(req, res);
	if (!pagination) return;
	const type = req.query.type;
	const status = req.query.status;
	const userId = req.query.userId;
	if (type !== undefined && !["collection", "withdrawal", "refund", "adjustment"].includes(type)) {
		return res.status(400).json({ message: "type is not a valid transaction type." });
	}
	if (status !== undefined && !["pending", "completed", "failed"].includes(status)) {
		return res.status(400).json({ message: "status is not a valid transaction status." });
	}
	if (userId !== undefined && !mongoose.Types.ObjectId.isValid(userId)) {
		return res.status(400).json({ message: "userId must be a valid account ID." });
	}
	return res.json(await walletService.getAdminTransactions({ ...pagination, type, status, userId }));
};

const listAuditLogs = async (req, res) => {
	const pagination = getPagination(req, res);
	if (!pagination) return;
	const actorId = req.query.actorId;
	const targetUserId = req.query.targetUserId;
	if (actorId !== undefined && !mongoose.Types.ObjectId.isValid(actorId)) {
		return res.status(400).json({ message: "actorId must be a valid account ID." });
	}
	if (targetUserId !== undefined && !mongoose.Types.ObjectId.isValid(targetUserId)) {
		return res.status(400).json({ message: "targetUserId must be a valid account ID." });
	}
	return res.json(await walletService.getAdminAuditLogs({ ...pagination, actorId, targetUserId }));
};

const adjustWallet = (direction) => async (req, res) => {
	const body = req.body || {};
	const userId = body.userId;
	const amountCents = body.amountCents;
	const reference = typeof body.reference === "string" ? body.reference.trim() : "";
	const description = typeof body.description === "string" ? body.description.trim() : "";
	const idempotencyKey = getIdempotencyKey(req);

	if (!mongoose.Types.ObjectId.isValid(userId)) {
		return res.status(400).json({ message: "userId must be a valid account ID." });
	}
	if (!isValidCollectionAmountCents(amountCents) || !idempotencyKey) {
		return res.status(400).json({ message: "Provide a positive integer amountCents and a valid Idempotency-Key." });
	}
	if (reference.length > 120 || description.length > 120) {
		return res.status(400).json({ message: "reference and description must not exceed 120 characters." });
	}

	const operation = direction === "credit" ? walletService.adminCreditWallet : walletService.adminDebitWallet;
	const result = await operation({
		actorId: req.user._id,
		userId,
		amountCents,
		reference: reference || undefined,
		description: description || `Administrator wallet ${direction}`,
		idempotencyKey,
		ipAddress: req.ip,
		userAgent: req.get("user-agent")
	});
	return res.status(result.replayed ? 200 : 201).json({
		success: true,
		message: `Wallet ${direction} applied.`,
		...result
	});
};

const correctWalletBalance = async (req, res) => {
	const body = req.body || {};
	const userId = body.userId;
	const targetBalanceCents = body.targetBalanceCents;
	const reference = typeof body.reference === "string" ? body.reference.trim() : "";
	const description = typeof body.description === "string" ? body.description.trim() : "";
	const idempotencyKey = getIdempotencyKey(req);
	if (!mongoose.Types.ObjectId.isValid(userId)) {
		return res.status(400).json({ message: "userId must be a valid account ID." });
	}
	if (!Number.isSafeInteger(targetBalanceCents) || targetBalanceCents < 0 || !idempotencyKey) {
		return res.status(400).json({ message: "Provide a non-negative integer targetBalanceCents and a valid Idempotency-Key." });
	}
	if (reference.length > 120 || description.length > 120) {
		return res.status(400).json({ message: "reference and description must not exceed 120 characters." });
	}
	const result = await walletService.adminCorrectWallet({
		actorId: req.user._id,
		userId,
		targetBalanceCents,
		reference: reference || undefined,
		description: description || "Administrator wallet balance correction",
		idempotencyKey,
		ipAddress: req.ip,
		userAgent: req.get("user-agent")
	});
	return res.status(result.replayed ? 200 : 201).json({
		success: true,
		message: "Wallet balance corrected.",
		...result
	});
};

const configurePayoutOption = async (req, res) => {
	const { code } = req.params;
	const body = req.body || {};
	const label = typeof body.label === "string" ? body.label.trim() : "";
	const eta = typeof body.eta === "string" ? body.eta.trim() : "";
	if (!SUPPORTED_PAYOUT_METHODS.includes(code)
		|| label.length < 1 || label.length > 80
		|| eta.length < 1 || eta.length > 80
		|| typeof body.active !== "boolean") {
		return res.status(400).json({ message: "Provide a supported payout code, label, ETA, and active boolean." });
	}
	const option = await walletService.updatePayoutOption({
		actorId: req.user._id,
		code,
		label,
		eta,
		active: body.active,
		ipAddress: req.ip,
		userAgent: req.get("user-agent")
	});
	return res.json({ success: true, option });
};

module.exports = {
	listWithdrawals,
	getWithdrawal,
	approveWithdrawal: reviewWithdrawal("approve"),
	rejectWithdrawal: reviewWithdrawal("reject"),
	listTransactions,
	listAuditLogs,
	creditWallet: adjustWallet("credit"),
	debitWallet: adjustWallet("debit"),
	correctWalletBalance,
	configurePayoutOption
};
