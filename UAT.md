# RealTourFlow UAT — Based on What's Actually Built

> **How to use:** Open in VS Code → `Cmd+Shift+V` to render diagrams.
> Use the **RoleSwitcher** toolbar (bottom-left, fixed position) to flip between personas.
> All data is mock — state lives in Zustand stores (in-memory, resets on page refresh).

---

## Mock Users Quick Reference

| User | Role | URL on switch | Deal(s) | Stage |
|------|------|--------------|---------|-------|
| Sarah Johnson (`agent-sarah`) | Agent | `/agent` | All 6 | — |
| Paul Leara (`admin-paul`) | Admin | `/admin` | All 6 | — |
| Mike Smith (`buyer-smith`) | Buyer | `/buyer/buyer-smith` | deal-smith | Under Contract |
| Alex Garcia (`buyer-garcia`) | Buyer | `/buyer/buyer-garcia` | deal-garcia | Active Search |
| Kevin Chen (`buyer-chen`) | Buyer | `/buyer/buyer-chen` | deal-chen | Intake |
| Chris Davis (`buyer-davis`) | Buyer | `/buyer/buyer-davis` | deal-davis | Intake |
| Jennifer Williams (`seller-williams`) | Seller | `/seller/seller-williams` | deal-williams | Under Contract |
| Robert Johnson (`seller-johnson`) | Seller | `/seller/seller-johnson` | deal-johnson | Offer Active |
| Jamie Taylor (`tc-taylor`) | TC | `/tc` | deal-smith + deal-williams | — |

---

## Known Stubs (built UI, action not yet wired)

| Location | Stub |
|----------|------|
| All message input fields | Text input + send button visible — does not actually send |
| Seller: Accept / Counter / Decline offer buttons | Buttons render — no state change wired |
| Settings → Integrations | DocuSign / Google Calendar / Outlook show "Connect" — no flow |
| Admin: Metro View, Promotions, Config sections | "Coming Soon" page |
| `/agent/messages`, `/agent/calendar`, `/agent/documents` | "Coming Soon" pages |
| Fast Pass checkout | Stripe not integrated — confirm button has no payment flow |

---

## 1. RoleSwitcher — How It Works

```mermaid
flowchart TD
    ANY_PAGE[Any page in the app] --> SWITCHER[RoleSwitcher toolbar\nbottom-left corner — fixed position]
    SWITCHER --> COLLAPSE{Expanded?}
    COLLAPSE -->|No| CLICK_OPEN[Click to expand — shows all 9 mock users]
    CLICK_OPEN --> COLLAPSE
    COLLAPSE -->|Yes| SELECT_USER[Click a user row]
    SELECT_USER --> SET_AUTH[setActiveUser in authStore\nNavigation fires to their home URL]
    SET_AUTH --> REDIRECT[Redirected:\nAgent → /agent\nBuyer → /buyer/:id\nSeller → /seller/:id\nAdmin → /admin\nTC → /tc]
    REDIRECT --> ANY_PAGE

    SET_AUTH --> PERM_CHANGE[Permissions update instantly\nAll PermissionGate checks re-evaluate]
    PERM_CHANGE --> UI_ADAPTS[UI hides/shows elements\nbased on new group's permissions]
```

---

## 2. Agent — Sarah Johnson

### 2A. Dashboard (`/agent`)

```mermaid
flowchart TD
    START([Switch to agent-sarah\nNavigate to /agent]) --> DASH[Dashboard loads]

    DASH --> GREETING[Time-based greeting banner\n+ current date]
    DASH --> QUICK_ACTIONS[3 quick action buttons:\nPipeline / Messages / Share Fast Pass]
    DASH --> STATS[Stats bar — 4 tiles:\nPipeline Value / Active Deals / Tasks Due / Est. Commission]
    DASH --> THREE_COL[3-column layout]

    THREE_COL --> COL1[Needs Your Action\nAgent-assigned tasks:\noverdue / in_progress / high-priority pending]
    THREE_COL --> COL2[Waiting on Client\nBuyer or seller tasks:\noverdue / in_progress / high-priority pending]
    THREE_COL --> COL3[On Track\nDeals with health=green\nOR all low-urgency tasks]

    DASH --> NOTIF_BANNER[Notification banner\nDismissible — shows unread alerts]
    NOTIF_BANNER --> DISMISS[Click X → removed from unread list]

    QUICK_ACTIONS --> SHARE_FP[Share Fast Pass button]
    SHARE_FP --> COPY[Copies /fast-pass URL to clipboard\nShows 'Link Copied!' confirmation]

    QUICK_ACTIONS --> MSGS_BTN[Messages button → /agent/messages]
    MSGS_BTN --> COMING_SOON_MSGS[Coming Soon page]

    COL1 --> TASK_ROW[Click any task row]
    COL2 --> TASK_ROW
    COL3 --> DEAL_CARD[Click deal card]
    TASK_ROW --> DEAL_DETAIL[Navigate to /agent/deals/:dealId]
    DEAL_CARD --> DEAL_DETAIL
```

### 2B. Pipeline (`/agent/pipeline`)

```mermaid
flowchart TD
    START([Navigate to /agent/pipeline\nor click Pipeline quick action]) --> PIPE[Pipeline page]
    PIPE --> HEADER[Header: 'Pipeline'\nX active deals · Y buyers · Z sellers]
    PIPE --> TYPE_FILTER[Filter toggle: All / Buyers / Sellers]
    PIPE --> NEW_DEAL_BTN[+ New Deal button]
    PIPE --> STAGE_GROUPS[Deals grouped by stage column\nIntake → Post Close]

    TYPE_FILTER --> FILTER_TOGGLE{Toggle selection}
    FILTER_TOGGLE -->|All| SHOW_ALL[Show all 6 deals]
    FILTER_TOGGLE -->|Buyers| SHOW_BUY[Show buy deals only\nGarcia, Smith, Chen, Davis]
    FILTER_TOGGLE -->|Sellers| SHOW_SELL[Show sell deals only\nWilliams, Johnson]
    SHOW_ALL --> STAGE_GROUPS
    SHOW_BUY --> STAGE_GROUPS
    SHOW_SELL --> STAGE_GROUPS

    STAGE_GROUPS --> DEAL_CARD[Deal card shows:\nclient name / type badge / flags\n address / price / days in stage\nopen task count / overdue badge]
    DEAL_CARD --> CLICK_CARD[Click card → /agent/deals/:id]

    NEW_DEAL_BTN --> MODAL[New Deal modal opens]
    MODAL --> DEAL_TYPE[Toggle: Buyer / Seller]
    MODAL --> CLIENT_NAME[Client name input — required]
    MODAL --> TBD_TOGGLE{Address TBD?}
    TBD_TOGGLE -->|No| ADDRESS_FIELDS[Street / City / State / ZIP inputs]
    TBD_TOGGLE -->|Yes| TBD[TBD placeholder — no address fields]
    MODAL --> PRICE_INPUT[Purchase/listing price]
    MODAL --> CLOSE_DATE[Est. closing date]
    MODAL --> SUBMIT{Submit}
    SUBMIT -->|Missing required fields| BLOCKED[Button disabled — client name + price required]
    BLOCKED --> CLIENT_NAME
    SUBMIT -->|Valid| CREATED[Deal created:\nstage=intake, health=green\ncommission = price × 3%\nAdded to pipeline]
    CREATED --> SUCCESS_MODAL[Deal Created success modal]
    SUCCESS_MODAL --> DISMISS_SUCCESS[Click to dismiss → deal visible in Intake column]
```

