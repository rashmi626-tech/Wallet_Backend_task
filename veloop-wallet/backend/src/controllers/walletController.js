const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const walletService = require("../services/walletService");
const {
	MAX_WALLET_BALANCE_CENTS,
	MAX_WITHDRAWAL_AMOUNT_CENTS,
	isValidCollectionAmountCents,
	isValidWithdrawalAmountCents,
	isWithinWalletLimit,
	isValidIdempotencyKey
} = require("../validators/walletValidator");

const readIdempotencyKey = (req) => {
	const key = req.get("idempotency-key");
	return isValidIdempotencyKey(key) ? key : null;
};

const formatMoneyForResponse = (cents) => `$${(cents / 100).toFixed(2)}`;

const serializeWallet = (wallet) => ({
	currency: wallet?.currency || "USD",
	balanceCents: wallet?.balanceCents ?? 0,
	ves: wallet?.ves ?? 0,
	sves: wallet?.sves ?? 0,
	gems: wallet?.gems ?? 0,
	tokens: wallet?.tokens ?? 0,
	spins: wallet?.spins ?? 0
});

const getWallet = async (req, res) => {
	const wallet = await Wallet.findOne({ userId: req.user._id });
	if (!wallet) return res.status(404).json({ message: "Wallet not found." });

	const transactions = await WalletTransaction.find({ userId: req.user._id })
		.sort({ createdAt: -1 })
		.limit(10)
		.select("type status amountCents reference description createdAt");

	return res.json({
		wallet: serializeWallet(wallet),
		transactions
	});
};

const getWalletSummary = async (req, res) => {
	const wallet = await Wallet.findOne({ userId: req.user._id });
	if (!wallet) return res.status(404).json({ message: "Wallet not found." });

	const [transactions, ledgerEntries] = await Promise.all([
		WalletTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(5).lean(),
		WalletTransaction.find({ userId: req.user._id }).countDocuments()
	]);

	return res.json({
		success: true,
		wallet: serializeWallet(wallet),
		summary: {
			totalTransactions: ledgerEntries,
			pendingTransactions: transactions.filter((tx) => tx.status === "pending").length
		},
		recentTransactions: transactions
	});
};

const getPayoutOptions = async (req, res) => {
	const options = await walletService.getPayoutOptions();
	return res.json({ options: options.filter((option) => option.active).map(({ code, label, eta }) => ({ code, label, eta })) });
};

const createCollection = async (req, res) => {
	const body = req.body || {};
	const amountCents = body.amountCents;
	const note = typeof body.note === "string" ? body.note.trim() : "";
	const idempotencyKey = readIdempotencyKey(req);
	const wallet = await Wallet.findOne({ userId: req.user._id });

	if (!isValidCollectionAmountCents(amountCents) || note.length > 100 || !idempotencyKey) {
		return res.status(400).json({ message: `Provide a positive integer amountCents, an optional note up to 100 characters, and a valid Idempotency-Key. Max wallet balance is ${formatMoneyForResponse(MAX_WALLET_BALANCE_CENTS)}.` });
	}

	if (wallet && !isWithinWalletLimit(wallet.balanceCents, amountCents)) {
		return res.status(409).json({ message: `Collection exceeds the wallet balance limit of ${formatMoneyForResponse(MAX_WALLET_BALANCE_CENTS)}.` });
	}

	const result = await walletService.createCollectionRequest({
		userId: req.user._id,
		amountCents,
		note,
		idempotencyKey
	});

	return res.status(result.replayed ? 200 : 201).json({
		message: "Collection request recorded. Balance changes only after signed provider settlement.",
		...result
	});
};

const createWithdrawal = async (req, res) => {
	const body = req.body || {};
	const amountCents = body.amountCents;
	const method = body.method;
	const idempotencyKey = readIdempotencyKey(req);

	if (!isValidWithdrawalAmountCents(amountCents) || !idempotencyKey) {
		return res.status(400).json({ message: `Provide a positive integer amountCents up to ${formatMoneyForResponse(MAX_WITHDRAWAL_AMOUNT_CENTS)} and a valid Idempotency-Key.` });
	}

	const result = await walletService.createWithdrawalRequest({
		userId: req.user._id,
		amountCents,
		method,
		idempotencyKey,
		ipAddress: req.ip,
		userAgent: req.get("user-agent")
	});

	return res.status(result.replayed ? 200 : 201).json({
		message: "Withdrawal submitted and funds reserved pending provider payout.",
		...result
	});
};

const getLedger = async (req, res) => {
	const rawLimit = req.query.limit === undefined ? 25 : Number(req.query.limit);
	const cursor = req.query.cursor;
	if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
		return res.status(400).json({ message: "limit must be an integer from 1 to 100." });
	}
	if (cursor !== undefined && !mongoose.Types.ObjectId.isValid(cursor)) {
		return res.status(400).json({ message: "cursor must be a valid ledger entry ID." });
	}
	const result = await walletService.getLedger({ userId: req.user._id, cursor, limit: rawLimit });
	return res.json(result);
};

module.exports = {
	getWallet,
	getWalletSummary,
	getPayoutOptions,
	createCollection,
	createWithdrawal,
	getLedger
};
