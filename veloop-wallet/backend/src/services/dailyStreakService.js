const Wallet = require("../models/Wallet");

const REWARD_SCHEDULE = [
	{ ves: 50, spins: 0 },
	{ ves: 75, spins: 0 },
	{ ves: 100, spins: 0 },
	{ ves: 125, spins: 0 },
	{ ves: 150, spins: 0 },
	{ ves: 200, spins: 0 },
	{ ves: 300, spins: 1 }
];

class DailyStreakError extends Error {
	constructor(message, statusCode) {
		super(message);
		this.statusCode = statusCode;
		this.expose = true;
	}
}

const getUtcDateKey = (date) => date.toISOString().slice(0, 10);
const getReward = (streakDay) => {
	const cycleDay = ((streakDay - 1) % REWARD_SCHEDULE.length) + 1;
	return { streakDay, cycleDay, ...REWARD_SCHEDULE[cycleDay - 1] };
};

const getDailyStreakStatus = (streak = {}, now = new Date()) => {
	const today = getUtcDateKey(now);
	const yesterday = getUtcDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
	const lastClaimDate = streak.lastClaimDate || null;
	const currentDays = lastClaimDate === today || lastClaimDate === yesterday
		? streak.currentDays || 0
		: 0;
	const claimedToday = lastClaimDate === today;
	const nextStreakDay = claimedToday
		? currentDays + 1
		: lastClaimDate === yesterday ? currentDays + 1 : 1;

	return {
		currentDays,
		bestDays: streak.bestDays || 0,
		lastClaimDate,
		claimedToday,
		canClaim: !claimedToday,
		nextReward: getReward(nextStreakDay),
		rewardSchedule: REWARD_SCHEDULE.map((reward, index) => ({
			cycleDay: index + 1,
			...reward
		}))
	};
};

const claimDailyReward = async ({ userId, now = new Date() }) => {
	const today = getUtcDateKey(now);
	const yesterday = getUtcDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
	const wallet = await Wallet.findOne({ userId });
	if (!wallet) throw new DailyStreakError("Wallet not found.", 404);

	const streak = wallet.dailyStreak || {};
	if (streak.lastClaimDate === today) {
		throw new DailyStreakError("Today's daily reward has already been claimed.", 409);
	}

	const streakDay = streak.lastClaimDate === yesterday ? (streak.currentDays || 0) + 1 : 1;
	const reward = getReward(streakDay);
	const claimFilter = { _id: wallet._id };
	if (streak.lastClaimDate) {
		claimFilter["dailyStreak.lastClaimDate"] = streak.lastClaimDate;
	} else {
		claimFilter["dailyStreak.lastClaimDate"] = null;
	}

	const updatedWallet = await Wallet.findOneAndUpdate(
		claimFilter,
		{
			$set: {
				dailyStreak: {
					currentDays: streakDay,
					bestDays: Math.max(streak.bestDays || 0, streakDay),
					lastClaimDate: today
				}
			},
			$inc: { ves: reward.ves, spins: reward.spins }
		},
		{ new: true, runValidators: true }
	);

	if (!updatedWallet) {
		throw new DailyStreakError("Today's daily reward has already been claimed.", 409);
	}

	return { wallet: updatedWallet, reward };
};

module.exports = { claimDailyReward, getDailyStreakStatus, getUtcDateKey };