### 2C. Deal Detail (`/agent/deals/:dealId`)

```mermaid
flowchart TD
    START([Navigate to /agent/deals/:dealId]) --> HEADER_DD[Header:\nclient name / property address / stage badge\nhealth indicator / closing date / commission]

    HEADER_DD --> STAGE_ADV[Stage advance control\nadvance button or dropdown]
    STAGE_ADV --> ADV_RESULT{Advance stage}
    ADV_RESULT -->|Clicked| STAGE_UPDATED[Deal stage updated in dealStageStore\nClient views update immediately]

    HEADER_DD --> TAB_BAR[Tab bar: Tasks · Messages · Documents\nwith live counts on Tasks and Messages]
    HEADER_DD --> OVERVIEW_SEC[Overview section — always visible above tabs]

    OVERVIEW_SEC --> LOAN_CARD[Loan Milestones card\nif deal has loanMilestones data]
    LOAN_CARD --> LOAN_SOURCE{Source}
    LOAN_SOURCE -->|ARIVE badge| ARIVE_RO[Read-only — milestones auto-sync\nAll 6 toggles disabled]
    LOAN_SOURCE -->|Manual badge| MANUAL_EDIT[Each milestone is a clickable toggle\nClick to check/uncheck]
    MANUAL_EDIT --> MARK_FUNDED{CTC done + not yet funded?}
    MARK_FUNDED -->|Yes| FUNDED_BTN[Mark as Funded button appears]
    FUNDED_BTN --> CLICK_FUNDED[Click → funded=true\nConfetti celebration fires\n6-second animation + modal]
    CLICK_FUNDED --> DISMISS_CONFETTI[Click Lets go → confetti dismisses]
    LOAN_CARD --> APPRAISAL_ROW[Appraisal status row\nARIVE: badge only\nManual: dropdown — Pending/Ordered/Scheduled/Complete]

    OVERVIEW_SEC --> DEAL_DETAILS[Deal Details card:\nType / Price / Stage / Days in Stage\nClosing Date / Commission / Created]

    OVERVIEW_SEC --> ONBOARD_INFO[Onboarding Info card:\nClient name\nPhone as tel link / Email as mailto link\nAppear once client completes onboarding\nFlags / task progress bar]

    OVERVIEW_SEC --> PROP_TRACKER[Property Tracker card — BUY deals only]
    PROP_TRACKER --> PUSH_BTN[Push to Buyer button]
    PUSH_BTN --> PROP_FORM[Form: URL / Address required / Price / Note to buyer]
    PROP_FORM --> PROP_SUBMIT{Submit}
    PROP_SUBMIT -->|No address| PROP_DISABLED[Button disabled]
    PROP_SUBMIT -->|Address entered| PROP_ADDED[Property added\nAppears in buyer portal immediately]
    PROP_ADDED --> PROP_LIST[Property list shows:\nAddress / status badge / buyer's thoughts / agent note]
    PROP_LIST --> PROP_ROW_ACTIONS{Actions on property row}
    PROP_ROW_ACTIONS -->|External link icon| OPEN_URL[Opens source URL in new tab]
    PROP_ROW_ACTIONS -->|X button| REMOVE_PROP[Property removed from tracker + buyer portal]
    PROP_ROW_ACTIONS -->|Add/Edit private note| PRIVATE_NOTE[Textarea: visible only to agent/TC/admin\nNot shown to buyer]
    PRIVATE_NOTE --> SAVE_NOTE[Save → note stored in propertyStore]
    PROP_LIST --> OFFER_REQ_ALERT{Buyer flagged 'request offer'?}
    OFFER_REQ_ALERT -->|Yes| STAR_ALERT[Amber alert banner on property row:\nBuyer wants to make an offer on the property]

    OVERVIEW_SEC --> SELLER_TOOLS[Seller-specific tools — SELL deals only]
    SELLER_TOOLS --> SHOWING_AVAIL[Showing Availability card\nView/edit days + time ranges per day]
    SHOWING_AVAIL --> AVAIL_EDIT[Edit button → toggle days Mon–Sun\nSet from/to time dropdowns per enabled day]
    AVAIL_EDIT --> SAVE_AVAIL[Save → stored in showingAvailabilityStore\nVisible in seller portal]

    SELLER_TOOLS --> OFFERS_CARD[Offers card — Add Offer button]
    OFFERS_CARD --> ADD_OFFER[Form: Buyer Name required / Price required / Close Date\nContingency pills / Agent Notes]
    ADD_OFFER --> SUBMIT_OFFER{Submit}
    SUBMIT_OFFER -->|Missing name or price| DISABLED_OFFER[Button disabled]
    SUBMIT_OFFER -->|Valid| OFFER_SAVED[Offer added to offerStore\nAppears on seller portal offer comparison]
    OFFER_SAVED --> REMOVE_OFFER[X button on offer card removes it]

    SELLER_TOOLS --> BUYER_STATUS[Buyer's Progress card\nunder_contract and beyond only]
    BUYER_STATUS --> STATUS_DROP[Dropdown — 7 options:\nInspection scheduled → Clear to close]
    STATUS_DROP --> STATUS_SET[Selection stored in dealStageStore\nShows on seller portal immediately]

    SELLER_TOOLS --> NET_SHEET[Net Sheet card — pre_close and post_close only]
    NET_SHEET --> NET_FIELDS[Editable: Sale Price / Commission% / Closing Costs%\nMortgage Payoff / Other Deductions / Label]
    NET_FIELDS --> LIVE_CALC[Live calculation updates in real time:\nSubtracts each line → Est. Net to Seller]
    LIVE_CALC --> NET_SAVE[Save Net Sheet → stored in netSheetStore\nAppears on seller post-close portal]

    OVERVIEW_SEC --> INT_NOTES[Internal Notes card\nNot visible to clients]
    INT_NOTES --> NOTES_EDIT[Click Edit or click text → textarea opens]
    NOTES_EDIT --> NOTES_SAVE[Save Notes → confirmed with 'Saved' badge]

    TAB_BAR --> TASKS_TAB[Tasks tab — grouped by assignee]
    TASKS_TAB --> AGENT_GROUP[Agent tasks section]
    TASKS_TAB --> CLIENT_GROUP[Buyer/Seller tasks section]
    TASKS_TAB --> SUPPORT_GROUP[TC / Third Party / Admin tasks section]

    AGENT_GROUP --> TASK_ITEM{Task item interaction}
    CLIENT_GROUP --> TASK_ITEM
    SUPPORT_GROUP --> TASK_ITEM
    TASK_ITEM -->|Circle icon click| TOGGLE_DONE[Toggle complete / incomplete\nStatus changes locally]
    TASK_ITEM -->|Assignee pill click| REASSIGN_DROP[Dropdown: Agent / Buyer / Seller / TC / Third Party]
    REASSIGN_DROP --> REASSIGNED[Task moves to correct group\noverride stored in taskStore]
    TASK_ITEM -->|AI badge| AI_LABEL[Shows Bot icon — task was AI-generated]

    TAB_BAR --> MSGS_TAB_DD[Messages tab]
    MSGS_TAB_DD --> LAST3[Shows last 3 messages from mock data\nAgent messages left / client messages right]
    MSGS_TAB_DD --> MSG_INPUT[Message input + send button — UI stub\ndoes not send]

    TAB_BAR --> DOCS_TAB_DD[Documents tab]
    DOCS_TAB_DD --> DOC_LIST[Static list of 3 documents:\nPurchase Agreement — signed\nInspection Report — review needed\nARIVE Disclosures — sign now]
    DOC_LIST --> DOC_BADGE[Status badge per doc:\nGreen = Signed / Amber = Review needed / Red = Sign now]
```

