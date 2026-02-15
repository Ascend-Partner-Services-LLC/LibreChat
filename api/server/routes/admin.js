const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { getBalanceConfig } = require('@librechat/api');
const { User, Balance, Conversation, Transaction, SharedLink, Message } = require('~/db/models');
const { getMessages } = require('~/models/Message');
const { createTransaction } = require('~/models/Transaction');
const { getAppConfig } = require('~/server/services/Config');
const { requireJwtAuth, checkAdmin } = require('~/server/middleware');

const router = express.Router();

router.use(requireJwtAuth);
router.use(checkAdmin);

function escapeRegex(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addIntervalToDate(date, value, unit) {
  if (!date || !value || value <= 0) return null;
  const d = new Date(date);
  switch (unit) {
    case 'seconds':
      d.setSeconds(d.getSeconds() + value);
      break;
    case 'minutes':
      d.setMinutes(d.getMinutes() + value);
      break;
    case 'hours':
      d.setHours(d.getHours() + value);
      break;
    case 'days':
      d.setDate(d.getDate() + value);
      break;
    case 'weeks':
      d.setDate(d.getDate() + value * 7);
      break;
    case 'months':
      d.setMonth(d.getMonth() + value);
      break;
    default:
      return null;
  }
  return d.toISOString();
}

/**
 * GET /api/admin/balances
 * List all users with their balance (admin only). Paginated.
 * Query: page (1-based), limit (default 25)
 */
router.get('/balances', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const userFilter = {};
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      userFilter.$or = [
        { email: re },
        { name: re },
        { username: re },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(userFilter),
      User.find(userFilter)
        .select('email name _id firm_name firm_id')
        .sort({ email: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    const balances = await Balance.find({
      user: { $in: users.map((u) => u._id) },
    })
      .select(
        'user tokenCredits autoRefillEnabled refillAmount refillIntervalValue refillIntervalUnit lastRefill',
      )
      .lean();
    const balanceByUser = Object.fromEntries(
      balances.map((b) => [
        b.user.toString(),
        {
          tokenCredits: b.tokenCredits ?? 0,
          autoRefillEnabled: b.autoRefillEnabled,
          refillAmount: b.refillAmount,
          refillIntervalValue: b.refillIntervalValue,
          refillIntervalUnit: b.refillIntervalUnit,
          lastRefill: b.lastRefill,
        },
      ]),
    );

    const userIds = users.map((u) => u._id);
    const tokenUsageAgg = await Transaction.aggregate([
      {
        $match: {
          user: { $in: userIds },
          tokenType: { $in: ['prompt', 'completion'] },
          rawAmount: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$user',
          totalTokensUsed: { $sum: { $abs: '$rawAmount' } },
        },
      },
    ]);
    const tokensUsedByUser = Object.fromEntries(
      tokenUsageAgg.map((r) => [r._id.toString(), r.totalTokensUsed ?? 0]),
    );

    const list = users.map((u) => {
      const bid = u._id.toString();
      const bal = balanceByUser[bid] ?? { tokenCredits: 0 };
      const nextRefillDate =
        bal.autoRefillEnabled && bal.lastRefill && bal.refillIntervalValue && bal.refillIntervalUnit
          ? addIntervalToDate(
              bal.lastRefill,
              bal.refillIntervalValue,
              bal.refillIntervalUnit,
            )
          : null;
      return {
        userId: bid,
        email: u.email,
        name: u.name || u.email,
        firm: u.firm_name || u.firm_id || null,
        tokenCredits: bal.tokenCredits ?? 0,
        totalTokensUsed: tokensUsedByUser[bid] ?? 0,
        nextRefillAmount: bal.autoRefillEnabled ? (bal.refillAmount ?? 0) : null,
        nextRefillDate,
      };
    });
    const totalPages = Math.ceil(total / limit) || 1;
    res.status(200).json({
      users: list,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    logger.error('Error fetching admin balances', error);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

/**
 * POST /api/admin/balances/topup
 * Body: { email?: string, userId?: string, amount: number }
 * Top up a user's balance (admin only).
 */
router.post('/balances/topup', async (req, res) => {
  try {
    const { email, userId, amount } = req.body;
    const rawAmount = typeof amount === 'number' ? amount : parseInt(amount, 10);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    let user;
    if (userId) {
      user = await User.findById(userId).select('_id email').lean();
    } else if (email) {
      user = await User.findOne({ email }).select('_id email').lean();
    } else {
      return res.status(400).json({ error: 'Provide email or userId' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const appConfig = await getAppConfig({ role: req.user.role });
    const balanceConfig = getBalanceConfig(appConfig);
    if (!balanceConfig?.enabled) {
      return res.status(400).json({ error: 'Balance is not enabled' });
    }

    const result = await createTransaction({
      user: user._id,
      tokenType: 'credits',
      context: 'admin',
      rawAmount: +rawAmount,
      balance: balanceConfig,
    });

    if (result?.balance == null) {
      return res.status(500).json({ error: 'Top-up failed' });
    }

    res.status(200).json({
      success: true,
      email: user.email,
      newBalance: result.balance,
      added: rawAmount,
    });
  } catch (error) {
    logger.error('Error topping up balance', error);
    res.status(500).json({ error: 'Failed to top up balance' });
  }
});

/**
 * GET /api/admin/conversations
 * List all conversations across users (admin only). Paginated.
 * Query: limit, cursor (base64), sortBy, sortDirection
 */
router.get('/conversations', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const cursor = req.query.cursor;
    const sortBy = req.query.sortBy || 'updatedAt';
    const sortDirection = req.query.sortDirection || 'desc';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const validSortFields = ['title', 'createdAt', 'updatedAt'];
    if (!validSortFields.includes(sortBy)) {
      return res.status(400).json({ error: `Invalid sortBy. Use one of: ${validSortFields.join(', ')}` });
    }

    const sortOrder = sortDirection === 'asc' ? 1 : -1;
    const sortObj = sortBy === 'updatedAt' ? { updatedAt: sortOrder } : { [sortBy]: sortOrder, updatedAt: sortOrder };

    const baseFilter = { $or: [{ expiredAt: null }, { expiredAt: { $exists: false } }] };
    let searchOr = null;
    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      const searchConditions = [{ title: re }, { conversationId: re }];
      const matchingUsers = await User.find({ $or: [{ email: re }, { name: re }, { username: re }] })
        .select('_id')
        .lean();
      if (matchingUsers.length) {
        searchConditions.push({ user: { $in: matchingUsers.map((u) => u._id) } });
      }
      searchOr = { $or: searchConditions };
      baseFilter.$and = baseFilter.$and || [];
      baseFilter.$and.push(searchOr);
    }
    const filter = { ...baseFilter };
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
        const primaryValue = sortBy === 'title' ? decoded.primary : new Date(decoded.primary);
        const op = sortOrder === 1 ? '$gt' : '$lt';
        filter[sortBy] = { [op]: primaryValue };
      } catch (e) {
        logger.warn('[admin conversations] Invalid cursor, ignoring');
      }
    }

    const [total, convos] = await Promise.all([
      Conversation.countDocuments(baseFilter),
      Conversation.find(filter)
      .select('conversationId endpoint title createdAt updatedAt user')
        .sort(sortObj)
        .limit(limit + 1)
        .lean(),
    ]);

    const hasMore = convos.length > limit;
    const totalPages = Math.ceil(total / limit) || 1;
    const currentConvos = hasMore ? convos.slice(0, limit) : convos;
    const conversationIds = currentConvos.map((c) => c.conversationId);
    const userIds = [...new Set(convos.map((c) => c.user?.toString()).filter(Boolean))];

    const [users, sharedLinks, questionCounts] = await Promise.all([
      User.find({ _id: { $in: userIds } })
        .select('email name firm_name firm_id')
        .lean(),
      SharedLink.find({ conversationId: { $in: conversationIds }, isPublic: true })
        .select('conversationId shareId')
        .lean(),
      conversationIds.length
        ? Message.aggregate([
            {
              $match: {
                conversationId: { $in: conversationIds },
                isCreatedByUser: true,
              },
            },
            { $group: { _id: '$conversationId', count: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
    ]);
    const questionCountByConvo = Object.fromEntries(
      (questionCounts || []).map((r) => [r._id, r.count]),
    );
    const userMap = Object.fromEntries(
      users.map((u) => [
        u._id.toString(),
        {
          email: u.email,
          name: u.name || u.email,
          firm: u.firm_name || u.firm_id || null,
        },
      ]),
    );
    const shareIdByConvo = Object.fromEntries(
      (sharedLinks || []).map((s) => [s.conversationId, s.shareId]),
    );
    const list = currentConvos.map((c) => ({
      conversationId: c.conversationId,
      title: c.title,
      endpoint: c.endpoint,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      user: c.user
        ? userMap[c.user.toString()] ?? { email: '', name: c.user.toString(), firm: null }
        : null,
      shareId: shareIdByConvo[c.conversationId] || null,
      questionCount: questionCountByConvo[c.conversationId] ?? 0,
    }));

    let nextCursor = null;
    if (hasMore && list.length > 0) {
      const last = list[list.length - 1];
      const primaryStr = sortBy === 'title' ? last.title : last.updatedAt?.toISOString?.() ?? '';
      nextCursor = Buffer.from(
        JSON.stringify({ primary: primaryStr, secondary: last.updatedAt?.toISOString?.() ?? '' }),
      ).toString('base64');
    }

    res.status(200).json({ conversations: list, nextCursor, total, totalPages });
  } catch (error) {
    logger.error('Error fetching admin conversations', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * GET /api/admin/conversations/:conversationId/messages
 * Get messages for a conversation (admin only). Returns user messages as "questions".
 */
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const messages = await getMessages({ conversationId });
    const list = (messages ?? []).map((m) => ({
      messageId: m.messageId,
      text: m.text,
      content: m.content,
      sender: m.sender,
      isCreatedByUser: m.isCreatedByUser,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
    res.status(200).json({ messages: list });
  } catch (error) {
    logger.error('Error fetching admin conversation messages', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * GET /api/admin/metrics
 * Aggregate metrics for admin dashboard (admin only).
 */
router.get('/metrics', async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const convoBaseFilter = { $or: [{ expiredAt: null }, { expiredAt: { $exists: false } }] };

    const [
      totalUsers,
      newUsersLast7Days,
      newUsersLast30Days,
      totalConversations,
      newConversationsLast7Days,
      totalMessages,
      questionsLast7Days,
      tokenAgg,
      tokenLast7Agg,
      activeUsersLast7Days,
      sharedLinksCount,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Conversation.countDocuments(convoBaseFilter),
      Conversation.countDocuments({
        ...convoBaseFilter,
        createdAt: { $gte: sevenDaysAgo },
      }),
      Message.countDocuments({}),
      Message.countDocuments({
        isCreatedByUser: true,
        createdAt: { $gte: sevenDaysAgo },
      }),
      Transaction.aggregate([
        {
          $match: {
            tokenType: { $in: ['prompt', 'completion'] },
            rawAmount: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: null, total: { $sum: { $abs: '$rawAmount' } } } },
      ]),
      Transaction.aggregate([
        {
          $match: {
            tokenType: { $in: ['prompt', 'completion'] },
            rawAmount: { $exists: true, $ne: null },
            createdAt: { $gte: sevenDaysAgo },
          },
        },
        { $group: { _id: null, total: { $sum: { $abs: '$rawAmount' } } } },
      ]),
      Conversation.distinct('user', {
        ...convoBaseFilter,
        updatedAt: { $gte: sevenDaysAgo },
      }).then((ids) => ids.length),
      SharedLink.countDocuments({ isPublic: true }),
    ]);

    const totalTokensUsed = tokenAgg[0]?.total ?? 0;
    const tokensUsedLast7Days = tokenLast7Agg[0]?.total ?? 0;

    res.status(200).json({
      totalUsers,
      newUsersLast7Days,
      newUsersLast30Days,
      totalConversations,
      newConversationsLast7Days,
      totalMessages,
      questionsLast7Days,
      totalTokensUsed,
      tokensUsedLast7Days,
      activeUsersLast7Days,
      sharedLinksCount,
    });
  } catch (error) {
    logger.error('Error fetching admin metrics', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

module.exports = router;
