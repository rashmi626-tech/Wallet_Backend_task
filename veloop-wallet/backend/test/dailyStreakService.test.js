const test = require("node:test");
const assert = require("node:assert/strict");
const Wallet = require("../src/models/Wallet");
const { claimDailyReward, getDailyStreakStatus } = require("../src/services/dailyStreakService");

const replace = (object, key, value) => {
	const original = Object.getOwnPropertyDescriptor(object, key);
	Object.defineProperty(object, key, { configurable: true, writable: true, value });
	return () => {
		if (original) Object.defineProperty(object, key, original);
		else delete object[key];
	};
};

test("streak status advances yesterday's claim and resets after a missed UTC day", () => {
	const now = new Date("2026-10-15T00:30:00.000Z");
	const continues = getDailyStreakStatus({
		currentDays: 4,
		bestDays: 8,
		lastClaimDate: "2026-10-14"
	}, now);
	const resets = getDailyStreakStatus({
		currentDays: 4,
		bestDays: 8,
		lastClaimDate: "2026-10-13"
	}, now);

	assert.equal(continues.currentDays, 4);
	assert.equal(continues.canClaim, true);
	assert.deepEqual(continues.nextReward, { streakDay: 5, cycleDay: 5, ves: 150, spins: 0 });
	assert.equal(resets.currentDays, 0);
	assert.deepEqual(resets.nextReward, { streakDay: 1, cycleDay: 1, ves: 50, spins: 0 });
});

test("a successful claim advances streak and rewards VEs and weekly spins without cash changes", async (t) => {
	const wallet = {
		_id: "wallet-1",
		balanceCents: 12500,
		ves: 700,
		spins: 2,
		dailyStreak: { currentDays: 6, bestDays: 6, lastClaimDate: "2026-10-14" }
	};
	const restoreFind = replace(Wallet, "findOne", async () => wallet);
	const restoreUpdate = replace(Wallet, "findOneAndUpdate", async (filter, update) => {
		assert.equal(filter["dailyStreak.lastClaimDate"], "2026-10-14");
		wallet.dailyStreak = update.$set.dailyStreak;
		wallet.ves += update.$inc.ves;
		wallet.spins += update.$inc.spins;
		return wallet;
	});
	t.after(() => {
		restoreUpdate();
		restoreFind();
	});

	const result = await claimDailyReward({
		userId: "user-1",
		now: new Date("2026-10-15T00:30:00.000Z")
	});

	assert.deepEqual(result.reward, { streakDay: 7, cycleDay: 7, ves: 300, spins: 1 });
	assert.equal(wallet.dailyStreak.currentDays, 7);
	assert.equal(wallet.dailyStreak.bestDays, 7);
	assert.equal(wallet.ves, 1000);
	assert.equal(wallet.spins, 3);
	assert.equal(wallet.balanceCents, 12500);
});

test("a second daily claim is rejected without changing the wallet", async (t) => {
	const wallet = {
		_id: "wallet-1",
		dailyStreak: { currentDays: 2, bestDays: 2, lastClaimDate: "2026-10-15" }
	};
	const restoreFind = replace(Wallet, "findOne", async () => wallet);
	let updateCalled = false;
	const restoreUpdate = replace(Wallet, "findOneAndUpdate", async () => {
		updateCalled = true;
		return wallet;
	});
	t.after(() => {
		restoreUpdate();
		restoreFind();
	});

	await assert.rejects(
		claimDailyReward({ userId: "user-1", now: new Date("2026-10-15T20:00:00.000Z") }),
		{ message: "Today's daily reward has already been claimed.", statusCode: 409 }
	);
	assert.equal(updateCalled, false);
});

test("concurrent same-day claims can credit only one reward", async (t) => {
	const wallet = {
		_id: "wallet-1",
		ves: 0,
		spins: 0,
		dailyStreak: { currentDays: 0, bestDays: 0, lastClaimDate: null }
	};
	const restoreFind = replace(Wallet, "findOne", async () => ({ ...wallet, dailyStreak: { ...wallet.dailyStreak } }));
	const restoreUpdate = replace(Wallet, "findOneAndUpdate", async (filter, update) => {
		if (filter["dailyStreak.lastClaimDate"] !== wallet.dailyStreak.lastClaimDate) return null;
		wallet.dailyStreak = update.$set.dailyStreak;
		wallet.ves += update.$inc.ves;
		wallet.spins += update.$inc.spins;
		return wallet;
	});
	t.after(() => {
		restoreUpdate();
		restoreFind();
	});

	const claims = await Promise.allSettled([
		claimDailyReward({ userId: "user-1", now: new Date("2026-10-15T10:00:00.000Z") }),
		claimDailyReward({ userId: "user-1", now: new Date("2026-10-15T10:00:00.000Z") })
	]);

	assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
	assert.equal(claims.filter((claim) => claim.status === "rejected")[0].reason.statusCode, 409);
	assert.equal(wallet.ves, 50);
	assert.equal(wallet.spins, 0);
});

test("claim status changes at UTC midnight", () => {
	const streak = {
		currentDays: 2,
		bestDays: 2,
		lastClaimDate: "2026-10-14"
	};
	const justBeforeMidnight = getDailyStreakStatus(streak, new Date("2026-10-14T23:59:59.000Z"));
	const justAfterMidnight = getDailyStreakStatus(streak, new Date("2026-10-15T00:00:01.000Z"));

	assert.equal(justBeforeMidnight.claimedToday, true);
	assert.equal(justAfterMidnight.canClaim, true);
	assert.equal(justAfterMidnight.currentDays, 2);
});