### 2D. Agent Onboarding (`/onboard/agent`)

```mermaid
flowchart TD
    START([Navigate to /onboard/agent]) --> PROGRESS[12-step form with progress bar]

    PROGRESS --> S1[Step 1: Name input + photo picker]
    S1 --> S2[Step 2: Title dropdown / Phone / License number]
    S2 --> S3[Step 3: Photo selection gallery]
    S3 --> S4[Step 4: Bio textarea]
    S4 --> S5[Step 5: Additional profile info]
    S5 --> S6[Step 6: Brokerage name + address]
    S6 --> TC_GATE{Step 7: Do you use a Transaction Coordinator?}
    TC_GATE -->|Yes — I work with a TC| TC_FORM[TC details form:\nName / Email / Phone\nLinked account lookup in MOCK_USERS]
    TC_GATE -->|No — I handle it myself| TC_SOLO[Solo mode saved to agentTCStore\nTC duties appear in agent task view]
    TC_FORM --> S8[Step 8: Custom buyer + seller welcome messages\nEditable textareas with pre-filled defaults]
    TC_SOLO --> S8
    S8 --> S9[Step 9: Notification preference checkboxes]
    S9 --> S10[Step 10: Notification delivery channels]
    S10 --> S11[Step 11: Integration tools checklist]
    S11 --> S12[Step 12: Document template upload]
    S12 --> DONE[Success screen — You are all set\nLets go button → /agent]

    S1 -->|Back button| S1
    S2 -->|Back| S1
    S3 -->|Back| S2
    S4 -->|Back| S3

    S1 --> SKIP_PHOTO{Skip photo?}
    SKIP_PHOTO -->|Yes| S2
    SKIP_PHOTO -->|No| PICK_PHOTO[Select from gallery → stored in agentSetupStore]
    PICK_PHOTO --> S2
```

### 2E. Invite Client — InviteModal

```mermaid
flowchart TD
    START([Agent opens InviteModal from deal]) --> MODAL_OPEN[InviteModal shows]
    MODAL_OPEN --> ROLE_SELECT[Select: Buyer or Seller]
    ROLE_SELECT --> LINK_GEN[Onboarding link generated:\n/onboard/buyer?agent=agent-sarah\nor /onboard/seller?agent=agent-sarah]
    LINK_GEN --> COPY_BTN[Copy Link button]
    COPY_BTN --> COPIED[Link copied to clipboard\nButton shows 'Copied!' briefly]
    COPIED --> SHARE[Agent shares link with client\nvia text / email outside the app]
    SHARE --> CLIENT_ONBOARDS[Client follows link → onboarding flow]
```

### 2F. Settings (`/agent/settings`)

```mermaid
flowchart TD
    START([/agent/settings]) --> TABS[Tab bar: Profile / TC / My Vendors / Documents / Notifications / Integrations]

    TABS --> PROFILE_T[Profile tab]
    PROFILE_T --> PROF_FIELDS[Editable: Name / Phone / Title / License / Bio]
    PROF_FIELDS --> SAVE_PROF[Save button → 'Saved ✓' confirmation]
    PROF_FIELDS --> EMAIL_NOTE[Email field — read-only\nNote: managed by admin]

    TABS --> TC_T[Transaction Coordinator tab]
    TC_T --> TC_CURRENT{TC currently set?}
    TC_CURRENT -->|Yes| TC_CARD[Shows TC card: name / email / phone\nEdit and Remove TC buttons]
    TC_CARD --> TC_EDIT[Edit form opens inline]
    TC_EDIT --> TC_SAVE[Save TC → stored in agentTCStore]
    TC_CARD --> TC_REMOVE[Remove TC button → confirmation prompt]
    TC_REMOVE --> TC_CONFIRM{Confirm?}
    TC_CONFIRM -->|Yes| TC_CLEARED[TC removed]
    TC_CONFIRM -->|No| TC_CARD
    TC_CURRENT -->|No| TC_EMPTY[Empty state + edit form\nAdd TC info → Save]
    TC_EMPTY --> TC_SAVE

    TABS --> VENDORS_T[My Vendors tab]
    VENDORS_T --> VENDOR_CATS[Collapsible categories:\nInspector / Title / Insurance / Lender / etc.]
    VENDOR_CATS --> VENDOR_ITEM{Vendor actions}
    VENDOR_ITEM -->|Star button| FEATURED[Toggle featured / unfeatured]
    VENDOR_ITEM -->|Up/Down arrows| REORDER[Reorder within category]
    VENDOR_ITEM -->|Pencil| EDIT_V[Open edit modal\nPre-fills all fields]
    VENDOR_ITEM -->|Trash| DELETE_V[Delete with confirmation]
    DELETE_V --> DEL_CONFIRM{Confirm?}
    DEL_CONFIRM -->|Yes| VENDOR_GONE[Vendor removed from list\n+ removed from client portals]
    DEL_CONFIRM -->|No| VENDOR_CATS
    VENDOR_CATS --> ADD_V[Add vendor button per category]
    ADD_V --> ADD_MODAL[Modal: Company required / Contact / Phone\nEmail / Website / Notes / Featured toggle]
    ADD_MODAL --> SAVE_V{Save}
    SAVE_V -->|Company missing| BLOCKED_V[Save button disabled]
    SAVE_V -->|Valid| VENDOR_SAVED[Vendor saved → appears in\nclient portals under Preferred Vendors]
    VENDOR_SAVED --> VENDOR_CATS

    TABS --> DOCS_T[Documents tab]
    DOCS_T --> DOC_TEMPLATE[Document template list]
    DOC_TEMPLATE --> ADD_TEMPLATE[Add template button]
    ADD_TEMPLATE --> TEMPLATE_FORM[Inline form: Type dropdown / Display name / Notes / Simulate Upload]
    TEMPLATE_FORM --> UPLOAD_SIM[Simulate upload → shows filename]
    TEMPLATE_FORM --> SAVE_TEMPLATE[Add button → template stored]
    TEMPLATE_FORM --> CANCEL_T[Cancel → form collapses]
    DOC_TEMPLATE --> TEMPLATE_ACTIONS{Template actions}
    TEMPLATE_ACTIONS -->|Pencil| EDIT_TEMPLATE[Edit inline]
    TEMPLATE_ACTIONS -->|Trash| DELETE_TEMPLATE[Delete with confirmation]

    TABS --> NOTIF_T[Notifications tab]
    NOTIF_T --> TOGGLES[Toggle switches per notification type:\nDeal changes / Tasks / Overdue / Fast Pass\nDisclosures / Messages / Email / Push/SMS]
    TOGGLES --> SAVED_AUTO[State updates immediately on toggle]

    TABS --> INTEGRATIONS_T[Integrations tab]
    INTEGRATIONS_T --> INT_CARDS[DocuSign / Google Calendar / Outlook:\nConnect buttons — no flow yet\nARIVE: shows Connected if Mountain Mortgage\nStripe: Coming in v2 teaser]
```

