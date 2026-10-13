const test = require("node:test");
const assert = require("node:assert/strict");
const AuditLog = require("../src/models/AuditLog");
const WalletLedger = require("../src/models/WalletLedger");
const WalletTransaction = require("../src/models/WalletTransaction");
const Withdrawal = require("../src/models/Withdrawal");

test("audit log supports sensitive-action events and traces targets", () => {
	const actions = AuditLog.schema.path("action").enumValues;
	for (const action of [
		"withdrawal.created",
		"withdrawal.approved",
		"withdrawal.rejected",
		"wallet.credited",
		"wallet.debited",
		"wallet.balance_corrected",
		"payout.configuration_changed"
	]) {
		assert.ok(actions.includes(action), `missing audit action ${action}`);
	}
	assert.equal(AuditLog.schema.path("referenceId").instance, "String");
	assert.equal(AuditLog.schema.path("targetType").instance, "String");
});

test("wallet and withdrawal query indexes cover owner, status, and transaction access", () => {
	const indexKeys = (model) => model.schema.indexes().map(([keys]) => Object.keys(keys).join(","));
	assert.ok(indexKeys(WalletLedger).includes("userId,_id"));
	assert.ok(indexKeys(WalletLedger).includes("transactionId,createdAt"));
	assert.ok(indexKeys(WalletTransaction).includes("userId,createdAt"));
	assert.ok(indexKeys(Withdrawal).includes("status,_id"));
	assert.ok(indexKeys(Withdrawal).includes("userId,_id"));
	assert.ok(indexKeys(AuditLog).includes("referenceId"));
});
