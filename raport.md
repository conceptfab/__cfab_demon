react-doctor v0.1.6

✔ Select projects to scan › dashboard
Scanning /Users/micz/__DEV__/__cfab_demon/dashboard...

- Detecting framework. Found Vite.
✔ Detecting framework. Found Vite.
- Detecting React version. Found React ^19.2.0.
✔ Detecting React version. Found React ^19.2.0.
- Detecting language. Found TypeScript.
✔ Detecting language. Found TypeScript.
- Detecting React Compiler. Not found.
✔ Detecting React Compiler. Not found.
- Found 223 source files.
✔ Found 223 source files.

- Running lint checks...
- Detecting dead code.
✔ Detecting dead code.
- Running lint checks...
✔ Running lint checks.

  ⚠ react-doctor/design-no-redundant-size-axes      ×439
      w-4 h-4 → use the shorthand size-4 (Tailwind v3.4+)
      → Collapse `w-N h-N` to `size-N` (Tailwind v3.4+) when both axes match
      src/components/project/CollapsibleSection.tsx:26
      src/components/project/CollapsibleSection.tsx:28
      src/components/help/sections/HelpProjectsSection.tsx:10
      src/components/help/sections/HelpLanSyncSection.tsx:10
      src/components/ai/AiBatchActionsCard.tsx:80
      src/components/ai/AiBatchActionsCard.tsx:92
      src/components/help/sections/HelpSimpleSections.tsx:17
      src/components/help/sections/HelpSimpleSections.tsx:47
      src/components/help/sections/HelpSimpleSections.tsx:72
      src/components/help/sections/HelpSimpleSections.tsx:97
      src/components/help/sections/HelpSimpleSections.tsx:120
      src/components/help/sections/HelpSimpleSections.tsx:151
      src/components/projects/ProjectList.tsx:60
      src/components/projects/ProjectList.tsx:89
      src/components/projects/ProjectList.tsx:97
      src/pages/Estimates.tsx:312
      src/pages/Estimates.tsx:395
      src/pages/Estimates.tsx:420
      src/pages/Estimates.tsx:490
      src/pages/Estimates.tsx:495
      src/components/project/CreateProjectDialog.tsx:129
      src/components/project/ProjectColorPicker.tsx:54
      src/components/project/ProjectColorPicker.tsx:59
      src/components/project/ProjectColorPicker.tsx:68
      src/components/help/sections/HelpSettingsSection.tsx:10
      src/components/ai/AiModelStatusCard.tsx:54
      src/components/ai/AiModelStatusCard.tsx:150
      src/components/ai/AiModelStatusCard.tsx:161
      src/components/ai/AiModelStatusCard.tsx:183
      src/components/ai/AiModelStatusCard.tsx:194
      src/components/help/sections/HelpAiSection.tsx:10
      src/components/project-page/ProjectEstimatesSection.tsx:63
      src/components/project-page/ProjectEstimatesSection.tsx:77
      src/components/project-page/ProjectEstimatesSection.tsx:87
      src/components/project-page/ProjectEstimatesSection.tsx:157
      src/components/project-page/ProjectEstimatesSection.tsx:195
      src/components/project-page/ProjectEstimatesSection.tsx:234
      src/components/project-page/ProjectEstimatesSection.tsx:236
      src/pages/Applications.tsx:363
      src/pages/Applications.tsx:416
      src/pages/Applications.tsx:459
      src/pages/Applications.tsx:463
      src/pages/Applications.tsx:470
      src/pages/Applications.tsx:474
      src/pages/Applications.tsx:496
      src/pages/Applications.tsx:534
      src/pages/Applications.tsx:557
      src/pages/Applications.tsx:585
      src/pages/Applications.tsx:593
      src/pages/Applications.tsx:611
      src/pages/Applications.tsx:673
      src/pages/Applications.tsx:677
      src/pages/Applications.tsx:684
      src/pages/Applications.tsx:688
      src/pages/Applications.tsx:695
      src/pages/Applications.tsx:699
      src/components/project/ProjectSessionDetailDialog.tsx:69
      src/components/project/ProjectSessionDetailDialog.tsx:134
      src/components/projects/ProjectDiscoveryPanel.tsx:75
      src/components/projects/ProjectDiscoveryPanel.tsx:79
      src/components/projects/ProjectDiscoveryPanel.tsx:208
      src/components/projects/ProjectDiscoveryPanel.tsx:229
      src/components/projects/ProjectDiscoveryPanel.tsx:256
      src/components/projects/ProjectDiscoveryPanel.tsx:299
      src/components/projects/ProjectDiscoveryPanel.tsx:321
      src/components/projects/ProjectDiscoveryPanel.tsx:370
      src/components/projects/ProjectDiscoveryPanel.tsx:373
      src/components/projects/ProjectDiscoveryPanel.tsx:399
      src/components/projects/ProjectDiscoveryPanel.tsx:412
      src/components/help/sections/HelpQuickStartSection.tsx:13
      src/components/help/sections/HelpQuickStartSection.tsx:42
      src/components/help/sections/HelpBughunterSection.tsx:10
      src/components/reports/ReportTemplateSelector.tsx:29
      src/components/reports/ReportTemplateSelector.tsx:32
      src/components/reports/ReportTemplateSelector.tsx:33
      src/components/reports/ReportTemplateSelector.tsx:49
      src/components/reports/ReportTemplateSelector.tsx:61
      src/components/project-page/ProjectOverview.tsx:26
      src/components/project-page/ProjectOverview.tsx:51
      src/pages/TimeAnalysis.tsx:73
      src/pages/TimeAnalysis.tsx:76
      src/pages/TimeAnalysis.tsx:86
      src/pages/TimeAnalysis.tsx:90
      src/pages/TimeAnalysis.tsx:182
      src/pages/TimeAnalysis.tsx:196
      src/components/project/ProjectManualSessionsCard.tsx:39
      src/components/projects/ProjectsList.tsx:93
      src/components/projects/ProjectsList.tsx:104
      src/components/projects/ProjectsList.tsx:129
      src/components/projects/ProjectsList.tsx:149
      src/components/projects/ProjectsList.tsx:169
      src/components/projects/ProjectsList.tsx:186
      src/components/projects/ProjectsList.tsx:225
      src/components/projects/ProjectsList.tsx:230
      src/components/help/sections/HelpReportsSection.tsx:10
      src/components/help/help-shared.tsx:29
      src/components/help/help-shared.tsx:74
      src/pages/ImportPage.tsx:86
      src/pages/ImportPage.tsx:90
      src/components/project/ProjectRecentCommentsCard.tsx:38
      src/components/project/ProjectCard.tsx:105
      src/components/project/ProjectCard.tsx:129
      src/components/project/ProjectCard.tsx:134
      src/components/project/ProjectCard.tsx:143
      src/components/project/ProjectCard.tsx:206
      src/components/project/ProjectCard.tsx:227
      src/components/project/ProjectCard.tsx:238
      src/components/project/ProjectCard.tsx:247
      src/components/project/ProjectCard.tsx:263
      src/components/project/ProjectCard.tsx:266
      src/components/project/ProjectCard.tsx:277
      src/components/project/ProjectCard.tsx:280
      src/components/project/ProjectCard.tsx:301
      src/components/help/sections/HelpDataSection.tsx:10
      src/components/ui/select.tsx:24
      src/components/ui/select.tsx:70
      src/components/ui/select.tsx:72
      src/pages/AI.tsx:682
      src/components/settings/DemoModeCard.tsx:68
      src/components/help/sections/HelpOnlineSyncSection.tsx:10
      src/components/project/ProjectSessionsTable.tsx:56
      src/components/project/ProjectSessionsTable.tsx:108
      src/components/project/ProjectSessionsTable.tsx:121
      src/components/project/ProjectSessionsTable.tsx:128
      src/components/project/ProjectSessionsTable.tsx:160
      src/components/project/ProjectSessionsTable.tsx:163
      src/components/project/ProjectSessionsTable.tsx:168
      src/components/projects/ExcludedProjectsList.tsx:103
      src/pages/ReportView.tsx:123
      src/pages/ReportView.tsx:149
      src/pages/ReportView.tsx:158
      src/pages/ReportView.tsx:175
      src/pages/ReportView.tsx:189
      src/components/settings/SessionManagementCard.tsx:139
      src/components/settings/SessionManagementCard.tsx:158
      src/components/help/sections/HelpSessionsSection.tsx:10
      src/components/settings/LanguageCard.tsx:34
      src/components/settings/PmSettingsCard.tsx:58
      src/components/settings/PmSettingsCard.tsx:76
      src/pages/Help.tsx:83
      src/pages/Help.tsx:116
      src/pages/Help.tsx:129
      src/pages/Help.tsx:138
      src/pages/Help.tsx:147
      src/pages/Help.tsx:156
      src/pages/Help.tsx:172
      src/pages/Help.tsx:175
      src/pages/Help.tsx:194
      src/pages/Help.tsx:207
      src/pages/Help.tsx:208
      src/pages/Help.tsx:209
      src/pages/Help.tsx:210
      src/pages/Help.tsx:211
      src/pages/Help.tsx:212
      src/pages/Help.tsx:213
      src/pages/Help.tsx:214
      src/pages/Help.tsx:215
      src/pages/Help.tsx:216
      src/pages/Help.tsx:217
      src/pages/Help.tsx:218
      src/pages/Help.tsx:219
      src/pages/Help.tsx:220
      src/pages/Help.tsx:221
      src/pages/Help.tsx:222
      src/components/ManualSessionDialog.tsx:240
      src/components/ManualSessionDialog.tsx:295
      src/components/settings/LanSyncCard.tsx:172
      src/components/settings/LanSyncCard.tsx:205
      src/components/settings/LanSyncCard.tsx:424
      src/components/settings/LanSyncCard.tsx:443
      src/components/settings/LanSyncCard.tsx:462
      src/components/settings/LanSyncCard.tsx:523
      src/components/settings/LanSyncCard.tsx:525
      src/components/settings/LanSyncCard.tsx:538
      src/components/settings/LanSyncCard.tsx:564
      src/components/settings/LanSyncCard.tsx:566
      src/components/settings/LanSyncCard.tsx:606
      src/components/settings/LanSyncCard.tsx:619
      src/components/settings/LanSyncCard.tsx:646
      src/components/settings/LanSyncCard.tsx:670
      src/components/settings/LanSyncCard.tsx:676
      src/components/settings/LanSyncCard.tsx:682
      src/components/settings/LanSyncCard.tsx:693
      src/components/settings/LanSyncCard.tsx:751
      src/components/settings/LanSyncCard.tsx:753
      src/components/settings/LanSyncCard.tsx:779
      src/components/settings/LanSyncCard.tsx:826
      src/components/settings/LanSyncCard.tsx:861
      src/components/settings/LanSyncCard.tsx:873
      src/components/settings/LanSyncCard.tsx:886
      src/pages/ProjectPage.tsx:895
      src/pages/ProjectPage.tsx:909
      src/pages/ProjectPage.tsx:919
      src/pages/ProjectPage.tsx:934
      src/pages/ProjectPage.tsx:955
      src/pages/ProjectPage.tsx:977
      src/pages/ProjectPage.tsx:1020
      src/pages/ProjectPage.tsx:1021
      src/pages/ProjectPage.tsx:1105
      src/pages/ProjectPage.tsx:1110
      src/pages/ProjectPage.tsx:1126
      src/pages/ProjectPage.tsx:1149
      src/components/ui/dialog.tsx:42
      src/components/import/FileDropzone.tsx:108
      src/components/import/FileDropzone.tsx:127
      src/components/import/FileDropzone.tsx:136
      src/components/settings/DangerZoneCard.tsx:59
      src/components/settings/AppearanceCard.tsx:40
      src/components/sessions/SessionContextMenu.tsx:91
      src/components/sessions/SessionContextMenu.tsx:150
      src/components/sessions/SessionContextMenu.tsx:164
      src/components/sessions/SessionContextMenu.tsx:191
      src/components/sessions/SessionContextMenu.tsx:209
      src/components/sessions/SessionContextMenu.tsx:227
      src/components/sessions/SessionContextMenu.tsx:240
      src/components/sessions/SessionContextMenu.tsx:258
      src/components/data/ImportPanel.tsx:83
      src/components/data/ImportPanel.tsx:91
      src/components/data/ImportPanel.tsx:101
      src/components/data/ImportPanel.tsx:133
      src/components/data/ImportPanel.tsx:135
      src/components/data/ImportPanel.tsx:158
      src/components/data/ImportPanel.tsx:173
      src/components/data/ImportPanel.tsx:195
      src/components/data/ImportPanel.tsx:196
      src/components/ui/DateRangeToolbar.tsx:62
      src/components/ui/DateRangeToolbar.tsx:65
      src/components/ui/DateRangeToolbar.tsx:76
      src/components/ui/DateRangeToolbar.tsx:80
      src/pages/DaemonControl.tsx:204
      src/pages/DaemonControl.tsx:209
      src/pages/DaemonControl.tsx:212
      src/pages/DaemonControl.tsx:284
      src/pages/DaemonControl.tsx:296
      src/pages/DaemonControl.tsx:309
      src/pages/DaemonControl.tsx:360
      src/pages/DaemonControl.tsx:378
      src/pages/DaemonControl.tsx:381
      src/components/settings/OnlineSyncCard.tsx:102
      src/components/settings/OnlineSyncCard.tsx:179
      src/components/settings/OnlineSyncCard.tsx:198
      src/components/settings/OnlineSyncCard.tsx:243
      src/components/settings/OnlineSyncCard.tsx:305
      src/components/settings/OnlineSyncCard.tsx:307
      src/components/sessions/SessionsVirtualList.tsx:99
      src/components/sessions/SessionsVirtualList.tsx:155
      src/components/sessions/SessionsVirtualList.tsx:171
      src/components/sessions/SessionsVirtualList.tsx:204
      src/components/data/DataHistory.tsx:122
      src/components/data/DataHistory.tsx:132
      src/components/data/DataHistory.tsx:142
      src/components/data/DataHistory.tsx:159
      src/components/data/DataHistory.tsx:169
      src/components/data/DataHistory.tsx:180
      src/components/data/DataHistory.tsx:186
      src/components/data/DataHistory.tsx:200
      src/components/data/DataHistory.tsx:210
      src/components/data/DataHistory.tsx:220
      src/components/data/DataHistory.tsx:227
      src/components/data/DataHistory.tsx:231
      src/pages/QuickStart.tsx:34
      src/pages/QuickStart.tsx:43
      src/pages/QuickStart.tsx:55
      src/pages/QuickStart.tsx:67
      src/pages/QuickStart.tsx:79
      src/pages/QuickStart.tsx:91
      src/pages/QuickStart.tsx:113
      src/pages/QuickStart.tsx:123
      src/pages/QuickStart.tsx:174
      src/components/sync/SyncProgressOverlay.tsx:118
      src/components/sync/SyncProgressOverlay.tsx:120
      src/components/sync/SyncProgressOverlay.tsx:122
      src/components/sync/SyncProgressOverlay.tsx:124
      src/components/sync/SyncProgressOverlay.tsx:126
      src/components/sync/SyncProgressOverlay.tsx:158
      src/components/sessions/SessionRow.tsx:168
      src/components/sessions/SessionRow.tsx:180
      src/components/sessions/SessionRow.tsx:186
      src/components/sessions/SessionRow.tsx:193
      src/components/sessions/SessionRow.tsx:202
      src/components/sessions/SessionRow.tsx:241
      src/components/sessions/SessionRow.tsx:253
      src/components/sessions/SessionRow.tsx:263
      src/components/sessions/SessionRow.tsx:271
      src/components/sessions/SessionRow.tsx:311
      src/components/sessions/SessionRow.tsx:323
      src/components/sessions/SessionRow.tsx:326
      src/components/sessions/SessionRow.tsx:332
      src/components/sessions/SessionRow.tsx:339
      src/components/sessions/SessionRow.tsx:348
      src/components/sessions/SessionRow.tsx:375
      src/components/sessions/SessionRow.tsx:385
      src/components/sessions/SessionRow.tsx:437
      src/components/sessions/SessionRow.tsx:447
      src/components/data/DatabaseManagement.tsx:251
      src/components/data/DatabaseManagement.tsx:273
      src/components/data/DatabaseManagement.tsx:330
      src/components/data/DatabaseManagement.tsx:334
      src/components/data/DatabaseManagement.tsx:341
      src/components/data/DatabaseManagement.tsx:356
      src/components/data/DatabaseManagement.tsx:366
      src/components/data/DatabaseManagement.tsx:375
      src/components/data/DatabaseManagement.tsx:386
      src/components/data/DatabaseManagement.tsx:440
      src/components/data/DatabaseManagement.tsx:444
      src/components/data/DatabaseManagement.tsx:454
      src/components/data/DatabaseManagement.tsx:467
      src/components/data/DatabaseManagement.tsx:477
      src/components/data/DatabaseManagement.tsx:506
      src/components/settings/DevSettingsCard.tsx:113
      src/components/settings/DevSettingsCard.tsx:143
      src/components/settings/DevSettingsCard.tsx:168
      src/components/settings/DevSettingsCard.tsx:183
      src/components/settings/DevSettingsCard.tsx:216
      src/components/settings/DevSettingsCard.tsx:223
      src/components/settings/DevSettingsCard.tsx:242
      src/components/settings/DevSettingsCard.tsx:260
      src/components/sync/LanPeerNotification.tsx:246
      src/components/sync/LanPeerNotification.tsx:253
      src/components/sync/LanPeerNotification.tsx:273
      src/components/sync/LanPeerNotification.tsx:280
      src/components/sync/LanPeerNotification.tsx:301
      src/components/data/ExportPanel.tsx:63
      src/components/data/ExportPanel.tsx:127
      src/components/data/ExportPanel.tsx:145
      src/components/data/ExportPanel.tsx:159
      src/components/data/ExportPanel.tsx:180
      src/pages/PM.tsx:182
      src/pages/PM.tsx:192
      src/pages/PM.tsx:196
      src/pages/PM.tsx:237
      src/components/pm/PmProjectsList.tsx:216
      src/components/pm/PmProjectsList.tsx:227
      src/components/pm/PmProjectsList.tsx:258
      src/components/pm/PmProjectsList.tsx:259
      src/components/pm/PmProjectsList.tsx:265
      src/components/pm/PmProjectsList.tsx:290
      src/components/pm/PmProjectsList.tsx:301
      src/components/pm/PmProjectsList.tsx:317
      src/components/pm/PmProjectsList.tsx:329
      src/components/pm/PmProjectsList.tsx:355
      src/components/pm/PmProjectsList.tsx:368
      src/components/pm/PmProjectsList.tsx:369
      src/components/pm/PmProjectsList.tsx:374
      src/components/pm/PmProjectsList.tsx:382
      src/pages/Reports.tsx:364
      src/pages/Reports.tsx:380
      src/pages/Reports.tsx:389
      src/pages/Reports.tsx:399
      src/pages/Reports.tsx:423
      src/pages/Reports.tsx:452
      src/pages/Reports.tsx:459
      src/pages/Reports.tsx:466
      src/pages/Reports.tsx:486
      src/pages/Reports.tsx:535
      src/components/sessions/MultiSplitSessionModal.tsx:199
      src/components/sessions/MultiSplitSessionModal.tsx:211
      src/components/sessions/MultiSplitSessionModal.tsx:215
      src/components/sessions/MultiSplitSessionModal.tsx:249
      src/components/sessions/MultiSplitSessionModal.tsx:271
      src/components/sessions/MultiSplitSessionModal.tsx:354
      src/components/layout/Sidebar.tsx:104
      src/components/layout/Sidebar.tsx:106
      src/components/layout/Sidebar.tsx:347
      src/components/layout/Sidebar.tsx:469
      src/components/layout/Sidebar.tsx:497
      src/components/layout/Sidebar.tsx:592
      src/components/layout/Sidebar.tsx:616
      src/components/layout/Sidebar.tsx:618
      src/components/layout/Sidebar.tsx:634
      src/components/layout/Sidebar.tsx:648
      src/pages/Dashboard.tsx:87
      src/pages/Dashboard.tsx:155
      src/pages/Dashboard.tsx:443
      src/pages/Dashboard.tsx:456
      src/pages/Dashboard.tsx:467
      src/pages/Dashboard.tsx:504
      src/pages/Projects.tsx:769
      src/components/sessions/SessionSuggestionBadge.tsx:62
      src/components/sessions/SessionSuggestionBadge.tsx:78
      src/components/layout/BugHunter.tsx:111
      src/components/layout/BugHunter.tsx:122
      src/components/layout/BugHunter.tsx:123
      src/components/layout/BugHunter.tsx:159
      src/components/layout/BugHunter.tsx:183
      src/components/layout/BugHunter.tsx:205
      src/components/layout/BugHunter.tsx:207
      src/components/pm/PmTemplateManager.tsx:193
      src/components/pm/PmTemplateManager.tsx:225
      src/components/pm/PmTemplateManager.tsx:228
      src/components/pm/PmTemplateManager.tsx:231
      src/components/pm/PmTemplateManager.tsx:233
      src/components/pm/PmTemplateManager.tsx:236
      src/components/pm/PmTemplateManager.tsx:238
      src/components/sessions/SessionsProjectContextMenu.tsx:70
      src/components/sessions/SessionsToolbar.tsx:101
      src/components/sessions/SessionsToolbar.tsx:104
      src/components/sessions/SessionsToolbar.tsx:115
      src/components/sessions/SessionsToolbar.tsx:119
      src/components/layout/TopBar.tsx:94
      src/components/layout/TopBar.tsx:98
      src/components/layout/TopBar.tsx:105
      src/components/layout/TopBar.tsx:109
      src/components/layout/TopBar.tsx:109
      src/components/layout/TopBar.tsx:116
      src/components/layout/TopBar.tsx:120
      src/components/layout/SplashScreen.tsx:23
      src/components/dashboard/TimelineChart.tsx:341
      src/components/dashboard/TimelineChart.tsx:347
      src/components/dashboard/TimelineChart.tsx:418
      src/components/dashboard/TimelineChart.tsx:425
      src/components/ai/AiFolderScanCard.tsx:57
      src/components/ai/AiFolderScanCard.tsx:70
      src/components/ai/AiSettingsForm.tsx:186
      src/components/dashboard/MetricCard.tsx:24
      src/components/dashboard/TopProjectsList.tsx:89
      src/components/dashboard/TopProjectsList.tsx:118
      src/components/dashboard/TopProjectsList.tsx:130
      src/components/dashboard/ProjectDayTimeline.tsx:423
      src/components/dashboard/ProjectDayTimeline.tsx:437
      src/components/dashboard/ProjectDayTimeline.tsx:452
      src/components/dashboard/ProjectDayTimeline.tsx:494
      src/components/dashboard/ProjectDayTimeline.tsx:504
      src/components/dashboard/ProjectDayTimeline.tsx:574
      src/components/dashboard/ProjectDayTimeline.tsx:579
      src/components/dashboard/ProjectDayTimeline.tsx:584
      src/components/dashboard/ProjectDayTimeline.tsx:589
      src/components/dashboard/ProjectDayTimeline.tsx:645
      src/components/dashboard/ProjectDayTimeline.tsx:722
      src/components/dashboard/ProjectDayTimeline.tsx:746
      src/components/dashboard/ProjectDayTimeline.tsx:760
      src/components/dashboard/ProjectDayTimeline.tsx:774
      src/components/dashboard/ProjectDayTimeline.tsx:787
      src/components/dashboard/ProjectDayTimeline.tsx:805
      src/components/dashboard/ProjectDayTimeline.tsx:836
      src/components/dashboard/ProjectDayTimeline.tsx:889
      src/components/dashboard/ProjectDayTimeline.tsx:919
      src/components/ai/AiSessionIndicatorsCard.tsx:45
      src/components/dashboard/TopAppsChart.tsx:33

  ⚠ knip/exports                                    ×177
      Unused export: areFileActivitiesEqual
      src/lib/session-utils.ts
      src/lib/user-settings.ts
      src/lib/tauri.ts
      src/lib/normalize.ts
      src/lib/tauri/projects.ts
      src/lib/tauri/dashboard.ts
      src/lib/tauri/applications.ts
      src/lib/tauri/sessions.ts
      src/lib/tauri/ai.ts
      src/lib/tauri/daemon.ts
      src/lib/tauri/manual-sessions.ts
      src/lib/tauri/settings.ts
      src/lib/tauri/data.ts
      src/lib/tauri/database.ts
      src/lib/tauri/lan-sync.ts
      src/lib/tauri/log-management.ts
      src/lib/tauri/pm.ts
      src/lib/utils.ts
      src/lib/help-navigation.ts
      src/lib/background-helpers.ts
      src/components/ui/button.tsx
      src/lib/date-helpers.ts
      src/components/ui/dialog.tsx
      src/components/ui/badge.tsx
      src/lib/online-sync.ts
      src/lib/async-utils.ts
      src/lib/report-templates.ts
      src/components/sync/job-pool-helpers.ts
      src/lib/sync/sync-sse.ts
      src/lib/chart-animation.ts
      src/lib/stacked-bar-series.ts
      src/components/dashboard/project-day-timeline/timeline-calculations.ts
      src/components/ui/select.tsx
      src/lib/sync/sync-storage.ts
      src/lib/sync/sync-runner.ts
      src/lib/sync/sync-http.ts

  ⚠ react-doctor/design-no-default-tailwind-palette ×41
      bg-slate-600 reads as the Tailwind template default — use zinc (true neutral), neutral (warmer), or stone (warmest)
      → Replace `indigo-*` / `gray-*` / `slate-*` with project tokens, your brand color, or a less-default neutral (`zinc`, `neutral`, `stone`)
      src/pages/TimeAnalysis.tsx:196
      src/pages/ReportView.tsx:181
      src/pages/ReportView.tsx:199
      src/pages/ReportView.tsx:227
      src/pages/ReportView.tsx:229
      src/pages/ReportView.tsx:245
      src/pages/ReportView.tsx:250
      src/pages/ReportView.tsx:257
      src/pages/ReportView.tsx:261
      src/pages/ReportView.tsx:275
      src/pages/ReportView.tsx:290
      src/pages/ReportView.tsx:309
      src/pages/ReportView.tsx:310
      src/pages/ReportView.tsx:315
      src/pages/ReportView.tsx:323
      src/pages/ReportView.tsx:337
      src/pages/ReportView.tsx:342
      src/pages/ReportView.tsx:342
      src/pages/ReportView.tsx:361
      src/pages/ReportView.tsx:363
      src/pages/ReportView.tsx:372
      src/pages/ReportView.tsx:393
      src/pages/ReportView.tsx:402
      src/pages/ReportView.tsx:426
      src/pages/ReportView.tsx:431
      src/pages/ReportView.tsx:431
      src/pages/ReportView.tsx:450
      src/pages/ReportView.tsx:452
      src/pages/ReportView.tsx:475
      src/pages/ReportView.tsx:480
      src/pages/ReportView.tsx:480
      src/pages/ReportView.tsx:499
      src/pages/ReportView.tsx:501
      src/pages/ReportView.tsx:507
      src/pages/ReportView.tsx:530
      src/pages/ReportView.tsx:530
      src/App.tsx:139
      src/App.tsx:139
      src/App.tsx:144
      src/App.tsx:147
      src/App.tsx:147

  ⚠ knip/types                                      ×27
      Unused type: FileActivity
      src/lib/db-types.ts
      src/lib/user-settings.ts
      src/lib/tauri/lan-sync.ts
      src/components/ui/button.tsx
      src/components/ui/badge.tsx
      src/lib/online-sync.ts
      src/lib/sync-events.ts
      src/lib/online-sync-types.ts
      src/lib/lan-sync-types.ts
      src/components/dashboard/project-day-timeline/timeline-calculations.ts
      src/components/ui/input.tsx

  ⚠ react-doctor/js-combine-iterations              ×24
      .filter().map() iterates the array twice — combine into a single loop with .reduce() or for...of
      → Combine `.map().filter()` (or similar chains) into a single pass with `.reduce()` or a `for...of` loop to avoid iterating the array twice
      src/components/time-analysis/DailyView.tsx:152
      src/hooks/useSessionSplitAnalysis.ts:123
      src/hooks/useSessionSplitAnalysis.ts:123
      src/components/ManualSessionDialog.tsx:236
      src/pages/ProjectPage.tsx:224
      src/pages/ProjectPage.tsx:238
      src/pages/ProjectPage.tsx:643
      src/pages/ProjectPage.tsx:646
      src/pages/ProjectPage.tsx:684
      src/pages/ProjectPage.tsx:788
      src/pages/ProjectPage.tsx:791
      src/components/import/FileDropzone.tsx:65
      src/components/import/FileDropzone.tsx:141
      src/hooks/useLanSyncManager.ts:167
      src/hooks/useSessionScoreBreakdown.ts:174
      src/hooks/useSessionScoreBreakdown.ts:185
      src/components/sessions/MultiSplitSessionModal.tsx:137
      src/components/sessions/MultiSplitSessionModal.tsx:332
      src/lib/stacked-bar-series.ts:40
      src/components/pm/PmTemplateManager.tsx:165
      src/components/dashboard/TimelineChart.tsx:159
      src/components/dashboard/TimelineChart.tsx:284
      src/components/dashboard/project-day-timeline/timeline-calculations.ts:350
      src/components/dashboard/project-day-timeline/timeline-calculations.ts:360

  ⚠ react-doctor/no-array-index-as-key              ×23
      Array index "i" used as key — causes bugs when list is reordered or filtered
      → Use a stable unique identifier: `key={item.id}` or `key={item.slug}` — index keys break on reorder/filter
      src/components/time-analysis/WeeklyView.tsx:116
      src/components/project-page/ProjectEstimatesSection.tsx:191
      src/components/project/ProjectSessionDetailDialog.tsx:151
      src/pages/TimeAnalysis.tsx:147
      src/pages/TimeAnalysis.tsx:177
      src/components/help/help-shared.tsx:73
      src/components/time-analysis/DailyView.tsx:98
      src/components/project/ProjectCard.tsx:299
      src/components/settings/LanSyncCard.tsx:183
      src/components/import/FileDropzone.tsx:144
      src/pages/QuickStart.tsx:136
      src/components/sessions/SessionRow.tsx:216
      src/components/sessions/SessionRow.tsx:409
      src/components/sessions/MultiSplitSessionModal.tsx:266
      src/components/sessions/MultiSplitSessionModal.tsx:341
      src/pages/Dashboard.tsx:494
      src/components/pm/PmCreateProjectDialog.tsx:181
      src/components/pm/PmTemplateManager.tsx:168
      src/components/dashboard/TimelineChart.tsx:333
      src/components/dashboard/TopProjectsList.tsx:69
      src/components/dashboard/ProjectDayTimeline.tsx:552
      src/components/dashboard/ProjectDayTimeline.tsx:911
      src/components/dashboard/TopAppsChart.tsx:27

  ⚠ react-doctor/no-react19-deprecated-apis         ×22
      forwardRef is no longer needed on React 19+ — refs are regular props on function components; remove forwardRef and pass ref directly
      → Pass `ref` as a regular prop on function components — `forwardRef` is no longer needed in React 19+. Replace `useContext(X)` with `use(X)` for branch-aware context reads. Only enabled on projects detected as React 19+.
      src/components/ui/progress.tsx:5
      src/components/ui/card.tsx:4
      src/components/ui/card.tsx:18
      src/components/ui/card.tsx:25
      src/components/ui/card.tsx:32
      src/components/ui/card.tsx:39
      src/components/ui/tabs.tsx:7
      src/components/ui/tabs.tsx:22
      src/components/ui/tabs.tsx:37
      src/components/ui/input.tsx:6
      src/components/ui/toast-notification.tsx:1
      src/components/ui/select.tsx:10
      src/components/ui/select.tsx:30
      src/components/ui/select.tsx:58
      src/components/ui/button.tsx:41
      src/components/ui/dialog.tsx:11
      src/components/ui/dialog.tsx:26
      src/components/ui/dialog.tsx:53
      src/components/ui/dialog.tsx:61
      src/components/ui/switch.tsx:4
      src/components/ui/tooltip.tsx:9
      src/components/ui/label.tsx:4

  ⚠ react-doctor/no-cascading-set-state             ×21
      5 setState calls in a single useEffect — consider using useReducer or deriving state
      → Combine into useReducer: `const [state, dispatch] = useReducer(reducer, initialState)`
      src/hooks/useSettingsDemoMode.ts:27
      src/components/time-analysis/useTimeAnalysisData.ts:86
      src/hooks/useBackgroundStartup.ts:23
      src/pages/Estimates.tsx:90
      src/hooks/useSessionsFilters.ts:82
      src/components/project/ProjectContextMenu.tsx:80
      src/hooks/useSessionSplitAnalysis.ts:47
      src/hooks/useProjectsData.ts:140
      src/hooks/useProjectsData.ts:172
      src/hooks/useProjectsData.ts:216
      src/pages/ReportView.tsx:58
      src/components/ManualSessionDialog.tsx:66
      src/components/settings/LanSyncCard.tsx:332
      src/hooks/settings/useSettingsGuards.ts:18
      src/pages/ProjectPage.tsx:282
      src/hooks/useSessionsData.ts:78
      src/hooks/useLanSyncManager.ts:198
      src/components/sync/SyncProgressOverlay.tsx:42
      src/hooks/useSessionScoreBreakdown.ts:72
      src/components/pm/PmCreateProjectDialog.tsx:33
      src/components/layout/SplashScreen.tsx:8

  ⚠ react-doctor/prefer-useReducer                  ×21
      Component "Estimates" has 13 useState calls — consider useReducer for related state
      → Group related state: `const [state, dispatch] = useReducer(reducer, { field1, field2, ... })`
      src/pages/Estimates.tsx:38
      src/pages/Applications.tsx:36
      src/pages/AI.tsx:131
      src/pages/ReportView.tsx:18
      src/components/ManualSessionDialog.tsx:51
      src/components/settings/LanSyncCard.tsx:287
      src/pages/ProjectPage.tsx:141
      src/components/data/ImportPanel.tsx:23
      src/components/data/DatabaseManagement.tsx:28
      src/pages/Sessions.tsx:61
      src/components/settings/DevSettingsCard.tsx:25
      src/components/sync/LanPeerNotification.tsx:78
      src/components/data/ExportPanel.tsx:16
      src/pages/PM.tsx:107
      src/components/layout/Sidebar.tsx:123
      src/pages/Dashboard.tsx:183
      src/components/pm/PmCreateProjectDialog.tsx:21
      src/pages/Projects.tsx:130
      src/components/layout/BugHunter.tsx:30
      src/components/pm/PmProjectDetailDialog.tsx:26
      src/components/dashboard/ProjectDayTimeline.tsx:66

  ⚠ react-doctor/rendering-hydration-mismatch-time  ×21
      new Date() reachable from JSX renders differently on server vs client — wrap in useEffect+useState (client-only) or add suppressHydrationWarning to the parent if intentional
      → Wrap dynamic time/random values in useEffect+useState (client-only) or add suppressHydrationWarning to the parent if intentional
      src/components/settings/LanSyncCard.tsx:545
      src/components/settings/LanSyncCard.tsx:545
      src/components/settings/LanSyncCard.tsx:803
      src/components/settings/LanSyncCard.tsx:803
      src/pages/ProjectPage.tsx:1002
      src/pages/ProjectPage.tsx:1002
      src/pages/ProjectPage.tsx:1002
      src/components/settings/OnlineSyncCard.tsx:130
      src/components/settings/OnlineSyncCard.tsx:130
      src/components/settings/OnlineSyncCard.tsx:130
      src/components/data/DataHistory.tsx:187
      src/components/data/DataHistory.tsx:187
      src/components/data/DataHistory.tsx:187
      src/components/sync/SyncProgressOverlay.tsx:153
      src/components/sync/SyncProgressOverlay.tsx:153
      src/components/data/DatabaseManagement.tsx:345
      src/components/data/DatabaseManagement.tsx:456
      src/components/layout/Sidebar.tsx:556
      src/components/ai/AiFolderScanCard.tsx:39
      src/components/ai/AiFolderScanCard.tsx:39
      src/components/ai/AiFolderScanCard.tsx:39

  ⚠ react-doctor/no-giant-component                 ×20
      Component "Estimates" is 482 lines — consider breaking it into smaller focused components
      → Extract logical sections into focused components: `<UserHeader />`, `<UserActions />`, etc.
      src/pages/Estimates.tsx:38
      src/pages/Applications.tsx:36
      src/components/project/ProjectCard.tsx:58
      src/pages/AI.tsx:131
      src/pages/ReportView.tsx:18
      src/components/settings/LanSyncCard.tsx:216
      src/pages/ProjectPage.tsx:141
      src/pages/DaemonControl.tsx:26
      src/components/settings/OnlineSyncCard.tsx:52
      src/components/data/DatabaseManagement.tsx:28
      src/pages/Sessions.tsx:61
      src/components/pm/PmProjectsList.tsx:97
      src/pages/Reports.tsx:235
      src/components/sessions/MultiSplitSessionModal.tsx:83
      src/pages/Settings.tsx:34
      src/components/layout/Sidebar.tsx:123
      src/pages/Dashboard.tsx:183
      src/pages/Projects.tsx:130
      src/components/dashboard/TimelineChart.tsx:103
      src/components/dashboard/ProjectDayTimeline.tsx:54

  ⚠ react-doctor/design-no-bold-heading             ×13
      font-bold on <h2> crushes counter shapes at display sizes — use font-semibold (600) or font-medium (500)
      → Use `font-semibold` (600) or `font-medium` (500) on headings — 700+ crushes letter counter shapes at display sizes
      src/components/reports/ReportTemplateSelector.tsx:30
      src/components/help/help-shared.tsx:68
      src/pages/ReportView.tsx:195
      src/pages/ReportView.tsx:275
      src/pages/ReportView.tsx:310
      src/pages/ReportView.tsx:337
      src/pages/ReportView.tsx:393
      src/pages/ReportView.tsx:426
      src/pages/ReportView.tsx:475
      src/components/data/DataHistory.tsx:111
      src/pages/Data.tsx:18
      src/pages/Data.tsx:32
      src/components/sessions/MultiSplitSessionModal.tsx:200

  ⚠ react-doctor/js-tosorted-immutable              ×12
      [...array].sort() — use array.toSorted() for immutable sorting (ES2023)
      → Use `array.toSorted()` (ES2023) instead of `[...array].sort()` for immutable sorting without the spread allocation
      src/pages/Applications.tsx:246
      src/pages/PM.tsx:44
      src/pages/PM.tsx:140
      src/components/pm/PmProjectsList.tsx:120
      src/components/pm/PmProjectsList.tsx:143
      src/components/pm/PmProjectsList.tsx:150
      src/pages/Projects.tsx:55
      src/pages/Projects.tsx:252
      src/components/pm/PmClientsList.tsx:58
      src/components/dashboard/project-day-timeline/timeline-calculations.ts:216
      src/components/dashboard/project-day-timeline/timeline-calculations.ts:567
      src/components/dashboard/project-day-timeline/timeline-calculations.ts:580

  ⚠ jsx-a11y/label-has-associated-control           ×12
      A form label must have accessible text.
      → Ensure the label either has text inside it or is accessibly labelled using an attribute such as `aria-label`, or `aria-labelledby`. You can mark more attributes as accessible labels by configuring the `labelAttributes` option.
      src/components/settings/DemoModeCard.tsx:55
      src/components/settings/SessionManagementCard.tsx:126
      src/components/settings/LanSyncCard.tsx:430
      src/components/settings/LanSyncCard.tsx:449
      src/components/settings/AppearanceCard.tsx:27
      src/components/settings/OnlineSyncCard.tsx:166
      src/components/settings/OnlineSyncCard.tsx:185
      src/components/settings/OnlineSyncCard.tsx:230
      src/components/ui/label.tsx:8
      src/components/data/ExportPanel.tsx:112
      src/components/settings/SessionSplitCard.tsx:93
      src/components/ai/AiSessionIndicatorsCard.tsx:39

  ⚠ react-doctor/rerender-functional-setstate       ×12
      setProject({ ...project, ... }) — use functional update `setProject(prev => ({ ...prev, ... }))` to avoid stale closures
      → Use the callback form: `setState(prev => prev + 1)` to always read the latest value
      src/pages/ProjectPage.tsx:743
      src/components/data/DatabaseManagement.tsx:166
      src/components/data/DatabaseManagement.tsx:316
      src/components/layout/BugHunter.tsx:55
      src/components/pm/PmTemplateManager.tsx:141
      src/components/pm/PmTemplateManager.tsx:154
      src/components/pm/PmProjectDetailDialog.tsx:115
      src/components/pm/PmProjectDetailDialog.tsx:120
      src/components/pm/PmProjectDetailDialog.tsx:126
      src/components/pm/PmProjectDetailDialog.tsx:132
      src/components/pm/PmProjectDetailDialog.tsx:137
      src/components/pm/PmProjectDetailDialog.tsx:142

  ⚠ react-doctor/async-await-in-loop                ×11
      await inside a while-loop runs the calls sequentially — for independent operations, collect them and use `await Promise.all(items.map(...))` to run them concurrently
      → Collect the items and use `await Promise.all(items.map(...))` to run independent operations concurrently
      src/lib/sync/sync-sse.ts:88
      src/hooks/useJobPool.ts:189
      src/pages/DaemonControl.tsx:147
      src/components/sync/job-pool-helpers.ts:83
      src/hooks/useSessionScoreBreakdown.ts:207
      src/components/sync/LanPeerNotification.tsx:174
      src/components/layout/Sidebar.tsx:193
      src/lib/session-pagination.ts:34
      src/lib/sync/sync-http.ts:74
      src/lib/sync/sync-http.ts:205
      src/lib/sync/sync-runner.ts:249

  ⚠ jsx-a11y/no-static-element-interactions         ×10
      Static HTML elements with event handlers require a role.
      → Add a role attribute to this element, or use a semantic HTML element instead.
      src/components/projects/ProjectList.tsx:47
      src/components/project/ProjectManualSessionsCard.tsx:55
      src/components/project/ProjectSessionsTable.tsx:143
      src/components/settings/LanSyncCard.tsx:843
      src/components/settings/LanSyncCard.tsx:848
      src/components/data/ImportPanel.tsx:96
      src/components/sessions/SessionsVirtualList.tsx:134
      src/components/settings/DevSettingsCard.tsx:189
      src/components/layout/Sidebar.tsx:306
      src/components/layout/TopBar.tsx:76

  ⚠ react-doctor/rerender-state-only-in-handlers    ×9
      useState "dataReloadVersion" is updated but never read in the component's return — use useRef so updates don't trigger re-renders
      → Replace useState with useRef when the value is only mutated and never read in render — `ref.current = ...` updates without re-rendering the component
      src/pages/Estimates.tsx:63
      src/pages/Applications.tsx:57
      src/pages/ReportView.tsx:30
      src/components/ManualSessionDialog.tsx:64
      src/pages/ProjectPage.tsx:168
      src/pages/ProjectPage.tsx:260
      src/pages/DaemonControl.tsx:37
      src/pages/Dashboard.tsx:205
      src/components/layout/SplashScreen.tsx:5

  ⚠ react-doctor/js-set-map-lookups                 ×9
      array.indexOf() in a loop is O(n) per call — convert to a Set for O(1) lookups
      → Use a `Set` or `Map` for repeated membership tests / keyed lookups — `Array.includes`/`find` is O(n) per call
      src/lib/sync/sync-sse.ts:95
      src/pages/PM.tsx:34
      src/pages/PM.tsx:75
      src/pages/PM.tsx:79
      src/pages/PM.tsx:79
      src/components/pm/PmProjectsList.tsx:133
      src/pages/Projects.tsx:670
      src/components/pm/PmClientsList.tsx:34
      src/components/pm/PmClientsList.tsx:55

  ⚠ jsx-a11y/click-events-have-key-events           ×8
      Enforce a clickable non-interactive element has at least one keyboard event listener.
      → Visible, non-interactive elements with click handlers must have one of `keyup`, `keydown`, or `keypress` listener.
      src/components/projects/ProjectList.tsx:47
      src/components/project/ProjectManualSessionsCard.tsx:55
      src/components/project/ProjectSessionsTable.tsx:143
      src/components/settings/LanSyncCard.tsx:843
      src/components/settings/LanSyncCard.tsx:848
      src/components/data/ImportPanel.tsx:96
      src/components/sessions/SessionsVirtualList.tsx:134
      src/components/settings/DevSettingsCard.tsx:189

  ⚠ react-doctor/no-render-in-render                ×8
      Inline render function "renderDuplicateMarker()" — extract to a separate component for proper reconciliation
      → Extract to a named component: `const ListItem = ({ item }) => <div>{item.name}</div>`
      src/components/projects/ProjectList.tsx:93
      src/components/projects/ProjectsList.tsx:259
      src/components/project/ProjectCard.tsx:218
      src/components/project/ProjectCard.tsx:306
      src/components/projects/ExcludedProjectsList.tsx:61
      src/components/sessions/SessionRow.tsx:293
      src/components/sessions/SessionRow.tsx:469
      src/pages/Projects.tsx:821

  ⚠ react-doctor/prefer-dynamic-import              ×8
      "recharts" is a heavy library — use React.lazy() or next/dynamic for code splitting
      → Use `const Component = dynamic(() => import('library'), { ssr: false })` from next/dynamic or React.lazy()
      src/components/time-analysis/WeeklyView.tsx:1
      src/pages/TimeAnalysis.tsx:2
      src/components/time-analysis/DailyView.tsx:1
      src/components/time-analysis/MonthlyView.tsx:1
      src/components/dashboard/TimelineChart.tsx:20
      src/components/dashboard/HourlyBreakdown.tsx:11
      src/components/ai/AiMetricsCharts.tsx:14
      src/components/dashboard/AllProjectsChart.tsx:11

  ⚠ react-doctor/design-no-redundant-padding-axes   ×6
      px-0.5 py-0.5 → use the shorthand p-0.5
      → Collapse `px-N py-N` to `p-N` when both axes match. Keep them split only when one axis varies at a breakpoint (`py-2 md:py-3`)
      src/components/projects/ProjectList.tsx:83
      src/pages/ProjectPage.tsx:999
      src/pages/ProjectPage.tsx:1012
      src/pages/ProjectPage.tsx:1058
      src/pages/Reports.tsx:418
      src/components/layout/Sidebar.tsx:400

  ⚠ react-doctor/js-hoist-intl                      ×4
      new Intl.NumberFormat() inside a function — hoist to module scope or wrap in useMemo so it isn't recreated each call
      → Hoist `new Intl.NumberFormat(...)` to module scope or wrap in `useMemo` — Intl constructors allocate dozens of objects per locale lookup
      src/pages/Estimates.tsx:68
      src/pages/Estimates.tsx:77
      src/pages/Applications.tsx:63
      src/lib/utils.ts:80

  ⚠ react-doctor/no-many-boolean-props              ×4
      Component "ProjectDiscoveryPanel" takes 4 boolean-like props (isFolderLoadError, isDemoMode, isClearingCandidates…) — consider compound components or explicit variants instead of stacking flags
      → Split into compound components or named variants: `<Button.Primary />`, `<DialogConfirm />` instead of stacking `isPrimary`, `isConfirm` flags
      src/components/projects/ProjectDiscoveryPanel.tsx:144
      src/components/project/ProjectCard.tsx:58
      src/components/settings/LanSyncCard.tsx:216
      src/components/sessions/SessionsVirtualList.tsx:66

  ⚠ react-doctor/design-no-space-on-flex-children   ×4
      space-y-8 on a flex/grid parent — use gap-y-8 instead. Per-sibling margins phantom-gap on conditional render and don't mirror in RTL
      → Use `gap-*` on the flex/grid parent. `space-x-*` / `space-y-*` produce phantom gaps when a sibling is conditionally rendered, lose vertical spacing on wrapped lines, and don't mirror in RTL
      src/pages/Help.tsx:74
      src/components/data/DataStats.tsx:70
      src/pages/QuickStart.tsx:105
      src/components/layout/BugHunter.tsx:121

  ⚠ react-doctor/no-derived-state-effect            ×3
      Derived state in useEffect — wrap the calculation in useMemo([deps]) (or compute it directly during render if it isn't expensive)
      → For derived state, compute inline: `const x = fn(dep)`. For state resets on prop change, use a key prop: `<Component key={prop} />`. See https://react.dev/learn/you-might-not-need-an-effect
      src/hooks/useLanSyncManager.ts:36
      src/components/sessions/MultiSplitSessionModal.tsx:97
      src/pages/Projects.tsx:541

  ⚠ react-doctor/no-tiny-text                       ×3
      Font size 11px is too small — body text should be at least 12px for readability, 16px is ideal
      → Use at least 12px for body content, 16px is ideal. Small text is hard to read, especially on high-DPI mobile screens
      src/components/dashboard/TimelineChart.tsx:333
      src/components/dashboard/TimelineChart.tsx:340
      src/components/dashboard/TimelineChart.tsx:346

  ⚠ knip/files                                      ×3
      Unused file
      → This file is not imported by any other file in the project.
      run_tsc.js
      src/components/dashboard/HourlyBreakdown.tsx
      src/components/settings/types.ts

  ⚠ react-doctor/design-no-em-dash-in-jsx-text      ×2
      Em dash (—) in JSX text reads as model output — replace with comma, colon, semicolon, or parentheses
      → Replace em dashes in JSX text with commas, colons, semicolons, periods, or parentheses — em dashes read as model-output filler
      src/components/settings/LanSyncCard.tsx:545
      src/components/pm/PmProjectDetailDialog.tsx:154

  ⚠ react-doctor/js-flatmap-filter                  ×2
      .map().filter(Boolean) iterates twice — use .flatMap() to transform and filter in a single pass
      → Use `.flatMap(item => condition ? [value] : [])` — transforms and filters in a single pass instead of creating an intermediate array
      src/pages/Projects.tsx:721
      src/components/pm/PmTemplateManager.tsx:74

  ⚠ react-doctor/js-length-check-first
      .every() over an array compared to another array — short-circuit with `a.length === b.length && a.every(...)` so unequal-length arrays exit immediately
      → Short-circuit with `a.length === b.length && a.every((x, i) => x === b[i])` — unequal-length arrays exit immediately
      src/store/background-status-store.ts:25

  ⚠ react-doctor/rendering-usetransition-loading
      useState for "isLoading" — if this guards a state transition (not an async fetch), consider useTransition instead
      → Replace with `const [isPending, startTransition] = useTransition()` — avoids a re-render for the loading state
      src/components/time-analysis/useTimeAnalysisData.ts:30

  ⚠ react-doctor/no-derived-useState
      useState initialized from prop "initialValue" — if this value should stay in sync with the prop, derive it during render instead
      → Remove useState and compute the value inline: `const value = transform(propName)`
      src/components/ui/prompt-modal.tsx:39

  ⚠ react-doctor/prefer-use-effect-event
      "onFinished" is read only inside `setTimeout` — wrap it with useEffectEvent and remove it from the dep array so the effect doesn't re-synchronize on every parent render
      → Wrap the callback with `useEffectEvent(callback)` (React 19+) and call the resulting binding from inside the sub-handler. The Effect Event captures the latest props/state without being a reactive dep, so the effect doesn't re-subscribe on every parent render. See https://react.dev/reference/react/useEffectEvent
      src/components/sync/SyncProgressOverlay.tsx:98

  ⚠ react-doctor/no-effect-event-handler
      useEffect simulating an event handler — move logic to an actual event handler instead
      → Move the conditional logic into onClick, onChange, or onSubmit handlers directly
      src/components/sync/DaemonSyncOverlay.tsx:58

  ⚠ react-doctor/js-index-maps
      array.find() in a loop is O(n*m) — build a Map for O(1) lookups
      → Build an index `Map` once outside the loop instead of `array.find(...)` inside it
      src/pages/Projects.tsx:669

  ⚠ react-doctor/js-cache-property-access
      p.prj_client.toUpperCase is read 3 times inside this loop — hoist into a const at the top of the loop body
      → Hoist the deep member access into a const at the top of the loop body: `const { x, y } = obj.deeply.nested`
      src/components/pm/PmClientsList.tsx:48

  ⚠ react-doctor/js-min-max-loop
      array.sort()[0] for min/max — use Math.min(...array) instead (O(n) vs O(n log n))
      → Use `Math.min(...array)` / `Math.max(...array)` instead of sorting just to read the first or last element
      src/components/dashboard/TimelineChart.tsx:159

  ⚠ react-doctor/rerender-memo-with-default-value
      Default prop value [] creates a new array reference every render — extract to a module-level constant
      → Move to module scope: `const EMPTY_ITEMS: Item[] = []` then use as the default value
      src/components/dashboard/ProjectDayTimeline.tsx:56

  ┌─────┐  70 / 100 Needs work
  │ • • │  ███████████████████████████████████░░░░░░░░░░░░░░░
  │  ─  │  React Doctor (www.react.doctor)
  └─────┘

  988 issues across 163/223 files  in 1.0s
  Full diagnostics written to /var/folders/mh/pdxysvws74v3zq32ky1z1r680000gn/T/react-doctor-f0a7d440-f11b-46e0-b35d-ebfc1ea9745c

  → Share your results: https://www.react.doctor/share?p=dashboard&s=70&w=988&f=163