---

## 3. Buyer Onboarding (`/onboard/buyer`)

```mermaid
flowchart TD
    START([Buyer opens invite link\n/onboard/buyer?agent=...]) --> S1[Screen 1: Cash or Loan choice]
    S1 --> CASH_PATH{Selection}

    CASH_PATH -->|Cash buyer| CASH_S2[Skip financing screens\nGo to property preferences]
    CASH_PATH -->|Getting a loan| LOAN_S2[Screen 2+: Full financing path]

    LOAN_S2 --> PA1[Property type preference]
    PA1 --> PA2[Bedrooms / Bathrooms]
    PA2 --> PA3[Target areas / neighborhoods]
    PA3 --> PA4[Garage / Pool / Schools / Basement options]
    PA4 --> PA5[Special notes / must-haves]
    PA5 --> FIN1[Financial screens:\nFirst-time buyer? / Military VA?]
    FIN1 --> FIN2[Employment status]
    FIN2 --> FIN3[Journey stage — where in process]
    FIN3 --> FIN4[Credit score range]
    FIN4 --> FIN5[Monthly income]
    FIN5 --> BUDGET[Budget range auto-calculated\nfrom income + credit score]
    BUDGET --> BUYING_POWER[Buying Power screen\nEstimated max purchase price displayed]
    BUYING_POWER --> MM_PITCH[Mountain Mortgage pitch screen]
    MM_PITCH --> LENDER_CHOICE{Lender choice}
    LENDER_CHOICE -->|Mountain Mortgage| MM_CTA[Mountain Mortgage screen\nLink to apply at portal]
    LENDER_CHOICE -->|Already have a lender| OTHER_LENDER[Continue with existing lender]
    MM_CTA --> PROP_TRACK[Property address tracking screen]
    OTHER_LENDER --> PROP_TRACK
    PROP_TRACK --> CONTACT_B[Contact info screen:\nFull name / Phone / Email\nAll fields required]

    CASH_S2 --> PA1_CASH[Same property preference screens]
    PA1_CASH --> CONTACT_B

    CONTACT_B --> SUCCESS[Done screen\nAgent notified\nContact stored in clientContactStore]
    SUCCESS --> PORTAL[Buyer navigates to /buyer/:userId]

    PA1 -->|Back button| S1
    FIN1 -->|Back| PA5
    BUDGET -->|Back| FIN5
```

---

## 4. Buyer — Kevin Chen / Chris Davis (Intake)

Both buyers are at Intake, new to the system. Same flow applies.

```mermaid
flowchart TD
    START([Switch to buyer-chen or buyer-davis\n/buyer/:userId]) --> INTAKE_VIEW[Intake stage view\n'Getting Started' label]

    INTAKE_VIEW --> STAGE_HEADER[Stage header card:\nproperty address / price / stage badge\nhealth border / journey tracker at bottom]

    INTAKE_VIEW --> STAGE_CARD[Stage-specific card: Welcome\nWelcome by first name message\n3 bullets: property / timeline / portal\nBegin my onboarding button]
    STAGE_CARD --> ONBOARD_BTN[Click 'Begin my onboarding'\n→ triggers buyer onboarding flow]

    INTAKE_VIEW --> TASK_LIST[Tasks tab — open tasks for Intake stage]
    TASK_LIST --> TASK_EXPAND{Click a task row}
    TASK_EXPAND -->|Task not done| EXPAND_PANEL[Action panel opens below task]
    TASK_EXPAND -->|Task already done| NOTHING[Row disabled — no expand]

    EXPAND_PANEL --> ACTION_TYPE{Task action type}
    ACTION_TYPE -->|confirm| CONFIRM_PANEL[Did you complete this outside the app?\nYes done / Not yet buttons]
    CONFIRM_PANEL -->|Yes| TASK_DONE[Task marked complete\nStrikethrough + 'Marked complete' label]
    CONFIRM_PANEL -->|Not yet| COLLAPSE[Panel collapses — task stays pending]

    ACTION_TYPE -->|upload| UPLOAD_PANEL[File picker UI\nChoose file to upload]
    UPLOAD_PANEL --> FILE_PICK[Select file → 1.5 second upload animation]
    FILE_PICK --> UPLOAD_DONE[File uploaded ✓ banner shows\nMark as complete button appears]
    UPLOAD_DONE --> TASK_DONE
    UPLOAD_PANEL --> CLOSE_PANEL[Close button collapses panel]

    ACTION_TYPE -->|link| LINK_PANEL[External link button — opens in new tab\n+ I've completed this button]
    LINK_PANEL -->|Open link| EXTERNAL[Opens action URL\nbrowser new tab]
    LINK_PANEL -->|I've completed this| TASK_DONE

    INTAKE_VIEW --> MSGS[Messages tab\nLast 3 mock messages shown\nInput field + send button — UI stub only]

    INTAKE_VIEW --> DOCS[Documents tab\nDocument list with status badges]

    INTAKE_VIEW --> JOURNEY[Journey Tracker at bottom\n7 stages — current stage highlighted with gold ring\nPast stages checkmarked]

    INTAKE_VIEW --> VENDOR_DIR[Vendor Directory\nAgent's preferred vendors by category]

    INTAKE_VIEW --> AGENT_CARD[Agent card at bottom\nSarah Johnson / Call button tel link / Email button mailto link]
```

