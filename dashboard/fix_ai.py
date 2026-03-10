import re

with open('src/pages/AI.tsx', 'r', encoding='utf-8') as f:
    text = f.read()

# We look for the marker of useEffect
start_marker = "  useEffect(() => {\n    void refreshModelData();"
start_idx = text.find(start_marker)

# We look for the marker of handleRunAutoSafe
end_marker = "  const handleRunAutoSafe = async () => {"
end_idx = text.find(end_marker)

if start_idx != -1 and end_idx != -1:
    before = text[:start_idx]
    after = text[end_idx:]
    
    replacement = """  useEffect(() => {
    void refreshModelData();
    const interval = setInterval(() => {
      void refreshModelData(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [refreshModelData]);

  const handleRefreshStatus = async () => {
    if (refreshingStatus) return;

    setRefreshingStatus(true);
    try {
      await refreshModelData();
    } finally {
      setRefreshingStatus(false);
    }
  };

  const handleSaveMode = async () => {
    setSavingMode(true);
    try {
      const normalizedSuggest = clampNumber(suggestConf, 0, 1);
      const normalizedAuto = clampNumber(autoConf, 0, 1);
      const normalizedEvidence = Math.round(clampNumber(autoEvidence, 1, 50));

      await setAssignmentMode(
        mode,
        normalizedSuggest,
        normalizedAuto,
        normalizedEvidence,
      );
      const freshStatus = await getAssignmentModelStatus();
      syncFromStatus(freshStatus, true);
      const freshFw = await getFeedbackWeight();
      setFeedbackWeight(freshFw);
      await fetchMetrics(true);
    } catch (e) {
      console.error(e);
      showError(
        tr('ai_page.text.failed_to_save_model_settings') + ` ${String(e)}`,
      );
    } finally {
      setSavingMode(false);
    }
  };

  const handleTrainNow = async () => {
    setTraining(true);
    try {
      const nextStatus = await trainAssignmentModel(true);
      syncFromStatus(nextStatus);
      await fetchMetrics(true);
      showInfo(tr('ai_page.text.model_training_completed'));
    } catch (e) {
      console.error(e);
      await fetchStatus();
      showError(
        tr('ai_page.text.model_training_failed') +
          ` ${String(e)}`,
      );
    } finally {
      setTraining(false);
    }
  };

  const handleResetKnowledge = async () => {
    const confirmed = await confirm(
      tr('ai_page.prompts.reset_knowledge_confirm'),
    );
    if (!confirmed) return;

    setResettingKnowledge(true);
    try {
      const nextStatus = await resetAssignmentModelKnowledge();
      dirtyRef.current = false;
      syncFromStatus(nextStatus, true);
      await fetchMetrics(true);
      triggerRefresh('ai_knowledge_reset');
      showInfo(tr('ai_page.info.knowledge_reset'));
    } catch (e) {
      console.error(e);
      showError(`${tr('ai_page.errors.knowledge_reset_failed')} ${String(e)}`);
    } finally {
      setResettingKnowledge(false);
    }
  };

"""
    with open('src/pages/AI.tsx', 'w', encoding='utf-8') as f:
        f.write(before + replacement + after)
    print("Fixed AI.tsx")
else:
    print(f"Could not find markers. start_idx: {start_idx}, end_idx: {end_idx}")
