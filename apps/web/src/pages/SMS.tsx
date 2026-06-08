import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { apiJson, formatPhone, labelize } from '@/lib/api';

interface SmsMessage {
  id: string;
  leadId?: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  leadEmail?: string | null;
  leadStatus?: string | null;
  direction?: 'inbound' | 'outbound' | string | null;
  body?: string | null;
  read?: boolean | null;
  createdAt?: string | null;
}

interface Conversation {
  leadId: string;
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  leadStatus: string;
  lastMessage: SmsMessage;
  unread: number;
  messages: SmsMessage[];
}

interface SmsLead {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
}

interface ThreadResponse {
  data?: {
    lead?: SmsLead;
    messages?: SmsMessage[];
  };
}

const quickReplies = [
  'Hi, just checking in on your painting project. Do you have any questions for us?',
  'We can take a look this week. What day works best for you?',
  'Thanks. I will update your estimate and send it over shortly.',
  'Your job is on schedule. I will send another update after today’s work is complete.',
];

function dateTime(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function dateShort(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function groupConversations(rows: SmsMessage[]) {
  const grouped = new Map<string, Conversation>();
  rows.forEach((message) => {
    if (!message.leadId) return;
    if (!grouped.has(message.leadId)) {
      grouped.set(message.leadId, {
        leadId: message.leadId,
        leadName: message.leadName || `Customer ${message.leadId.slice(0, 8)}`,
        leadPhone: message.leadPhone || '',
        leadEmail: message.leadEmail || '',
        leadStatus: message.leadStatus || '',
        lastMessage: message,
        unread: 0,
        messages: [],
      });
    }
    const conversation = grouped.get(message.leadId);
    if (!conversation) return;
    conversation.messages.push(message);
    if (new Date(message.createdAt || 0) > new Date(conversation.lastMessage.createdAt || 0)) {
      conversation.lastMessage = message;
    }
    if (message.direction === 'inbound' && !message.read) conversation.unread += 1;
  });
  return Array.from(grouped.values()).sort((a, b) => new Date(b.lastMessage.createdAt || 0).getTime() - new Date(a.lastMessage.createdAt || 0).getTime());
}

function conversationMatches(conversation: Conversation, query: string) {
  if (!query) return true;
  const haystack = [
    conversation.leadName,
    conversation.leadPhone,
    conversation.leadEmail,
    conversation.leadStatus,
    conversation.lastMessage?.body,
  ].join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function ConversationList({
  conversations,
  selectedLeadId,
  query,
  onQuery,
  onSelect,
  isLoading,
}: {
  conversations: Conversation[];
  selectedLeadId: string | null;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (leadId: string) => void;
  isLoading: boolean;
}) {
  const visible = conversations.filter((conversation) => conversationMatches(conversation, query.trim()));

  return (
    <aside className="flex min-h-0 flex-col border-r bg-white lg:flex">
      <div className="border-b p-3">
        <label className="block">
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            className="input"
            placeholder="Search customer, phone, or message"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto divide-y">
        {isLoading && (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((item) => (
              <div key={item} className="space-y-2">
                <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && !visible.length && (
          <div className="p-8 text-center text-sm text-gray-500">No conversations match this view.</div>
        )}

        {!isLoading && visible.map((conversation) => (
          <button
            key={conversation.leadId}
            type="button"
            className={`w-full p-3 text-left transition hover:bg-gray-50 ${conversation.leadId === selectedLeadId ? 'bg-blue-50' : ''}`}
            onClick={() => onSelect(conversation.leadId)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-gray-950">{conversation.leadName}</p>
                  {conversation.unread > 0 && <Badge variant="info" size="sm">{conversation.unread}</Badge>}
                </div>
                <p className="truncate text-sm text-gray-600">{conversation.lastMessage?.body || ''}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {conversation.leadPhone ? formatPhone(conversation.leadPhone) : 'No phone'} · {labelize(conversation.leadStatus || 'No status')}
                </p>
              </div>
              <span className="shrink-0 text-xs text-gray-500">{dateShort(conversation.lastMessage?.createdAt)}</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

export function SMS() {
  const [searchParams] = useSearchParams();
  const initialLeadId = searchParams.get('leadId');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [lead, setLead] = useState<SmsLead | null>(null);
  const [thread, setThread] = useState<SmsMessage[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [sendStatus, setSendStatus] = useState('SMS is logged to the customer CRM history.');
  const [isLoading, setIsLoading] = useState(true);
  const [isThreadLoading, setIsThreadLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showInbox, setShowInbox] = useState(true);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.leadId === selectedLeadId) || null,
    [conversations, selectedLeadId],
  );

  async function loadConversations({ keepThread = true } = {}) {
    setIsLoading(true);
    try {
      const payload = await apiJson<{ data?: SmsMessage[] }>('/v1/sms/inbox');
      const grouped = groupConversations(payload.data || []);
      setConversations(grouped);
      if (initialLeadId && !selectedLeadId) {
        await selectConversation(initialLeadId, grouped);
      } else if (keepThread && selectedLeadId) {
        await selectConversation(selectedLeadId, grouped, { silent: true });
      }
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to load messages', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  async function selectConversation(leadId: string, nextConversations = conversations, options: { silent?: boolean } = {}) {
    setSelectedLeadId(leadId);
    setShowInbox(false);
    if (!options.silent) setSendStatus('Loading conversation...');
    setIsThreadLoading(true);
    try {
      const payload = await apiJson<ThreadResponse>(`/v1/sms/thread/${leadId}`);
      setLead(payload.data?.lead || null);
      setThread(payload.data?.messages || nextConversations.find((conversation) => conversation.leadId === leadId)?.messages || []);
      setSendStatus('SMS is logged to the customer CRM history.');
    } catch (err) {
      setSendStatus(err instanceof Error ? err.message : 'Failed to load conversation');
      window.showToast?.(err instanceof Error ? err.message : 'Failed to load conversation', 'error');
    } finally {
      setIsThreadLoading(false);
    }
  }

  async function sendMessage(body: string) {
    if (!body.trim() || !selectedLeadId || isSending) return;
    setIsSending(true);
    setSendStatus('Sending message...');
    try {
      await apiJson('/v1/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ body: body.trim(), leadId: selectedLeadId }),
      });
      setMessage('');
      await loadConversations({ keepThread: true });
      setSendStatus('Message sent and logged.');
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to send message';
      setSendStatus(text);
      window.showToast?.(text, 'error');
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    sendMessage(message);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage(message);
    }
  }

  useEffect(() => {
    loadConversations();
    const interval = window.setInterval(() => loadConversations({ keepThread: true }), 15000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [thread, selectedLeadId]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 128)}px`;
  }, [message]);

  const canSend = Boolean(lead?.phone || selectedConversation?.leadPhone) && Boolean(selectedLeadId);

  return (
    <div className="h-[calc(100dvh-9.5rem-env(safe-area-inset-bottom))] overflow-hidden bg-gray-50 sm:h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] lg:h-[calc(100dvh-7rem)]">
      <div className="mx-auto flex h-full max-w-7xl flex-col px-0 sm:px-4 lg:px-8">
        <section className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden bg-white sm:rounded-lg sm:border lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className={`${showInbox ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
            <ConversationList
              conversations={conversations}
              selectedLeadId={selectedLeadId}
              query={query}
              onQuery={setQuery}
              onSelect={(leadId) => selectConversation(leadId)}
              isLoading={isLoading}
            />
          </div>

          <section className={`${selectedLeadId && !showInbox ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>
            <div className="shrink-0 flex items-center gap-3 border-b p-3">
              <Button type="button" variant="secondary" size="sm" className="lg:hidden" onClick={() => setShowInbox(true)}>Inbox</Button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-gray-950">{lead?.name || selectedConversation?.leadName || 'Select a conversation'}</h2>
                <p className="truncate text-sm text-gray-600">
                  {[lead?.phone ? formatPhone(lead.phone) : selectedConversation?.leadPhone ? formatPhone(selectedConversation.leadPhone) : 'No phone', lead?.email || selectedConversation?.leadEmail, labelize(lead?.status || selectedConversation?.leadStatus)].filter(Boolean).join(' · ')}
                </p>
              </div>
              {selectedLeadId && <Button as="a" href={`/leads/${selectedLeadId}`} variant="secondary" size="sm">CRM</Button>}
            </div>

            <div ref={messagesRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gray-50 p-3 sm:p-5">
              {!selectedLeadId && (
                <div className="mx-auto mt-10 max-w-sm rounded-lg border bg-white p-5 text-center text-sm text-gray-600">
                  Select a conversation to view the full SMS history.
                </div>
              )}

              {selectedLeadId && isThreadLoading && (
                <div className="space-y-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className={`flex ${item % 2 ? 'justify-end' : 'justify-start'}`}>
                      <div className="h-16 w-2/3 animate-pulse rounded-2xl bg-white shadow-sm" />
                    </div>
                  ))}
                </div>
              )}

              {selectedLeadId && !isThreadLoading && !thread.length && (
                <div className="mx-auto mt-10 max-w-sm rounded-lg border bg-white p-5 text-center text-sm text-gray-600">
                  No messages yet. Start with a concise, customer-friendly update.
                </div>
              )}

              {selectedLeadId && !isThreadLoading && thread.map((item) => (
                <div key={item.id} className={`mb-3 flex ${item.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] rounded-2xl px-3 py-2 shadow-sm ${item.direction === 'outbound' ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md border bg-white text-gray-900'}`}>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.body}</p>
                    <p className={`mt-1 text-[11px] ${item.direction === 'outbound' ? 'text-blue-50' : 'text-gray-500'}`}>{dateTime(item.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="sticky bottom-0 z-10 shrink-0 border-t bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_20px_rgba(15,23,42,0.06)] sm:p-4">
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {quickReplies.map((reply) => (
                  <Button key={reply} type="button" variant="secondary" size="sm" className="shrink-0" disabled={!canSend} onClick={() => {
                    setMessage(reply);
                    inputRef.current?.focus();
                  }}>
                    {reply.split('.')[0]}
                  </Button>
                ))}
              </div>
              <form className="grid grid-cols-[1fr_auto] gap-2" onSubmit={handleSubmit}>
                <label className="min-w-0">
                  <span className="sr-only">Message</span>
                  <textarea
                    ref={inputRef}
                    rows={1}
                    maxLength={1000}
                    enterKeyHint="send"
                    className="input max-h-32 min-h-11 resize-none"
                    placeholder={canSend ? 'Type a message...' : 'Add a phone number before sending SMS'}
                    disabled={!canSend}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                </label>
                <Button type="submit" className="self-end" disabled={!canSend || !message.trim()} isLoading={isSending}>Send</Button>
              </form>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                <span>{sendStatus}</span>
                <span>{message.length}/1000</span>
              </div>
            </div>
          </section>

          {!selectedLeadId && (
            <section className="hidden min-h-0 flex-col lg:flex">
              <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-3 sm:p-5">
                <div className="mx-auto mt-10 max-w-sm rounded-lg border bg-white p-5 text-center text-sm text-gray-600">
                  Select a conversation to view the full SMS history.
                </div>
              </div>
            </section>
          )}
        </section>
      </div>
    </div>
  );
}