---

## 5. Buyer — Alex Garcia (Active Search)

deal-garcia | Active Search | Mountain Mortgage pre-approval in progress

```mermaid
flowchart TD
    START([Switch to buyer-garcia\n/buyer/buyer-garcia]) --> VIEW[Active Search stage view\nLabel: 'Home Search']

    VIEW --> STAGE_CARD_AS[Stage card for Active Search:\nPre-approval status widget\nProperty suggestions from agent]

    STAGE_CARD_AS --> PA_WIDGET[Pre-Approval Status widget\nMountain Mortgage — ARIVE tracking]
    PA_WIDGET --> PA_STATUS[Current status: in progress\nShows loanMilestones data from deal-garcia]

    STAGE_CARD_AS --> PROP_LIST[Properties pushed by agent\nvia Property Tracker in DealDetail]
    PROP_LIST --> PROP_CARD{Property card interaction}
    PROP_CARD -->|View status badge| STATUS_DISPLAY[Interested / Toured / Not for me / Offer Submitted]
    PROP_CARD -->|External link| OPEN_LISTING[Opens source URL — MLS/Zillow/Realtor]
    PROP_CARD -->|Agent note visible| AGENT_NOTE[Agent's note shown in amber]
    PROP_CARD -->|Buyer note field| BUYER_THOUGHTS[Buyer can type thoughts on property\nStored in propertyStore — visible to agent]
    PROP_CARD -->|Request offer flag| REQ_OFFER[Buyer can flag 'I want to make an offer'\nShows alert on agent's property tracker]

    VIEW --> TASKS_AS[Tasks tab — Active Search tasks]
    TASKS_AS --> TASK_ACTIONS_AS{Task interaction — same flow as Intake}

    VIEW --> MSGS_AS[Messages tab — same stub]
    VIEW --> DOCS_AS[Documents tab]
    VIEW --> JOURNEY_AS[Journey tracker — Active Search highlighted]
    VIEW --> VENDOR_DIR_AS[Vendor Directory]
    VIEW --> AGENT_CARD_AS[Agent card]
```

---

## 6. Buyer — Mike Smith (Under Contract + Fast Pass)

deal-smith | Under Contract | Health: Yellow | Fast Pass enrolled | Disclosures: NOT SIGNED

```mermaid
flowchart TD
    START([Switch to buyer-smith\n/buyer/buyer-smith]) --> VIEW_UC[Under Contract stage view\nHealth border: YELLOW]

    VIEW_UC --> METRO[MetroMap component renders\n5 visual tracks]
    METRO --> TRACK_DEAL_B[Deal track\nContingency nodes]
    METRO --> TRACK_LOAN_B[Loan track — ARIVE sync\nShows milestone progress]
    METRO --> TRACK_TITLE_B[Title track]
    METRO --> TRACK_REPAIRS_B[Repairs track]
    METRO --> TRACK_FP_B[Fast Pass track\nIntake → Utilities → Cleaning → Movers → Confirm → Welcome Home]

    TRACK_LOAN_B --> DISC_CHECK[Disclosures node shows: NOT SIGNED]
    DISC_CHECK --> DISC_TASK[Task in task list:\nactionType = 'link'\nOpens ARIVE portal]
    DISC_TASK --> OPEN_ARIVE[Click 'Open Application' button\nNavigates to ARIVE portal in new tab]
    OPEN_ARIVE --> RETURN[Return to app\nClick 'I've completed this' → task marked done]
    RETURN --> METRO_UPDATE[MetroMap loan track node updates]

    DISC_CHECK --> DISC_STUCK{Task still overdue?}
    DISC_STUCK -->|Yes — action needed| DISC_RED[Task shows overdue red styling\nExpand for action panel with ARIVE link]
    DISC_RED --> OPEN_ARIVE

    VIEW_UC --> TASKS_UC[Tasks tab — Under Contract tasks]
    TASKS_UC --> TASK_ITEMS_UC[Same expand/action flow as Intake\nOverdue tasks shown first in red]

    VIEW_UC --> MSGS_UC[Messages tab]
    VIEW_UC --> DOCS_UC[Documents tab\nARIVE Disclosures show 'Sign now' in red]

    VIEW_UC --> FP_STATUS[Fast Pass status visible in MetroMap\nAdmin marks each service complete\nTrack updates in real time]

    VIEW_UC --> JOURNEY_UC[Journey tracker — Under Contract highlighted]
```

---

## 7. Seller Onboarding (`/onboard/seller`)

```mermaid
flowchart TD
    START([Seller opens invite link\n/onboard/seller]) --> S1[Property address]
    S1 --> S2[Price expectation + priorities]
    S2 --> S3[Desired list date + hard deadline + timeline flexibility]
    S3 --> S4[Reasons for selling — multi-select]
    S4 --> S5[Stress/urgency questions]
    S5 --> S6[Mortgage details:\nBalance / Rate / Assumable / HELOC]
    S6 --> S7[Property info:\nType / Occupancy / Year built / Condition]
    S7 --> S8[Known issues + upgrades + HOA]
    S8 --> S9[Pre-listing prep items]
    S9 --> S10[Fears/concerns + incentive flexibility]
    S10 --> BUYING_Q{Also buying a new home?}
    BUYING_Q -->|Yes| PITCH[Pitch page shown]
    BUYING_Q -->|No| SMOOTH_PITCH

    PITCH --> SMOOTH_PITCH[Smooth Exit pitch screen]
    SMOOTH_PITCH --> SE_Q{Interested in Smooth Exit?}
    SE_Q -->|Yes| SE_SURVEY_LINK[Navigate to /smooth-exit/survey]
    SE_Q -->|No| CONTACT_S[Contact info screen:\nFull name / Phone / Email\nAll fields required]
    SE_SURVEY_LINK --> SE_SURVEY[SmoothExitSurvey flow]
    SE_SURVEY --> CONTACT_S
    CONTACT_S --> CONFIRM[Confirmation screen\nContact stored in clientContactStore]
    CONFIRM --> PORTAL[seller portal — seller userId]

    S1 -->|Back| S1
    S2 -->|Back| S1
```

---

## 8. Smooth Exit Flow (`/smooth-exit` + `/smooth-exit/survey`)

