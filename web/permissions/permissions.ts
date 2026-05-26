"use client";

/**
 * Atomic permission definitions for RealTourFlow.
 *
 * Every permission belongs to one of five classes:
 *   VISIBILITY    — controls what a user can see
 *   ACTION        — controls what a user can do
 *   APPROVAL      — controls what a user can finalize / release / authorize
 *   CONFIGURATION — controls what a user can configure or change
 *   OVERRIDE      — allows a privileged user to bypass normal rules
 *
 * Permissions are assigned to Groups. Users inherit permissions from their Group.
 * Per-deal exceptions are controlled via deal.manage_permissions / deal.override_permissions.
 */

export const PERMISSIONS = {

  // ═══════════════════════════════════════════════════════════════════════════
  // DEAL — Deal lifecycle, access, and participant management
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  DEAL_VIEW:                              'deal.view',
  DEAL_VIEW_ALL:                          'deal.view_all',
  DEAL_VIEW_FINANCIALS:                   'deal.view_financials',
  DEAL_VIEW_SENSITIVE_DOCS:              'deal.view_sensitive_docs',

  // ACTION
  DEAL_CREATE:                            'deal.create',
  DEAL_EDIT:                              'deal.edit',
  DEAL_ADVANCE_STAGE:                     'deal.advance_stage',
  DEAL_ARCHIVE:                           'deal.archive',
  DEAL_RESTORE_ARCHIVE:                   'deal.restore_archive',
  DEAL_DELETE:                            'deal.delete',
  DEAL_PAUSE:                             'deal.pause',
  DEAL_ASSIGN_AGENT:                      'deal.assign_agent',
  DEAL_ADD_PARTICIPANT:                   'deal.add_participant',
  DEAL_REMOVE_PARTICIPANT:                'deal.remove_participant',
  DEAL_MANAGE_PARTICIPANTS:              'deal.manage_participants',
  DEAL_TRANSFER_OWNERSHIP:               'deal.transfer_ownership',
  DEAL_DELEGATE_TO_TC:                   'deal.delegate_to_tc',

  // CONFIGURATION
  DEAL_CHANGE_VISIBILITY:                'deal.change_visibility',
  DEAL_MANAGE_PERMISSIONS:               'deal.manage_permissions',
  DEAL_CONFIGURE_TC_ACCESS:              'deal.configure_tc_access',

  // OVERRIDE
  DEAL_ADVANCE_STAGE_OVERRIDE:           'deal.advance_stage_override',
  DEAL_OVERRIDE_PERMISSIONS:             'deal.override_permissions',
  DEAL_MARK_FALLEN_THROUGH:             'deal.mark_fallen_through',
  DEAL_REACTIVATE_FALLEN:               'deal.reactivate_fallen',

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE — Stage engine, requirement control, and history
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  STAGE_VIEW_REQUIREMENTS:               'stage.view_requirements',
  STAGE_VIEW_HISTORY:                    'stage.view_history',

  // ACTION
  STAGE_COMPLETE_REQUIREMENT:            'stage.complete_requirement',
  STAGE_REOPEN:                          'stage.reopen',
  STAGE_ROLLBACK:                        'stage.rollback',

  // CONFIGURATION
  STAGE_LOCK:                            'stage.lock',
  STAGE_UNLOCK:                          'stage.unlock',
  STAGE_CONFIGURE_TRIGGERS:             'stage.configure_triggers',

  // OVERRIDE
  STAGE_OVERRIDE_REQUIREMENTS:          'stage.override_requirements',

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTINGENCY — Inspection, financing, appraisal, and HOA contingencies
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  CONTINGENCY_VIEW:                      'contingency.view',

  // ACTION
  CONTINGENCY_TRACK:                     'contingency.track',
  CONTINGENCY_REMOVE:                    'contingency.remove',
  CONTINGENCY_WAIVE:                     'contingency.waive',
  CONTINGENCY_EXTEND:                    'contingency.extend',
  CONTINGENCY_EXPIRE:                    'contingency.expire',

  // ═══════════════════════════════════════════════════════════════════════════
  // EARNEST MONEY — Deposit tracking, receipt confirmation, and release
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  EARNEST_MONEY_VIEW_STATUS:             'earnest_money.view_status',

  // ACTION
  EARNEST_MONEY_CONFIRM_RECEIPT:         'earnest_money.confirm_receipt',
  EARNEST_MONEY_RELEASE:                 'earnest_money.release',
  EARNEST_MONEY_DISPUTE:                 'earnest_money.dispute',

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCLOSURE — Seller disclosure package lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  DISCLOSURE_VIEW:                       'disclosure.view',
  DISCLOSURE_VIEW_STATUS:                'disclosure.view_status',

  // ACTION
  DISCLOSURE_CREATE:                     'disclosure.create',
  DISCLOSURE_SEND:                       'disclosure.send',
  DISCLOSURE_ACKNOWLEDGE:                'disclosure.acknowledge',

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK — Task management and AI generation
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  TASK_VIEW:                             'task.view',

  // ACTION
  TASK_CREATE:                           'task.create',
  TASK_EDIT:                             'task.edit',
  TASK_DELETE:                           'task.delete',
  TASK_COMPLETE:                         'task.complete',
  TASK_ASSIGN_SELF:                      'task.assign_self',
  TASK_ASSIGN_ANY:                       'task.assign_any',
  TASK_REORDER:                          'task.reorder',
  TASK_AI_GENERATE:                      'task.ai_generate',

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE — In-deal communication
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  MESSAGE_VIEW:                          'message.view',
  MESSAGE_READ_RECEIPT:                  'message.read_receipt',

  // ACTION
  MESSAGE_SEND:                          'message.send',
  MESSAGE_EDIT_OWN:                      'message.edit_own',
  MESSAGE_DELETE_OWN:                    'message.delete_own',
  MESSAGE_DELETE_ANY:                    'message.delete_any',
  MESSAGE_AI_DRAFT:                      'message.ai_draft',
  MESSAGE_PIN:                           'message.pin',
  MESSAGE_ARCHIVE:                       'message.archive',
  MESSAGE_EXPORT:                        'message.export',
  MESSAGE_SEND_EXTERNAL:                 'message.send_external',
  MESSAGE_USE_TEMPLATES:                 'message.use_templates',

  // APPROVAL
  MESSAGE_APPROVE_BEFORE_SEND:           'message.approve_before_send',

  // CONFIGURATION
  MESSAGE_MANAGE_TEMPLATES:              'message.manage_templates',

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENT — Document lifecycle, compliance, and version control
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  DOCUMENT_VIEW:                         'document.view',
  DOCUMENT_VERSION_HISTORY:             'document.version_history',
  DOCUMENT_VIEW_AUDIT_TRAIL:            'document.view_audit_trail',

  // ACTION
  DOCUMENT_UPLOAD:                       'document.upload',
  DOCUMENT_DOWNLOAD:                     'document.download',
  DOCUMENT_DELETE_OWN:                   'document.delete_own',
  DOCUMENT_DELETE_ANY:                   'document.delete_any',
  DOCUMENT_REQUEST:                      'document.request',
  DOCUMENT_SIGN:                         'document.sign',
  DOCUMENT_EDIT_METADATA:               'document.edit_metadata',
  DOCUMENT_REPLACE_VERSION:             'document.replace_version',
  DOCUMENT_RESTORE_VERSION:             'document.restore_version',
  DOCUMENT_LOCK:                         'document.lock',
  DOCUMENT_UNLOCK:                       'document.unlock',
  DOCUMENT_SHARE:                        'document.share',
  DOCUMENT_REQUEST_SIGNATURE:           'document.request_signature',
  DOCUMENT_MARK_RECEIVED:               'document.mark_received',
  DOCUMENT_MARK_MISSING:                'document.mark_missing',
  DOCUMENT_CLASSIFY:                     'document.classify',

  // APPROVAL
  DOCUMENT_APPROVE:                      'document.approve',
  DOCUMENT_REJECT:                       'document.reject',

  // CONFIGURATION
  DOCUMENT_SET_VISIBILITY:              'document.set_visibility',
  DOCUMENT_MANAGE_CHECKLIST:            'document.manage_checklist',

  // ═══════════════════════════════════════════════════════════════════════════
  // ESIGN — Electronic signature workflows
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  ESIGN_VIEW_STATUS:                     'esign.view_status',

  // ACTION
  ESIGN_SEND:                            'esign.send',
  ESIGN_CANCEL:                          'esign.cancel',
  ESIGN_REMIND:                          'esign.remind',
  ESIGN_MANAGE_RECIPIENTS:              'esign.manage_recipients',
  ESIGN_DOWNLOAD_CERTIFICATE:           'esign.download_certificate',

  // ═══════════════════════════════════════════════════════════════════════════
  // PROPERTY — Property details, photos, MLS, and valuation
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  PROPERTY_VIEW:                         'property.view',
  PROPERTY_VIEW_VALUATION:              'property.view_valuation',

  // ACTION
  PROPERTY_ADD:                          'property.add',
  PROPERTY_EDIT:                         'property.edit',
  PROPERTY_REMOVE:                       'property.remove',
  PROPERTY_PHOTO_UPLOAD:                 'property.photo_upload',
  PROPERTY_AI_ANALYZE:                   'property.ai_analyze',
  PROPERTY_ENRICH_MLS:                   'property.enrich_mls',
  PROPERTY_LINK_MLS:                     'property.link_mls',
  PROPERTY_UNLINK_MLS:                   'property.unlink_mls',
  PROPERTY_EDIT_VALUATION:              'property.edit_valuation',

  // ═══════════════════════════════════════════════════════════════════════════
  // CMA — Comparative Market Analysis
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  CMA_VIEW:                              'cma.view',

  // ACTION
  CMA_CREATE:                            'cma.create',
  CMA_EDIT:                              'cma.edit',
  CMA_EXPORT:                            'cma.export',
  CMA_DELETE:                            'cma.delete',

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTING — Seller listing management
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  LISTING_VIEW:                          'listing.view',
  LISTING_VIEW_FEEDBACK_SUMMARY:        'listing.view_feedback_summary',
  LISTING_VIEW_PERFORMANCE:             'listing.view_performance',

  // ACTION
  LISTING_CREATE:                        'listing.create',
  LISTING_EDIT:                          'listing.edit',
  LISTING_PUBLISH:                       'listing.publish',
  LISTING_UNPUBLISH:                     'listing.unpublish',
  LISTING_PAUSE:                         'listing.pause',
  LISTING_MANAGE_PRICE:                  'listing.manage_price',
  LISTING_MANAGE_DESCRIPTION:           'listing.manage_description',
  LISTING_MANAGE_PHOTOS:                 'listing.manage_photos',
  LISTING_EXPORT_MARKETING:             'listing.export_marketing',
  LISTING_COPY_GENERATE:                'listing.copy_generate',
  LISTING_UPDATE_MLS_STATUS:            'listing.update_mls_status',

  // APPROVAL
  LISTING_APPROVE_DRAFT:                 'listing.approve_draft',

  // CONFIGURATION
  LISTING_MANAGE_SHOWING_INSTRUCTIONS:  'listing.manage_showing_instructions',

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOWING — Property showings and scheduling
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  SHOWING_VIEW:                          'showing.view',
  SHOWING_FEEDBACK_VIEW:                 'showing.feedback_view',
  SHOWING_VIEW_ACTIVITY_REPORT:         'showing.view_activity_report',
  SHOWING_VIEW_BUYER_IDENTITY:          'showing.view_buyer_identity',

  // ACTION
  SHOWING_REQUEST:                       'showing.request',
  SHOWING_SCHEDULE:                      'showing.schedule',
  SHOWING_CANCEL:                        'showing.cancel',
  SHOWING_REQUEST_FEEDBACK:             'showing.request_feedback',

  // CONFIGURATION
  SHOWING_AUTO_APPROVE_TOGGLE:          'showing.auto_approve_toggle',

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFER — Offer submission, negotiation, and approval
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  OFFER_VIEW:                            'offer.view',
  OFFER_VIEW_ANALYSIS_DETAILS:          'offer.view_analysis_details',

  // ACTION
  OFFER_SUBMIT:                          'offer.submit',
  OFFER_EDIT:                            'offer.edit',
  OFFER_WITHDRAW:                        'offer.withdraw',
  OFFER_EXPIRE:                          'offer.expire',
  OFFER_REOPEN:                          'offer.reopen',
  OFFER_ACCEPT:                          'offer.accept',
  OFFER_REJECT:                          'offer.reject',
  OFFER_COUNTER:                         'offer.counter',
  OFFER_COMPARE:                         'offer.compare',
  OFFER_AI_ANALYZE:                      'offer.ai_analyze',
  OFFER_SHARE:                           'offer.share',
  OFFER_MANAGE_COUNTER_CHAIN:           'offer.manage_counter_chain',
  OFFER_PRESENT:                         'offer.present',
  OFFER_REQUEST_HIGHEST_BEST:           'offer.request_highest_best',
  OFFER_CREATE_NET_SHEET:               'offer.create_net_sheet',

  // APPROVAL
  OFFER_APPROVE_FOR_SEND:               'offer.approve_for_send',

  // CONFIGURATION
  OFFER_LOCK:                            'offer.lock',
  OFFER_UNLOCK:                          'offer.unlock',

  // ═══════════════════════════════════════════════════════════════════════════
  // APPRAISAL — Property appraisal workflow (separated from lending)
  // Note: ordering the appraisal itself is lender-only (AMC independence rules)
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  APPRAISAL_VIEW_RESULT:                 'appraisal.view_result',
  APPRAISAL_VIEW_REPORT:                 'appraisal.view_report',

  // ACTION
  APPRAISAL_COORDINATE_ACCESS:          'appraisal.coordinate_access',
  APPRAISAL_SUBMIT_ROV:                  'appraisal.submit_rov',

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT — Calendar events and scheduling
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  EVENT_VIEW:                            'event.view',
  EVENT_VIEW_AVAILABILITY:              'event.view_availability',

  // ACTION
  EVENT_CREATE:                          'event.create',
  EVENT_EDIT:                            'event.edit',
  EVENT_DELETE:                          'event.delete',
  EVENT_RESPOND:                         'event.respond',
  EVENT_RESCHEDULE:                      'event.reschedule',
  EVENT_MANAGE_ATTENDEES:               'event.manage_attendees',
  EVENT_SCHEDULE_FOR_OTHERS:            'event.schedule_for_others',
  EVENT_CALENDAR_SYNC:                   'event.calendar_sync',
  EVENT_LINK_TO_STAGE:                   'event.link_to_stage',
  EVENT_UNLINK_FROM_STAGE:              'event.unlink_from_stage',

  // ═══════════════════════════════════════════════════════════════════════════
  // PIPELINE — Agent pipeline and deal overview
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  PIPELINE_VIEW_OWN:                     'pipeline.view_own',
  PIPELINE_VIEW_ALL:                     'pipeline.view_all',

  // ACTION
  PIPELINE_FILTER:                       'pipeline.filter',
  PIPELINE_BULK_ACTION:                  'pipeline.bulk_action',
  PIPELINE_EXPORT:                       'pipeline.export',

  // ═══════════════════════════════════════════════════════════════════════════
  // AI — Artificial intelligence capabilities
  // Note: ai.* = capability to invoke AI. Domain permissions govern the workflow action.
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  AI_GENERATE_TASKS:                     'ai.generate_tasks',
  AI_DRAFT_COMMUNICATION:               'ai.draft_communication',
  AI_GENERATE_LISTING:                   'ai.generate_listing',
  AI_GENERATE_CMA:                       'ai.generate_cma',
  AI_ANALYZE_OFFER:                      'ai.analyze_offer',
  AI_SCORE_LEAD:                         'ai.score_lead',
  AI_NEGOTIATION_COPILOT:               'ai.negotiation_copilot',

  // APPROVAL
  AI_APPROVE_OUTPUT:                     'ai.approve_output',

  // ═══════════════════════════════════════════════════════════════════════════
  // LENDING — Loan and mortgage pipeline (ARIVE + multi-lender ready)
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  LENDING_VIEW_STATUS:                   'lending.view_status',
  LENDING_VIEW_MILESTONES:              'lending.view_milestones',
  LENDING_VIEW_DISCLOSURES:             'lending.view_disclosures',
  LENDING_VIEW_SENSITIVE_LOAN_DATA:     'lending.view_sensitive_loan_data',

  // ACTION
  LENDING_SYNC:                          'lending.sync',
  LENDING_RESEND_DISCLOSURES:           'lending.resend_disclosures',
  LENDING_MARK_PREAPPROVED:             'lending.mark_preapproved',
  LENDING_MARK_CLEARED:                  'lending.mark_cleared',
  LENDING_REQUEST_PREAPPROVAL:          'lending.request_preapproval',
  LENDING_UPDATE_STATUS_MANUAL:         'lending.update_status_manual',

  // CONFIGURATION
  LENDING_CONNECT_PROVIDER:             'lending.connect_provider',
  LENDING_DISCONNECT_PROVIDER:          'lending.disconnect_provider',
  LENDING_MANAGE_WEBHOOKS:              'lending.manage_webhooks',

  // OVERRIDE
  LENDING_OVERRIDE_STATUS:              'lending.override_status',

  // ═══════════════════════════════════════════════════════════════════════════
  // TITLE — Title search, commitment, and insurance
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  TITLE_VIEW_COMMITMENT:                 'title.view_commitment',
  TITLE_VIEW_INSURANCE_POLICY:          'title.view_insurance_policy',

  // ACTION
  TITLE_FLAG_EXCEPTION:                  'title.flag_exception',
  TITLE_CONFIRM_CLEAR:                   'title.confirm_clear',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLOSING — The closing event: scheduling, funds, wire, ALTA, completion
  // closing.view_wire_instructions is audited on every access — fraud prevention
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  CLOSING_VIEW_WIRE_INSTRUCTIONS:       'closing.view_wire_instructions',

  // ACTION
  CLOSING_SCHEDULE:                      'closing.schedule',
  CLOSING_CONFIRM_FUNDS:                 'closing.confirm_funds',
  CLOSING_COMPLETE:                      'closing.complete',

  // APPROVAL
  CLOSING_APPROVE_ALTA:                  'closing.approve_alta',

  // ═══════════════════════════════════════════════════════════════════════════
  // POST_CLOSE — Recording, document delivery, compliance archiving
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  POST_CLOSE_CONFIRM_RECORDING:         'post_close.confirm_recording',
  POST_CLOSE_DELIVER_DOCUMENTS:         'post_close.deliver_documents',
  POST_CLOSE_TRACK_TITLE_POLICY:        'post_close.track_title_policy',
  POST_CLOSE_SUBMIT_COMPLIANCE_FILE:    'post_close.submit_compliance_file',

  // ═══════════════════════════════════════════════════════════════════════════
  // FASTPASS — Premium buyer tier ($1,997 concierge)
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  FASTPASS_VIEW:                         'fastpass.view',

  // ACTION
  FASTPASS_ENROLL:                       'fastpass.enroll',
  FASTPASS_MANAGE:                       'fastpass.manage',

  // OVERRIDE
  FASTPASS_WAIVE_FEE:                    'fastpass.waive_fee',

  // ═══════════════════════════════════════════════════════════════════════════
  // PORTAL — Client-facing portal visibility control
  // Presence = section is shown. Absence = section is hidden. No hide_* mirrors.
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  PORTAL_VIEW:                           'portal.view',

  // CONFIGURATION
  PORTAL_MANAGE_SECTIONS:               'portal.manage_sections',
  PORTAL_SHOW_STAGE_PROGRESS:           'portal.show_stage_progress',
  PORTAL_SHOW_DOCUMENTS:                'portal.show_documents',
  PORTAL_SHOW_TASKS:                     'portal.show_tasks',
  PORTAL_SHOW_MESSAGES:                  'portal.show_messages',
  PORTAL_SHOW_OFFERS:                    'portal.show_offers',

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATION — Alerts, broadcasts, and templates
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  NOTIFICATION_RECEIVE:                  'notification.receive',
  NOTIFICATION_TRIGGER_MANUAL:          'notification.trigger_manual',
  NOTIFICATION_MUTE_DEAL:               'notification.mute_deal',
  NOTIFICATION_MUTE_USER:               'notification.mute_user',
  NOTIFICATION_SEND_ANY:                 'notification.send_any',
  NOTIFICATION_BROADCAST:               'notification.broadcast',

  // CONFIGURATION
  NOTIFICATION_MANAGE:                   'notification.manage',
  NOTIFICATION_MANAGE_TEMPLATES:        'notification.manage_templates',

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTOMATION — Stage triggers and workflow automation
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  AUTOMATION_VIEW:                       'automation.view',

  // ACTION
  AUTOMATION_CREATE:                     'automation.create',
  AUTOMATION_EDIT:                       'automation.edit',
  AUTOMATION_RUN:                        'automation.run',

  // CONFIGURATION
  AUTOMATION_DISABLE:                    'automation.disable',

  // ═══════════════════════════════════════════════════════════════════════════
  // PERMISSION — Atomic permission management
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  PERMISSION_VIEW:                       'permission.view',

  // ACTION
  PERMISSION_CREATE:                     'permission.create',
  PERMISSION_EDIT:                       'permission.edit',

  // CONFIGURATION
  PERMISSION_ASSIGN:                     'permission.assign',

  // ═══════════════════════════════════════════════════════════════════════════
  // BUNDLE — Permission bundle (group template) management
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  BUNDLE_CREATE:                         'bundle.create',
  BUNDLE_EDIT:                           'bundle.edit',
  BUNDLE_DELETE:                         'bundle.delete',

  // CONFIGURATION
  BUNDLE_ASSIGN:                         'bundle.assign',

  // ═══════════════════════════════════════════════════════════════════════════
  // ROLE — Role definition and assignment
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  ROLE_CREATE:                           'role.create',
  ROLE_EDIT:                             'role.edit',
  ROLE_DELETE:                           'role.delete',

  // CONFIGURATION
  ROLE_ASSIGN:                           'role.assign',

  // ═══════════════════════════════════════════════════════════════════════════
  // USER — User lifecycle management
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  USER_INVITE:                           'user.invite',
  USER_DEACTIVATE:                       'user.deactivate',
  USER_REACTIVATE:                       'user.reactivate',
  USER_RESET_PASSWORD:                   'user.reset_password',
  USER_ASSIGN_ROLE:                      'user.assign_role',

  // ═══════════════════════════════════════════════════════════════════════════
  // BILLING — Payments, fees, invoices, and transaction history
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  BILLING_VIEW:                          'billing.view',
  BILLING_VIEW_TRANSACTION_HISTORY:     'billing.view_transaction_history',

  // ACTION
  BILLING_CHARGE:                        'billing.charge',
  BILLING_REFUND:                        'billing.refund',
  BILLING_WAIVE:                         'billing.waive',
  BILLING_RETRY_PAYMENT:                 'billing.retry_payment',
  BILLING_DOWNLOAD_INVOICE:             'billing.download_invoice',
  BILLING_MANAGE_PAYMENT_METHOD:        'billing.manage_payment_method',
  BILLING_EXPORT_TRANSACTIONS:          'billing.export_transactions',
  BILLING_APPLY_PROMOTION:              'billing.apply_promotion',

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYTICS — Performance metrics and deal intelligence
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  ANALYTICS_VIEW_OWN:                    'analytics.view_own',
  ANALYTICS_VIEW_ALL:                    'analytics.view_all',
  ANALYTICS_VIEW_TEAM:                   'analytics.view_team',
  ANALYTICS_VIEW_DEAL_HEALTH:           'analytics.view_deal_health',
  ANALYTICS_VIEW_CONVERSION:            'analytics.view_conversion',
  ANALYTICS_VIEW_STAGE_PERFORMANCE:     'analytics.view_stage_performance',
  ANALYTICS_AI_METRICS:                  'analytics.ai_metrics',

  // ACTION
  ANALYTICS_EXPORT:                      'analytics.export',

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT — Structured reports
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  REPORT_VIEW:                           'report.view',

  // ACTION
  REPORT_CREATE:                         'report.create',
  REPORT_EXPORT:                         'report.export',

  // ═══════════════════════════════════════════════════════════════════════════
  // DASHBOARD — Operational dashboards
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  DASHBOARD_VIEW:                        'dashboard.view',

  // ACTION
  DASHBOARD_SHARE:                       'dashboard.share',

  // CONFIGURATION
  DASHBOARD_CUSTOMIZE:                   'dashboard.customize',

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT — System audit trail
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  AUDIT_VIEW:                            'audit.view',

  // ACTION
  AUDIT_FILTER:                          'audit.filter',
  AUDIT_EXPORT:                          'audit.export',

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY — Session and authentication management
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  SECURITY_VIEW_SESSIONS:               'security.view_sessions',

  // ACTION
  SECURITY_REVOKE_SESSIONS:             'security.revoke_sessions',

  // CONFIGURATION
  SECURITY_MANAGE_MFA:                   'security.manage_mfa',

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLIANCE — Regulatory flags and data retention
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  COMPLIANCE_VIEW_FLAGS:                 'compliance.view_flags',

  // ACTION
  COMPLIANCE_RESOLVE_FLAGS:             'compliance.resolve_flags',
  COMPLIANCE_PLACE_LEGAL_HOLD:          'compliance.place_legal_hold',

  // CONFIGURATION
  COMPLIANCE_MANAGE_RETENTION:          'compliance.manage_retention',

  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH — Global and scoped search
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  SEARCH_GLOBAL:                         'search.global',
  SEARCH_DEALS:                          'search.deals',
  SEARCH_DOCUMENTS:                      'search.documents',
  SEARCH_MESSAGES:                       'search.messages',

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORT — Data import
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  IMPORT_DEALS:                          'import.deals',
  IMPORT_CONTACTS:                       'import.contacts',

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT — Bulk data export
  // ═══════════════════════════════════════════════════════════════════════════

  // ACTION
  EXPORT_DEALS:                          'export.deals',
  EXPORT_DOCUMENTS:                      'export.documents',
  EXPORT_MESSAGES:                       'export.messages',

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE — Reusable content templates (tasks, messages, docs, checklists)
  // ═══════════════════════════════════════════════════════════════════════════

  // VISIBILITY
  TEMPLATE_VIEW:                         'template.view',

  // ACTION
  TEMPLATE_CREATE:                       'template.create',
  TEMPLATE_EDIT:                         'template.edit',
  TEMPLATE_DELETE:                       'template.delete',
  TEMPLATE_USE:                          'template.use',
  TEMPLATE_ASSIGN:                       'template.assign',

  // APPROVAL
  TEMPLATE_PUBLISH:                      'template.publish',

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN — System-level administration
  // Deliberately narrow: domain-specific admin work lives in its own domain.
  // ═══════════════════════════════════════════════════════════════════════════

  // CONFIGURATION
  ADMIN_CONFIGURE_SYSTEM:               'admin.configure_system',
  ADMIN_MANAGE_FEES:                     'admin.manage_fees',
  ADMIN_MANAGE_PROMOTIONS:              'admin.manage_promotions',

  // OVERRIDE
  ADMIN_IMPERSONATE:                     'admin.impersonate',

} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type Permission = (typeof PERMISSIONS)[PermissionKey];
