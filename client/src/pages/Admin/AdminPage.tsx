import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, useToastContext } from '@librechat/client';
import { SystemRoles } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';
import {
  useAdminBalancesQuery,
  useAdminTopUpMutation,
  useAdminConversationsQuery,
  useAdminConversationMessagesQuery,
  useAdminMetricsQuery,
} from '~/data-provider';
import { format } from 'date-fns';
import {
  Coins,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Search,
  BarChart3,
  Users,
  Hash,
  Zap,
  Link2,
} from 'lucide-react';
import { cn } from '~/utils';

function getMessageDisplayText(m: { text?: string; content?: Array<{ type?: string; text?: string }> }): string {
  if (typeof m.text === 'string' && m.text) {
    return m.text;
  }
  if (Array.isArray(m.content) && m.content.length) {
    return m.content
      .filter((p) => p?.type === 'text' && p?.text)
      .map((p) => p.text ?? '')
      .join('') || '(no text)';
  }
  return '(no text)';
}

export default function AdminPage() {
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const [activeTab, setActiveTab] = useState<'balances' | 'conversations' | 'metrics'>('balances');
  const [topUpEmail, setTopUpEmail] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('1000');
  const [expandedConvo, setExpandedConvo] = useState<string | null>(null);
  const [balancePage, setBalancePage] = useState(1);
  const balanceLimit = 25;
  const [convoPage, setConvoPage] = useState(0);
  const [convoCursors, setConvoCursors] = useState<(string | undefined)[]>([undefined]);
  const convoLimit = 25;
  const [balanceSearch, setBalanceSearch] = useState('');
  const [convoSearch, setConvoSearch] = useState('');

  const isAdmin = user?.role === SystemRoles.ADMIN;

  useEffect(() => {
    setBalancePage(1);
  }, [balanceSearch]);
  useEffect(() => {
    setConvoPage(0);
    setConvoCursors([undefined]);
  }, [convoSearch]);

  const { data: balancesData, isLoading: balancesLoading } = useAdminBalancesQuery(
    { page: balancePage, limit: balanceLimit, search: balanceSearch || undefined },
    !!isAdmin,
  );
  const topUpMutation = useAdminTopUpMutation();
  const { data: convosData, isLoading: convosLoading } = useAdminConversationsQuery(
    {
      limit: convoLimit,
      cursor: convoCursors[convoPage],
      sortBy: 'updatedAt',
      sortDirection: 'desc',
      search: convoSearch || undefined,
    },
    !!isAdmin,
  );
  const { data: messagesData, isLoading: messagesLoading } =
    useAdminConversationMessagesQuery(expandedConvo, !!isAdmin && !!expandedConvo);
  const { data: metricsData, isLoading: metricsLoading } = useAdminMetricsQuery(!!isAdmin);

  if (user != null && !isAdmin) {
    return <Navigate to="/c/new" replace />;
  }
  if (user == null) {
    return null;
  }

  const handleTopUp = (email: string) => {
    const amount = parseInt(topUpAmount, 10);
    if (!email || !Number.isFinite(amount) || amount <= 0) {
      showToast({ status: 'error', message: 'Invalid email or amount' });
      return;
    }
    topUpMutation.mutate(
      { email, amount },
      {
        onSuccess: (res) => {
          showToast({
            status: 'success',
            message: `Added ${res.added} to ${res.email}. New balance: ${res.newBalance}`,
          });
          setTopUpEmail('');
        },
        onError: (err: Error) => {
          showToast({ status: 'error', message: err.message || 'Top-up failed' });
        },
      },
    );
  };

  const users = balancesData?.users ?? [];
  const balanceTotal = balancesData?.total ?? 0;
  const balanceTotalPages = balancesData?.totalPages ?? 1;
  const conversations = convosData?.conversations ?? [];
  const convoNextCursor = convosData?.nextCursor ?? null;
  const convoTotal = convosData?.total ?? 0;
  const convoTotalPages = convosData?.totalPages ?? 1;
  const messages = messagesData?.messages ?? [];

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-transparent p-4 text-text-primary">
      <div className="mb-4 flex gap-2 border-b border-border-medium pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('balances')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            activeTab === 'balances'
              ? 'bg-surface-active-alt text-text-primary'
              : 'text-text-secondary hover:bg-surface-active-alt/70',
          )}
        >
          <Coins className="h-4 w-4" />
          Balances
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('conversations')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            activeTab === 'conversations'
              ? 'bg-surface-active-alt text-text-primary'
              : 'text-text-secondary hover:bg-surface-active-alt/70',
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Conversations
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('metrics')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            activeTab === 'metrics'
              ? 'bg-surface-active-alt text-text-primary'
              : 'text-text-secondary hover:bg-surface-active-alt/70',
          )}
        >
          <BarChart3 className="h-4 w-4" />
          Metrics
        </button>
      </div>

      {activeTab === 'balances' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">User balances</h2>
            <div className="flex flex-1 items-center gap-2 min-w-[200px] max-w-sm">
              <Search className="h-4 w-4 shrink-0 text-text-secondary" />
              <input
                type="text"
                value={balanceSearch}
                onChange={(e) => setBalanceSearch(e.target.value)}
                placeholder="Search by email or name…"
                className="w-full rounded-lg border border-border-medium bg-surface-primary px-3 py-2 text-sm placeholder:text-text-secondary focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>
          {balancesLoading ? (
            <p className="text-text-secondary">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border-medium">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border-medium bg-surface-primary-alt">
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Balance (used %)</th>
                    <th className="px-3 py-2 font-medium">Total tokens used</th>
                    <th className="px-3 py-2 font-medium">Next auto top-up</th>
                    <th className="px-3 py-2 font-medium">Top up</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.userId} className="border-b border-border-light">
                      <td className="px-3 py-2">{u.email}</td>
                      <td className="px-3 py-2">{u.name}</td>
                      <td className="px-3 py-2 font-mono">
                        {(() => {
                          const used = u.totalTokensUsed ?? 0;
                          const balance = u.tokenCredits ?? 0;
                          const total = used + balance;
                          const pct = total > 0 ? (used / total) * 100 : 0;
                          return `${new Intl.NumberFormat().format(used)} (${pct.toFixed(0)}%)`;
                        })()}
                      </td>
                      <td className="px-3 py-2 font-mono text-text-secondary">
                        {new Intl.NumberFormat().format(u.totalTokensUsed ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        {u.nextRefillAmount != null && u.nextRefillDate ? (
                          <>
                            <span className="font-mono">{new Intl.NumberFormat().format(u.nextRefillAmount)}</span>
                            <span className="ml-1">
                              {format(new Date(u.nextRefillDate), 'MMM d, yyyy HH:mm')}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={topUpEmail === u.email ? topUpAmount : ''}
                            onChange={(e) => {
                              setTopUpEmail(u.email);
                              setTopUpAmount(e.target.value);
                            }}
                            placeholder="Amount"
                            className="w-24 rounded border border-border-medium bg-surface-primary px-2 py-1 text-sm"
                          />
                          <Button
                            onClick={() => handleTopUp(u.email)}
                            disabled={topUpMutation.isPending}
                            className="rounded-lg px-2 py-1 text-xs"
                          >
                            {topUpMutation.isPending ? '…' : 'Top up'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex items-center justify-between border-t border-border-medium px-2 py-2">
                <span className="text-sm text-text-secondary">
                  Page {balancePage} of {balanceTotalPages} ({balanceTotal} total)
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBalancePage((p) => Math.max(1, p - 1))}
                    disabled={balancePage <= 1 || balancesLoading}
                    className="flex items-center gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBalancePage((p) => Math.min(balanceTotalPages, p + 1))}
                    disabled={balancePage >= balanceTotalPages || balancesLoading}
                    className="flex items-center gap-1"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'conversations' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">All conversations</h2>
            <div className="flex flex-1 items-center gap-2 min-w-[200px] max-w-sm">
              <Search className="h-4 w-4 shrink-0 text-text-secondary" />
              <input
                type="text"
                value={convoSearch}
                onChange={(e) => setConvoSearch(e.target.value)}
                placeholder="Search by title, user, or ID…"
                className="w-full rounded-lg border border-border-medium bg-surface-primary px-3 py-2 text-sm placeholder:text-text-secondary focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>
          {convosLoading ? (
            <p className="text-text-secondary">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border-medium">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border-medium bg-surface-primary-alt">
                    <th className="w-8 px-2 py-2" />
                    <th className="px-3 py-2 font-medium">Conversation ID</th>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Questions</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-3 py-2 font-medium">Shared link</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((c) => (
                    <React.Fragment key={c.conversationId}>
                      <tr
                        className="cursor-pointer border-b border-border-light hover:bg-surface-active-alt/50"
                        onClick={() =>
                          setExpandedConvo(expandedConvo === c.conversationId ? null : c.conversationId)
                        }
                      >
                        <td className="px-2 py-2">
                          {expandedConvo === c.conversationId ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs" title={c.conversationId}>
                          {c.conversationId}
                        </td>
                        <td className="px-3 py-2">
                          {c.user?.email ?? c.user?.name ?? '—'}
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2" title={c.title}>
                          {c.title || '(No title)'}
                        </td>
                        <td className="px-3 py-2 font-mono text-text-secondary">
                          {c.questionCount ?? 0}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">
                          {c.updatedAt ? format(new Date(c.updatedAt), 'MMM d, HH:mm') : '—'}
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          {c.shareId ? (
                            <a
                              href={`/share/${c.shareId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-link hover:underline"
                            >
                              View shared
                            </a>
                          ) : (
                            <span className="text-text-secondary">—</span>
                          )}
                        </td>
                      </tr>
                      {expandedConvo === c.conversationId && (
                        <tr className="border-b border-border-light bg-surface-primary-alt/50">
                          <td colSpan={7} className="px-4 py-3">
                            {messagesLoading ? (
                              <p className="text-text-secondary">Loading messages…</p>
                            ) : (
                              <ul className="space-y-3 text-sm">
                                {messages.length === 0 ? (
                                  <li className="text-text-secondary">No messages</li>
                                ) : (
                                  messages.map((m) => (
                                    <li
                                      key={m.messageId}
                                      className={cn(
                                        'rounded border px-3 py-2',
                                        m.isCreatedByUser
                                          ? 'border-blue-500/30 bg-blue-500/5'
                                          : 'border-border-light bg-surface-primary',
                                      )}
                                    >
                                      <div className="mb-1 flex items-center gap-2 text-xs text-text-secondary">
                                        <span>
                                          {m.isCreatedByUser ? 'User' : 'Assistant'}
                                        </span>
                                        <span>
                                          {m.createdAt
                                            ? format(new Date(m.createdAt), 'MMM d, HH:mm')
                                            : ''}
                                        </span>
                                      </div>
                                      <div className="whitespace-pre-wrap break-words text-text-primary">
                                        {getMessageDisplayText(m)}
                                      </div>
                                    </li>
                                  ))
                                )}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-border-medium px-2 py-2">
                <span className="text-sm text-text-secondary">
                  Page {convoPage + 1} of {convoTotalPages} ({convoTotal} total)
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConvoPage((p) => Math.max(0, p - 1))}
                    disabled={convoPage <= 0 || convosLoading}
                    className="flex items-center gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!convoNextCursor) return;
                      if (convoCursors.length > convoPage + 1) {
                        setConvoPage((p) => p + 1);
                      } else {
                        setConvoCursors((prev) => [...prev, convoNextCursor]);
                        setConvoPage((p) => p + 1);
                      }
                    }}
                    disabled={!convoNextCursor || convosLoading}
                    className="flex items-center gap-1"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'metrics' && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Platform metrics</h2>
          {metricsLoading ? (
            <p className="text-text-secondary">Loading metrics…</p>
          ) : metricsData ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-border-medium bg-surface-primary p-4 shadow-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Users className="h-4 w-4" />
                  <span className="text-sm font-medium">Total users</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {new Intl.NumberFormat().format(metricsData.totalUsers)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  +{metricsData.newUsersLast7Days} in 7 days · +{metricsData.newUsersLast30Days} in 30 days
                </p>
              </div>
              <div className="rounded-lg border border-border-medium bg-surface-primary p-4 shadow-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-sm font-medium">Conversations</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {new Intl.NumberFormat().format(metricsData.totalConversations)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  +{metricsData.newConversationsLast7Days} in last 7 days
                </p>
              </div>
              <div className="rounded-lg border border-border-medium bg-surface-primary p-4 shadow-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Hash className="h-4 w-4" />
                  <span className="text-sm font-medium">Messages</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {new Intl.NumberFormat().format(metricsData.totalMessages)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  {metricsData.questionsLast7Days} user questions in last 7 days
                </p>
              </div>
              <div className="rounded-lg border border-border-medium bg-surface-primary p-4 shadow-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Zap className="h-4 w-4" />
                  <span className="text-sm font-medium">Total tokens used</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {new Intl.NumberFormat().format(metricsData.totalTokensUsed)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  {new Intl.NumberFormat().format(metricsData.tokensUsedLast7Days)} in last 7 days
                </p>
              </div>
              <div className="rounded-lg border border-border-medium bg-surface-primary p-4 shadow-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Users className="h-4 w-4" />
                  <span className="text-sm font-medium">Active users (7d)</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {new Intl.NumberFormat().format(metricsData.activeUsersLast7Days)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  Users with conversation activity in last 7 days
                </p>
              </div>
              <div className="rounded-lg border border-border-medium bg-surface-primary p-4 shadow-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <Link2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Shared links</span>
                </div>
                <p className="mt-2 text-2xl font-semibold tabular-nums">
                  {new Intl.NumberFormat().format(metricsData.sharedLinksCount)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  Public shared conversation links
                </p>
              </div>
            </div>
          ) : (
            <p className="text-text-secondary">No metrics available</p>
          )}
        </div>
      )}
    </div>
  );
}