```mermaid
flowchart TD
    ENTRY([Seller lands on /smooth-exit\nvia onboarding or seller portal CTA]) --> SE_DETAIL[SmoothExitDetail page]
    SE_DETAIL --> BENEFITS[Benefits display:\nMove coordination / utilities / cleaning / etc.]
    SE_DETAIL --> FEE[Fee: 1% of sale price — paid from proceeds]
    SE_DETAIL --> ACCEPT_BTN[Get Started button → /smooth-exit/survey]
    SE_DETAIL --> DECLINE_BTN[No thanks → back to seller portal]

    ACCEPT_BTN --> SURVEY[SmoothExitSurvey — multi-step form]
    SURVEY --> Q_NEXT[What's next: buying local / renting / relocating / undecided]
    Q_NEXT --> Q_PRICE[Estimated sale price]
    Q_PRICE --> Q_MOVE[Move-out date]
    Q_MOVE --> Q_BRIDGE[Need bridge financing? Yes / No]
    Q_BRIDGE --> Q_MOVERS[Mover preference]
    Q_MOVERS --> Q_CLEAN[Wants deep clean? Yes / No]
    Q_CLEAN --> Q_UTILS[Utility transfer checkboxes:\nElectric / Gas / Internet / Trash etc.]
    Q_UTILS --> Q_NOTES[Special notes textarea]
    Q_NOTES --> SUBMIT_SE[Submit]
    SUBMIT_SE --> SE_STORED[Answers stored in mockSmoothExit\nAdmin sees in Smooth Exit Queue]
    SE_STORED --> PORTAL_BACK[Return to seller portal\nSmooth Exit badge shows]

    SURVEY --> BACK_LOOP{Back button}
    BACK_LOOP --> PREV_Q[Returns to previous survey screen]
    PREV_Q --> BACK_LOOP
```

---

## 9. Fast Pass Flow (`/fast-pass` + `/fast-pass/survey`)

```mermaid
flowchart TD
    ENTRY([Buyer/agent navigates to /fast-pass\nor agent copies link via Share Fast Pass]) --> FP_DETAIL[FastPassDetail page]
    FP_DETAIL --> BENEFITS_FP[6 benefit cards with icons + copy]
    FP_DETAIL --> PRICING[Pricing breakdown:\nBase price + upsell options\nCheckboxes for add-ons]
    PRICING --> UPSELL_TOGGLE[Check/uncheck upsells\nTotal price updates live]
    FP_DETAIL --> ACCEPT_FP[Accept button → /fast-pass/survey]
    FP_DETAIL --> DECLINE_FP[Decline button → back to previous]

    ACCEPT_FP --> FP_SURVEY[FastPassSurvey — 6-8 screens]
    FP_SURVEY --> FP_Q1[Current situation: renting / own / staying with family etc.]
    FP_Q1 --> FP_Q2[Target move-in date]
    FP_Q2 --> FP_Q3[Date flexibility: flexible / somewhat / firm]
    FP_Q3 --> FP_Q4[Move size: studio / 1BR / 2BR / 3BR+ etc.]
    FP_Q4 --> FP_Q5[Mover preference: coordinate / have movers / no help needed]
    FP_Q5 --> FP_Q6[Packing help: full / partial / none]
    FP_Q6 --> FP_Q7[Utilities to transfer — checkboxes]
    FP_Q7 --> FP_Q8[Special notes / access requirements]
    FP_Q8 --> FP_SUBMIT[Submit survey]
    FP_SUBMIT --> FP_STORED[Answers stored in mockFastPass\nAdmin sees in Active Fast Pass section]
    FP_STORED --> CHECKOUT[Checkout screen — $2,977 displayed\nStripe not yet integrated — UI stub]
    CHECKOUT --> FP_ENROLLED[Enrolled state set\nFast Pass badge appears on deal]

    FP_SURVEY --> FP_BACK{Back button}
    FP_BACK --> FP_PREV[Returns to previous survey screen]
    FP_PREV --> FP_BACK
```

---

## 10. Seller — Robert Johnson (Offer Active)

deal-johnson | Offer Active | ASAP timeline | Also buying

```mermaid
flowchart TD
    START([Switch to seller-johnson\n/seller/seller-johnson]) --> VIEW_OA[Offer Active stage view\nLabel: 'Listed & Active']

    VIEW_OA --> AUTO_MODAL[Auto-shows Showing Availability modal\non first visit to offer_active stage]
    AUTO_MODAL --> MODAL_AVAIL[Day toggles Mon–Sun + time range dropdowns]
    MODAL_AVAIL --> SAVE_AVAIL_OA[Save → showingAvailabilityStore\nModal dismisses]
    AUTO_MODAL --> DISMISS_MODAL[Dismiss without saving — modal closes]

    VIEW_OA --> LISTING_CARD[ListingActiveCard:\nStats — Days Listed / Showings: 7 mock / Online Views: 142 mock\nLatest showing feedback\nShowing availability section\nOffers received section]

    LISTING_CARD --> AVAIL_EDIT_OA[Edit availability button → same day/time editor]
    AVAIL_EDIT_OA --> SAVE_OR_CANCEL{Save or Cancel}
    SAVE_OR_CANCEL -->|Save| AVAIL_SAVED[Stored in showingAvailabilityStore]
    SAVE_OR_CANCEL -->|Cancel| LISTING_CARD

    LISTING_CARD --> OFFERS_SECTION[Offers received section\nLists offers added by agent via DealDetail]
    OFFERS_SECTION --> OFFER_EXPAND{Click offer card}
    OFFER_EXPAND -->|Expand| OFFER_DETAILS[Shows: net to seller / earnest money\nconcessions warning / close date\ncontingency list / financing type]
    OFFER_DETAILS --> OFFER_BUTTONS[Accept / Counter / Decline buttons\nUI renders — action not yet wired]
    OFFER_EXPAND -->|Collapse| OFFERS_SECTION

    OFFERS_SECTION --> NO_OFFERS{No offers yet?}
    NO_OFFERS -->|Yes| WAITING[Waiting state — 'No offers yet' empty state]
    WAITING --> OFFERS_SECTION

    VIEW_OA --> TASKS_OA[Tasks tab — Offer Active tasks]
    VIEW_OA --> MSGS_OA[Messages tab]
    VIEW_OA --> DOCS_OA[Documents tab]
    VIEW_OA --> JOURNEY_OA[Journey tracker — Offer Active highlighted]
    VIEW_OA --> SMOOTH_CTA[Smooth Exit pitch card\n'Learn more' → /smooth-exit\n'Get Started' → /smooth-exit/survey]
```

---

## 11. Seller — Jennifer Williams (Under Contract + Smooth Exit + Repair Request)

deal-williams | Under Contract | Health: RED | repair_request flag | Smooth Exit enrolled

