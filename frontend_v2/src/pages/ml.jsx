/* global React, Icon, Stepper, StageUpload, StagePreproc, StageModels, StageTrain, StagePredict */
const { useState: useStateMLPage } = React;

const ML_STEPS = ['Upload Data', 'Preprocessing', 'Pilih Model', 'Train & Compare', 'Prediksi'];

function MLPage() {
  const [stage, setStage] = useStateMLPage(0);
  const [completed, setCompleted] = useStateMLPage([]);

  // Shared state across stages
  const [dataset, setDataset] = useStateMLPage(null);
  const [target, setTarget] = useStateMLPage('');
  const [featureCols, setFeatureCols] = useStateMLPage([]);
  const [groupCol, setGroupCol] = useStateMLPage('');
  const [classWeightBalanced, setClassWeightBalanced] = useStateMLPage(false);
  const [missingStrategy, setMissingStrategy] = useStateMLPage('mean');
  const [normalize, setNormalize] = useStateMLPage('standard');
  const [splitPct, setSplitPct] = useStateMLPage(80);
  const [selectedModels, setSelectedModels] = useStateMLPage(['svm', 'rf', 'lr']);
  const [hyperOverrides, setHyperOverrides] = useStateMLPage({});
  const [trainResult, setTrainResult] = useStateMLPage(null);

  const goNext = () => {
    setCompleted(c => Array.from(new Set([...c, stage])));
    setStage(s => Math.min(s + 1, ML_STEPS.length - 1));
  };
  const goBack = () => setStage(s => Math.max(s - 1, 0));
  const handleReset = () => {
    setDataset(null); setTarget(''); setFeatureCols([]); setTrainResult(null);
    setGroupCol(''); setClassWeightBalanced(false);
    setCompleted([]); setStage(0);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumb">Analisis <Icon.Chev /> Machine Learning</div>
          <h2>Machine Learning</h2>
          <p className="subtitle">Upload data fitur EEG, latih model klasifikasi, dan prediksi kategori ALS vs Normal.</p>
        </div>
        <div className="page-head-actions">
          <button className="fpill"><Icon.Database /> {dataset ? `Dataset: ${dataset.filename}` : 'Dataset: belum upload'}</button>
          <button className="fpill"><Icon.Target /> Target: {target || '—'}</button>
          <button className="btn btn-primary" onClick={handleReset}><Icon.Refresh /> Reset Pipeline</button>
        </div>
      </div>

      <Stepper steps={ML_STEPS} current={stage} completed={completed} onJump={setStage} />

      {stage === 0 && (
        <StageUpload onNext={goNext}
          dataset={dataset} setDataset={setDataset}
          target={target} setTarget={setTarget}
          featureCols={featureCols} setFeatureCols={setFeatureCols}
          groupCol={groupCol} setGroupCol={setGroupCol} />
      )}
      {stage === 1 && (
        <StagePreproc onBack={goBack} onNext={goNext}
          dataset={dataset}
          missingStrategy={missingStrategy} setMissingStrategy={setMissingStrategy}
          normalize={normalize} setNormalize={setNormalize}
          splitPct={splitPct} setSplitPct={setSplitPct}
          target={target} featureCols={featureCols} />
      )}
      {stage === 2 && (
        <StageModels onBack={goBack} onNext={goNext}
          selected={selectedModels} setSelected={setSelectedModels}
          hyperOverrides={hyperOverrides} setHyperOverrides={setHyperOverrides} />
      )}
      {stage === 3 && (
        <StageTrain onBack={goBack} onNext={goNext}
          dataset={dataset} target={target} featureCols={featureCols}
          missingStrategy={missingStrategy} normalize={normalize} splitPct={splitPct}
          selected={selectedModels} hyperOverrides={hyperOverrides}
          groupCol={groupCol} classWeightBalanced={classWeightBalanced} setClassWeightBalanced={setClassWeightBalanced}
          trainResult={trainResult} setTrainResult={setTrainResult} />
      )}
      {stage === 4 && (
        <StagePredict onBack={goBack} trainResult={trainResult} />
      )}
    </div>
  );
}

Object.assign(window, { MLPage });
