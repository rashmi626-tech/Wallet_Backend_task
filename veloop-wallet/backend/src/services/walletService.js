const crypto = require("crypto");
const mongoose = require("mongoose");
const connectDB = require("../config/database");
const Wallet = require("../models/Wallet");
const WalletLedger = require("../models/WalletLedger");
const WalletTransaction = require("../models/WalletTransaction");
const Withdrawal = require("../models/Withdrawal");
const WebhookEvent = require("../models/WebhookEvent");
const AuditLog = require("../models/AuditLog");
const PayoutOption = require("../models/PayoutOption");
const {
	MAX_WALLET_BALANCE_CENTS,
	MAX_WITHDRAWAL_AMOUNT_CENTS,
	isWithinWalletLimit,
	isValidAmountCents,
	isValidIdempotencyKey
} = require("../validators/walletValidator");

const defaultPayoutOptions = [
	{ code: "bank_transfer", label: "Bank transfer", eta: "1-3 business days" },
	{ code: "mobile_money", label: "Mobile money", eta: "Usually within minutes" }
];

const getPayoutOptions = async () => {
	const configuredOptions = await PayoutOption.find({}).lean();
	const configuredByCode = new Map(configuredOptions.map((option) => [option.code, option]));
	return defaultPayoutOptions.map((option) => {
		const configured = configuredByCode.get(option.code);
		return {
			code: option.code,
			label: configured?.label || option.label,
			eta: configured?.eta || option.eta,
			active: configured ? configured.active : true
		};
	});
};

class WalletServiceError extends Error {
	constructor(message, statusCode = 400) {
		super(message);
		this.statusCode = statusCode;
		this.expose = true;
	}
}