```mermaid
flowchart TD
    START([Switch to seller-williams\n/seller/seller-williams]) --> VIEW_JW[Under Contract stage view\nHealth border: RED\nSmooth Exit badge in header]

    VIEW_JW --> UC_CARD[UnderContractCard:\nRepair request alert — repair_request flag is active\nTarget closing date + countdown\nBuyer progress tracker — 7 steps]

    UC_CARD --> REPAIR_ALERT[Alert: repair request pending]
    REPAIR_ALERT --> TASKS_JW[Tasks tab — repair-related tasks overdue]
    TASKS_JW --> REPAIR_TASK{Repair task — action type}
    REPAIR_TASK -->|Confirm type| CONFIRM_REPAIR[Expand: 'Did you complete this outside the app?'\nYes done / Not yet]
    CONFIRM_REPAIR -->|Yes| REPAIR_TASK_DONE[Task marked complete\nHealth may update]
    CONFIRM_REPAIR -->|Not yet| STAY_PENDING[Task stays pending — stays red]
    STAY_PENDING --> TASKS_JW

    UC_CARD --> BUYER_PROGRESS[Buyer progress tracker\n7 steps from Inspection → Financing → Clear to Close\nCurrent step set by agent in DealDetail]
    BUYER_PROGRESS --> PROGRESS_VIEW[Read-only for seller\nAgent updates via Buyer's Progress dropdown]

    VIEW_JW --> SE_TRACK[Smooth Exit enrolled — badge shows\nServices being coordinated by admin]

    VIEW_JW --> LOAN_JW[Loan milestones visible via MetroMap\nRegions Bank — manual tracking]

    VIEW_JW --> TASKS_JW_2[Tasks tab — full task list\nOverdue items shown first in red]
    TASKS_JW_2 --> TASK_ACTION_JW{Each task}
    TASK_ACTION_JW -->|Upload type| UPLOAD_FLOW[File picker → upload → mark complete]
    TASK_ACTION_JW -->|Confirm type| CONFIRM_FLOW[Yes/No buttons]
    TASK_ACTION_JW -->|Link type| LINK_FLOW[External link + I've completed this]

    VIEW_JW --> MSGS_JW[Messages tab]
    VIEW_JW --> DOCS_JW[Documents tab]
    VIEW_JW --> JOURNEY_JW[Journey tracker — Under Contract highlighted]
    VIEW_JW --> AGENT_CARD_JW[Agent card — call/email Sarah]
```

---

## 12. TC — Jamie Taylor

Assigned to: deal-smith + deal-williams

```mermaid
flowchart TD
    START([Switch to tc-taylor\n/tc]) --> TC_DASH[TC Dashboard]

    TC_DASH --> NAV[Section navigation via URL]
    NAV --> OV_URL[tc — Overview]
    NAV --> DOC_URL[tc/documents — Documents]
    NAV --> DISC_URL[tc/disclosures — Loan Milestones]
    NAV --> CHECK_URL[tc/checklists — Checklists]
    NAV --> CAL_URL[tc/calendar — Calendar]
    NAV --> MSG_URL[tc/messages — Contacts]

    OV_URL --> VIEW_SWITCHER[View switcher dropdown:\nMy Transactions / Contingencies / Deadlines]

    VIEW_SWITCHER --> MY_TX[My Transactions view]
    MY_TX --> STATS_TC[Stats bar: Active Files / Overdue Tasks\nUrgent Contingencies / Closing This Month]
    MY_TX --> ALERTS_TC[Critical deal alert if red deals exist\nUrgent contingency alert if expiring ≤5 days]
    MY_TX --> DEAL_CARDS_TC[Deal cards — deal-smith + deal-williams\nEach shows: client / health / stage / task count\ncontingency count / closing date countdown]
    DEAL_CARDS_TC --> CLICK_DEAL_TC[Click card → /tc/deals/:dealId]

    VIEW_SWITCHER --> CONTINGENCIES_V[Contingencies view]
    CONTINGENCIES_V --> CONT_BY_DEAL[Grouped by deal\nEach contingency: type / status / deadline]
    CONT_BY_DEAL --> CONT_ACTIONS{Contingency action}
    CONT_ACTIONS -->|Mark Waived| WAIVED[Status → waived / turns green]
    CONT_ACTIONS -->|Remove| REMOVED_C[Status → removed / turns gray]
    WAIVED --> CONT_BY_DEAL
    REMOVED_C --> CONT_BY_DEAL
    CONT_ACTIONS -->|Neither| CONT_STATUS[Active status — amber — deadline counting down]

    VIEW_SWITCHER --> DEADLINES_V[Deadlines view]
    DEADLINES_V --> DEADLINE_GROUPS[Grouped: Overdue / Today / Next 7 Days / Upcoming]
    DEADLINE_GROUPS --> DEADLINE_ITEM[Each item: icon / title / source badge\nclient name / stage / days until due / assignee]

    DISC_URL --> MILESTONES_TC[Loan Milestones — by deal]
    MILESTONES_TC --> MILESTONE_CARD{Milestone card type}
    MILESTONE_CARD -->|ARIVE synced badge| ARIVE_RO_TC[All 6 toggles disabled — read-only\nSend Reminder button if disclosures pending]
    ARIVE_RO_TC --> REMIND_BTN[Send Reminder button — UI present\nAction stub]
    MILESTONE_CARD -->|Manual badge| MANUAL_TC[All 6 toggles clickable by TC\nAppraisal dropdown editable\nCTC + Funded shown when applicable]
    MANUAL_TC --> TOGGLE_TC[Click toggle → checkbox updates\nProgress bar recalculates]

    CHECK_URL --> CHECKLISTS_TC[Checklists — by deal]
    CHECKLISTS_TC --> ELIGIBLE{Deal stage ≥ Under Contract?}
    ELIGIBLE -->|Yes| FULL_CHECKLIST[Full checklist card:\nGrouped by: Contract / Loan / Title / Closing\nEach item: checkbox / label / assignee dropdown / due date]
    FULL_CHECKLIST --> ITEM_ACTIONS{Item actions}
    ITEM_ACTIONS -->|Click checkbox| TOGGLE_ITEM[Item marked done/undone\nProgress bar updates]
    ITEM_ACTIONS -->|Assignee dropdown| REASSIGN_ITEM[Change assignee — permission checked]
    ITEM_ACTIONS -->|Due date picker| SET_DUE[Set/change due date]
    ITEM_ACTIONS -->|Delete button| DELETE_ITEM[Remove item]
    FULL_CHECKLIST --> ADD_ITEM[Add item button per category]
    ADD_ITEM --> NEW_ITEM[New row with label input + save]
    FULL_CHECKLIST --> ADD_CATEGORY[Add custom category + items]
    ELIGIBLE -->|No| LOCKED_CHECK[Locked card: 'Available at Under Contract']

    CAL_URL --> CALENDAR_TC[Calendar events list]
    CALENDAR_TC --> EVENT_GROUPS[Grouped: Past/Overdue / Today / Next 7 Days\nNext 2 Weeks / This Month]
    EVENT_GROUPS --> EVENT_ITEM[Each event: icon / title / client / days until\nevent type badge — Closing/Contingency/Task]

    MSG_URL --> CONTACTS_TC[Contacts — by deal]
    CONTACTS_TC --> CONTACT_CARD[For each deal:\nEach party: role / name / company\nCall button tel link / Email copies to clipboard]

    DOC_URL --> DOCS_TC[Documents — by deal]
    DOCS_TC --> DOC_ITEM_TC{Document action}
    DOC_ITEM_TC -->|Request| REQUEST_DOC_TC[Request button — stub]
    DOC_ITEM_TC -->|Send Reminder| REMINDER_TC[Send Reminder button — stub]
    DOC_ITEM_TC -->|Mark OK| MARK_OK_TC[Mark as received — stub]
```

