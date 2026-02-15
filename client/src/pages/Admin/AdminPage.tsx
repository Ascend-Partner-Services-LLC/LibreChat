import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, useToastContext } from '@librechat/client';
import { SystemRoles } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks';
import {
  useAdminBalancesQuery,
  useAdminTopUpMutation,
  useAdminUpdateUserRoleMutation,
  useAdminConversationsQuery,
  useAdminConversationMessagesQuery,
  useAdminMetricsQuery,
} from '~/data-provider';
import { format } from 'date-fns';
import {
  MessageSquare,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  Search,
  BarChart3,
  Users,
  Hash,
  Zap,
  Link2,
} from 'lucide-react';
import { cn } from '~/utils';

function SortableTh({
  label,
  sortKey,
  currentSortBy,
  currentDir,
  onSort,
  className,
  defaultDir,
}: {
  label: string;
  sortKey: string;
  currentSortBy: string;
  currentDir: 'asc' | 'desc';
  onSort: (key: string, dir: 'asc' | 'desc') => void;
  className?: string;
  /** When switching to this column, use this direction if not already active */
  defaultDir?: 'asc' | 'desc';
}) {
  const isActive = currentSortBy === sortKey;
  return (
    <th
      className={cn('cursor-pointer select-none px-3 py-2 font-medium hover:bg-surface-active-alt/70', className)}
      onClick={() => {
        if (isActive) {
          onSort(sortKey, currentDir === 'asc' ? 'desc' : 'asc');
        } else {
          onSort(sortKey, defaultDir ?? 'asc');
        }
      }}
    >
      <span className="flex items-center gap-1">
        {label}
        {isActive ? (
          currentDir === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <span className="inline-block h-3.5 w-3.5 shrink-0" />
        )}
      </span>
    </th>
  );
}

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

export type AdminPageProps = {
  /** When true, render for use inside a modal (no full-page layout, close on non-admin) */
  isModal?: boolean;
  /** Called when modal should close (e.g. when user is not admin in modal context) */
  onClose?: () => void;
};

export default function AdminPage({ isModal, onClose }: AdminPageProps = {}) {
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
  const [balanceSortBy, setBalanceSortBy] = useState('email');
  const [balanceSortDir, setBalanceSortDir] = useState<'asc' | 'desc'>('asc');
  const [convoSortBy, setConvoSortBy] = useState('updatedAt');
  const [convoSortDir, setConvoSortDir] = useState<'asc' | 'desc'>('desc');

  const isAdmin = user?.role === SystemRoles.ADMIN;

  useEffect(() => {
    setBalancePage(1);
  }, [balanceSearch, balanceSortBy, balanceSortDir]);
  useEffect(() => {
    setConvoPage(0);
    setConvoCursors([undefined]);
  }, [convoSearch, convoSortBy, convoSortDir]);

  const handleBalanceSort = (key: string, dir: 'asc' | 'desc') => {
    setBalanceSortBy(key);
    setBalanceSortDir(dir);
  };
  const handleConvoSort = (key: string, dir: 'asc' | 'desc') => {
    setConvoSortBy(key);
    setConvoSortDir(dir);
  };

  const { data: balancesData, isLoading: balancesLoading } = useAdminBalancesQuery(
    {
      page: balancePage,
      limit: balanceLimit,
      search: balanceSearch || undefined,
      sortBy: balanceSortBy,
      sortDirection: balanceSortDir,
    },
    !!isAdmin,
  );
  const topUpMutation = useAdminTopUpMutation();
  const updateRoleMutation = useAdminUpdateUserRoleMutation();
  const { data: convosData, isLoading: convosLoading } = useAdminConversationsQuery(
    {
      limit: convoLimit,
      cursor: convoCursors[convoPage],
      sortBy: convoSortBy,
      sortDirection: convoSortDir,
      search: convoSearch || undefined,
    },
    !!isAdmin,
  );
  const { data: messagesData, isLoading: messagesLoading } =
    useAdminConversationMessagesQuery(expandedConvo, !!isAdmin && !!expandedConvo);
  const { data: metricsData, isLoading: metricsLoading } = useAdminMetricsQuery(!!isAdmin);

  if (user != null && !isAdmin) {
    if (isModal && onClose) {
      onClose();
      return null;
    }
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
    <div
      className={cn(
        'flex flex-col overflow-auto bg-transparent text-text-primary',
        isModal ? 'min-h-[60vh] max-h-[85vh] w-full p-4' : 'h-full w-full p-4',
      )}
    >
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
          <Users className="h-4 w-4" />
          Users
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
            <h2 className="text-lg font-semibold">Users</h2>
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
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border-medium bg-surface-primary-alt">
                    <SortableTh
                      label="Email"
                      sortKey="email"
                      currentSortBy={balanceSortBy}
                      currentDir={balanceSortDir}
                      onSort={handleBalanceSort}
                    />
                    <SortableTh
                      label="Name"
                      sortKey="name"
                      currentSortBy={balanceSortBy}
                      currentDir={balanceSortDir}
                      onSort={handleBalanceSort}
                    />
                    <SortableTh
                      label="Role"
                      sortKey="role"
                      currentSortBy={balanceSortBy}
                      currentDir={balanceSortDir}
                      onSort={handleBalanceSort}
                    />
                    <th className="px-3 py-2 font-medium">Role at Firm</th>
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
                      <td className="px-3 py-2">
                        <select
                          value={u.role ?? 'USER'}
                          onChange={(e) => {
                            const newRole = e.target.value as 'USER' | 'ADMIN';
                            if (newRole !== (u.role ?? 'USER')) {
                              updateRoleMutation.mutate(
                                { userId: u.userId, role: newRole },
                                {
                                  onError: (err: Error) => {
                                    showToast({ status: 'error', message: err.message || 'Failed to update role' });
                                  },
                                  onSuccess: () => {
                                    showToast({
                                      status: 'success',
                                      message: `Role updated to ${newRole}`,
                                    });
                                  },
                                },
                              );
                            }
                          }}
                          disabled={
                            (user?.id ?? (user as { _id?: string })?._id?.toString()) === u.userId ||
                            (updateRoleMutation.isPending &&
                              updateRoleMutation.variables?.userId === u.userId)
                          }
                          title={
                            (user?.id ?? (user as { _id?: string })?._id?.toString()) === u.userId
                              ? 'Cannot change your own role'
                              : undefined
                          }
                          className={cn(
                            'min-w-[5.5rem] rounded border px-2 py-1 pr-7 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-border-strong',
                            u.role === 'ADMIN'
                              ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'border-border-medium bg-surface-primary text-text-secondary',
                          )}
                        >
                          <option value="USER">USER</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        {u.roleAtFirm ?? '—'}
                      </td>
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
                    <SortableTh
                      label="Conversation ID"
                      sortKey="conversationId"
                      currentSortBy={convoSortBy}
                      currentDir={convoSortDir}
                      onSort={handleConvoSort}
                    />
                    <th className="px-3 py-2 font-medium">User</th>
                    <SortableTh
                      label="Title"
                      sortKey="title"
                      currentSortBy={convoSortBy}
                      currentDir={convoSortDir}
                      onSort={handleConvoSort}
                    />
                    <th className="px-3 py-2 font-medium">Questions</th>
                    <SortableTh
                      label="Updated"
                      sortKey="updatedAt"
                      currentSortBy={convoSortBy}
                      currentDir={convoSortDir}
                      onSort={handleConvoSort}
                      defaultDir="desc"
                    />
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