const createReference = (prefix) => `${prefix}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

const validatePositiveAmount = (amountCents, label = "amount") => {
	if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
		throw new WalletServiceError(`${label} must be a positive safe integer in cents.`, 400);
	}
};

const requireTransactionSupport = () => {
	if (!connectDB.getCapabilities().transactionsSupported) {
		throw new WalletServiceError("Wallet balance operations require a MongoDB replica set or sharded cluster.", 503);
	}
};

const runInTransaction = async (operation) => {
	requireTransactionSupport();
	const session = await mongoose.startSession();
	try {
		let result;
		await session.withTransaction(async () => {
			result = await operation(session);
		});
		return result;
	} finally {
		await session.endSession();
	}
};

const findReplay = async ({ userId, idempotencyKey, type, amountCents, session, conflictMessage, adjustmentDirection }) => {
	const existing = await WalletTransaction.findOne({ userId, idempotencyKey }).session(session || null);
	if (!existing) return null;
	if (
		existing.type !== type
		|| existing.amountCents !== amountCents
		|| (adjustmentDirection && existing.adjustmentDirection !== adjustmentDirection)
	) {
		throw new WalletServiceError(conflictMessage || "Idempotency-Key was already used with a different operation.", 409);
	}
	return existing;
};

const validateBalance = ({ balanceCents, amountCents, direction, balanceType = "wallet" }) => {
	validatePositiveAmount(amountCents, "amountCents");
	if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
		throw new WalletServiceError("Wallet balance is invalid.", 400);
	}
	if (direction === "debit" && balanceCents < amountCents) {
		throw new WalletServiceError(balanceType === "ves" ? "Insufficient VEs balance." : "Insufficient balance.", 409);
	}
	return true;
};

const getWallet = async ({ userId, session } = {}) => (
	Wallet.findOne({ userId }).session(session || null).lean()
);

const getTransactions = async ({ userId, session, limit = 25, page = 1 } = {}) => {
	const pageSize = Number.isInteger(limit) && limit > 0 ? limit : 25;
	const pageNumber = Number.isInteger(page) && page > 0 ? page : 1;
	const skip = (pageNumber - 1) * pageSize;
	const [transactions, total] = await Promise.all([
		WalletTransaction.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean().session(session || null),
		WalletTransaction.countDocuments({ userId }).session(session || null)
	]);
	return { transactions, page, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
};

const createLedgerEntry = async ({
	userId,
	walletId,
	transactionId,
	type,
	direction,
	amountCents,
	balanceAfterCents,
	reference,
	idempotencyKey,
	description,
	metadata,
	session
}) => {
	validatePositiveAmount(amountCents, "amountCents");
	if (!Number.isSafeInteger(balanceAfterCents) || balanceAfterCents < 0) {
		throw new WalletServiceError("balanceAfterCents must be a non-negative safe integer.", 400);
	}
	const [entry] = await WalletLedger.create([{
		userId,
		walletId,
		transactionId,
		type,
		direction,
		amountCents,
		balanceAfterCents,
		reference,
		idempotencyKey,
		description,
		metadata
	}], { session });
	return entry;
};

const creditWallet = async ({ userId, amountCents, reference, description, idempotencyKey, session }) => {
	validatePositiveAmount(amountCents, "amountCents");
	const wallet = await Wallet.findOne({ userId }).session(session || null);
	if (!wallet) throw new WalletServiceError("Wallet not found.", 404);
	const nextBalance = wallet.balanceCents + amountCents;
	if (!isWithinWalletLimit(wallet.balanceCents, amountCents)) {
		throw new WalletServiceError(`Wallet balance cannot exceed ${MAX_WALLET_BALANCE_CENTS} cents.`, 409);
	}
	const finalReference = reference || createReference("CRT");
	const finalIdempotencyKey = idempotencyKey || `credit:${finalReference}`;
	const finalDescription = description || "Wallet credit";
	const replay = await findReplay({
		userId,
		idempotencyKey: finalIdempotencyKey,
		type: "adjustment",
		amountCents,
		session,
		adjustmentDirection: "credit"
	});
	if (replay) return { transaction: replay, wallet, replayed: true };
	const updatedWallet = await Wallet.findOneAndUpdate(
		{ userId },
		{ $inc: { balanceCents: amountCents } },
		{ new: true, session }
	);
	const [transaction] = await WalletTransaction.create([{
		userId,
		walletId: wallet._id,
		type: "adjustment",
		adjustmentDirection: "credit",
		status: "completed",
		amountCents,
		reference: finalReference,
		idempotencyKey: finalIdempotencyKey,
		description: finalDescription
	}], { session });
	await createLedgerEntry({
		userId,
		walletId: wallet._id,
		transactionId: transaction._id,
		type: "adjustment_credit",
		direction: "credit",
		amountCents,
		balanceAfterCents: nextBalance,
		reference: finalReference,
		idempotencyKey: finalIdempotencyKey,
		description: finalDescription,
		session
	});
	return { transaction, wallet: updatedWallet, replayed: false };
};

const debitWallet = async ({ userId, amountCents, reference, description, idempotencyKey, session }) => {
	validatePositiveAmount(amountCents, "amountCents");
	const wallet = await Wallet.findOne({ userId }).session(session || null);
	if (!wallet) throw new WalletServiceError("Wallet not found.", 404);
	validateBalance({ balanceCents: wallet.balanceCents, amountCents, direction: "debit" });
	const finalReference = reference || createReference("DBT");
	const finalIdempotencyKey = idempotencyKey || `debit:${finalReference}`;
	const finalDescription = description || "Wallet debit";
	const replay = await findReplay({
		userId,
		idempotencyKey: finalIdempotencyKey,
		type: "adjustment",
		amountCents,
		session,
		adjustmentDirection: "debit"
	});
	if (replay) return { transaction: replay, wallet, replayed: true };
	const updatedWallet = await Wallet.findOneAndUpdate(
		{ userId },
		{ $inc: { balanceCents: -amountCents } },
		{ new: true, session }
	);
	const [transaction] = await WalletTransaction.create([{
		userId,
		walletId: wallet._id,
		type: "adjustment",
		adjustmentDirection: "debit",
		status: "completed",
		amountCents,
		reference: finalReference,
		idempotencyKey: finalIdempotencyKey,
		description: finalDescription
	}], { session });
	await createLedgerEntry({
		userId,
		walletId: wallet._id,
		transactionId: transaction._id,
		type: "adjustment_debit",
		direction: "debit",
		amountCents,
		balanceAfterCents: updatedWallet.balanceCents,
		reference: finalReference,
		idempotencyKey: finalIdempotencyKey,
		description: finalDescription,
		session
	});
	return { transaction, wallet: updatedWallet, replayed: false };
};

const createCollectionRequest = async ({ userId, amountCents, note, idempotencyKey }) => {
	const existing = await findReplay({ userId, idempotencyKey, type: "collection", amountCents });
	if (existing) return { transaction: existing, replayed: true };

	const wallet = await Wallet.findOne({ userId });
	if (!wallet) throw new WalletServiceError("Wallet not found.", 404);
	const reference = createReference("COL");

	try {
		const [transaction] = await WalletTransaction.create([{
			userId,
			walletId: wallet._id,
			type: "collection",
			status: "pending",
			amountCents,
			reference,
			idempotencyKey,
			description: note || "Incoming payment request"
		}]);
		return { transaction, replayed: false };
	} catch (error) {
		if (error.code !== 11000) throw error;
		const replay = await findReplay({ userId, idempotencyKey, type: "collection", amountCents });
		if (replay) return { transaction: replay, replayed: true };
		throw error;
	}
};

const createWithdrawalRequest = async ({ userId, amountCents, method, idempotencyKey, ipAddress, userAgent }) => {
	if (!isValidAmountCents(amountCents) || amountCents > MAX_WITHDRAWAL_AMOUNT_CENTS) {
		throw new WalletServiceError("Provide a valid withdrawal amount within the configured limit.", 400);
	}
	if (!isValidIdempotencyKey(idempotencyKey)) {
		throw new WalletServiceError("A valid Idempotency-Key is required.", 400);
	}

	const payoutOptions = await getPayoutOptions();
	const payoutOption = payoutOptions.find((option) => option.code === method);
	if (!payoutOption) {
		throw new WalletServiceError("Selected payout option is unavailable.", 400);
	}
	if (!payoutOption.active) {
		throw new WalletServiceError("This payout method is currently unavailable.", 400);
	}
	const findWithdrawalReplay = async (session) => {
		const replay = await findReplay({
			userId,
			idempotencyKey,
			type: "withdrawal",
			amountCents,
			session,
			conflictMessage: "This withdrawal request has already been submitted."
		});
		if (replay) {
			const existingWithdrawal = await Withdrawal.findOne({ reference: replay.reference }).select("method").session(session || null);
			if (existingWithdrawal && existingWithdrawal.method !== method) {
				throw new WalletServiceError("This withdrawal request has already been submitted.", 409);
			}
		}
		return replay;
	};

	try {
		return await runInTransaction(async (session) => {
			const replay = await findWithdrawalReplay(session);
			if (replay) return { transaction: replay, replayed: true };

			const wallet = await Wallet.findOne({ userId }).session(session);
			if (!wallet) throw new WalletServiceError("Wallet not found.", 404);
			if (wallet.balanceCents < amountCents) throw new WalletServiceError("Insufficient balance.", 409);
			if (!isWithinWalletLimit(wallet.balanceCents - amountCents, 0)) {
				throw new WalletServiceError("Wallet balance cannot exceed the configured cap.", 409);
			}

			const updatedWallet = await Wallet.findOneAndUpdate(
				{ userId, balanceCents: { $gte: amountCents } },
				{ $inc: { balanceCents: -amountCents } },
				{ new: true, session }
			);
			if (!updatedWallet) throw new WalletServiceError("Insufficient balance.", 409);

			const reference = createReference("WDR");
			const [transaction] = await WalletTransaction.create([{
				userId,
				walletId: wallet._id,
				type: "withdrawal",
				status: "pending",
				amountCents,
				reference,
				idempotencyKey,
				description: `Withdrawal via ${payoutOption.label}`
			}], { session });

			await Withdrawal.create([{
				userId,
				walletId: wallet._id,
				amountCents,
				method,
				reference
			}], { session });

			await WalletLedger.create([{
				userId,
				walletId: wallet._id,
				transactionId: transaction._id,
				type: "withdrawal_debit",
				direction: "debit",
				amountCents,
				balanceAfterCents: updatedWallet.balanceCents,
				reference,
				idempotencyKey: `withdrawal:${idempotencyKey}`,
				description: transaction.description
			}], { session });

			await writeAuditLog({
				actorId: userId,
				targetUserId: userId,
				targetType: "withdrawal",
				referenceId: String(transaction._id),
				action: "withdrawal.created",
				amountCents,
				reference,
				description: transaction.description,
				ipAddress,
				userAgent,
				metadata: { withdrawalId: String(transaction._id), method },
				session
			});

			return { transaction, wallet: updatedWallet, replayed: false };
		});
	} catch (error) {
		if (error.code === 11000) {
			const replay = await findWithdrawalReplay();
			if (replay) return { transaction: replay, replayed: true };
		}
		throw error;
	}
};

const writeAuditLog = async ({
	actorId,
	targetUserId,
	targetType,
	referenceId,
	action,
	amountCents,
	reference,
	idempotencyKey,
	description,
	ipAddress,
	userAgent,
	metadata,
	session
}) => {
	const [entry] = await AuditLog.create([{
		actorId,
		targetUserId,
		targetType,
		referenceId,
		action,
		amountCents,
		reference,
		idempotencyKey,
		description,
		ipAddress,
		userAgent,
		metadata
	}], { session });
	return entry;
};

const updatePayoutOption = async ({ actorId, code, label, eta, active, ipAddress, userAgent }) => (
	runInTransaction(async (session) => {
		const previous = await PayoutOption.findOne({ code }).session(session);
		const defaultOption = defaultPayoutOptions.find((option) => option.code === code);
		const before = {
			label: previous?.label || defaultOption.label,
			eta: previous?.eta || defaultOption.eta,
			active: previous ? previous.active : true
		};
		const option = await PayoutOption.findOneAndUpdate(
			{ code },
			{ $set: { label, eta, active } },
			{ new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, session }
		);
		await writeAuditLog({
			actorId,
			targetType: "payout_option",
			referenceId: code,
			action: "payout.configuration_changed",
			reference: `PAYOUT-${code}`,
			description: `Payout option ${code} configuration changed`,
			ipAddress,
			userAgent,
			metadata: { before, after: { label: option.label, eta: option.eta, active: option.active } },
			session
		});
		return option;
	})
);

const adminCreditWallet = async ({ actorId, userId, amountCents, reference, description, idempotencyKey, ipAddress, userAgent }) => (
	runInTransaction(async (session) => {
		const result = await creditWallet({ userId, amountCents, reference, description, idempotencyKey, session });
		if (!result.replayed) {
			await writeAuditLog({
				actorId,
				targetUserId: userId,
				targetType: "wallet",
				referenceId: String(result.transaction._id),
				action: "wallet.credited",
				amountCents,
				reference: result.transaction.reference,
				idempotencyKey,
				description: result.transaction.description,
				ipAddress,
				userAgent,
				metadata: { transactionId: result.transaction._id },
				session
			});
		}
		return result;
	})
);

const adminDebitWallet = async ({ actorId, userId, amountCents, reference, description, idempotencyKey, ipAddress, userAgent }) => (
	runInTransaction(async (session) => {
		const result = await debitWallet({ userId, amountCents, reference, description, idempotencyKey, session });
		if (!result.replayed) {
			await writeAuditLog({
				actorId,
				targetUserId: userId,
				targetType: "wallet",
				referenceId: String(result.transaction._id),
				action: "wallet.debited",
				amountCents,
				reference: result.transaction.reference,
				idempotencyKey,
				description: result.transaction.description,
				ipAddress,
				userAgent,
				metadata: { transactionId: result.transaction._id },
				session
			});
		}
		return result;
	})
);

const adminCorrectWallet = async ({
	actorId,
	userId,
	targetBalanceCents,
	reference,
	description,
	idempotencyKey,
	ipAddress,
	userAgent
}) => runInTransaction(async (session) => {
	const priorAudit = await AuditLog.findOne({
		actorId,
		idempotencyKey,
		action: "wallet.balance_corrected"
	}).session(session);
	if (priorAudit) {
		if (String(priorAudit.targetUserId) !== String(userId)
			|| priorAudit.metadata?.targetBalanceCents !== targetBalanceCents) {
			throw new WalletServiceError("Idempotency-Key was already used with a different correction.", 409);
		}
		return {
			auditLog: priorAudit,
			wallet: await Wallet.findOne({ userId }).session(session),
			replayed: true
		};
	}

	const wallet = await Wallet.findOne({ userId }).session(session);
	if (!wallet) throw new WalletServiceError("Wallet not found.", 404);
	if (!Number.isSafeInteger(targetBalanceCents) || targetBalanceCents < 0) {
		throw new WalletServiceError("Target balance is outside the configured wallet limits.", 400);
	}
	if (targetBalanceCents > MAX_WALLET_BALANCE_CENTS) {
		throw new WalletServiceError("Target balance exceeds the configured wallet limit.", 409);
	}
	const difference = targetBalanceCents - wallet.balanceCents;
	if (difference === 0) throw new WalletServiceError("Wallet already has the requested balance.", 409);

	const adjustment = difference > 0
		? await creditWallet({
			userId,
			amountCents: difference,
			reference,
			description,
			idempotencyKey: `correction:${idempotencyKey}`,
			session
		})
		: await debitWallet({
			userId,
			amountCents: Math.abs(difference),
			reference,
			description,
			idempotencyKey: `correction:${idempotencyKey}`,
			session
		});
	const auditLog = await writeAuditLog({
		actorId,
		targetUserId: userId,
		targetType: "wallet",
		referenceId: String(adjustment.transaction._id),
		action: "wallet.balance_corrected",
		amountCents: Math.abs(difference),
		reference: adjustment.transaction.reference,
		idempotencyKey,
		description: adjustment.transaction.description,
		ipAddress,
		userAgent,
		metadata: { targetBalanceCents, previousBalanceCents: wallet.balanceCents },
		session
	});
	return { ...adjustment, auditLog, replayed: false };
});

const reviewWithdrawal = async ({ withdrawalId, actorId, decision, reason, ipAddress, userAgent }) => (
	runInTransaction(async (session) => {
		const withdrawal = await Withdrawal.findOne({ _id: withdrawalId, status: "pending" }).session(session);
		if (!withdrawal) throw new WalletServiceError("Withdrawal not found or has already been reviewed.", 404);

		const transaction = await WalletTransaction.findOne({
			reference: withdrawal.reference,
			type: "withdrawal",
			status: "pending"
		}).session(session);
		if (!transaction) throw new WalletServiceError("Withdrawal not found or has already been reviewed.", 404);

		if (decision === "reject") {
			const wallet = await Wallet.findOneAndUpdate(
				{ _id: withdrawal.walletId, userId: withdrawal.userId },
				{ $inc: { balanceCents: withdrawal.amountCents } },
				{ new: true, session }
			);
			if (!wallet) throw new WalletServiceError("Wallet not found for withdrawal refund.", 404);

			const refundReference = createReference("REF");
			const refundDescription = `Refund for rejected withdrawal ${withdrawal.reference}`;
			const [refund] = await WalletTransaction.create([{
				userId: withdrawal.userId,
				walletId: wallet._id,
				type: "refund",
				status: "completed",
				amountCents: withdrawal.amountCents,
				reference: refundReference,
				idempotencyKey: `admin-withdrawal-refund:${withdrawal._id}`,
				description: refundDescription
			}], { session });
			await WalletLedger.create([{
				userId: withdrawal.userId,
				walletId: wallet._id,
				transactionId: refund._id,
				type: "withdrawal_refund",
				direction: "credit",
				amountCents: withdrawal.amountCents,
				balanceAfterCents: wallet.balanceCents,
				reference: refundReference,
				idempotencyKey: `admin-withdrawal-refund:${withdrawal._id}`,
				description: refundDescription
			}], { session });

			transaction.status = "failed";
			await transaction.save({ session });
			withdrawal.status = "rejected";
		} else {
			withdrawal.status = "approved";
		}

		withdrawal.reviewedBy = actorId;
		withdrawal.reviewedAt = new Date();
		withdrawal.reviewReason = reason;
		await withdrawal.save({ session });
		await writeAuditLog({
			actorId,
			targetUserId: withdrawal.userId,
			targetType: "withdrawal",
			referenceId: String(withdrawal._id),
			action: decision === "approve" ? "withdrawal.approved" : "withdrawal.rejected",
			amountCents: withdrawal.amountCents,
			reference: withdrawal.reference,
			description: reason || (decision === "approve" ? "Withdrawal approved by administrator" : "Withdrawal rejected by administrator"),
			ipAddress,
			userAgent,
			metadata: { withdrawalId: withdrawal._id, decision },
			session
		});
		return { withdrawal, transaction };
	})
);

const getAdminWithdrawals = async ({ status, cursor, limit }) => {
	const filter = {};
	if (status) filter.status = status;
	if (cursor) filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
	const withdrawals = await Withdrawal.find(filter)
		.sort({ _id: -1 })
		.limit(limit + 1)
		.populate("userId", "name email")
		.lean();
	const hasMore = withdrawals.length > limit;
	if (hasMore) withdrawals.pop();
	return { withdrawals, nextCursor: hasMore ? withdrawals[withdrawals.length - 1]._id : null };
};

const getAdminWithdrawal = async ({ withdrawalId }) => {
	const withdrawal = await Withdrawal.findById(withdrawalId)
		.populate("userId", "name email")
		.populate("reviewedBy", "name email")
		.lean();
	if (!withdrawal) throw new WalletServiceError("Withdrawal not found.", 404);
	return withdrawal;
};

const getAdminTransactions = async ({ type, status, userId, cursor, limit }) => {
	const filter = {};
	if (type) filter.type = type;
	if (status) filter.status = status;
	if (userId) filter.userId = userId;
	if (cursor) filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
	const transactions = await WalletTransaction.find(filter)
		.sort({ _id: -1 })
		.limit(limit + 1)
		.populate("userId", "name email")
		.lean();
	const hasMore = transactions.length > limit;
	if (hasMore) transactions.pop();
	return { transactions, nextCursor: hasMore ? transactions[transactions.length - 1]._id : null };
};

const getAdminAuditLogs = async ({ actorId, targetUserId, cursor, limit }) => {
	const filter = {};
	if (actorId) filter.actorId = actorId;
	if (targetUserId) filter.targetUserId = targetUserId;
	if (cursor) filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
	const entries = await AuditLog.find(filter)
		.sort({ _id: -1 })
		.limit(limit + 1)
		.populate("actorId", "name email")
		.populate("targetUserId", "name email")
		.lean();
	const hasMore = entries.length > limit;
	if (hasMore) entries.pop();
	return { entries, nextCursor: hasMore ? entries[entries.length - 1]._id : null };
};

const getLedger = async ({ userId, cursor, limit }) => {
	const filter = { userId };
	if (cursor) filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
	const entries = await WalletLedger.find(filter)
		.sort({ _id: -1 })
		.limit(limit + 1)
		.lean();
	const hasMore = entries.length > limit;
	if (hasMore) entries.pop();
	return { entries, nextCursor: hasMore ? entries[entries.length - 1]._id : null };
};

const applyProviderEvent = async ({ event, payloadHash }) => {
	if (!connectDB.getCapabilities().transactionsSupported) {
		throw new WalletServiceError("Provider settlement requires a MongoDB replica set or sharded cluster.", 503);
	}

	try {
		return await runInTransaction(async (session) => {
			await WebhookEvent.create([{
				eventId: event.eventId,
				type: event.type,
				reference: event.reference,
				payloadHash
			}], { session });

			if (event.type === "collection.succeeded") {
				const transaction = await WalletTransaction.findOneAndUpdate(
					{ reference: event.reference, type: "collection", status: "pending", amountCents: event.amountCents },
					{ $set: { status: "completed", providerEventId: event.eventId } },
					{ new: true, session }
				);
				if (!transaction) throw new WalletServiceError("Pending collection not found or amount does not match.", 404);

				const currentWallet = await Wallet.findOne({ _id: transaction.walletId, userId: transaction.userId }).session(session);
				if (!currentWallet) throw new WalletServiceError("Wallet not found.", 404);
				if (!isWithinWalletLimit(currentWallet.balanceCents, event.amountCents)) {
					throw new WalletServiceError(`Wallet balance cannot exceed ${MAX_WALLET_BALANCE_CENTS} cents.`, 409);
				}

				const wallet = await Wallet.findOneAndUpdate(
					{
						_id: transaction.walletId,
						userId: transaction.userId
					},
					{ $inc: { balanceCents: event.amountCents } },
					{ new: true, session }
				);
				if (!wallet) throw new WalletServiceError("Wallet not found or balance limit would be exceeded.", 409);

				await WalletLedger.create([{
					userId: transaction.userId,
					walletId: wallet._id,
					transactionId: transaction._id,
					type: "collection_credit",
					direction: "credit",
					amountCents: event.amountCents,
					balanceAfterCents: wallet.balanceCents,
					reference: transaction.reference,
					idempotencyKey: `provider:${event.eventId}`,
					description: transaction.description
				}], { session });
				return { duplicate: false, status: "completed" };
			}

			const withdrawal = await Withdrawal.findOne({
				reference: event.reference,
				status: { $in: ["pending", "approved"] },
				amountCents: event.amountCents
			}).session(session);
			if (!withdrawal) throw new WalletServiceError("Pending withdrawal not found or amount does not match.", 404);

			const transaction = await WalletTransaction.findOne({ reference: event.reference, type: "withdrawal" }).session(session);
			if (!transaction) throw new WalletServiceError("Withdrawal transaction not found.", 404);

			if (event.type === "withdrawal.failed") {
				const wallet = await Wallet.findOneAndUpdate(
					{ _id: withdrawal.walletId, userId: withdrawal.userId },
					{ $inc: { balanceCents: withdrawal.amountCents } },
					{ new: true, session }
				);
				if (!wallet) throw new WalletServiceError("Wallet not found for withdrawal refund.", 404);

				const refundReference = createReference("REF");
				const [refund] = await WalletTransaction.create([{
					userId: withdrawal.userId,
					walletId: wallet._id,
					type: "refund",
					status: "completed",
					amountCents: withdrawal.amountCents,
					reference: refundReference,
					idempotencyKey: `refund:${event.eventId}`,
					description: `Refund for failed withdrawal ${event.reference}`
				}], { session });
				await WalletLedger.create([{
					userId: withdrawal.userId,
					walletId: wallet._id,
					transactionId: refund._id,
					type: "withdrawal_refund",
					direction: "credit",
					amountCents: withdrawal.amountCents,
					balanceAfterCents: wallet.balanceCents,
					reference: refundReference,
					idempotencyKey: `provider:${event.eventId}`,
					description: refund.description
				}], { session });
				transaction.status = "failed";
				withdrawal.status = "failed";
			} else {
				transaction.status = "completed";
				withdrawal.status = "completed";
			}

			transaction.providerEventId = event.eventId;
			withdrawal.providerEventId = event.eventId;
			await transaction.save({ session });
			await withdrawal.save({ session });
			return { duplicate: false, status: withdrawal.status };
		});
	} catch (error) {
		if (error.code === 11000) {
			const priorEvent = await WebhookEvent.findOne({ eventId: event.eventId }).lean();
			if (priorEvent?.payloadHash === payloadHash) return { duplicate: true };
			if (priorEvent) throw new WalletServiceError("Provider event ID was reused with a different payload.", 409);
		}
		throw error;
	}
};

module.exports = {
	WalletServiceError,
	createCollectionRequest,
	createWithdrawalRequest,
	createLedgerEntry,
	creditWallet,
	debitWallet,
	adminCreditWallet,
	adminDebitWallet,
	getWallet,
	getTransactions,
	validateBalance,
	getLedger,
	getPayoutOptions,
	updatePayoutOption,
	adminCorrectWallet,
	reviewWithdrawal,
	getAdminWithdrawals,
	getAdminWithdrawal,
	getAdminTransactions,
	getAdminAuditLogs,
	applyProviderEvent
};