---

## 13. Admin — Paul Leara

```mermaid
flowchart TD
    START([Switch to admin-paul\n/admin]) --> ADMIN_DASH[Admin Dashboard]

    ADMIN_DASH --> SIDE_NAV[Left sidebar navigation:\n13 sections]

    SIDE_NAV --> PIPELINE_ADM[Pipeline Overview — default]
    PIPELINE_ADM --> STATS_ADM[8-tile stats bar:\nTotal Value / Active Deals / Commission\nOverdue Tasks / Pending Disclosures\nClosing ≤30d / Active Fast Pass / Agents]
    PIPELINE_ADM --> NEEDS_ATTN[Needs Attention:\nRed deals → Williams shown with health badge\nYellow + overdue tasks]
    PIPELINE_ADM --> BY_STAGE[Deals by Stage rows:\nCompact table — client / property / type / stage / health / agent / tasks]
    PIPELINE_ADM --> BY_AGENT[By Agent cards:\nSarah — health dot counts / commission / overdue indicator]

    SIDE_NAV --> ALL_DEALS[All Deals section\nFull table — all 6 deals\nSort-on-hover / links to deal detail]

    SIDE_NAV --> DISCLOSURES[Pending Disclosures\nAlert rows: client / property / health / stage\nSend Reminder button per row — stub]

    SIDE_NAV --> PREAPPROVAL[Pre-Approval Queue\nDeals with mountain_mortgage flag\nClient / current task / stage / target price]

    SIDE_NAV --> STUCK[Stuck Deals\nDeals in current stage 14+ days\nDays-in-stage shown as large number]

    SIDE_NAV --> FEES[Fees Collected\nCollected vs. Pipeline commission totals\nFull commission table with breakdown]

    SIDE_NAV --> FP_ADM[Active Fast Pass section]
    FP_ADM --> FP_SECTIONS_ADM[Three sections:\nPending Payment / Active / No Enrollment]
    FP_SECTIONS_ADM --> FP_DEAL_ADM[For each enrolled deal:\nClient / property / status badge / amount paid\nSelected upsells list / survey snapshot\nTask progress bar]
    FP_DEAL_ADM --> MARK_PAID[Mark Paid button — pending payment only]
    MARK_PAID --> PAID_DONE[Status updates to active]
    FP_DEAL_ADM --> TASK_PROG[Progress bar — admin completes tasks externally\nBar reflects % of services done]

    SIDE_NAV --> SE_ADM[Smooth Exit Queue]
    SE_ADM --> SE_SECTIONS_ADM[Pending Activation / Active]
    SE_SECTIONS_ADM --> SE_DEAL_ADM[Client / property / status / fee 1 pct of sale\nBuy Before Sell badge if applicable\nSurvey snapshot: next step / move-out date]
    SE_DEAL_ADM --> ACTIVATE_BTN[Activate button — pending only]
    ACTIVATE_BTN --> SE_ACTIVATED[Status → active]

    SIDE_NAV --> ARIVE_ADM[ARIVE Status\nAll deals with loan milestone data]
    ARIVE_ADM --> ARIVE_DEAL_ROW[For each deal:\nclient / property / stage / completion pct\n6-item milestone checklist — visual display only\nAppraisal status badge / Funded badge]

    SIDE_NAV --> USERS_ADM[User Management]
    USERS_ADM --> USER_STATS_ADM[4 stat cards: Agent / TC / Buyer / Seller counts]
    USERS_ADM --> USER_TABLES[Tables grouped by role]
    USER_TABLES --> USER_ROW_ADM{User row actions}
    USER_ROW_ADM -->|View Deals| VIEW_DEALS_ADM[Button — stub]
    USER_ROW_ADM -->|Deactivate| DEACT_ADM[Deactivate button — stub]
    USERS_ADM --> INVITE_USER_ADM[Invite User — dashed button at bottom\nStub]

    SIDE_NAV --> COMING_SOON_ADM[Metro View / Promotions / Config\n→ Coming Soon page]

    SIDE_NAV --> ADMIN_SETTINGS[admin/settings → same Settings page\nwith agent/admin tabs]
```

---

## 14. Error State Reference — What's Actually in the Code

| Scenario | What the UI does | How to continue |
|----------|-----------------|-----------------|
| Task is overdue | Row turns red / overdue badge / sorted to top | Expand task → use action panel (confirm/upload/link) to mark complete |
| Task has upload action | File picker renders in expand panel | Select file → 1.5s animation → Upload success → Mark complete |
| Task has link action | External link button + 'I've completed this' | Click link → do the thing externally → return → click completed |
| Deal health is Red (Williams) | Red border on header card / alert in Admin | Agent/TC addresses underlying tasks or flags — health badge is visual only, no auto-block |
| ARIVE milestones read-only | All toggles disabled — ARIVE badge shown | Manual updates not possible — reflects ARIVE state only |
| Manual milestones — CTC reached | 'Mark as Funded' button appears | Click → Funded=true → confetti celebration fires |
| No offers added yet (seller view) | Empty state: 'No offers yet' | Agent adds offers via DealDetail → Offers card |
| Showing availability not set (offer_active) | Auto-modal fires on first visit | Set availability → Save → modal dismisses |
| Buyer requests offer on property | Star alert banner on agent's property row | Agent initiates offer outside app — no direct flow yet |
| Smooth Exit survey abandoned | Progress lost (in-memory store) | Re-enter /smooth-exit/survey and start over |
| Fast Pass survey abandoned | Progress lost (in-memory store) | Re-enter /fast-pass/survey and start over |
| Contingency overdue (TC view) | Amber alert banner + red badge on deadline | TC marks Waived or Removed in Contingencies view |
| Net sheet negative (red) | Net proceeds shows in red | Agent adjusts fields — e.g. lower mortgage payoff — recalculates live |
| Messages input | Input and button render — no send | Known stub — backend messaging not yet integrated |
| Offer Accept/Counter/Decline | Buttons render — no state change | Known stub — offer decision flow not yet implemented |
| Stage advance | Stage changes in dealStageStore — all views update | No checklist gate in the prototype — advance is always available |
