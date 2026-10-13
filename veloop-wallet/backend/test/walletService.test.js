const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const connectDB = require("../src/config/database");
const AuditLog = require("../src/models/AuditLog");
const PayoutOption = require("../src/models/PayoutOption");
const Wallet = require("../src/models/Wallet");
const WalletLedger = require("../src/models/WalletLedger");
const WalletTransaction = require("../src/models/WalletTransaction");
const Withdrawal = require("../src/models/Withdrawal");
const walletService = require("../src/services/walletService");

const mockWalletDatabase = (startingBalanceCents) => {
	let balanceCents = startingBalanceCents;
	let nextId = 1;
	const transactions = new Map();
	const withdrawals = new Map();
	const ledger = [];
	const auditLogs = [];
	const restorers = [];
	const replace = (object, key, value) => {
		const original = Object.getOwnPropertyDescriptor(object, key);
		Object.defineProperty(object, key, { configurable: true, writable: true, value });
		restorers.push(() => {
			if (original) Object.defineProperty(object, key, original);
			else delete object[key];
		});
	};

	replace(connectDB, "getCapabilities", () => ({ transactionsSupported: true }));
	replace(mongoose, "startSession", async () => {
		const session = {
			withTransaction: async (callback) => callback(session),
			endSession: async () => {}
		};
		return session;
	});
	replace(PayoutOption, "find", () => ({ lean: async () => [] }));
	replace(WalletTransaction, "findOne", ({ idempotencyKey }) => ({
		session: async () => transactions.get(idempotencyKey) || null
	}));
	replace(WalletTransaction, "create", async (records) => records.map((record) => {
		const transaction = { _id: `transaction-${nextId++}`, ...record };
		if (transaction.idempotencyKey) transactions.set(transaction.idempotencyKey, transaction);
		return transaction;
	}));
	replace(Wallet, "findOne", ({ userId }) => ({
		session: async () => userId === "user-1" ? { _id: "wallet-1", balanceCents } : null
	}));
	replace(Wallet, "findOneAndUpdate", async (filter, update) => {
		if (filter.balanceCents?.$gte !== undefined && balanceCents < filter.balanceCents.$gte) return null;
		balanceCents += update.$inc.balanceCents;
		return { _id: "wallet-1", balanceCents };
	});
	replace(Withdrawal, "findOne", ({ reference }) => ({
		select() { return this; },
		session: async () => withdrawals.get(reference) || null
	}));
	replace(Withdrawal, "create", async (records) => records.map((record) => {
		const withdrawal = { _id: `withdrawal-${nextId++}`, ...record };
		withdrawals.set(withdrawal.reference, withdrawal);
		return withdrawal;
	}));
	replace(WalletLedger, "create", async (records) => {
		const created = records.map((record) => ({ _id: `ledger-${nextId++}`, ...record }));
		ledger.push(...created);
		return created;
	});
	replace(AuditLog, "create", async (records) => {
		const created = records.map((record) => ({ _id: `audit-${nextId++}`, ...record }));
		auditLogs.push(...created);
		return created;
	});

	return {
		get balanceCents() { return balanceCents; },
		transactions,
		ledger,
		auditLogs,
		restore: () => restorers.reverse().forEach((restore) => restore())
	};
};

test("credits compose and ledger balances reconcile", async (t) => {
	const db = mockWalletDatabase(0);
	t.after(db.restore);

	await walletService.creditWallet({ userId: "user-1", amountCents: 1000, idempotencyKey: "credit-0001" });
	await walletService.creditWallet({ userId: "user-1", amountCents: 500, idempotencyKey: "credit-0002" });

	assert.equal(db.balanceCents, 1500);
	assert.deepEqual(db.ledger.map((entry) => entry.balanceAfterCents), [1000, 1500]);
	assert.equal(db.ledger.reduce((balance, entry) => balance + (entry.direction === "credit" ? entry.amountCents : -entry.amountCents), 0), db.balanceCents);
});

test("withdrawal debits once and returns the exact replay on a repeated request", async (t) => {
	const db = mockWalletDatabase(1500);
	t.after(db.restore);
	const request = {
		userId: "user-1",
		amountCents: 1000,
		method: "bank_transfer",
		idempotencyKey: "withdrawal-0001"
	};

	const first = await walletService.createWithdrawalRequest(request);
	const replay = await walletService.createWithdrawalRequest(request);

	assert.equal(db.balanceCents, 500);
	assert.equal(first.wallet.balanceCents, 500);
	assert.equal(replay.replayed, true);
	assert.equal(db.ledger.length, 1);
	assert.equal(db.auditLogs.filter((entry) => entry.action === "withdrawal.created").length, 1);
});

test("rejects insufficient and invalid payout requests without changing the balance", async (t) => {
	const db = mockWalletDatabase(500);
	t.after(db.restore);

	await assert.rejects(
		walletService.createWithdrawalRequest({
			userId: "user-1",
			amountCents: 1000,
			method: "bank_transfer",
			idempotencyKey: "withdrawal-0002"
		}),
		{ message: "Insufficient balance.", statusCode: 409 }
	);
	await assert.rejects(
		walletService.createWithdrawalRequest({
			userId: "user-1",
			amountCents: 100,
			method: "fake_method",
			idempotencyKey: "withdrawal-0003"
		}),
		{ message: "Selected payout option is unavailable.", statusCode: 400 }
	);
	await assert.rejects(
		walletService.createWithdrawalRequest({
			userId: "user-1",
			amountCents: -100,
			method: "bank_transfer",
			idempotencyKey: "withdrawal-0004"
		}),
		{ statusCode: 400 }
	);
	assert.equal(db.balanceCents, 500);
	assert.equal(db.ledger.length, 0);
});

test("concurrent withdrawals cannot spend the same available balance twice", async (t) => {
	const db = mockWalletDatabase(10000);
	t.after(db.restore);
	const withdraw = (idempotencyKey) => walletService.createWithdrawalRequest({
		userId: "user-1",
		amountCents: 8000,
		method: "bank_transfer",
		idempotencyKey
	});

	const results = await Promise.allSettled([withdraw("withdrawal-0005"), withdraw("withdrawal-0006")]);
	assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
	assert.equal(db.balanceCents, 2000);
	assert.equal(db.ledger.length, 1);
});
