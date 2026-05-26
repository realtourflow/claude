export type MessageChannel = 'client_thread' | 'internal';

export type Message = {
  id: string;
  dealId: string;
  senderId: string;
  senderName: string;
  senderRole: 'agent' | 'buyer' | 'seller' | 'admin' | 'tc';
  channel: MessageChannel;
  content: string;
  timestamp: string;
  isAiDraft: boolean;
  editDistance?: number;
  readAt?: string;
};

export const MOCK_MESSAGES: Message[] = [
  // ── deal-smith: client thread ─────────────────────────────────────────────
  {
    id: 'msg-smith-1',
    dealId: 'deal-smith',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'client_thread',
    content: 'Hi Mike! Great news — you\'re officially under contract on 456 Elm Street. The inspection is scheduled for tomorrow at 10am. I\'ll be there with the inspector.',
    timestamp: '2026-02-01T09:15:00Z',
    isAiDraft: false,
    readAt: '2026-02-01T09:22:00Z',
  },
  {
    id: 'msg-smith-2',
    dealId: 'deal-smith',
    senderId: 'buyer-smith',
    senderName: 'Mike Smith',
    senderRole: 'buyer',
    channel: 'client_thread',
    content: 'Thanks Sarah! Should I be there for the inspection or is it fine if you handle it?',
    timestamp: '2026-02-01T09:45:00Z',
    isAiDraft: false,
    readAt: '2026-02-01T09:50:00Z',
  },
  {
    id: 'msg-smith-3',
    dealId: 'deal-smith',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'client_thread',
    content: 'It\'s always a great idea for you to be present! You\'ll learn a lot about the property and can ask the inspector questions directly. Plan for about 2-3 hours. Also — please make sure to sign your ARIVE disclosures today, they\'re overdue.',
    timestamp: '2026-02-01T10:00:00Z',
    isAiDraft: true,
    editDistance: 12,
    readAt: '2026-02-01T10:15:00Z',
  },
  {
    id: 'msg-smith-4',
    dealId: 'deal-smith',
    senderId: 'buyer-smith',
    senderName: 'Mike Smith',
    senderRole: 'buyer',
    channel: 'client_thread',
    content: 'Perfect, I\'ll be there! I\'ll sign the ARIVE disclosures tonight — I didn\'t realize they were due already.',
    timestamp: '2026-02-01T10:30:00Z',
    isAiDraft: false,
  },

  // ── deal-smith: internal (agent ↔ TC only) ────────────────────────────────
  {
    id: 'msg-smith-int-1',
    dealId: 'deal-smith',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'internal',
    content: 'Hey — Mike\'s disclosures are still unsigned. Can you send him a reminder this afternoon? I don\'t want to nag him directly right after I already mentioned it.',
    timestamp: '2026-02-01T11:00:00Z',
    isAiDraft: false,
    readAt: '2026-02-01T11:10:00Z',
  },
  {
    id: 'msg-smith-int-2',
    dealId: 'deal-smith',
    senderId: 'tc-lisa',
    senderName: 'Lisa Park',
    senderRole: 'tc',
    channel: 'internal',
    content: 'On it. Also flagging — the earnest money deadline is in 3 days and I still haven\'t seen confirmation from the title company. I\'ll chase them down today.',
    timestamp: '2026-02-01T11:20:00Z',
    isAiDraft: false,
    readAt: '2026-02-01T11:25:00Z',
  },
  {
    id: 'msg-smith-int-3',
    dealId: 'deal-smith',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'internal',
    content: 'Great, thank you. Let me know what title says — if they can\'t confirm by EOD tomorrow I\'ll call the listing agent directly.',
    timestamp: '2026-02-01T11:30:00Z',
    isAiDraft: false,
    readAt: '2026-02-01T11:35:00Z',
  },

  // ── deal-garcia: client thread ────────────────────────────────────────────
  {
    id: 'msg-garcia-1',
    dealId: 'deal-garcia',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'client_thread',
    content: 'Welcome Alex! I\'ve set up your property alerts for Hoover and Vestavia Hills. You should start getting matches in your inbox. Let me know when you\'re ready to schedule showings.',
    timestamp: '2026-02-08T11:00:00Z',
    isAiDraft: true,
    editDistance: 5,
    readAt: '2026-02-08T11:30:00Z',
  },
  {
    id: 'msg-garcia-2',
    dealId: 'deal-garcia',
    senderId: 'buyer-garcia',
    senderName: 'Alex Garcia',
    senderRole: 'buyer',
    channel: 'client_thread',
    content: 'This is great, thank you! I\'ve been working on my Mountain Mortgage application. Should be done by end of week.',
    timestamp: '2026-02-08T12:15:00Z',
    isAiDraft: false,
    readAt: '2026-02-08T12:20:00Z',
  },
  {
    id: 'msg-garcia-3',
    dealId: 'deal-garcia',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'client_thread',
    content: 'Perfect! Once your pre-approval comes through, we can move fast. I have a few properties in Vestavia Hills I think you\'ll love. Want to schedule showings for next weekend?',
    timestamp: '2026-02-09T09:00:00Z',
    isAiDraft: false,
    readAt: '2026-02-09T09:45:00Z',
  },

  // ── deal-williams: client thread ──────────────────────────────────────────
  {
    id: 'msg-williams-1',
    dealId: 'deal-williams',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'client_thread',
    content: 'Jennifer, I received the buyer\'s repair request this morning. They\'re asking for HVAC servicing and the deck rail repair. I\'ll put together our response options for you today.',
    timestamp: '2026-02-13T08:30:00Z',
    isAiDraft: false,
    readAt: '2026-02-13T09:00:00Z',
  },
  {
    id: 'msg-williams-2',
    dealId: 'deal-williams',
    senderId: 'seller-williams',
    senderName: 'Jennifer Williams',
    senderRole: 'seller',
    channel: 'client_thread',
    content: 'The HVAC was serviced last year — I have the receipt. Do we really need to fix the deck rail too? That seems like a lot.',
    timestamp: '2026-02-13T09:15:00Z',
    isAiDraft: false,
    readAt: '2026-02-13T09:20:00Z',
  },
  {
    id: 'msg-williams-3',
    dealId: 'deal-williams',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'client_thread',
    content: 'Great that you have the HVAC receipt — that will help. For the deck rail, we have three options: repair it, offer a credit, or decline and see if they walk. Given we\'re this far into contract, I\'d recommend a small credit. Let\'s talk through it — are you free for a quick call this afternoon?',
    timestamp: '2026-02-13T10:00:00Z',
    isAiDraft: true,
    editDistance: 22,
    readAt: '2026-02-13T10:30:00Z',
  },
  {
    id: 'msg-williams-4',
    dealId: 'deal-williams',
    senderId: 'seller-williams',
    senderName: 'Jennifer Williams',
    senderRole: 'seller',
    channel: 'client_thread',
    content: 'Yes, 3pm works for me. I\'ll get that HVAC receipt uploaded to the documents today.',
    timestamp: '2026-02-13T10:45:00Z',
    isAiDraft: false,
  },

  // ── deal-johnson: client thread ───────────────────────────────────────────
  {
    id: 'msg-johnson-1',
    dealId: 'deal-johnson',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'client_thread',
    content: 'Hi Robert! Welcome to RealTourFlow. I\'m excited to help you sell 123 Oak Lane. I\'ve sent over the intake questionnaire — please fill it out when you get a chance so I can start building your CMA.',
    timestamp: '2026-02-10T10:00:00Z',
    isAiDraft: true,
    editDistance: 8,
    readAt: '2026-02-10T10:45:00Z',
  },
  {
    id: 'msg-johnson-2',
    dealId: 'deal-johnson',
    senderId: 'seller-johnson',
    senderName: 'Robert Johnson',
    senderRole: 'seller',
    channel: 'client_thread',
    content: 'Thanks Sarah! We\'re definitely motivated to move quickly — ideally listed within 30 days. We\'re also looking at buying something in the Cahaba Heights area once this sells.',
    timestamp: '2026-02-10T11:30:00Z',
    isAiDraft: false,
    readAt: '2026-02-10T11:35:00Z',
  },
  {
    id: 'msg-johnson-3',
    dealId: 'deal-johnson',
    senderId: 'agent-sarah',
    senderName: 'Sarah Johnson',
    senderRole: 'agent',
    channel: 'client_thread',
    content: 'Love the energy! 30 days is absolutely doable. For the buy-side, I\'ll set up a separate deal once we go live on this one — we can coordinate both transactions together. Fill out that questionnaire and we\'ll get your listing strategy call on the calendar.',
    timestamp: '2026-02-10T12:00:00Z',
    isAiDraft: false,
    readAt: '2026-02-10T13:00:00Z',
  },
];

export function getMessagesByDealId(dealId: string): Message[] {
  return MOCK_MESSAGES.filter((message) => message.dealId === dealId);
}
